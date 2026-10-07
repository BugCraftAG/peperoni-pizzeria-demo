/** Warenkorb-Schublade: Positionen → Bestelldaten → Bestätigung */

import type { Ctx } from "./ctx.js";
import type { Mode } from "./types.js";
import { euro, priceLine, totals } from "./pricing.js";
import { DAY_NAMES, hhmm, slots, status, viennaNow } from "./hours.js";
import { formatOrder, normalizePhone, orderRef, whatsappUrl, type Customer } from "./order.js";
import { api, ApiError } from "./api.js";
import { DEMO, WHATSAPP_TARGET } from "./config.js";
import { h, svg, toast, announce } from "./dom.js";
import { closeButton, openDialog } from "./customizer.js";
import { forgetProfile, loadProfile, pushHistory, saveProfile, type Profile } from "./profile.js";

type View = "cart" | "checkout" | "done";

const I = {
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`,
  wa: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4Z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8c-1-.4-2.4-1.8-2.8-2.8l.8-1-1-2Z" fill="currentColor" stroke="none"/></svg>`,
  check: `<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>`,
  bag: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 22h40l-3 34H15Z"/><path d="M23 22v-4a9 9 0 0 1 18 0v4"/><path d="M26 38c2 3 10 3 12 0"/></svg>`,
};

