//! Optional: Bestellung zusätzlich automatisch aufs Handy der Pizzeria schicken.
//!
//! Ohne Einstellung schickt der Kunde die Bestellung selbst per WhatsApp
//! (vorausgefüllte Nachricht). Mit CALLMEBOT_PHONE + CALLMEBOT_APIKEY
//! (kostenlos, https://www.callmebot.com/blog/free-api-whatsapp-messages/)
//! bekommt die Nummer jede Bestellung zusätzlich sofort vom Server –
//! auch wenn der Kunde in WhatsApp nicht auf "Senden" tippt.

use std::time::Duration;

#[derive(Clone)]
pub struct Notifier {
    http: reqwest::Client,
    callmebot: Option<(String, String)>,
}

impl Notifier {
    pub fn from_env() -> Self {
        let phone = std::env::var("CALLMEBOT_PHONE").ok().filter(|s| !s.is_empty());
        let key = std::env::var("CALLMEBOT_APIKEY").ok().filter(|s| !s.is_empty());
        let http = reqwest::Client::builder().timeout(Duration::from_secs(6)).build().expect("HTTP-Client");
        Self { http, callmebot: phone.zip(key) }
    }

    pub fn enabled(&self) -> bool { self.callmebot.is_some() }

    pub async fn send(&self, text: &str) -> bool {
        let Some((phone, key)) = &self.callmebot else { return false };
        let url = format!(
            "https://api.callmebot.com/whatsapp.php?phone={}&text={}&apikey={}",
            urlencoding::encode(phone), urlencoding::encode(text), urlencoding::encode(key)
        );
        match self.http.get(url).send().await {
            Ok(r) if r.status().is_success() => true,
            Ok(r) => { tracing::warn!(status = %r.status(), "Benachrichtigung abgelehnt"); false }
            Err(e) => { tracing::warn!(error = %e, "Benachrichtigung fehlgeschlagen"); false }
        }
    }
}
