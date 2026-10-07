/**
 * Datenmodell der Speisekarte (shared/menu.json).
 * Alle Preise sind in Cent als ganze Zahlen – nie Gleitkomma für Geld.
 */

export type Cents = number;
export type AllergenCode = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "L" | "M" | "N" | "O" | "P" | "R";

export interface Variant { id: string; label: string; price: Cents }

export type OptionKind = "pizza" | "wunsch" | "burger" | "pasta" | "lasagne";

export interface MenuItem {
  id: string;
  name: string;
  desc: string;
  allergens: AllergenCode[];
  price?: Cents;
  variants?: Variant[];
  options?: OptionKind;
  deposit?: Cents;
  veg?: boolean;
  spicy?: boolean;
  popular?: boolean;
}

export interface Category { id: string; name: string; note: string; items: MenuItem[] }

export interface Zone { id: string; name: string; places: string[]; minOrder: Cents; fee: Cents }

export interface Sauce { id: string; name: string; desc: string; allergens: AllergenCode[]; veg?: boolean; spicy?: boolean }

/** Öffnungszeiten: Wochentag (0 = Sonntag) → Liste von [von, bis] in Minuten ab Mitternacht */
export type Hours = Record<string, [number, number][]>;

export interface Menu {
  restaurant: { name: string; full: string; phone: string; phoneIntl: string; street: string; city: string; mapsQuery: string };
  hours: Hours;
  zones: Zone[];
  pizzaToppings: { price: Cents; items: string[] };
  burgerExtras: { id: string; name: string; price: Cents; allergens: AllergenCode[] }[];
  pasta: { noodles: string[]; sauces: Sauce[] };
  lasagneCheese: Cents;
  categories: Category[];
  allergens: Record<AllergenCode, string>;
}

/** Eine Position im Warenkorb – genau das, was der Gast ausgewählt hat. */
export interface LineInput {
  itemId: string;
  qty: number;
  variant?: string;
  /** Pizza: Extra-Zutaten · Wunschpizza: die gewählten Zutaten */
  toppings?: string[];
  /** Burger: IDs der Extra-Zutaten */
  extras?: string[];
  noodle?: string;
  sauce?: string;
  cheese?: boolean;
  note?: string;
}

export type Mode = "delivery" | "pickup";

export function isMenu(x: unknown): x is Menu {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return Array.isArray(m.categories) && Array.isArray(m.zones) && typeof m.hours === "object" && typeof m.restaurant === "object";
}
