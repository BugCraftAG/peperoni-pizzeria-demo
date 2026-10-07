//! Ende-zu-Ende-Tests der API gegen eine echte SQLite-Datenbank im Speicher.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use peperoni_server::{app, connect, notify::Notifier, routes::Limiter, AppState, Config};
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

async fn state(demo: bool) -> AppState {
    let cfg = Config {
        database_url: "sqlite::memory:".into(),
        web_dir: "../web".into(),
        bind: "127.0.0.1:0".into(),
        whatsapp_target: "+436645112794".into(),
        demo,
        cookie_secure: false,
        admin_token: Some("0123456789abcdef-test".into()),
    };
    AppState { db: connect(&cfg.database_url).await.unwrap(), cfg: Arc::new(cfg), limiter: Arc::new(Limiter::default()), notifier: Notifier::from_env() }
}

async fn call(s: &AppState, method: &str, path: &str, body: Option<Value>, cookie: Option<&str>) -> (StatusCode, Value, Option<String>) {
    let mut req = Request::builder().method(method).uri(path);
    if let Some(c) = cookie { req = req.header(header::COOKIE, c); }
    let req = match body {
        Some(b) => req.header(header::CONTENT_TYPE, "application/json").body(Body::from(b.to_string())).unwrap(),
        None => req.body(Body::empty()).unwrap(),
    };
    let res = app(s.clone()).oneshot(req).await.unwrap();
    let status = res.status();
    let set_cookie = res.headers().get(header::SET_COOKIE).map(|v| v.to_str().unwrap().to_string());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, v, set_cookie)
}

fn cookie_pair(set_cookie: &str) -> String { set_cookie.split(';').next().unwrap().to_string() }

#[tokio::test]
async fn health() {
    let s = state(true).await;
    let (st, v, _) = call(&s, "GET", "/api/health", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["ok"], true);
}

