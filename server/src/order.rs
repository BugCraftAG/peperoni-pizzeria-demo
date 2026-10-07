//! Bestellung prüfen und als WhatsApp-Text formatieren (wie web/src/order.ts).

use crate::menu::Menu;
use crate::pricing::{euro, price_line, totals, LineInput, Mode, Totals};
use chrono::{Datelike, Timelike, Utc};
use chrono_tz::Europe::Vienna;
use rand::Rng;
use serde::Deserialize;

#[derive(Debug, thiserror::Error, PartialEq)]
#[error("{0}")]
pub struct OrderError(pub String);

fn err<T>(m: impl Into<String>) -> Result<T, OrderError> { Err(OrderError(m.into())) }

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum WishTime { Minutes(u32), Asap(String) }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Payment { Bar, Karte }

#[derive(Debug, Clone, Deserialize)]
pub struct Customer {
    pub name: String,
    pub phone: String,
    #[serde(default)]
    pub street: Option<String>,
    #[serde(default)]
    pub place: Option<String>,
    pub time: WishTime,
    pub payment: Payment,
    #[serde(default)]
    pub note: Option<String>,
}

pub fn normalize_phone(input: &str) -> Result<String, OrderError> {
    let digits: String = input.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
    let n = if let Some(rest) = digits.strip_prefix('+') { format!("+{}", rest.replace('+', "")) }
        else if let Some(rest) = digits.strip_prefix("00") { format!("+{}", rest.replace('+', "")) }
        else if let Some(rest) = digits.strip_prefix('0') { format!("+43{}", rest.replace('+', "")) }
        else { digits.replace('+', "") };
    let len = n.len().saturating_sub(1);
    if !n.starts_with('+') || !(8..=15).contains(&len) || !n[1..].chars().all(|c| c.is_ascii_digit()) {
        return err("Bitte eine gültige Telefonnummer angeben.");
    }
    Ok(n)
}

pub fn hhmm(m: u32) -> String { format!("{:02}:{:02}", m / 60, m % 60) }

/// Aktueller Wochentag (0 = Sonntag) und Minute des Tages in Wien
pub fn vienna_now() -> (u32, u32) {
    let now = Utc::now().with_timezone(&Vienna);
    (now.weekday().num_days_from_sunday(), now.hour() * 60 + now.minute())
}

pub fn lead(mode: Mode) -> u32 { if mode == Mode::Delivery { 45 } else { 20 } }

/// Prüft Öffnungszeit und Wunschzeit (wie slots() im Frontend, 5 Minuten Kulanz)
pub fn check_time(menu: &Menu, mode: Mode, time: &WishTime, (wd, now): (u32, u32)) -> Result<(), OrderError> {
    let today = menu.hours_for(wd);
    match time {
        WishTime::Asap(s) if s == "asap" => {
            if today.iter().any(|[a, b]| now >= *a && now < *b) { Ok(()) } else { err("Wir haben gerade geschlossen – bitte eine spätere Zeit wählen.") }
        }
        WishTime::Minutes(t) => {
            let t = *t;
            if !t.is_multiple_of(15) { return err("Ungültige Uhrzeit."); }
            let ok = today.iter().any(|[a, b]| t >= a + lead(mode) && t <= *b) && t + 5 >= now + lead(mode);
            if ok { Ok(()) } else { err("Diese Uhrzeit ist nicht mehr möglich.") }
        }
        _ => err("Ungültige Uhrzeit."),
    }
}

pub fn validate_customer(c: &Customer, mode: Mode) -> Result<(), OrderError> {
    if c.name.trim().chars().count() < 2 { return err("Bitte Ihren Namen angeben."); }
    if c.name.chars().count() > 60 { return err("Name ist zu lang."); }
    normalize_phone(&c.phone)?;
    if mode == Mode::Delivery && c.street.as_deref().map_or(0, |s| s.trim().chars().count()) < 4 {
        return err("Bitte Straße und Hausnummer angeben.");
    }
    if c.street.as_deref().is_some_and(|s| s.chars().count() > 80) { return err("Adresse ist zu lang."); }
    if c.note.as_deref().is_some_and(|s| s.chars().count() > 200) { return err("Anmerkung ist zu lang."); }
    match &c.time {
        WishTime::Asap(s) if s != "asap" => return err("Ungültige Uhrzeit."),
        WishTime::Minutes(t) if *t >= 24 * 60 => return err("Ungültige Uhrzeit."),
        _ => {}
    }
    Ok(())
}

