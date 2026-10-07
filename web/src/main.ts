/** Einstieg: Speisekarte laden, alles verdrahten. */

import { isMenu, type Menu } from "./types.js";
import type { Ctx } from "./ctx.js";
import type { User } from "./api.js";
import { api, available } from "./api.js";
import { Cart } from "./cart.js";
import { euro, fromPrice, totals } from "./pricing.js";
import { DAY_NAMES, hhmm, status, statusText, viennaNow } from "./hours.js";
import { h, svg, toast, announce } from "./dom.js";
import { heroPizza, LOGO, zoneMap } from "./art.js";
import { needsChoice, renderMenu } from "./menu-view.js";
import { closeOnBackdrop, openCustomizer } from "./customizer.js";
import { cartDrawer } from "./cart-view.js";
import { accountDialog } from "./account.js";

const all = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const one = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`fehlt: ${sel}`);
  return el;
};

async function loadMenu(): Promise<Menu> {
  const res = await fetch("data/menu.json");
  const j: unknown = await res.json();
  if (!isMenu(j)) throw new Error("Speisekarte ungültig");
  return j;
}

function statics(menu: Menu): void {
  all("[data-logo]").forEach((el) => el.replaceChildren(svg(LOGO)));
  one("[data-hero-pizza]").replaceChildren(svg(heroPizza()));

  const pizzas = menu.categories.find((c) => c.id === "pizza")?.items ?? [];
  one("[data-pizza-from]").textContent = euro(Math.min(...pizzas.map(fromPrice)));
  one("[data-fact-fee]").textContent = `ab ${euro(Math.min(...menu.zones.map((z) => z.fee)))}`;
  one("[data-fact-min]").textContent = `ab ${euro(Math.min(...menu.zones.map((z) => z.minOrder)))}`;

  // Laufband mit Hausspezialitäten
  const names = menu.categories.flatMap((c) => c.items).filter((i) => i.popular).map((i) => i.name);
  const words = [...names, "Pizzastangerl", "Lasagne", "Wunschpizza"];
  const track = one("[data-marquee]");
  for (let k = 0; k < 2; k++) for (const w of words) track.append(h("span", {}, w), h("i", {}, "✦"));

  // Liefergebiete
  one("[data-zones]").replaceChildren(...menu.zones.map((z, i) =>
    h("article", { class: "zone" },
      h("span", { class: "zone-no" }, String(i + 1)),
      h("div", {},
        h("h3", {}, z.places.join(" · ")),
        h("p", {}, h("span", {}, "Mindestbestellwert ", h("b", {}, euro(z.minOrder))), h("span", {}, "Liefergebühr ", h("b", {}, euro(z.fee))))))));
  one("[data-zone-map]").replaceChildren(svg(zoneMap(menu.zones)));

  // Öffnungszeiten (Montag zuerst)
  const today = viennaNow().weekday;
  const table = one<HTMLTableElement>("[data-hours]");
  const tb = h("tbody", {});
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    const sl = menu.hours[String(wd)] ?? [];
    tb.append(h("tr", { class: wd === today ? "today" : "" },
      h("th", { scope: "row" }, DAY_NAMES[wd], wd === today ? h("small", {}, "heute") : null),
      h("td", {}, sl.length ? sl.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(" · ") : h("span", { class: "rest" }, "Ruhetag"))));
  }
  table.append(tb);

  // Allergene
  one("[data-allergens]").replaceChildren(...Object.entries(menu.allergens).map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v))));

  // Route
  one<HTMLAnchorElement>("[data-maps]").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(menu.restaurant.mapsQuery)}`;
}

function liveStatus(menu: Menu): void {
  const pill = one("[data-status]");
  const tick = (): void => {
    const s = status(menu.hours, viennaNow());
    pill.classList.toggle("open", s.open);
    pill.querySelector("span")!.textContent = statusText(s).replace("Jetzt geöffnet · ", "Offen ").replace("Geschlossen · wieder ", "Zu · ");
    pill.title = statusText(s);
  };
  tick();
  window.setInterval(tick, 30_000);
}

async function boot(): Promise<void> {
  const menu = await loadMenu();
  const cart = new Cart(menu);

  const userListeners: ((u: User | null) => void)[] = [];
  const ctx: Ctx = {
    menu, cart, apiOn: false, user: null,
    setUser(u) { ctx.user = u; userListeners.forEach((fn) => fn(u)); },
    onUser(fn) { userListeners.push(fn); },
    openCart: (v) => drawer.open(v),
    openAccount: () => account.open(),
  };

  statics(menu);
  liveStatus(menu);

  const czDlg = one<HTMLDialogElement>("[data-customizer]");
  const cartDlg = one<HTMLDialogElement>("[data-cart]");
  const accDlg = one<HTMLDialogElement>("[data-account]");
  [czDlg, cartDlg, accDlg].forEach(closeOnBackdrop);

  const drawer = cartDrawer(ctx, cartDlg);
  const account = accountDialog(ctx, accDlg);

  // Speisekarte
  const view = renderMenu(menu, one("[data-menu]"), one("[data-cat-nav]"), {
    onPick(item) {
      const add = (line: Parameters<Cart["add"]>[0]): void => {
        cart.add(line);
        toast(`${line.qty}× ${item.name} im Warenkorb`);
        announce(`${item.name} hinzugefügt`);
        bump();
      };
      if (needsChoice(item) || item.id === "softdrink") openCustomizer(menu, czDlg, item, add);
      else add({ itemId: item.id, qty: 1 });
    },
  });

  const filters = new Set<"veg" | "spicy" | "popular">();
  const search = one<HTMLInputElement>("[data-search]");
  const apply = (): void => { view.filter(search.value, filters); };
  search.addEventListener("input", apply);
  all<HTMLButtonElement>("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    const f = b.dataset.filter as "veg" | "spicy" | "popular";
    if (filters.has(f)) filters.delete(f); else filters.add(f);
    b.setAttribute("aria-pressed", String(filters.has(f)));
    apply();
  }));

  // Warenkorb-Anzeigen
  const fab = one<HTMLButtonElement>(".fab");
  const bump = (): void => all(".cart-btn, .fab").forEach((b) => { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); });
  cart.subscribe((s) => {
    const n = cart.count();
    let sum = 0;
    try { sum = totals(menu, s.lines, "pickup").subtotal; } catch { /* ignorieren */ }
    all("[data-cart-count]").forEach((el) => (el.textContent = String(n)));
    all("[data-cart-sum]").forEach((el) => (el.textContent = euro(sum)));
    fab.hidden = n === 0;
    document.body.classList.toggle("has-cart", n > 0);
  });
  all("[data-open-cart]").forEach((b) => b.addEventListener("click", () => drawer.open()));
  all("[data-open-account]").forEach((b) => b.addEventListener("click", () => account.open()));

  // Header beim Scrollen verdichten
  const top = one(".top");
  const onScroll = (): void => { top.classList.toggle("scrolled", window.scrollY > 24); };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Server vorhanden? → Login möglich
  const label = one("[data-account-label]");
  const setLabel = (u: User | null): void => { label.textContent = u ? (u.name.split(" ")[0] || "Konto") : ctx.apiOn ? "Anmelden" : "Meine Daten"; };
  ctx.onUser(setLabel);
  setLabel(null);
  if (await available()) {
    ctx.apiOn = true;
    document.documentElement.dataset.api = "on";
    try { ctx.setUser((await api.me()).user); } catch { ctx.setUser(null); }
  }
}

boot().catch((e: unknown) => {
  console.error(e);
  const m = document.querySelector("[data-menu]");
  m?.replaceChildren(h("p", { class: "empty" }, "Die Speisekarte konnte nicht geladen werden. Bitte Seite neu laden oder anrufen: ", h("a", { href: "tel:+43347640786" }, "03476 40786")));
});
