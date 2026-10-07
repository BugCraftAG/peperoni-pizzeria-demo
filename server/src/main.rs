use peperoni_server::{app, auth, connect, notify::Notifier, routes::Limiter, AppState, Config};
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    // `peperoni-server healthcheck` → für den Docker-HEALTHCHECK (kein curl im Image nötig)
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        std::process::exit(if healthcheck() { 0 } else { 1 });
    }
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=warn,sqlx=warn".into())).init();
    let cfg = Config::from_env();
    let db = connect(&cfg.database_url).await.expect("Datenbank nicht erreichbar");
    let notifier = Notifier::from_env();
    tracing::info!(bind = %cfg.bind, demo = cfg.demo, notify = notifier.enabled(), web = %cfg.web_dir, "Peperoni-Server startet");

    // abgelaufene Sitzungen stündlich aufräumen
    let cleanup = db.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            tick.tick().await;
            if let Ok(n) = auth::purge_expired(&cleanup).await { if n > 0 { tracing::info!(n, "Sitzungen aufgeräumt"); } }
        }
    });

    let state = AppState { db, cfg: Arc::new(cfg.clone()), limiter: Arc::new(Limiter::default()), notifier };
    let listener = tokio::net::TcpListener::bind(&cfg.bind).await.expect("Port belegt?");
    axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown())
        .await
        .expect("Server-Fehler");
}

/// Docker stoppt mit SIGTERM, im Terminal kommt Strg+C
async fn shutdown() {
    let ctrl_c = async { let _ = tokio::signal::ctrl_c().await; };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) { s.recv().await; }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("Server wird beendet");
}

fn healthcheck() -> bool {
    use std::io::{Read, Write};
    let port = std::env::var("BIND").ok().and_then(|b| b.rsplit(':').next().map(str::to_string)).unwrap_or_else(|| "8080".into());
    let Ok(mut s) = std::net::TcpStream::connect(format!("127.0.0.1:{port}")) else { return false };
    let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(3)));
    if s.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n").is_err() { return false; }
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.0 200") || buf.starts_with("HTTP/1.1 200")
}