export function cartDrawer(ctx: Ctx, dlg: HTMLDialogElement): { open: (v?: View) => void } {
  let view: View = "cart";
  let done: { ref: string; url: string; text: string; total: number; notified: boolean } | null = null;

  const render = (): void => {
    const body = view === "cart" ? cartView() : view === "checkout" ? checkoutView() : doneView();
    dlg.replaceChildren(body);
  };

  ctx.cart.subscribe(() => { if (dlg.open && view === "cart") { const y = dlg.querySelector(".dr-body")?.scrollTop ?? 0; render(); dlg.querySelector(".dr-body")?.scrollTo(0, y); } });
  dlg.addEventListener("close", () => { if (view === "done") { view = "cart"; done = null; } });

  function go(v: View): void {
    view = v;
    render();
    (dlg.querySelector("h2") as HTMLElement | null)?.focus();
  }

  // ───────────────────────── Warenkorb
  function modeSwitch(): HTMLElement {
    const { mode } = ctx.cart.get();
    const opt = (m: Mode, label: string, sub: string): HTMLElement =>
      h("label", { class: "seg-opt" },
        h("input", { type: "radio", name: "mode", value: m, checked: mode === m, onchange: () => ctx.cart.setMode(m) }),
        h("span", {}, label, h("small", {}, sub)));
    return h("fieldset", { class: "seg mode" },
      h("legend", { class: "sr" }, "Lieferart"),
      opt("delivery", "Lieferung", "zu dir nach Hause"),
      opt("pickup", "Abholung", "Langgasse 31"));
  }

  function placeSelect(): HTMLElement {
    const { place } = ctx.cart.get();
    const sel = h("select", { id: "place", required: true, onchange: (e: Event) => ctx.cart.setPlace((e.currentTarget as HTMLSelectElement).value) },
      h("option", { value: "", disabled: true, selected: !place }, "Ort wählen …"),
      ctx.menu.zones.map((z, i) => h("optgroup", { label: `Zone ${i + 1} · ab ${euro(z.minOrder)} · Lieferung ${euro(z.fee)}` },
        z.places.map((p) => h("option", { value: p, selected: p === place }, p)))));
    return h("div", { class: "field" }, h("label", { for: "place" }, "Wohin liefern wir?"), h("div", { class: "select" }, sel));
  }

  function cartView(): HTMLElement {
    const s = ctx.cart.get();
    const lines = s.lines;
    const head = h("header", { class: "dr-head" },
      h("h2", { id: "cart-title", tabindex: -1 }, "Warenkorb"),
      closeButton(dlg));

    if (!lines.length) {
      return h("div", { class: "dr" }, head,
        h("div", { class: "dr-body empty-cart" },
          svg(I.bag),
          h("p", { class: "big" }, "Noch nichts drin."),
          h("p", {}, "Such dir in der Speisekarte etwas Gutes aus – wir machen den Rest."),
          h("a", { class: "btn btn-primary", href: "#speisekarte", onclick: () => dlg.close() }, "Zur Speisekarte")));
    }

    const list = h("ul", { class: "lines" }, lines.map((l, i) => {
      const p = priceLine(ctx.menu, l);
      return h("li", { class: "line" },
        h("div", { class: "line-main" },
          h("b", {}, p.title),
          p.details.length ? h("small", {}, p.details.join(", ")) : null,
          l.note ? h("small", { class: "line-note" }, `„${l.note}“`) : null),
        h("div", { class: "line-side" },
          h("span", { class: "line-price" }, euro(p.unit * l.qty)),
          h("div", { class: "qty sm", role: "group", "aria-label": `Menge ${p.title}` },
            h("button", { type: "button", "aria-label": l.qty === 1 ? `${p.title} entfernen` : "weniger", onclick: () => ctx.cart.setQty(i, l.qty - 1) },
              l.qty === 1 ? svg(I.trash) : "−"),
            h("output", {}, String(l.qty)),
            h("button", { type: "button", "aria-label": "mehr", onclick: () => ctx.cart.setQty(i, l.qty + 1) }, "+"))));
    }));

    let summary: HTMLElement;
    let canGo = true;
    const needPlace = s.mode === "delivery" && !s.zoneId;
    if (needPlace) {
      canGo = false;
      const sub = totals(ctx.menu, lines, "pickup");
      summary = h("dl", { class: "sum" },
        h("div", {}, h("dt", {}, "Zwischensumme"), h("dd", {}, euro(sub.subtotal))),
        sub.deposit ? h("div", {}, h("dt", {}, "Pfand"), h("dd", {}, euro(sub.deposit))) : null,
        h("p", { class: "hint" }, "Bitte oben deinen Ort wählen – dann siehst du Liefergebühr und Mindestbestellwert."));
    } else {
      const t = totals(ctx.menu, lines, s.mode, s.zoneId);
      const pct = t.minOrder ? Math.min(100, Math.round((t.subtotal / t.minOrder) * 100)) : 100;
      if (t.missing > 0) canGo = false;
      summary = h("dl", { class: "sum" },
        h("div", {}, h("dt", {}, "Zwischensumme"), h("dd", {}, euro(t.subtotal))),
        t.deposit ? h("div", {}, h("dt", {}, "Pfand"), h("dd", {}, euro(t.deposit))) : null,
        s.mode === "delivery" ? h("div", {}, h("dt", {}, `Liefergebühr ${s.place}`), h("dd", {}, euro(t.fee))) : null,
        h("div", { class: "total" }, h("dt", {}, "Gesamt"), h("dd", {}, euro(t.total))),
        s.mode === "delivery" && t.missing > 0
          ? h("div", { class: "minbar" },
            h("p", {}, `Noch ${euro(t.missing)} bis zum Mindestbestellwert von ${euro(t.minOrder)}.`),
            h("div", { class: "bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct, "aria-label": "Mindestbestellwert" },
              h("i", { style: `width:${pct}%` })))
          : null);
    }

    return h("div", { class: "dr" }, head,
      h("div", { class: "dr-body" },
        modeSwitch(),
        s.mode === "delivery" ? placeSelect() : h("p", { class: "pickup-note" }, "Abholung in der Langgasse 31, 8490 Bad Radkersburg"),
        list,
        h("button", { type: "button", class: "link-btn", onclick: () => { if (confirmClear()) ctx.cart.clear(); } }, "Warenkorb leeren")),
      h("footer", { class: "dr-foot" },
        summary,
        h("button", { type: "button", class: "btn btn-primary block", disabled: !canGo, onclick: () => go("checkout") },
          "Weiter zur Bestellung", svg(`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`))));
  }

  // Eigener kleiner Bestätigungsschritt statt window.confirm (blockiert nichts)
  let clearArmed = 0;
  function confirmClear(): boolean {
    const now = Date.now();
    if (now - clearArmed < 4000) { clearArmed = 0; return true; }
    clearArmed = now;
    toast("Nochmal tippen, um den Warenkorb wirklich zu leeren.");
    return false;
  }

  // ───────────────────────── Bestelldaten
  function checkoutView(): HTMLElement {
    const s = ctx.cart.get();
    const mode = s.mode;
    const u = ctx.user;
    const local = loadProfile();
    const pre: Profile = {
      name: u?.name || local?.name || "",
      phone: u?.phone || local?.phone || "",
      street: (u?.place === s.place ? u?.street : "") || (local?.place === s.place ? local?.street : "") || u?.street || local?.street || "",
      zoneId: s.zoneId, place: s.place,
      payment: local?.payment ?? "bar",
    };

    const now = viennaNow();
    const st = status(ctx.menu.hours, now);
    const times = slots(ctx.menu.hours, now, mode);
    const timeOptions: HTMLOptionElement[] = [];
    if (st.open) timeOptions.push(h("option", { value: "asap" }, `So schnell wie möglich (ca. ${mode === "delivery" ? "45–60" : "20–30"} Min.)`));
    for (const t of times) timeOptions.push(h("option", { value: String(t) }, `heute ${hhmm(t)} Uhr`));
    let closedMsg = "";
    if (!timeOptions.length) {
      const nx = st.next;
      const when = nx ? `${nx.inDays === 1 ? "morgen" : DAY_NAMES[nx.weekday]} ab ${hhmm(nx.minutes)} Uhr` : "bald";
      closedMsg = `Heute ist keine Bestellung mehr möglich – wir sind wieder ${when} für dich da.`;
      if (DEMO) timeOptions.push(h("option", { value: "asap" }, "Sofort (Demo – außerhalb der Öffnungszeiten)"));
    }
    const blocked = !timeOptions.length;

    const err = h("p", { class: "form-err", role: "alert" });
    const t = totals(ctx.menu, s.lines, mode, mode === "delivery" ? s.zoneId : undefined);

    const field = (id: string, label: string, input: HTMLElement, hint?: string): HTMLElement =>
      h("div", { class: "field" }, h("label", { for: id }, label), input, hint ? h("small", {}, hint) : null);

    const remember = u
      ? h("label", { class: "check" }, h("input", { type: "checkbox", name: "remember", checked: true }), h("span", {}, "Adresse in meinem Konto speichern"))
      : h("label", { class: "check" }, h("input", { type: "checkbox", name: "remember", checked: Boolean(local) }),
        h("span", {}, "Daten auf diesem Gerät merken", h("small", {}, "Name, Telefon und Adresse werden nur in deinem Browser gespeichert.")));

    const submit = h("button", { type: "submit", class: "btn btn-wa block", disabled: blocked }, svg(I.wa), "Bestellung per WhatsApp senden");

    const form = h("form", { class: "dr", novalidate: true,
      onsubmit: (e: Event) => { e.preventDefault(); void send(form, err, submit); },
      oninput: (e: Event) => { (e.target as HTMLElement).removeAttribute("aria-invalid"); err.textContent = ""; } },
      h("header", { class: "dr-head" },
        h("button", { type: "button", class: "x back", "aria-label": "Zurück zum Warenkorb", onclick: () => go("cart") }, svg(I.back)),
        h("h2", { id: "cart-title", tabindex: -1 }, mode === "delivery" ? "Lieferung" : "Abholung"),
        closeButton(dlg)),
      h("div", { class: "dr-body" },
        ctx.apiOn && !u ? h("div", { class: "login-hint" },
          h("span", {}, "Schon Stammgast? Melde dich an, dann sind deine Daten automatisch ausgefüllt."),
          h("button", { type: "button", class: "link-btn", onclick: () => ctx.openAccount() }, "Anmelden")) : null,
        u ? h("p", { class: "login-hint ok" }, `Angemeldet als ${u.name || u.email}`) : null,
        field("c-name", "Name", h("input", { id: "c-name", name: "name", required: true, autocomplete: "name", value: pre.name, maxlength: 60 })),
        field("c-phone", "Telefon", h("input", { id: "c-phone", name: "phone", type: "tel", required: true, autocomplete: "tel", inputmode: "tel", value: pre.phone, maxlength: 25, placeholder: "0664 …" }), "Für Rückfragen zur Bestellung."),
        mode === "delivery" ? h("div", { class: "row2" },
          field("c-street", "Straße und Hausnummer", h("input", { id: "c-street", name: "street", required: true, autocomplete: "street-address", value: pre.street, maxlength: 80 })),
          h("div", { class: "field" }, h("span", { class: "label" }, "Ort"),
            h("p", { class: "place-pill" }, s.place, h("button", { type: "button", class: "link-btn", onclick: () => go("cart") }, "ändern")))) : null,
        field("c-time", mode === "delivery" ? "Lieferzeit" : "Abholzeit", h("div", { class: "select" }, h("select", { id: "c-time", name: "time", disabled: blocked }, timeOptions))),
        closedMsg ? h("p", { class: `hint ${DEMO ? "" : "warn"}` }, closedMsg) : null,
        h("fieldset", { class: "seg pay" },
          h("legend", {}, "Zahlung bei " + (mode === "delivery" ? "Lieferung" : "Abholung")),
          h("label", { class: "seg-opt" }, h("input", { type: "radio", name: "payment", value: "bar", checked: pre.payment === "bar" }), h("span", {}, "Bar")),
          h("label", { class: "seg-opt" }, h("input", { type: "radio", name: "payment", value: "karte", checked: pre.payment === "karte" }), h("span", {}, "Karte"))),
        field("c-note", "Anmerkung zur Bestellung", h("textarea", { id: "c-note", name: "note", rows: 2, maxlength: 200, placeholder: mode === "delivery" ? "z. B. 2. Stock, bei „Huber“ läuten" : "optional" })),
        remember),
      h("footer", { class: "dr-foot" },
        h("dl", { class: "sum compact" },
          h("div", { class: "total" }, h("dt", {}, `${ctx.cart.count()} Artikel · Gesamt`), h("dd", {}, euro(t.total)))),
        err,
        submit,
        h("p", { class: "fine" }, DEMO
          ? "Demo: WhatsApp öffnet sich mit der fertigen Bestellung an die Testnummer – nicht an die Pizzeria."
          : "WhatsApp öffnet sich mit deiner fertigen Bestellung – du musst nur noch auf Senden tippen.")));
    return form;
  }

  async function send(form: HTMLFormElement, err: HTMLElement, submit: HTMLButtonElement): Promise<void> {
    const s = ctx.cart.get();
    const fd = new FormData(form);
    const str = (k: string): string => String(fd.get(k) ?? "").trim();
    const timeRaw = str("time") || "asap";
    const c: Customer = {
      name: str("name"),
      phone: str("phone"),
      street: s.mode === "delivery" ? str("street") : undefined,
      zoneId: s.mode === "delivery" ? s.zoneId : undefined,
      place: s.mode === "delivery" ? s.place : undefined,
      time: timeRaw === "asap" ? "asap" : Number(timeRaw),
      payment: str("payment") === "karte" ? "karte" : "bar",
      note: str("note") || undefined,
    };
    err.textContent = "";
    form.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));

    // 1) im Browser prüfen und Nachricht bauen
    let text: string;
    let ref = orderRef();
    try {
      text = formatOrder(ctx.menu, s.lines, s.mode, c, ref);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bitte Eingaben prüfen.";
      err.textContent = msg;
      const bad = /Namen/.test(msg) ? "c-name" : /Telefon/.test(msg) ? "c-phone" : /Straße/.test(msg) ? "c-street" : "";
      if (bad) { const el = document.getElementById(bad); el?.setAttribute("aria-invalid", "true"); el?.focus(); }
      return;
    }
    let url = whatsappUrl(WHATSAPP_TARGET, text);
    let total = totals(ctx.menu, s.lines, s.mode, c.zoneId).total;
    let notified = false;
    const remember = (form.elements.namedItem("remember") as HTMLInputElement | null)?.checked ?? false;

    // 2) mit Server: dort speichern, Preis neu berechnen lassen, ggf. Push an die Pizzeria
    if (ctx.apiOn) {
      submit.disabled = true;
      submit.classList.add("busy");
      try {
        const r = await api.placeOrder({ lines: s.lines, mode: s.mode, zoneId: c.zoneId, customer: { ...c, phone: normalizePhone(c.phone) } });
        ref = r.ref; text = r.text; url = r.whatsappUrl; total = r.total; notified = r.notified;
        if (ctx.user && remember) {
          ctx.setUser((await api.saveProfile({ name: c.name, phone: normalizePhone(c.phone), ...(c.street ? { street: c.street, zoneId: c.zoneId, place: c.place } : {}) })).user);
        }
      } catch (e) {
        submit.disabled = false;
        submit.classList.remove("busy");
        if (e instanceof ApiError && e.status < 500) { err.textContent = e.message; return; }
        // Server nicht erreichbar → trotzdem per WhatsApp bestellen können
        toast("Server nicht erreichbar – Bestellung wird direkt per WhatsApp gesendet.");
      }
    } else {
      // Ohne Server sofort öffnen (direkt im Klick, sonst blockt der Browser das Fenster)
      window.open(url, "_blank", "noopener");
    }

    if (!ctx.user) {
      if (remember) saveProfile({ name: c.name, phone: c.phone, street: c.street ?? loadProfile()?.street ?? "", zoneId: c.zoneId ?? "", place: c.place ?? "", payment: c.payment });
      else forgetProfile();
    }
    pushHistory({ ref, at: new Date().toISOString(), total, mode: s.mode, items: ctx.cart.count() });
    ctx.cart.clear();
    done = { ref, url, text, total, notified };
    go("done");
    announce(`Bestellung ${ref} vorbereitet.`);
  }

  // ───────────────────────── Bestätigung
  function doneView(): HTMLElement {
    const d = done!;
    const copy = h("button", { type: "button", class: "link-btn", onclick: async () => {
      try { await navigator.clipboard.writeText(d.text); toast("Bestellung kopiert."); } catch { toast("Kopieren nicht möglich."); }
    } }, "Bestelltext kopieren");
    return h("div", { class: "dr" },
      h("header", { class: "dr-head" }, h("h2", { id: "cart-title", tabindex: -1 }, "Fast geschafft!"), closeButton(dlg)),
      h("div", { class: "dr-body done" },
        h("div", { class: "done-check" }, svg(I.check)),
        h("p", { class: "ref" }, h("small", {}, "Deine Bestellnummer"), h("b", {}, d.ref)),
        h("ol", { class: "steps" },
          h("li", {}, "WhatsApp öffnet sich mit deiner fertigen Bestellung."),
          h("li", {}, h("b", {}, "Auf „Senden“ tippen"), " – erst dann ist sie bei uns."),
          h("li", {}, "Wir legen los – bei Fragen rufen wir dich kurz an.")),
        d.notified ? h("p", { class: "hint" }, "Die Pizzeria wurde zusätzlich automatisch benachrichtigt.") : null,
        h("a", { class: "btn btn-wa block", href: d.url, target: "_blank", rel: "noopener" }, svg(I.wa), "WhatsApp öffnen"),
        h("p", { class: "fine" }, "Kein WhatsApp? Ruf uns an unter ", h("a", { href: "tel:+43347640786" }, "03476 40786"), ` und nenne die Nummer ${d.ref}. `, copy),
        h("p", { class: "fine" }, `Gesamt: ${euro(d.total)}`)));
  }

  return {
    open(v: View = "cart") {
      if (view !== "done" || v !== "cart") view = v;
      if (view === "checkout" && !ctx.cart.get().lines.length) view = "cart";
      render();
      openDialog(dlg);
      (dlg.querySelector("h2") as HTMLElement | null)?.focus();
    },
  };
}
