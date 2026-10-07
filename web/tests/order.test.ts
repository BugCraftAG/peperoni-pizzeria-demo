import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Menu } from "../src/types.js";
import { formatOrder, normalizePhone, orderRef, whatsappUrl, OrderError, type Customer } from "../src/order.js";

const M = JSON.parse(readFileSync(fileURLToPath(new URL("../../../shared/menu.json", import.meta.url)), "utf8")) as Menu;

test("Telefonnummern werden normalisiert", () => {
  assert.equal(normalizePhone("0664 1234567"), "+436641234567");
  assert.equal(normalizePhone("+43 664 / 123 45 67"), "+436641234567");
  assert.equal(normalizePhone("0043 664 1234567"), "+436641234567");
  assert.throws(() => normalizePhone("123"), OrderError);
});

const customer: Customer = { name: "Max Muster", phone: "0664 1234567", street: "Hauptplatz 1", zoneId: "bad-radkersburg", time: "asap", payment: "bar" };

test("Bestelltext enthält alle Angaben", () => {
  const text = formatOrder(M, [
    { itemId: "pizza-peperoni", qty: 2, toppings: ["Mais"], note: "gut durch" },
    { itemId: "softdrink", qty: 1, note: "Cola" },
  ], "delivery", { ...customer, note: "Klingel 2" }, "P-TEST");
  for (const s of ["P-TEST", "LIEFERUNG", "Max Muster", "+436641234567", "Hauptplatz 1", "Bad Radkersburg", "2× Pizza Peperoni", "+ Mais", "gut durch", "Pfand", "Liefergebühr: € 2,00", "Gesamt: € 34,55", "Klingel 2", "bar"])
    assert.ok(text.includes(s), `fehlt: ${s}\n${text}`);
});

test("Mindestbestellwert wird bei Lieferung erzwungen", () => {
  assert.throws(() => formatOrder(M, [{ itemId: "doener-kebap", qty: 1 }], "delivery", customer, "P-1"), OrderError);
  assert.doesNotThrow(() => formatOrder(M, [{ itemId: "doener-kebap", qty: 1 }], "pickup", { ...customer, street: undefined, zoneId: undefined }, "P-1"));
});

test("Lieferung ohne Adresse wird abgelehnt", () => {
  assert.throws(() => formatOrder(M, [{ itemId: "margherita", qty: 2 }], "delivery", { ...customer, street: "" }, "P-1"), OrderError);
});

test("WhatsApp-Link ist korrekt kodiert", () => {
  const u = whatsappUrl("+43 664 5112794", "Hallo & *Pizza*\nZeile 2");
  assert.equal(u, "https://wa.me/436645112794?text=Hallo%20%26%20*Pizza*%0AZeile%202");
});

test("Bestellnummer: P- plus 4 eindeutig lesbare Zeichen", () => {
  assert.match(orderRef(), /^P-[2-9A-HJKMNP-Z]{4}$/);
});
