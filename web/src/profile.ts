/** „Daten merken“ ohne Konto: nur in diesem Browser gespeichert. */

import { load, remove, save } from "./storage.js";

export interface Profile {
  name: string;
  phone: string;
  street: string;
  zoneId: string;
  place: string;
  payment: "bar" | "karte";
}

const KEY = "peperoni.profile.v1";

export const emptyProfile = (): Profile => ({ name: "", phone: "", street: "", zoneId: "", place: "", payment: "bar" });

export function loadProfile(): Profile | null {
  const p = load<Partial<Profile> | null>(KEY, null);
  return p ? { ...emptyProfile(), ...p } : null;
}
export const saveProfile = (p: Profile): void => save(KEY, p);
export const forgetProfile = (): void => remove(KEY);

/** Letzte Bestellungen lokal (Bestellnummer, Zeitpunkt, Summe) */
export interface LocalOrder { ref: string; at: string; total: number; mode: "delivery" | "pickup"; items: number }
const HKEY = "peperoni.history.v1";
export const loadHistory = (): LocalOrder[] => load<LocalOrder[]>(HKEY, []);
export function pushHistory(o: LocalOrder): void {
  save(HKEY, [o, ...loadHistory()].slice(0, 10));
}
export const forgetHistory = (): void => remove(HKEY);