pub struct Formatted { pub text: String, pub totals: Totals }

pub fn format_order(menu: &Menu, lines: &[LineInput], mode: Mode, zone_id: Option<&str>, c: &Customer, order_ref: &str) -> Result<Formatted, OrderError> {
    if lines.is_empty() { return err("Der Warenkorb ist leer."); }
    if lines.len() > 40 { return err("Zu viele Positionen."); }
    for l in lines {
        if l.note.as_deref().is_some_and(|s| s.chars().count() > 140) { return err("Anmerkung ist zu lang."); }
    }
    validate_customer(c, mode)?;
    let t = totals(menu, lines, mode, zone_id).map_err(|e| OrderError(e.0))?;
    if mode == Mode::Delivery && t.missing > 0 {
        return err(format!("Mindestbestellwert für dieses Gebiet: {}. Es fehlen noch {}.", euro(t.min_order), euro(t.missing)));
    }
    let zone = zone_id.and_then(|z| menu.zone(z));
    if let (Mode::Delivery, Some(z), Some(p)) = (mode, zone, c.place.as_deref()) {
        if !z.places.iter().any(|x| x == p) { return err("Ort und Liefergebiet passen nicht zusammen."); }
    }
    let mut out: Vec<String> = Vec::new();
    out.push(format!("*Neue Bestellung {order_ref}*"));
    out.push(if mode == Mode::Delivery { "*LIEFERUNG*" } else { "*ABHOLUNG*" }.into());
    out.push(format!("{} · {}", c.name.trim(), normalize_phone(&c.phone)?));
    if mode == Mode::Delivery {
        let place = c.place.clone().or_else(|| zone.and_then(|z| z.places.first().cloned())).unwrap_or_default();
        out.push(format!("{}, {}", c.street.as_deref().unwrap_or("").trim(), place));
    }
    out.push(format!("Zeit: {}", match &c.time { WishTime::Minutes(m) => format!("{} Uhr", hhmm(*m)), WishTime::Asap(_) => "so schnell wie möglich".into() }));
    out.push(String::new());
    for l in lines {
        let p = price_line(menu, l).map_err(|e| OrderError(e.0))?;
        out.push(format!("{}× {} – {}", l.qty, p.title, euro(p.unit * l.qty)));
        if !p.details.is_empty() { out.push(format!("   {}", p.details.join(", "))); }
        if let Some(n) = l.note.as_deref().map(str::trim).filter(|n| !n.is_empty()) { out.push(format!("   Anmerkung: {n}")); }
    }
    out.push(String::new());
    out.push(format!("Zwischensumme: {}", euro(t.subtotal)));
    if t.deposit > 0 { out.push(format!("Pfand: {}", euro(t.deposit))); }
    if mode == Mode::Delivery { out.push(format!("Liefergebühr: {}", euro(t.fee))); }
    out.push(format!("*Gesamt: {}*", euro(t.total)));
    out.push(format!("Zahlung: {} bei {}", if c.payment == Payment::Bar { "bar" } else { "mit Karte" }, if mode == Mode::Delivery { "Lieferung" } else { "Abholung" }));
    if let Some(n) = c.note.as_deref().map(str::trim).filter(|n| !n.is_empty()) { out.push(format!("Anmerkung: {n}")); }
    Ok(Formatted { text: out.join("\n"), totals: t })
}

pub fn whatsapp_url(target_intl: &str, text: &str) -> String {
    let digits: String = target_intl.chars().filter(|c| c.is_ascii_digit()).collect();
    format!("https://wa.me/{digits}?text={}", urlencoding::encode(text))
}

