/** Warenkorb: Positionen + Lieferart, im Browser gespeichert. */

import type { LineInput, Menu, Mode } from "./types.js";
import { lineKey, MAX_QTY, priceLine } from "./pricing.js";
import { load, save } from "./storage.js";

export interface CartState { lines: LineInput[]; mode: Mode; zoneId: string; place: string }

const KEY = "peperoni.cart.v1";
type Listener = (s: CartState) => void;

export class Cart {
  private state: CartState;
  private listeners: Listener[] = [];

  constructor(private menu: Menu) {
    const s = load<CartState>(KEY, { lines: [], mode: "delivery", zoneId: "", place: "" });
    // Nach einer Kartenänderung ungültige Positionen still verwerfen
    s.lines = (Array.isArray(s.lines) ? s.lines : []).filter((l) => {
      try { priceLine(menu, l); return true; } catch { return false; }
    });
    if (s.mode !== "pickup") s.mode = "delivery";
    const zone = menu.zones.find((z) => z.id === s.zoneId);
    if (!zone || !zone.places.includes(s.place)) { s.zoneId = ""; s.place = ""; }
    this.state = s;
  }

  get(): CartState { return this.state; }
  count(): number { return this.state.lines.reduce((n, l) => n + l.qty, 0); }

  subscribe(fn: Listener): void { this.listeners.push(fn); fn(this.state); }

  private commit(): void {
    save(KEY, this.state);
    for (const fn of this.listeners) fn(this.state);
  }

  add(line: LineInput): void {
    priceLine(this.menu, line); // wirft bei ungültiger Auswahl
    const key = lineKey(line);
    const existing = this.state.lines.find((l) => lineKey(l) === key);
    if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + line.qty);
    else this.state.lines.push({ ...line });
    this.commit();
  }

  setQty(index: number, qty: number): void {
    const l = this.state.lines[index];
    if (!l) return;
    if (qty <= 0) this.state.lines.splice(index, 1);
    else l.qty = Math.min(MAX_QTY, qty);
    this.commit();
  }

  setMode(mode: Mode): void { this.state.mode = mode; this.commit(); }
  /** Ort wählen – das Liefergebiet ergibt sich daraus */
  setPlace(place: string): void {
    const zone = this.menu.zones.find((z) => z.places.includes(place));
    this.state.place = zone ? place : "";
    this.state.zoneId = zone?.id ?? "";
    this.commit();
  }
  clear(): void { this.state.lines = []; this.commit(); }
}
