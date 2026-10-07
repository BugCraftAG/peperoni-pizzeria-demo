/** Dialog zum Zusammenstellen eines Gerichts (Größe, Zutaten, Extras, Sauce …) */

import type { LineInput, Menu, MenuItem } from "./types.js";
import { euro, MAX_EXTRA_TOPPINGS, MAX_QTY, priceLine, PriceError, WUNSCH_INCLUDED } from "./pricing.js";
import { h, svg } from "./dom.js";

const CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

/** Klick auf den abgedunkelten Hintergrund schließt (der Inhalt füllt den Dialog ganz aus) */
export function closeOnBackdrop(d: HTMLDialogElement): void {
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
}

export function openDialog(d: HTMLDialogElement): void {
  if (!d.open) d.showModal();
  document.documentElement.classList.add("locked");
  d.addEventListener("close", () => {
    if (!document.querySelector("dialog[open]")) document.documentElement.classList.remove("locked");
  }, { once: true });
}

export function closeButton(d: HTMLDialogElement, label = "Schließen"): HTMLButtonElement {
  return h("button", { type: "button", class: "x", "aria-label": label, onclick: () => d.close() }, svg(CLOSE));
}

let uid = 0;

export function openCustomizer(menu: Menu, dlg: HTMLDialogElement, item: MenuItem, onAdd: (l: LineInput) => void): void {
  const line: LineInput = { itemId: item.id, qty: 1 };
  if (item.variants?.length) line.variant = item.variants[0]!.id;
  if (item.options === "pasta") line.noodle = menu.pasta.noodles[0];

  const groups: HTMLElement[] = [];
  const n = ++uid;

  // ── Größe / Variante
  if (item.variants?.length) {
    const label = item.options === "burger" ? "Fleisch" : item.id === "kebap-teller" ? "Beilage" : item.id === "energy" || item.id === "ketchup-mayo" ? "Sorte" : "Größe";
    groups.push(h("fieldset", { class: "opt" },
      h("legend", {}, label, h("em", {}, "Pflicht")),
      h("div", { class: "seg" }, item.variants.map((v, i) =>
        h("label", { class: "seg-opt" },
          h("input", { type: "radio", name: `v${n}`, value: v.id, checked: i === 0, onchange: () => { line.variant = v.id; update(); } }),
          h("span", {}, v.label, h("small", {}, euro(v.price))))))));
  }

  // ── Pizza-Zutaten
  if (item.options === "pizza" || item.options === "wunsch") {
    const wunsch = item.options === "wunsch";
    const counter = h("span", { class: "counter", "aria-live": "polite" });
    const chosen: string[] = [];
    const boxes: HTMLInputElement[] = [];
    const refresh = (): void => {
      line.toppings = [...chosen];
      if (wunsch) {
        const extra = Math.max(0, chosen.length - WUNSCH_INCLUDED);
        counter.textContent = chosen.length < WUNSCH_INCLUDED
          ? `${chosen.length} von ${WUNSCH_INCLUDED} gewählt`
          : `${WUNSCH_INCLUDED} inklusive${extra ? ` + ${extra} extra` : ""}`;
        counter.classList.toggle("ok", chosen.length >= WUNSCH_INCLUDED);
      } else {
        counter.textContent = chosen.length ? `${chosen.length} extra · + ${euro(chosen.length * menu.pizzaToppings.price)}` : `je + ${euro(menu.pizzaToppings.price)}`;
      }
      const max = wunsch ? WUNSCH_INCLUDED + MAX_EXTRA_TOPPINGS : MAX_EXTRA_TOPPINGS;
      for (const b of boxes) b.disabled = !b.checked && chosen.length >= max;
      update();
    };
    const grid = h("div", { class: "tops" }, menu.pizzaToppings.items.map((t) => {
      const box = h("input", {
        type: "checkbox", value: t,
        onchange: (e: Event) => {
          const on = (e.currentTarget as HTMLInputElement).checked;
          if (on) chosen.push(t); else chosen.splice(chosen.indexOf(t), 1);
          refresh();
        },
      });
      boxes.push(box);
      return h("label", { class: "tp" }, box, h("span", {}, t));
    }));
    groups.push(h("fieldset", { class: "opt" },
      h("legend", {}, wunsch ? `Deine ${WUNSCH_INCLUDED} Zutaten` : "Extra-Zutaten", counter),
      wunsch ? h("p", { class: "hint" }, `${WUNSCH_INCLUDED} Zutaten sind im Preis enthalten, jede weitere + ${euro(menu.pizzaToppings.price)}.`) : null,
      grid));
    queueMicrotask(refresh);
  }

  // ── Burger-Extras
  if (item.options === "burger") {
    const chosen = new Set<string>();
    groups.push(h("fieldset", { class: "opt" },
      h("legend", {}, "Extras", h("em", {}, "optional")),
      h("div", { class: "tops" }, menu.burgerExtras.map((x) =>
        h("label", { class: "tp" },
          h("input", { type: "checkbox", value: x.id, onchange: (e: Event) => {
            if ((e.currentTarget as HTMLInputElement).checked) chosen.add(x.id); else chosen.delete(x.id);
            line.extras = menu.burgerExtras.filter((b) => chosen.has(b.id)).map((b) => b.id);
            update();
          } }),
          h("span", {}, x.name, h("small", {}, `+ ${euro(x.price)}`)))))));
  }

  // ── Nudeln
  if (item.options === "pasta") {
    groups.push(h("fieldset", { class: "opt" },
      h("legend", {}, "Nudelsorte", h("em", {}, "Pflicht")),
      h("div", { class: "seg wrap-seg" }, menu.pasta.noodles.map((nd, i) =>
        h("label", { class: "seg-opt" },
          h("input", { type: "radio", name: `n${n}`, value: nd, checked: i === 0, onchange: () => { line.noodle = nd; update(); } }),
          h("span", {}, nd))))));
    groups.push(h("fieldset", { class: "opt" },
      h("legend", {}, "Sauce", h("em", {}, "Pflicht")),
      h("div", { class: "sauces" }, menu.pasta.sauces.map((s) =>
        h("label", { class: "sauce" },
          h("input", { type: "radio", name: `s${n}`, value: s.id, onchange: () => { line.sauce = s.id; update(); } }),
          h("span", {},
            h("b", {}, s.name, s.veg ? h("i", { class: "tag tag-veg" }, "veg") : null, s.spicy ? h("i", { class: "tag tag-hot" }, "scharf") : null),
            h("small", {}, s.desc)))))));
  }

  // ── Lasagne
  if (item.options === "lasagne") {
    groups.push(h("fieldset", { class: "opt" },
      h("legend", {}, "Extra"),
      h("label", { class: "tp wide" },
        h("input", { type: "checkbox", onchange: (e: Event) => { line.cheese = (e.currentTarget as HTMLInputElement).checked; update(); } }),
        h("span", {}, "mit Käse überbacken", h("small", {}, `+ ${euro(menu.lasagneCheese)}`)))));
  }

  // ── Anmerkung
  const noteId = `note${n}`;
  groups.push(h("div", { class: "opt" },
    h("label", { for: noteId, class: "legend" }, "Anmerkung", h("em", {}, item.id === "softdrink" ? "Sorte angeben" : "optional")),
    h("textarea", {
      id: noteId, rows: 2, maxlength: 140,
      placeholder: item.id === "softdrink" ? "z. B. Cola, Fanta, Eistee …" : "z. B. ohne Zwiebel, gut durch …",
      oninput: (e: Event) => { line.note = (e.currentTarget as HTMLTextAreaElement).value; },
    })));

  // ── Fuß: Menge + Button
  const qtyOut = h("output", { class: "qty-val", "aria-live": "polite" }, "1");
  const setQty = (q: number): void => { line.qty = Math.max(1, Math.min(MAX_QTY, q)); qtyOut.textContent = String(line.qty); update(); };
  const addBtn = h("button", { type: "submit", class: "btn btn-primary add-big" });
  const err = h("p", { class: "cz-err", "aria-live": "polite" });

  function update(): void {
    try {
      const p = priceLine(menu, line);
      addBtn.disabled = false;
      addBtn.replaceChildren(h("span", {}, h("span", { class: "l-long" }, "In den Warenkorb"), h("span", { class: "l-short" }, "Hinzufügen")), h("b", {}, euro(p.unit * line.qty)));
      err.textContent = "";
    } catch (e) {
      addBtn.disabled = true;
      addBtn.replaceChildren(h("span", {}, e instanceof PriceError ? e.message : "Bitte Auswahl prüfen"));
    }
  }

  const form = h("form", { method: "dialog", class: "cz-form", onsubmit: (e: Event) => {
    e.preventDefault();
    if (item.id === "softdrink" && !line.note?.trim()) {
      err.textContent = "Bitte die gewünschte Sorte als Anmerkung angeben.";
      (form.querySelector("textarea") as HTMLTextAreaElement).focus();
      return;
    }
    try {
      priceLine(menu, line);
      const clean: LineInput = { ...line, note: line.note?.trim() || undefined };
      if (!clean.toppings?.length) delete clean.toppings;
      if (!clean.extras?.length) delete clean.extras;
      if (!clean.cheese) delete clean.cheese;
      onAdd(clean);
      dlg.close();
    } catch (ex) {
      err.textContent = ex instanceof Error ? ex.message : "Fehler";
    }
  } },
    h("header", { class: "cz-head" },
      h("div", {},
        h("h2", { id: "cz-title" }, item.name),
        h("p", {}, item.desc)),
      closeButton(dlg)),
    h("div", { class: "cz-body" }, groups),
    h("footer", { class: "cz-foot" },
      err,
      h("div", { class: "cz-foot-row" },
        h("div", { class: "qty", role: "group", "aria-label": "Menge" },
          h("button", { type: "button", "aria-label": "weniger", onclick: () => setQty(line.qty - 1) }, "−"),
          qtyOut,
          h("button", { type: "button", "aria-label": "mehr", onclick: () => setQty(line.qty + 1) }, "+")),
        addBtn)),
  );

  dlg.replaceChildren(form);
  update();
  openDialog(dlg);
  (dlg.querySelector(".cz-body input, .cz-body textarea") as HTMLElement | null)?.focus({ preventScroll: true });
  dlg.querySelector(".cz-body")?.scrollTo(0, 0);
}
