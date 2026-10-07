/**
 * Bestellung als WhatsApp-Nachricht.
 * Die Nachricht ist so aufgebaut, dass man sie in der Küche sofort lesen kann:
 * Lieferart und Adresse oben, dann Positionen, dann Summe und Zahlung.
 */

import type { LineInput, Menu, Mode } from "./types.js";
import { priceLine, totals, euro } from "./pricing.js";
import { hhmm } from "./hours.js";

export interface Customer {
  name: string;
  phone: string;
  street?: string;
  zoneId?: string;
  place?: string;
  time: number | "asap";
  payment: "bar" | "karte";
  note?: string;
}

export class OrderError extends Error {}

/** Telefonnummer prüfen und auf +43… normalisieren */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  let n = digits.startsWith("+") ? digits : digits.startsWith("00") ? "+" + digits.slice(2) : digits.startsWith("0") ? "+43" + digits.slice(1) : digits;
  n = n.replace(/(?!^)\+/g, "");
  if (!/^\+\d{8,15}$/.test(n)) throw new OrderError("Bitte eine gültige Telefonnummer angeben.");
  return n;
}

export function validateCustomer(c: Customer, mode: Mode): void {
  if (c.name.trim().length < 2) throw new OrderError("Bitte Ihren Namen angeben.");
  normalizePhone(c.phone);
  if (mode === "delivery") {
    if (!c.street || c.street.trim().length < 4) throw new OrderError("Bitte Straße und Hausnummer angeben.");
    if (!c.zoneId) throw new OrderError("Bitte den Ort wählen.");
  }
}

export function formatOrder(menu: Menu, lines: LineInput[], mode: Mode, c: Customer, orderRef: string): string {
  validateCustomer(c, mode);
  const t = totals(menu, lines, mode, c.zoneId);
  if (mode === "delivery" && t.missing > 0) {
    throw new OrderError(`Mindestbestellwert für dieses Gebiet: ${euro(t.minOrder)}. Es fehlen noch ${euro(t.missing)}.`);
  }
  const zone = menu.zones.find((z) => z.id === c.zoneId);
  const out: string[] = [];
  out.push(`*Neue Bestellung ${orderRef}*`);
  out.push(mode === "delivery" ? "*LIEFERUNG*" : "*ABHOLUNG*");
  out.push(`${c.name.trim()} · ${normalizePhone(c.phone)}`);
  if (mode === "delivery") out.push(`${c.street?.trim()}, ${c.place ?? zone?.places[0] ?? ""}`);
  out.push(`Zeit: ${c.time === "asap" ? "so schnell wie möglich" : hhmm(c.time) + " Uhr"}`);
  out.push("");
  for (const l of lines) {
    const p = priceLine(menu, l);
    out.push(`${l.qty}× ${p.title} – ${euro(p.unit * l.qty)}`);
    if (p.details.length) out.push(`   ${p.details.join(", ")}`);
    if (l.note?.trim()) out.push(`   Anmerkung: ${l.note.trim()}`);
  }
  out.push("");
  out.push(`Zwischensumme: ${euro(t.subtotal)}`);
  if (t.deposit) out.push(`Pfand: ${euro(t.deposit)}`);
  if (mode === "delivery") out.push(`Liefergebühr: ${euro(t.fee)}`);
  out.push(`*Gesamt: ${euro(t.total)}*`);
  out.push(`Zahlung: ${c.payment === "bar" ? "bar" : "mit Karte"} bei ${mode === "delivery" ? "Lieferung" : "Abholung"}`);
  if (c.note?.trim()) out.push(`Anmerkung: ${c.note.trim()}`);
  return out.join("\n");
}

/** WhatsApp-Link (funktioniert am Handy und mit WhatsApp Web) */
export function whatsappUrl(targetIntl: string, text: string): string {
  return `https://wa.me/${targetIntl.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** Kurze, gut vorlesbare Bestellnummer, z. B. "P-7K3Q" */
export function orderRef(random: () => number = Math.random): string {
  const a = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  return "P-" + Array.from({ length: 4 }, () => a[Math.floor(random() * a.length)]).join("");
}
