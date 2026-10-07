/**
 * Verbindung zum Rust-Server (optional).
 * Läuft die Seite ohne Server (z. B. auf Netlify), meldet available() false
 * und die Website arbeitet im lokalen Modus weiter.
 */

import { apiBase } from "./config.js";
import type { LineInput, Mode } from "./types.js";

export interface User { id: number; email: string; name: string; phone: string; street: string; zoneId: string; place: string }
export interface OrderSummary { ref: string; createdAt: string; mode: Mode; total: number; items: number; status: string }
export interface OrderResult { ref: string; text: string; whatsappUrl: string; total: number; notified: boolean }

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

let availability: Promise<boolean> | null = null;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiBase() + path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body: unknown = isJson ? await res.json() : null;
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Serverfehler (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export function available(): Promise<boolean> {
  availability ??= (async () => {
    try {
      const ctl = new AbortController();
      const t = window.setTimeout(() => ctl.abort(), 2000);
      const res = await fetch(apiBase() + "/health", { signal: ctl.signal, credentials: "include" });
      window.clearTimeout(t);
      if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) return false;
      const j = (await res.json()) as { ok?: boolean };
      return j.ok === true;
    } catch {
      return false;
    }
  })();
  return availability;
}

export const api = {
  me: () => call<{ user: User | null }>("/me"),
  register: (b: { email: string; password: string; name: string; phone: string; remember: boolean }) =>
    call<{ user: User }>("/register", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { email: string; password: string; remember: boolean }) =>
    call<{ user: User }>("/login", { method: "POST", body: JSON.stringify(b) }),
  logout: () => call<{ ok: true }>("/logout", { method: "POST" }),
  saveProfile: (b: Partial<Omit<User, "id" | "email">>) =>
    call<{ user: User }>("/me", { method: "PUT", body: JSON.stringify(b) }),
  orders: () => call<{ orders: OrderSummary[] }>("/orders"),
  placeOrder: (b: {
    lines: LineInput[]; mode: Mode; zoneId?: string;
    customer: { name: string; phone: string; street?: string; place?: string; time: number | "asap"; payment: "bar" | "karte"; note?: string };
  }) => call<OrderResult>("/orders", { method: "POST", body: JSON.stringify(b) }),
};
