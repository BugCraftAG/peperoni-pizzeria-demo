//! Speisekarte – dieselbe Datei wie im Frontend (shared/menu.json),
//! zur Compile-Zeit eingebettet. Damit kann der Server Preise nie „vergessen“.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub type Cents = i64;

#[derive(Debug, Deserialize, Clone)]
pub struct Variant { pub id: String, pub label: String, pub price: Cents }

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OptionKind { Pizza, Wunsch, Burger, Pasta, Lasagne }

#[derive(Debug, Deserialize, Clone)]
pub struct MenuItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub price: Option<Cents>,
    #[serde(default)]
    pub variants: Option<Vec<Variant>>,
    #[serde(default)]
    pub options: Option<OptionKind>,
    #[serde(default)]
    pub deposit: Option<Cents>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Category { pub id: String, pub name: String, pub items: Vec<MenuItem> }

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Zone { pub id: String, pub name: String, pub places: Vec<String>, pub min_order: Cents, pub fee: Cents }

#[derive(Debug, Deserialize, Clone)]
pub struct Toppings { pub price: Cents, pub items: Vec<String> }

#[derive(Debug, Deserialize, Clone)]
pub struct Extra { pub id: String, pub name: String, pub price: Cents }

#[derive(Debug, Deserialize, Clone)]
pub struct Sauce { pub id: String, pub name: String }

#[derive(Debug, Deserialize, Clone)]
pub struct Pasta { pub noodles: Vec<String>, pub sauces: Vec<Sauce> }

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Restaurant { pub name: String, pub phone: String, pub phone_intl: String }

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Menu {
    pub restaurant: Restaurant,
    /// Wochentag ("0" = Sonntag) → [[von, bis]] in Minuten
    pub hours: BTreeMap<String, Vec<[u32; 2]>>,
    pub zones: Vec<Zone>,
    pub pizza_toppings: Toppings,
    pub burger_extras: Vec<Extra>,
    pub pasta: Pasta,
    pub lasagne_cheese: Cents,
    pub categories: Vec<Category>,
}

impl Menu {
    pub fn item(&self, id: &str) -> Option<&MenuItem> {
        self.categories.iter().flat_map(|c| c.items.iter()).find(|i| i.id == id)
    }
    pub fn zone(&self, id: &str) -> Option<&Zone> {
        self.zones.iter().find(|z| z.id == id)
    }
    pub fn hours_for(&self, weekday: u32) -> &[[u32; 2]] {
        self.hours.get(&weekday.to_string()).map(|v| v.as_slice()).unwrap_or(&[])
    }
}

pub const MENU_JSON: &str = include_str!("../../shared/menu.json");

pub fn menu() -> &'static Menu {
    static M: OnceLock<Menu> = OnceLock::new();
    M.get_or_init(|| serde_json::from_str(MENU_JSON).expect("shared/menu.json ist ungültig"))
}
