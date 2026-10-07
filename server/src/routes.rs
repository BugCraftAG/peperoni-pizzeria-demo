//! HTTP-Endpunkte unter /api

use crate::auth::{self, current_user, User};
use crate::error::{ApiError, ApiResult};
use crate::menu::menu;
use crate::order::{self, Customer, WishTime};
use crate::pricing::{price_line, LineInput, Mode};
use crate::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/me", get(me).put(update_me))
        .route("/orders", get(my_orders).post(place_order))
        .route("/admin/orders", get(admin_orders))
        .fallback(|| async { ApiError(StatusCode::NOT_FOUND, "Unbekannter Endpunkt.".into()) })
}

async fn health(State(s): State<AppState>) -> Json<Value> {
    Json(json!({ "ok": true, "demo": s.cfg.demo, "notify": s.notifier.enabled(), "version": env!("CARGO_PKG_VERSION") }))
}

// ───────────────────────── Konto

#[derive(Deserialize)]
pub struct RegisterBody { email: String, password: String, #[serde(default)] name: String, #[serde(default)] phone: String, #[serde(default)] remember: bool }

fn valid_email(e: &str) -> bool {
    let e = e.trim();
    e.len() <= 120 && e.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with('.') && !b.ends_with('.') && !e.contains(char::is_whitespace))
}

async fn register(State(s): State<AppState>, jar: CookieJar, Json(b): Json<RegisterBody>) -> ApiResult<(StatusCode, CookieJar, Json<Value>)> {
    let email = b.email.trim().to_lowercase();
    if !valid_email(&email) { return Err(ApiError::bad("Bitte eine gültige E-Mail-Adresse angeben.")); }
    if b.password.chars().count() < 8 { return Err(ApiError::bad("Das Passwort braucht mindestens 8 Zeichen.")); }
    if b.password.len() > 200 { return Err(ApiError::bad("Das Passwort ist zu lang.")); }
    if b.name.chars().count() > 60 { return Err(ApiError::bad("Name ist zu lang.")); }
    let phone = if b.phone.trim().is_empty() { String::new() } else { order::normalize_phone(&b.phone).map_err(|e| ApiError::bad(e.0))? };
    s.limiter.check(&format!("reg:{email}"), 5)?;

    let hash = auth::hash_password(b.password).await?;
    let res = sqlx::query("INSERT INTO users (email, password_hash, name, phone) VALUES (?, ?, ?, ?)")
        .bind(&email).bind(hash).bind(b.name.trim()).bind(phone)
        .execute(&s.db).await;
    let id = match res {
        Ok(r) => r.last_insert_rowid(),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => return Err(ApiError(StatusCode::CONFLICT, "Diese E-Mail ist schon registriert – bitte anmelden.".into())),
        Err(e) => return Err(e.into()),
    };
    let jar = auth::create_session(&s, jar, id, b.remember).await?;
    let user = auth::load_user(&s.db, id).await?;
    Ok((StatusCode::CREATED, jar, Json(json!({ "user": user }))))
}

#[derive(Deserialize)]
pub struct LoginBody { email: String, password: String, #[serde(default)] remember: bool }

async fn login(State(s): State<AppState>, jar: CookieJar, Json(b): Json<LoginBody>) -> ApiResult<(CookieJar, Json<Value>)> {
    let email = b.email.trim().to_lowercase();
    s.limiter.check(&format!("login:{email}"), 10)?;
    let row: Option<(i64, String)> = sqlx::query_as("SELECT id, password_hash FROM users WHERE email = ?").bind(&email).fetch_optional(&s.db).await?;
    let ok = match &row {
        Some((_, hash)) => auth::verify_password(b.password, hash.clone()).await,
        None => { auth::dummy_verify().await; false }
    };
    let Some((id, _)) = row.filter(|_| ok) else {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "E-Mail oder Passwort falsch.".into()));
    };
    s.limiter.reset(&format!("login:{email}"));
    let jar = auth::create_session(&s, jar, id, b.remember).await?;
    Ok((jar, Json(json!({ "user": auth::load_user(&s.db, id).await? }))))
}

async fn logout(State(s): State<AppState>, jar: CookieJar) -> ApiResult<(CookieJar, Json<Value>)> {
    Ok((auth::end_session(&s, jar).await?, Json(json!({ "ok": true }))))
}