#[tokio::test]
async fn register_login_remember_logout() {
    let s = state(true).await;
    let (st, v, sc) = call(&s, "POST", "/api/register", Some(json!({"email":"Max@Example.at","password":"geheim123","name":"Max Muster","phone":"0664 1234567","remember":true})), None).await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(v["user"]["email"], "max@example.at");
    assert_eq!(v["user"]["phone"], "+436641234567");
    let sc = sc.expect("Cookie fehlt");
    assert!(sc.contains("HttpOnly") && sc.contains("SameSite=Lax") && sc.contains("Max-Age=2592000"), "{sc}");
    let c = cookie_pair(&sc);

    let (_, v, _) = call(&s, "GET", "/api/me", None, Some(&c)).await;
    assert_eq!(v["user"]["name"], "Max Muster");

    // doppelt registrieren
    let (st, _, _) = call(&s, "POST", "/api/register", Some(json!({"email":"max@example.at","password":"geheim123"})), None).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // falsches Passwort
    let (st, v, _) = call(&s, "POST", "/api/login", Some(json!({"email":"max@example.at","password":"falsch!!"})), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    assert_eq!(v["error"], "E-Mail oder Passwort falsch.");

    // Login ohne "merken" → Sitzungs-Cookie ohne Max-Age
    let (st, _, sc2) = call(&s, "POST", "/api/login", Some(json!({"email":"MAX@example.at","password":"geheim123","remember":false})), None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(!sc2.unwrap().contains("Max-Age"));

    // Profil
    let (st, v, _) = call(&s, "PUT", "/api/me", Some(json!({"street":"Hauptplatz 1","place":"Klöch"})), Some(&c)).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["user"]["zoneId"], "zone3");
    let (st, _, _) = call(&s, "PUT", "/api/me", Some(json!({"place":"Wien"})), Some(&c)).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Abmelden → Cookie ungültig
    let (_, _, _) = call(&s, "POST", "/api/logout", None, Some(&c)).await;
    let (_, v, _) = call(&s, "GET", "/api/me", None, Some(&c)).await;
    assert!(v["user"].is_null());
}

fn order_body() -> Value {
    json!({
        "mode": "delivery", "zoneId": "zone2",
        "lines": [
            {"itemId":"wunschpizza","qty":1,"toppings":["Schinken","Salami","Mais","Zwiebel","Champignons","Extra Käse"]},
            {"itemId":"peperoni-burger","qty":1,"variant":"180","extras":["speck","cheddar"]},
            {"itemId":"nudeln","qty":1,"noodle":"Penne","sauce":"carbonara"},
            {"itemId":"lasagne","qty":1,"cheese":true,"note":"bitte heiß"}
        ],
        "customer": {"name":"Max Muster","phone":"0664 1234567","street":"Dorfstraße 3","place":"Halbenrain","time":"asap","payment":"karte","note":"Hund bellt, beißt aber nicht"}
    })
}

#[tokio::test]
async fn order_is_priced_on_server_and_saved() {
    let s = state(true).await;
    let (_, _, sc) = call(&s, "POST", "/api/register", Some(json!({"email":"a@b.at","password":"geheim123","remember":true})), None).await;
    let c = cookie_pair(&sc.unwrap());

    let mut body = order_body();
    body["total"] = json!(1); // wird ignoriert – der Server rechnet selbst
    let (st, v, _) = call(&s, "POST", "/api/orders", Some(body), Some(&c)).await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(v["total"], 6030);
    let text = v["text"].as_str().unwrap();
    assert!(text.contains("Halbenrain") && text.contains("*Gesamt: € 60,30*") && text.contains("Anmerkung: bitte heiß"), "{text}");
    assert!(v["whatsappUrl"].as_str().unwrap().starts_with("https://wa.me/436645112794?text="));

    let (_, v, _) = call(&s, "GET", "/api/orders", None, Some(&c)).await;
    assert_eq!(v["orders"][0]["total"], 6030);
    assert_eq!(v["orders"][0]["items"], 4);

    let row: (i64, String) = sqlx::query_as("SELECT COUNT(*), (SELECT details FROM order_items WHERE item_id = 'peperoni-burger') FROM order_items").fetch_one(&s.db).await.unwrap();
    assert_eq!(row.0, 4);
    assert_eq!(row.1, "180 g Fleisch, + Speck, + Cheddarkäse");
}

#[tokio::test]
async fn bad_orders_are_rejected() {
    let s = state(true).await;
    let mut b = order_body();
    b["lines"] = json!([{"itemId":"doener-kebap","qty":1}]);
    let (st, v, _) = call(&s, "POST", "/api/orders", Some(b), None).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert!(v["error"].as_str().unwrap().contains("Mindestbestellwert"));

    let mut b = order_body();
    b["customer"]["place"] = json!("Klöch");
    let (st, _, _) = call(&s, "POST", "/api/orders", Some(b), None).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    let mut b = order_body();
    b["lines"][0]["qty"] = json!(99);
    let (st, _, _) = call(&s, "POST", "/api/orders", Some(b), None).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // ohne JSON-Content-Type (Schutz gegen fremde Formulare)
    let req = Request::builder().method("POST").uri("/api/orders").header(header::CONTENT_TYPE, "text/plain").body(Body::from(order_body().to_string())).unwrap();
    let res = app(s.clone()).oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);

    let (st, _, _) = call(&s, "GET", "/api/orders", None, None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_sees_orders_only_with_token() {
    let s = state(true).await;
    call(&s, "POST", "/api/orders", Some(order_body()), None).await;
    let (st, _, _) = call(&s, "GET", "/api/admin/orders", None, None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    let req = Request::builder().uri("/api/admin/orders").header(header::AUTHORIZATION, "Bearer 0123456789abcdef-test").body(Body::empty()).unwrap();
    let res = app(s.clone()).oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn login_is_rate_limited() {
    let s = state(true).await;
    let mut last = StatusCode::OK;
    for _ in 0..12 {
        let (st, _, _) = call(&s, "POST", "/api/login", Some(json!({"email":"x@y.at","password":"nope"})), None).await;
        last = st;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
}
