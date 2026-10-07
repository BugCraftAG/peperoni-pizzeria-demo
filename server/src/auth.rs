//! Passwörter (Argon2id) und Sitzungen ("angemeldet bleiben").

use crate::error::{ApiError, ApiResult};
use crate::AppState;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

pub const COOKIE: &str = "pep_session";
pub const REMEMBER_DAYS: i64 = 30;
const SHORT_HOURS: i64 = 12;

pub async fn hash_password(pw: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default().hash_password(pw.as_bytes(), &salt).map(|h| h.to_string())
    })
    .await
    .ok()
    .and_then(Result::ok)
    .ok_or_else(|| ApiError(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "Interner Fehler.".into()))
}

pub async fn verify_password(pw: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok()).unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Gleich teure Prüfung, auch wenn es die E-Mail nicht gibt (verrät nichts über Konten)
pub async fn dummy_verify() {
    static DUMMY: &str = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Vw2pV3kUqk0b6m8C2C1s8zFJbB1pQ9Kp2n4cQwz8m9Q";
    let _ = verify_password("x".into(), DUMMY.into()).await;
}

fn token_hash(token: &str) -> String { hex::encode(Sha256::digest(token.as_bytes())) }

fn now() -> i64 { chrono::Utc::now().timestamp() }

pub async fn create_session(state: &AppState, jar: CookieJar, user_id: i64, remember: bool) -> ApiResult<CookieJar> {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let token = hex::encode(raw);
    let ttl = if remember { REMEMBER_DAYS * 86_400 } else { SHORT_HOURS * 3_600 };
    sqlx::query("INSERT INTO sessions (token_hash, user_id, remember, expires_at) VALUES (?, ?, ?, ?)")
        .bind(token_hash(&token)).bind(user_id).bind(remember).bind(now() + ttl)
        .execute(&state.db).await?;
    let mut c = Cookie::build((COOKIE, token)).path("/").http_only(true).same_site(SameSite::Lax).secure(state.cfg.cookie_secure);
    if remember { c = c.max_age(time_dur(ttl)); }
    Ok(jar.add(c.build()))
}

fn time_dur(secs: i64) -> time::Duration { time::Duration::seconds(secs) }

pub async fn end_session(state: &AppState, jar: CookieJar) -> ApiResult<CookieJar> {
    if let Some(c) = jar.get(COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?").bind(token_hash(c.value())).execute(&state.db).await?;
    }
    Ok(jar.remove(Cookie::build(COOKIE).path("/").build()))
}

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub email: String,
    pub name: String,
    pub phone: String,
    pub street: String,
    pub zone_id: String,
    pub place: String,
}

pub async fn load_user(db: &SqlitePool, id: i64) -> ApiResult<Option<User>> {
    Ok(sqlx::query_as::<_, User>(
        "SELECT u.id, u.email, u.name, u.phone, COALESCE(a.street, '') AS street, COALESCE(a.zone_id, '') AS zone_id, COALESCE(a.place, '') AS place
         FROM users u LEFT JOIN addresses a ON a.user_id = u.id WHERE u.id = ?",
    ).bind(id).fetch_optional(db).await?)
}

/// Angemeldeter Nutzer laut Cookie – oder None
pub async fn current_user(state: &AppState, jar: &CookieJar) -> ApiResult<Option<User>> {
    let Some(c) = jar.get(COOKIE) else { return Ok(None) };
    if c.value().len() != 64 { return Ok(None); }
    let row: Option<(i64,)> = sqlx::query_as("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
        .bind(token_hash(c.value())).bind(now()).fetch_optional(&state.db).await?;
    match row { Some((id,)) => load_user(&state.db, id).await, None => Ok(None) }
}

pub async fn purge_expired(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("DELETE FROM sessions WHERE expires_at <= ?").bind(now()).execute(db).await?.rows_affected())
}
