import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMenu, type LineInput, type Menu, type Mode } from "../src/types.js";
import { euro, fromPrice, lineKey, priceLine, totals, PriceError } from "../src/pricing.js";

const root = fileURLToPath(new URL("../../../shared/", import.meta.url));
const menu: unknown = JSON.parse(readFileSync(root + "menu.json", "utf8"));
assert.ok(isMenu(menu));
const M = menu as Menu;

interface Vector { name: string; mode: Mode; zone?: string; lines: LineInput[]; expect?: Record<string, number>; error?: boolean }
const vectors = JSON.parse(readFileSync(root + "price-vectors.json", "utf8")) as Vector[];

for (const v of vectors) {
  test(`Vektor: ${v.name}`, () => {
    if (v.error) {
      assert.throws(() => totals(M, v.lines, v.mode, v.zone), PriceError);
      return;
    }
    const t = totals(M, v.lines, v.mode, v.zone);
    for (const [k, val] of Object.entries(v.expect ?? {})) assert.equal(t[k as keyof typeof t], val, k);
  });
}

test("Speisekarte: eindeutige IDs, alle Preise ganze Cent", () => {
  const ids = new Set<string>();
  for (const c of M.categories) for (const i of c.items) {
    assert.ok(!ids.has(i.id), `doppelte ID ${i.id}`);
    ids.add(i.id);
    const prices = i.variants ? i.variants.map((x) => x.price) : [i.price];
    for (const p of prices) assert.ok(Number.isInteger(p) && (p as number) > 0, `${i.id}: Preis ${p}`);
    for (const a of i.allergens) assert.ok(a in M.allergens, `${i.id}: Allergen ${a}`);
  }
});

test("euro() formatiert österreichisch", () => {
  assert.equal(euro(1240), "€ 12,40");
  assert.equal(euro(5), "€ 0,05");
  assert.equal(euro(123450), "€ 1.234,50");
  assert.equal(euro(-200), "-€ 2,00");
});

test("fromPrice nimmt die kleinste Variante", () => {
  const stangerl = M.categories.find((c) => c.id === "stangerl")!.items[0]!;
  assert.equal(fromPrice(stangerl), 780);
});

test("Wunschpizza: 5 inklusive, ab der 6. Zutat Aufpreis", () => {
  const five = priceLine(M, { itemId: "wunschpizza", qty: 1, toppings: ["Schinken", "Salami", "Mais", "Zwiebel", "Champignons"] });
  const six = priceLine(M, { itemId: "wunschpizza", qty: 1, toppings: ["Schinken", "Salami", "Mais", "Zwiebel", "Champignons", "Extra Käse"] });
  assert.equal(six.unit - five.unit, M.pizzaToppings.price);
});

test("lineKey fasst gleiche Auswahl zusammen, unterscheidet Anmerkungen", () => {
  const a = lineKey({ itemId: "hamburger", qty: 1, variant: "100", extras: ["speck", "cheddar"] });
  const b = lineKey({ itemId: "hamburger", qty: 3, variant: "100", extras: ["cheddar", "speck"] });
  const c = lineKey({ itemId: "hamburger", qty: 1, variant: "100", extras: ["speck", "cheddar"], note: "ohne Zwiebel" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("Menge 21 wird abgelehnt", () => {
  assert.throws(() => priceLine(M, { itemId: "margherita", qty: 21 }), PriceError);
});