async fn me(State(s): State<AppState>, jar: CookieJar) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "user": current_user(&s, &jar).await? })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBody { name: Option<String>, phone: Option<String>, street: Option<String>, zone_id: Option<String>, place: Option<String> }

async fn update_me(State(s): State<AppState>, jar: CookieJar, Json(b): Json<ProfileBody>) -> ApiResult<Json<Value>> {
    let u = current_user(&s, &jar).await?.ok_or_else(ApiError::unauthorized)?;
    let name = b.name.map(|n| n.trim().to_string()).unwrap_or(u.name.clone());
    if name.chars().count() > 60 { return Err(ApiError::bad("Name ist zu lang.")); }
    let phone = match b.phone.as_deref().map(str::trim) {
        Some("") => String::new(),
        Some(p) => order::normalize_phone(p).map_err(|e| ApiError::bad(e.0))?,
        None => u.phone.clone(),
    };
    let street = b.street.map(|x| x.trim().to_string()).unwrap_or(u.street.clone());
    if street.chars().count() > 80 { return Err(ApiError::bad("Adresse ist zu lang.")); }
    let place = b.place.map(|x| x.trim().to_string()).unwrap_or(u.place.clone());
    // Liefergebiet immer aus dem Ort ableiten, nie dem Browser glauben
    let zone_id = if place.is_empty() { String::new() } else {
        menu().zones.iter().find(|z| z.places.contains(&place)).map(|z| z.id.clone()).ok_or_else(|| ApiError::bad("Unbekannter Ort."))?
    };
    let _ = b.zone_id;

    let mut tx = s.db.begin().await?;
    sqlx::query("UPDATE users SET name = ?, phone = ? WHERE id = ?").bind(&name).bind(&phone).bind(u.id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO addresses (user_id, street, zone_id, place) VALUES (?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET street = excluded.street, zone_id = excluded.zone_id, place = excluded.place, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")
        .bind(u.id).bind(&street).bind(&zone_id).bind(&place).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "user": auth::load_user(&s.db, u.id).await? })))
}

