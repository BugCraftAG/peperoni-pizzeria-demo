import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Menu } from "../src/types.js";
import { slots, status, statusText, viennaNow } from "../src/hours.js";

const M = JSON.parse(readFileSync(fileURLToPath(new URL("../../../shared/menu.json", import.meta.url)), "utf8")) as Menu;
const H = M.hours;

test("viennaNow rechnet in Wiener Zeit (Sommerzeit)", () => {
  // 2026-07-15 10:30 UTC = 12:30 in Wien, Mittwoch
  const n = viennaNow(new Date("2026-07-15T10:30:00Z"));
  assert.deepEqual(n, { weekday: 3, minutes: 750, date: "2026-07-15" });
});

test("Mittwoch 12:30 offen bis 14:00", () => {
  const s = status(H, { weekday: 3, minutes: 750, date: "" });
  assert.equal(s.open, true);
  assert.equal(statusText(s), "Jetzt geöffnet · bis 14:00 Uhr");
});

test("Mittwoch 15:00 Mittagspause → heute ab 16:00", () => {
  assert.equal(statusText(status(H, { weekday: 3, minutes: 900, date: "" })), "Geschlossen · wieder heute ab 16:00 Uhr");
});

test("Montag 22:00 → Dienstag Ruhetag → Mittwoch ab 11:00", () => {
  assert.equal(statusText(status(H, { weekday: 1, minutes: 1320, date: "" })), "Geschlossen · wieder Mittwoch ab 11:00 Uhr");
});

test("Samstag durchgehend 11–21", () => {
  assert.equal(status(H, { weekday: 6, minutes: 900, date: "" }).open, true);
});

test("Zeitfenster: Vorlauf und Raster", () => {
  const s = slots(H, { weekday: 3, minutes: 1200, date: "" }, "pickup"); // 20:00
  assert.deepEqual(s, [1230, 1245, 1260]);
  assert.deepEqual(slots(H, { weekday: 2, minutes: 700, date: "" }, "delivery"), []);
  const d = slots(H, { weekday: 3, minutes: 600, date: "" }, "delivery"); // 10:00
  assert.equal(d[0], 705); // 11:00 + 45 min
  assert.ok(d.every((t) => t % 15 === 0));
});
