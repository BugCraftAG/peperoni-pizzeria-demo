//! Peperoni-Server: liefert die Website aus und stellt unter /api
//! Konten (Login merken), Bestellungen und den Bestellverlauf bereit.

pub mod auth;
pub mod error;
pub mod menu;
pub mod notify;
pub mod order;
pub mod pricing;
pub mod routes;

use axum::http::{header, HeaderValue};
use axum::Router;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub web_dir: String,
    pub bind: String,
    /// Empfänger für den WhatsApp-Link
    pub whatsapp_target: String,
    /// Demo: Öffnungszeiten werden nicht erzwungen
    pub demo: bool,
    pub cookie_secure: bool,
    pub admin_token: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let var = |k: &str, d: &str| std::env::var(k).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| d.to_string());
        let flag = |k: &str, d: bool| std::env::var(k).map(|v| matches!(v.as_str(), "1" | "true" | "yes")).unwrap_or(d);
        Self {
            database_url: var("DATABASE_URL", "sqlite://peperoni.db"),
            web_dir: var("WEB_DIR", "../web"),
            bind: var("BIND", "0.0.0.0:8080"),
            whatsapp_target: var("WHATSAPP_TARGET", "+436645112794"),
            demo: flag("PEPERONI_DEMO", true),
            cookie_secure: flag("COOKIE_SECURE", false),
            admin_token: std::env::var("ADMIN_TOKEN").ok().filter(|t| t.len() >= 16),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub cfg: Arc<Config>,
    pub limiter: Arc<routes::Limiter>,
    pub notifier: notify::Notifier,
}

pub async fn connect(url: &str) -> Result<SqlitePool, sqlx::Error> {
    let opts = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));
    let pool = SqlitePoolOptions::new().max_connections(if url.contains(":memory:") { 1 } else { 8 }).connect_with(opts).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

pub fn app(state: AppState) -> Router {
    let web = state.cfg.web_dir.clone();
    let static_files = ServeDir::new(&web).append_index_html_on_directories(true).not_found_service(ServeFile::new(format!("{web}/index.html")));
    Router::new()
        .nest("/api", routes::router())
        .fallback_service(static_files)
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::overriding(header::REFERRER_POLICY, HeaderValue::from_static("strict-origin-when-cross-origin")))
        .layer(SetResponseHeaderLayer::if_not_present(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")))
        .layer(SetResponseHeaderLayer::overriding(header::HeaderName::from_static("x-robots-tag"), HeaderValue::from_static("noindex, nofollow")))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