// ───────────────────────── Bestellungen

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderBody { lines: Vec<LineInput>, mode: Mode, zone_id: Option<String>, customer: Customer }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderResult { r#ref: String, text: String, whatsapp_url: String, total: i64, notified: bool }

async fn place_order(State(s): State<AppState>, jar: CookieJar, headers: HeaderMap, Json(b): Json<OrderBody>) -> ApiResult<(StatusCode, Json<OrderResult>)> {
    let ip = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).unwrap_or("local").trim().to_string();
    s.limiter.check(&format!("order:{ip}"), 20)?;
    let user: Option<User> = current_user(&s, &jar).await?;
    let m = menu();
    let zone_id = if b.mode == Mode::Delivery { b.zone_id.clone() } else { None };

    if !s.cfg.demo {
        order::check_time(m, b.mode, &b.customer.time, order::vienna_now()).map_err(|e| ApiError::bad(e.0))?;
    }

    // eindeutige Bestellnummer
    let mut r#ref = order::order_ref();
    for _ in 0..5 {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT id FROM orders WHERE ref = ?").bind(&r#ref).fetch_optional(&s.db).await?;
        if exists.is_none() { break; }
        r#ref = order::order_ref();
    }

    let f = order::format_order(m, &b.lines, b.mode, zone_id.as_deref(), &b.customer, &r#ref).map_err(|e| ApiError::bad(e.0))?;
    let c = &b.customer;
    let phone = order::normalize_phone(&c.phone).map_err(|e| ApiError::bad(e.0))?;
    let wish = match c.time { WishTime::Minutes(t) => order::hhmm(t), WishTime::Asap(_) => "asap".into() };
    let payment = match c.payment { order::Payment::Bar => "bar", order::Payment::Karte => "karte" };

    let mut tx = s.db.begin().await?;
    let order_id = sqlx::query(
        "INSERT INTO orders (ref, user_id, mode, customer_name, customer_phone, street, zone_id, place, wish_time, payment, note, subtotal, deposit, fee, total, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&r#ref).bind(user.as_ref().map(|u| u.id)).bind(b.mode.as_str())
        .bind(c.name.trim()).bind(&phone)
        .bind(c.street.as_deref().filter(|_| b.mode == Mode::Delivery).map(str::trim))
        .bind(zone_id.as_deref()).bind(c.place.as_deref().filter(|_| b.mode == Mode::Delivery))
        .bind(&wish).bind(payment).bind(c.note.as_deref().map(str::trim).filter(|n| !n.is_empty()))
        .bind(f.totals.subtotal).bind(f.totals.deposit).bind(f.totals.fee).bind(f.totals.total).bind(&f.text)
        .execute(&mut *tx).await?.last_insert_rowid();
    for l in &b.lines {
        let p = price_line(m, l).map_err(|e| ApiError::bad(e.0))?;
        let options = serde_json::to_string(&LineInput { note: None, qty: l.qty, ..l.clone() }).unwrap_or_default();
        sqlx::query("INSERT INTO order_items (order_id, item_id, title, qty, unit_price, deposit, details, options, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(order_id).bind(&l.item_id).bind(&p.title).bind(l.qty).bind(p.unit).bind(p.deposit)
            .bind(p.details.join(", ")).bind(options).bind(l.note.as_deref().map(str::trim).filter(|n| !n.is_empty()))
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;

    let notified = if s.notifier.enabled() {
        let ok = s.notifier.send(&f.text).await;
        if ok { sqlx::query("UPDATE orders SET notified = 1 WHERE id = ?").bind(order_id).execute(&s.db).await?; }
        ok
    } else { false };

    tracing::info!(r#ref = %r#ref, total = f.totals.total, mode = b.mode.as_str(), "Neue Bestellung");
    Ok((StatusCode::CREATED, Json(OrderResult {
        whatsapp_url: order::whatsapp_url(&s.cfg.whatsapp_target, &f.text),
        r#ref, text: f.text, total: f.totals.total, notified,
    })))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct OrderSummary { r#ref: String, created_at: String, mode: String, total: i64, items: i64, status: String }

async fn my_orders(State(s): State<AppState>, jar: CookieJar) -> ApiResult<Json<Value>> {
    let u = current_user(&s, &jar).await?.ok_or_else(ApiError::unauthorized)?;
    let rows: Vec<OrderSummary> = sqlx::query_as(
        "SELECT o.ref, o.created_at, o.mode, o.total, COALESCE(SUM(i.qty), 0) AS items, o.status
         FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
         WHERE o.user_id = ? GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT 20",
    ).bind(u.id).fetch_all(&s.db).await?;
    Ok(Json(json!({ "orders": rows })))
}

/// Für die Pizzeria: alle Bestellungen des Tages. Authorization: Bearer <ADMIN_TOKEN>
async fn admin_orders(State(s): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let Some(expected) = s.cfg.admin_token.as_deref() else { return Err(ApiError(StatusCode::NOT_FOUND, "Nicht aktiviert.".into())) };
    let given = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    if !constant_eq(given.as_bytes(), expected.as_bytes()) { return Err(ApiError(StatusCode::UNAUTHORIZED, "Kein Zugriff.".into())); }
    let rows: Vec<(String, String, String, String, i64, String, String)> = sqlx::query_as(
        "SELECT ref, created_at, mode, customer_name, total, status, message FROM orders ORDER BY id DESC LIMIT 100",
    ).fetch_all(&s.db).await?;
    let list: Vec<Value> = rows.into_iter().map(|(r, at, mode, name, total, status, message)| json!({ "ref": r, "createdAt": at, "mode": mode, "name": name, "total": total, "status": status, "message": message })).collect();
    Ok(Json(json!({ "orders": list })))
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ───────────────────────── einfache Bremse gegen Durchprobieren

#[derive(Default)]
pub struct Limiter(std::sync::Mutex<std::collections::HashMap<String, (u32, Instant)>>);

impl Limiter {
    const WINDOW: Duration = Duration::from_secs(15 * 60);

    pub fn check(&self, key: &str, max: u32) -> ApiResult<()> {
        let mut map = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        if map.len() > 10_000 { map.retain(|_, (_, t)| now.duration_since(*t) < Self::WINDOW); }
        let e = map.entry(key.to_string()).or_insert((0, now));
        if now.duration_since(e.1) > Self::WINDOW { *e = (0, now); }
        e.0 += 1;
        if e.0 > max { return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "Zu viele Versuche – bitte in ein paar Minuten nochmal.".into())); }
        Ok(())
    }

    pub fn reset(&self, key: &str) {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).remove(key);
    }
}
