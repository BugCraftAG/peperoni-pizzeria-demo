/** Speisekarte: Kategorien, Suche, Filter, Karten */

import type { Category, Menu, MenuItem } from "./types.js";
import { euro, fromPrice } from "./pricing.js";
import { h, svg } from "./dom.js";
import { icon } from "./art.js";

type Filter = "veg" | "spicy" | "popular";

export interface MenuViewOptions {
  onPick: (item: MenuItem) => void;
}

/** Umlaute vereinfachen, damit „doner" auch „Döner" findet */
const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

export function needsChoice(item: MenuItem): boolean {
  return Boolean(item.variants?.length || item.options);
}

function card(menu: Menu, item: MenuItem, opts: MenuViewOptions): HTMLElement {
  const price = fromPrice(item);
  const from = item.variants && new Set(item.variants.map((v) => v.price)).size > 1;
  const tags: HTMLElement[] = [];
  if (item.popular) tags.push(h("span", { class: "tag tag-pop" }, "Hausspezialität"));
  if (item.veg && !item.deposit) tags.push(h("span", { class: "tag tag-veg", title: "vegetarisch" }, "veg"));
  if (item.spicy) tags.push(h("span", { class: "tag tag-hot", title: "scharf" }, "scharf"));

  const allergenTitle = item.allergens.map((a) => `${a}: ${menu.allergens[a]}`).join(", ");
  const btnLabel = needsChoice(item) ? `${item.name} auswählen` : `${item.name} in den Warenkorb`;

  const el = h("article", { class: `dish${item.popular ? " is-pop" : ""}`, id: `g-${item.id}` },
    h("div", { class: "dish-top" },
      h("h4", { class: "dish-name" }, item.name),
      tags.length ? h("div", { class: "dish-tags" }, tags) : null,
    ),
    h("p", { class: "dish-desc" }, item.desc),
    item.variants && item.options !== "burger" && item.variants.length > 1
      ? h("p", { class: "dish-variants" }, item.variants.map((v) => `${v.label} ${euro(v.price)}`).join(" · "))
      : item.options === "burger" && item.variants
        ? h("p", { class: "dish-variants" }, item.variants.map((v) => `${v.label.replace(" Fleisch", "")} ${euro(v.price)}`).join(" · "))
        : null,
    h("div", { class: "dish-foot" },
      h("span", { class: "dish-price" }, from ? h("small", {}, "ab ") : null, euro(price)),
      item.allergens.length ? h("abbr", { class: "dish-all", title: allergenTitle }, item.allergens.join(" ")) : null,
      h("button", { type: "button", class: "add", "aria-label": btnLabel, onclick: () => opts.onPick(item) },
        svg(`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`)),
    ),
  );
  return el;
}

export function renderMenu(menu: Menu, root: HTMLElement, nav: HTMLElement, opts: MenuViewOptions): { filter: (q: string, f: Set<Filter>) => number } {
  root.replaceChildren();
  nav.replaceChildren();

  const sections: { cat: Category; sec: HTMLElement; cards: { item: MenuItem; el: HTMLElement; text: string }[]; link: HTMLAnchorElement }[] = [];

  for (const cat of menu.categories) {
    const link = h("a", { href: `#k-${cat.id}`, class: "cat-link" }, svg(icon(cat.id)), h("span", {}, cat.name));
    nav.append(link);
    const cards = cat.items.map((item) => {
      const el = card(menu, item, opts);
      const text = fold([item.name, item.desc, cat.name].join(" "));
      return { item, el, text };
    });
    const sec = h("section", { class: `cat cat-${cat.id}`, id: `k-${cat.id}`, "aria-labelledby": `kt-${cat.id}` },
      h("header", { class: "cat-head" },
        h("span", { class: "cat-ico" }, svg(icon(cat.id))),
        h("div", {},
          h("h3", { id: `kt-${cat.id}` }, cat.name),
          cat.note ? h("p", {}, cat.note) : null),
        h("span", { class: "cat-count" }, `${cat.items.length}`),
      ),
      h("div", { class: "dishes" }, cards.map((c) => c.el)),
    );
    root.append(sec);
    sections.push({ cat, sec, cards, link });
  }
  const empty = h("p", { class: "empty", hidden: true }, "Nichts gefunden. Probier einen anderen Begriff – oder ruf uns an: 03476 40786.");
  root.append(empty);

  // aktive Kategorie in der Leiste markieren
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const s of sections) {
        const on = s.sec === e.target;
        s.link.classList.toggle("on", on);
        if (on) {
          s.link.setAttribute("aria-current", "true");
          const bar = nav;
          const left = s.link.offsetLeft - bar.clientWidth / 2 + s.link.clientWidth / 2;
          bar.scrollTo({ left, behavior: "smooth" });
        } else s.link.removeAttribute("aria-current");
      }
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  sections.forEach((s) => io.observe(s.sec));

  return {
    filter(q, f) {
      const needle = fold(q.trim());
      let shown = 0;
      for (const s of sections) {
        let n = 0;
        for (const c of s.cards) {
          const ok = (!needle || needle.split(/\s+/).every((w) => c.text.includes(w)))
            && (!f.has("veg") || c.item.veg)
            && (!f.has("spicy") || c.item.spicy)
            && (!f.has("popular") || c.item.popular);
          c.el.hidden = !ok;
          if (ok) n++;
        }
        s.sec.hidden = n === 0;
        s.link.hidden = n === 0;
        shown += n;
      }
      empty.hidden = shown > 0;
      return shown;
    },
  };
}
