/** Öffnungszeiten in österreichischer Zeit – unabhängig von der Zeitzone des Geräts. */

import type { Hours } from "./types.js";

export interface ViennaNow { weekday: number; minutes: number; date: string }

export function viennaNow(at: Date = new Date()): ViennaNow {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const g = (t: Intl.DateTimeFormatPartTypes): string => p.find((x) => x.type === t)?.value ?? "";
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")),
    minutes: Number(g("hour")) * 60 + Number(g("minute")),
    date: `${g("year")}-${g("month")}-${g("day")}`,
  };
}

export const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export interface Status {
  open: boolean;
  /** offen: Schließzeit heute · geschlossen: nächste Öffnung */
  until?: number;
  next?: { weekday: number; minutes: number; inDays: number };
}

export function status(hours: Hours, now: ViennaNow): Status {
  const today = hours[String(now.weekday)] ?? [];
  const current = today.find(([a, b]) => now.minutes >= a && now.minutes < b);
  if (current) return { open: true, until: current[1] };
  for (let d = 0; d < 8; d++) {
    const wd = (now.weekday + d) % 7;
    const slot = (hours[String(wd)] ?? []).find(([a]) => d > 0 || a > now.minutes);
    if (slot) return { open: false, next: { weekday: wd, minutes: slot[0], inDays: d } };
  }
  return { open: false };
}

export function statusText(s: Status): string {
  if (s.open && s.until !== undefined) return `Jetzt geöffnet · bis ${hhmm(s.until)} Uhr`;
  if (!s.next) return "Derzeit geschlossen";
  const when = s.next.inDays === 0 ? "heute" : s.next.inDays === 1 ? "morgen" : DAY_NAMES[s.next.weekday];
  return `Geschlossen · wieder ${when} ab ${hhmm(s.next.minutes)} Uhr`;
}

/**
 * Wunschzeiten für heute im 15-Minuten-Raster.
 * Vorlauf: Abholung 20 Minuten, Lieferung 45 Minuten. Letzte Bestellung zur Schließzeit.
 */
export function slots(hours: Hours, now: ViennaNow, mode: "delivery" | "pickup"): number[] {
  const lead = mode === "delivery" ? 45 : 20;
  const out: number[] = [];
  for (const [a, b] of hours[String(now.weekday)] ?? []) {
    const start = Math.max(a + lead, Math.ceil((now.minutes + lead) / 15) * 15);
    for (let t = start; t <= b; t += 15) out.push(t);
  }
  return out;
}
