/**
 * Preisberechnung – reine Funktionen, keine Seiteneffekte.
 *
 * Dieselben Regeln sind im Rust-Server (server/src/pricing.rs) umgesetzt. Beide
 * werden gegen dieselben Testfälle (shared/price-vectors.json) geprüft, damit
 * Website und Server garantiert dasselbe rechnen. Der Server vertraut nie dem
 * Preis, den der Browser schickt.
 */

import type { Cents, LineInput, Menu, MenuItem, Mode, Zone } from "./types.js";

export const MAX_QTY = 20;
export const MAX_EXTRA_TOPPINGS = 8;
export const WUNSCH_INCLUDED = 5;

export class PriceError extends Error {}

export interface PricedLine {
  unit: Cents;        // Preis pro Stück (ohne Pfand)
  deposit: Cents;     // Pfand pro Stück
  title: string;      // z. B. "Pizza Peperoni"
  details: string[];  // z. B. ["+ Mais", "+ Extra Käse"]
}

export function findItem(menu: Menu, id: string): MenuItem | undefined {
  for (const c of menu.categories) for (const i of c.items) if (i.id === id) return i;
  return undefined;
}

export function basePrice(item: MenuItem, variantId?: string): Cents {
  if (item.variants?.length) {
    const v = item.variants.find((x) => x.id === variantId);
    if (!v) throw new PriceError(`${item.name}: bitte eine Größe/Variante wählen.`);
    return v.price;
  }
  if (item.price === undefined) throw new PriceError(`${item.name}: kein Preis hinterlegt.`);
  return item.price;
}

/** Ab-Preis für die Speisekarte (kleinste Variante) */
export function fromPrice(item: MenuItem): Cents {
  return item.variants?.length ? Math.min(...item.variants.map((v) => v.price)) : item.price ?? 0;
}

function unique(list: string[], what: string): void {
  if (new Set(list).size !== list.length) throw new PriceError(`${what} doppelt gewählt.`);
}

export function priceLine(menu: Menu, line: LineInput): PricedLine {
  const item = findItem(menu, line.itemId);
  if (!item) throw new PriceError(`Unbekanntes Gericht: ${line.itemId}`);
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) throw new PriceError(`Menge muss zwischen 1 und ${MAX_QTY} liegen.`);

  let unit = basePrice(item, line.variant);
  const details: string[] = [];
  const variant = item.variants?.find((v) => v.id === line.variant);
  if (variant) details.push(variant.label);

  const toppings = line.toppings ?? [];
  const extras = line.extras ?? [];
  if (item.options !== "pizza" && item.options !== "wunsch" && toppings.length) throw new PriceError(`${item.name}: keine Zutaten wählbar.`);
  if (item.options !== "burger" && extras.length) throw new PriceError(`${item.name}: keine Extras wählbar.`);

  switch (item.options) {
    case "pizza": {
      unique(toppings, "Zutat");
      if (toppings.length > MAX_EXTRA_TOPPINGS) throw new PriceError(`Höchstens ${MAX_EXTRA_TOPPINGS} Extra-Zutaten.`);
      for (const t of toppings) {
        if (!menu.pizzaToppings.items.includes(t)) throw new PriceError(`Unbekannte Zutat: ${t}`);
        unit += menu.pizzaToppings.price;
        details.push(`+ ${t}`);
      }
      break;
    }
    case "wunsch": {
      unique(toppings, "Zutat");
      if (toppings.length < WUNSCH_INCLUDED) throw new PriceError(`Wunschpizza: bitte ${WUNSCH_INCLUDED} Zutaten wählen.`);
      if (toppings.length > WUNSCH_INCLUDED + MAX_EXTRA_TOPPINGS) throw new PriceError("Zu viele Zutaten.");
      toppings.forEach((t, i) => {
        if (!menu.pizzaToppings.items.includes(t)) throw new PriceError(`Unbekannte Zutat: ${t}`);
        if (i >= WUNSCH_INCLUDED) unit += menu.pizzaToppings.price;
        details.push(i < WUNSCH_INCLUDED ? t : `+ ${t}`);
      });
      break;
    }
    case "burger": {
      unique(extras, "Extra");
      for (const id of extras) {
        const e = menu.burgerExtras.find((x) => x.id === id);
        if (!e) throw new PriceError(`Unbekanntes Extra: ${id}`);
        unit += e.price;
        details.push(`+ ${e.name}`);
      }
      break;
    }
    case "pasta": {
      if (!line.noodle || !menu.pasta.noodles.includes(line.noodle)) throw new PriceError("Bitte eine Nudelsorte wählen.");
      const sauce = menu.pasta.sauces.find((s) => s.id === line.sauce);
      if (!sauce) throw new PriceError("Bitte eine Sauce wählen.");
      details.push(line.noodle, sauce.name);
      break;
    }
    case "lasagne": {
      if (line.cheese) {
        unit += menu.lasagneCheese;
        details.push("+ mit Käse überbacken");
      }
      break;
    }
    default:
      break;
  }
  if (item.options !== "pasta" && (line.noodle || line.sauce)) throw new PriceError(`${item.name}: keine Sauce wählbar.`);
  if (item.options !== "lasagne" && line.cheese) throw new PriceError(`${item.name}: nicht überbackbar.`);

  return { unit, deposit: item.deposit ?? 0, title: item.name, details };
}

export interface Totals {
  subtotal: Cents;   // Speisen & Getränke
  deposit: Cents;    // Pfand
  fee: Cents;        // Liefergebühr
  total: Cents;
  minOrder: Cents;
  missing: Cents;    // fehlt noch bis zum Mindestbestellwert
}

export function totals(menu: Menu, lines: LineInput[], mode: Mode, zoneId?: string): Totals {
  let subtotal = 0;
  let deposit = 0;
  for (const l of lines) {
    const p = priceLine(menu, l);
    subtotal += p.unit * l.qty;
    deposit += p.deposit * l.qty;
  }
  let zone: Zone | undefined;
  if (mode === "delivery") {
    zone = menu.zones.find((z) => z.id === zoneId);
    if (!zone) throw new PriceError("Bitte ein Liefergebiet wählen.");
  }
  const fee = zone?.fee ?? 0;
  const minOrder = zone?.minOrder ?? 0;
  return { subtotal, deposit, fee, total: subtotal + deposit + fee, minOrder, missing: Math.max(0, minOrder - subtotal) };
}

/** Gleiche Auswahl → gleicher Schlüssel; so werden identische Positionen zusammengefasst. */
export function lineKey(l: LineInput): string {
  return JSON.stringify([l.itemId, l.variant ?? "", [...(l.toppings ?? [])], [...(l.extras ?? [])].sort(), l.noodle ?? "", l.sauce ?? "", Boolean(l.cheese), (l.note ?? "").trim()]);
}

/** 1240 → "€ 12,40", 123450 → "€ 1.234,50" – identisch zur Rust-Funktion `euro()` */
export function euro(c: Cents): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(Math.round(c));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}€ ${whole},${String(abs % 100).padStart(2, "0")}`;
}
