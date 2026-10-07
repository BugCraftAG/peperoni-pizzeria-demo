//! Preisberechnung – exakt dieselben Regeln wie web/src/pricing.ts.
//! Beide Seiten werden gegen shared/price-vectors.json getestet.

use crate::menu::{Cents, Menu, OptionKind};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_QTY: i64 = 20;
pub const MAX_EXTRA_TOPPINGS: usize = 8;
pub const WUNSCH_INCLUDED: usize = 5;

#[derive(Debug, thiserror::Error, PartialEq)]
#[error("{0}")]
pub struct PriceError(pub String);

fn err<T>(msg: impl Into<String>) -> Result<T, PriceError> { Err(PriceError(msg.into())) }

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LineInput {
    pub item_id: String,
    pub qty: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toppings: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub noodle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sauce: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cheese: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Delivery, Pickup }

impl Mode {
    pub fn as_str(self) -> &'static str { match self { Mode::Delivery => "delivery", Mode::Pickup => "pickup" } }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PricedLine { pub unit: Cents, pub deposit: Cents, pub title: String, pub details: Vec<String> }

fn unique(list: &[String], what: &str) -> Result<(), PriceError> {
    let set: HashSet<&String> = list.iter().collect();
    if set.len() != list.len() { return err(format!("{what} doppelt gewählt.")); }
    Ok(())
}

pub fn price_line(menu: &Menu, line: &LineInput) -> Result<PricedLine, PriceError> {
    let Some(item) = menu.item(&line.item_id) else { return err(format!("Unbekanntes Gericht: {}", line.item_id)) };
    if !(1..=MAX_QTY).contains(&line.qty) { return err(format!("Menge muss zwischen 1 und {MAX_QTY} liegen.")); }

    let mut details = Vec::new();
    let mut unit = match &item.variants {
        Some(vs) if !vs.is_empty() => {
            let Some(v) = vs.iter().find(|v| Some(&v.id) == line.variant.as_ref()) else {
                return err(format!("{}: bitte eine Größe/Variante wählen.", item.name));
            };
            details.push(v.label.clone());
            v.price
        }
        _ => match item.price { Some(p) => p, None => return err(format!("{}: kein Preis hinterlegt.", item.name)) },
    };

    let toppings = line.toppings.clone().unwrap_or_default();
    let extras = line.extras.clone().unwrap_or_default();
    let opt = item.options;
    if !matches!(opt, Some(OptionKind::Pizza | OptionKind::Wunsch)) && !toppings.is_empty() { return err(format!("{}: keine Zutaten wählbar.", item.name)); }
    if opt != Some(OptionKind::Burger) && !extras.is_empty() { return err(format!("{}: keine Extras wählbar.", item.name)); }

    match opt {
        Some(OptionKind::Pizza) => {
            unique(&toppings, "Zutat")?;
            if toppings.len() > MAX_EXTRA_TOPPINGS { return err(format!("Höchstens {MAX_EXTRA_TOPPINGS} Extra-Zutaten.")); }
            for t in &toppings {
                if !menu.pizza_toppings.items.contains(t) { return err(format!("Unbekannte Zutat: {t}")); }
                unit += menu.pizza_toppings.price;
                details.push(format!("+ {t}"));
            }
        }
        Some(OptionKind::Wunsch) => {
            unique(&toppings, "Zutat")?;
            if toppings.len() < WUNSCH_INCLUDED { return err(format!("Wunschpizza: bitte {WUNSCH_INCLUDED} Zutaten wählen.")); }
            if toppings.len() > WUNSCH_INCLUDED + MAX_EXTRA_TOPPINGS { return err("Zu viele Zutaten."); }
            for (i, t) in toppings.iter().enumerate() {
                if !menu.pizza_toppings.items.contains(t) { return err(format!("Unbekannte Zutat: {t}")); }
                if i >= WUNSCH_INCLUDED { unit += menu.pizza_toppings.price; details.push(format!("+ {t}")); } else { details.push(t.clone()); }
            }
        }
        Some(OptionKind::Burger) => {
            unique(&extras, "Extra")?;
            for id in &extras {
                let Some(e) = menu.burger_extras.iter().find(|x| &x.id == id) else { return err(format!("Unbekanntes Extra: {id}")) };
                unit += e.price;
                details.push(format!("+ {}", e.name));
            }
        }
        Some(OptionKind::Pasta) => {
            let Some(noodle) = line.noodle.as_ref().filter(|n| menu.pasta.noodles.contains(n)) else { return err("Bitte eine Nudelsorte wählen.") };
            let Some(sauce) = menu.pasta.sauces.iter().find(|s| Some(&s.id) == line.sauce.as_ref()) else { return err("Bitte eine Sauce wählen.") };
            details.push(noodle.clone());
            details.push(sauce.name.clone());
        }
        Some(OptionKind::Lasagne) if line.cheese == Some(true) => {
            unit += menu.lasagne_cheese;
            details.push("+ mit Käse überbacken".into());
        }
        Some(OptionKind::Lasagne) | None => {}
    }
    if opt != Some(OptionKind::Pasta) && (line.noodle.as_deref().is_some_and(|s| !s.is_empty()) || line.sauce.as_deref().is_some_and(|s| !s.is_empty())) {
        return err(format!("{}: keine Sauce wählbar.", item.name));
    }
    if opt != Some(OptionKind::Lasagne) && line.cheese == Some(true) { return err(format!("{}: nicht überbackbar.", item.name)); }

    Ok(PricedLine { unit, deposit: item.deposit.unwrap_or(0), title: item.name.clone(), details })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals { pub subtotal: Cents, pub deposit: Cents, pub fee: Cents, pub total: Cents, pub min_order: Cents, pub missing: Cents }

pub fn totals(menu: &Menu, lines: &[LineInput], mode: Mode, zone_id: Option<&str>) -> Result<Totals, PriceError> {
    let (mut subtotal, mut deposit) = (0, 0);
    for l in lines {
        let p = price_line(menu, l)?;
        subtotal += p.unit * l.qty;
        deposit += p.deposit * l.qty;
    }
    let zone = match mode {
        Mode::Delivery => match zone_id.and_then(|z| menu.zone(z)) { Some(z) => Some(z), None => return err("Bitte ein Liefergebiet wählen.") },
        Mode::Pickup => None,
    };
    let fee = zone.map_or(0, |z| z.fee);
    let min_order = zone.map_or(0, |z| z.min_order);
    Ok(Totals { subtotal, deposit, fee, total: subtotal + deposit + fee, min_order, missing: (min_order - subtotal).max(0) })
}

/// 1240 → "€ 12,40", 123450 → "€ 1.234,50" – identisch zu euro() in TypeScript
pub fn euro(c: Cents) -> String {
    let sign = if c < 0 { "-" } else { "" };
    let abs = c.abs();
    let whole = (abs / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i).is_multiple_of(3) { grouped.push('.'); }
        grouped.push(ch);
    }
    format!("{sign}€ {grouped},{:02}", abs % 100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::menu::menu;
    use serde_json::Value;

    #[derive(Deserialize)]
    struct Vector { name: String, mode: Mode, zone: Option<String>, lines: Vec<LineInput>, expect: Option<Value>, #[serde(default)] error: bool }

    #[test]
    fn shared_price_vectors() {
        let vectors: Vec<Vector> = serde_json::from_str(include_str!("../../shared/price-vectors.json")).unwrap();
        assert!(vectors.len() >= 10);
        for v in vectors {
            let r = totals(menu(), &v.lines, v.mode, v.zone.as_deref());
            if v.error {
                assert!(r.is_err(), "{} hätte fehlschlagen müssen", v.name);
                continue;
            }
            let t = serde_json::to_value(r.unwrap_or_else(|e| panic!("{}: {e}", v.name))).unwrap();
            for (k, val) in v.expect.unwrap().as_object().unwrap() {
                assert_eq!(&t[k], val, "{}: {k}", v.name);
            }
        }
    }

    #[test]
    fn euro_format() {
        assert_eq!(euro(1240), "€ 12,40");
        assert_eq!(euro(5), "€ 0,05");
        assert_eq!(euro(123450), "€ 1.234,50");
        assert_eq!(euro(-200), "-€ 2,00");
    }
}
