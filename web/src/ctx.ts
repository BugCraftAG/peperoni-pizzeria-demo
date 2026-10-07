/** Gemeinsamer Zustand der Seite */

import type { Menu } from "./types.js";
import type { Cart } from "./cart.js";
import type { User } from "./api.js";

export interface Ctx {
  menu: Menu;
  cart: Cart;
  /** läuft der Rust-Server? (sonst lokaler Modus) */
  apiOn: boolean;
  user: User | null;
  setUser(u: User | null): void;
  onUser(fn: (u: User | null) => void): void;
  openCart(view?: "cart" | "checkout"): void;
  openAccount(): void;
}