pub fn order_ref() -> String {
    const A: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let mut r = rand::thread_rng();
    let s: String = (0..4).map(|_| A[r.gen_range(0..A.len())] as char).collect();
    format!("P-{s}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::menu::menu;

    fn cust() -> Customer {
        Customer { name: "Max Muster".into(), phone: "0664 1234567".into(), street: Some("Hauptplatz 1".into()), place: Some("Bad Radkersburg".into()), time: WishTime::Asap("asap".into()), payment: Payment::Bar, note: Some("Klingel 2".into()) }
    }

    #[test]
    fn phones() {
        assert_eq!(normalize_phone("0664 1234567").unwrap(), "+436641234567");
        assert_eq!(normalize_phone("+43 664 / 123 45 67").unwrap(), "+436641234567");
        assert_eq!(normalize_phone("0043 664 1234567").unwrap(), "+436641234567");
        assert!(normalize_phone("123").is_err());
    }

    #[test]
    fn same_text_as_frontend() {
        let lines: Vec<LineInput> = serde_json::from_str(r#"[{"itemId":"pizza-peperoni","qty":2,"toppings":["Mais"],"note":"gut durch"},{"itemId":"softdrink","qty":1,"note":"Cola"}]"#).unwrap();
        let f = format_order(menu(), &lines, Mode::Delivery, Some("bad-radkersburg"), &cust(), "P-TEST").unwrap();
        for s in ["P-TEST", "*LIEFERUNG*", "Max Muster · +436641234567", "Hauptplatz 1, Bad Radkersburg", "2× Pizza Peperoni – € 28,80", "   + Mais", "   Anmerkung: gut durch", "Pfand: € 0,25", "Liefergebühr: € 2,00", "*Gesamt: € 34,55*", "Zahlung: bar bei Lieferung", "Anmerkung: Klingel 2"] {
            assert!(f.text.contains(s), "fehlt {s}:\n{}", f.text);
        }
    }

    #[test]
    fn minimum_order_and_place() {
        let lines: Vec<LineInput> = serde_json::from_str(r#"[{"itemId":"doener-kebap","qty":1}]"#).unwrap();
        assert!(format_order(menu(), &lines, Mode::Delivery, Some("bad-radkersburg"), &cust(), "P-1").is_err());
        assert!(format_order(menu(), &lines, Mode::Pickup, None, &cust(), "P-1").is_ok());
        let big: Vec<LineInput> = serde_json::from_str(r#"[{"itemId":"margherita","qty":3}]"#).unwrap();
        let mut c = cust();
        c.place = Some("Klöch".into());
        assert!(format_order(menu(), &big, Mode::Delivery, Some("bad-radkersburg"), &c, "P-1").is_err());
    }

    #[test]
    fn opening_hours() {
        let m = menu();
        let asap = WishTime::Asap("asap".into());
        assert!(check_time(m, Mode::Pickup, &asap, (3, 750)).is_ok()); // Mi 12:30
        assert!(check_time(m, Mode::Pickup, &asap, (2, 750)).is_err()); // Di Ruhetag
        assert!(check_time(m, Mode::Pickup, &asap, (3, 900)).is_err()); // Mittagspause
        assert!(check_time(m, Mode::Delivery, &WishTime::Minutes(1020), (3, 900)).is_ok()); // 17:00 vorbestellt
        assert!(check_time(m, Mode::Delivery, &WishTime::Minutes(990), (3, 900)).is_err()); // 16:30 < 16:00+45
        assert!(check_time(m, Mode::Pickup, &WishTime::Minutes(1007), (3, 900)).is_err()); // nicht im Raster
    }

    #[test]
    fn wa_url() {
        assert_eq!(whatsapp_url("+43 664 5112794", "Hallo & *Pizza*\nZeile 2"), "https://wa.me/436645112794?text=Hallo%20%26%20%2APizza%2A%0AZeile%202");
        assert!(order_ref().starts_with("P-"));
    }
}
