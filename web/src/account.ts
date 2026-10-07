/**
 * Konto: Anmelden / Registrieren gegen den Rust-Server (Login wird per
 * HttpOnly-Cookie gemerkt). Ohne Server: Verwaltung der lokal gemerkten Daten.
 */

import type { Ctx } from "./ctx.js";
import { api, ApiError } from "./api.js";
import { euro } from "./pricing.js";
import { h, toast } from "./dom.js";
import { closeButton, openDialog } from "./customizer.js";
import { forgetHistory, forgetProfile, loadHistory, loadProfile } from "./profile.js";

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function accountDialog(ctx: Ctx, dlg: HTMLDialogElement): { open: () => void } {
  let tab: "login" | "register" = "login";

  const head = (title: string): HTMLElement =>
    h("header", { class: "cz-head" }, h("div", {}, h("h2", { id: "acc-title", tabindex: -1 }, title)), closeButton(dlg));

  function history(list: { ref: string; at: string; total: number; mode: string }[]): HTMLElement {
    if (!list.length) return h("p", { class: "hint" }, "Noch keine Bestellungen.");
    return h("ul", { class: "history" }, list.map((o) =>
      h("li", {}, h("b", {}, o.ref), h("span", {}, fmtDate(o.at)), h("span", {}, o.mode === "delivery" ? "Lieferung" : "Abholung"), h("span", { class: "r" }, euro(o.total)))));
  }

  // ── ohne Server
  function localView(): HTMLElement {
    const p = loadProfile();
    const hist = loadHistory();
    return h("div", { class: "cz-form" },
      head("Deine Daten"),
      h("div", { class: "cz-body" },
        h("div", { class: "info-box" },
          h("b", {}, "Demo ohne Server"),
          h("p", {}, "Konten mit Login, Bestellverlauf und gespeicherten Adressen laufen über den Peperoni-Server (Rust + SQLite in Docker). Diese Vorschau läuft ohne Server – deshalb werden deine Daten nur in diesem Browser gespeichert, wenn du beim Bestellen „Daten merken“ anhakst.")),
        h("h3", { class: "mini" }, "Gemerkte Daten"),
        p ? h("dl", { class: "kv" },
          h("div", {}, h("dt", {}, "Name"), h("dd", {}, p.name || "–")),
          h("div", {}, h("dt", {}, "Telefon"), h("dd", {}, p.phone || "–")),
          h("div", {}, h("dt", {}, "Adresse"), h("dd", {}, [p.street, p.place].filter(Boolean).join(", ") || "–")))
          : h("p", { class: "hint" }, "Nichts gespeichert."),
        h("h3", { class: "mini" }, "Letzte Bestellungen auf diesem Gerät"),
        history(hist.map((o) => ({ ...o, at: o.at }))),
        p || hist.length ? h("button", { type: "button", class: "btn btn-ghost", onclick: () => { forgetProfile(); forgetHistory(); toast("Alles gelöscht."); render(); } }, "Alles vergessen") : null));
  }

  // ── Server: anmelden / registrieren
  function authView(): HTMLElement {
    const err = h("p", { class: "form-err", role: "alert" });
    const reg = tab === "register";
    const btn = h("button", { type: "submit", class: "btn btn-primary block" }, reg ? "Konto erstellen" : "Anmelden");
    const form = h("form", { class: "cz-form", novalidate: true, onsubmit: async (e: Event) => {
      e.preventDefault();
      const fd = new FormData(form);
      const v = (k: string): string => String(fd.get(k) ?? "").trim();
      err.textContent = "";
      if (!/^\S+@\S+\.\S+$/.test(v("email"))) { err.textContent = "Bitte eine gültige E-Mail-Adresse angeben."; return; }
      if (String(fd.get("password") ?? "").length < (reg ? 8 : 1)) { err.textContent = reg ? "Das Passwort braucht mindestens 8 Zeichen." : "Bitte Passwort eingeben."; return; }
      btn.disabled = true;
      btn.classList.add("busy");
      try {
        const remember = fd.get("remember") === "on";
        const r = reg
          ? await api.register({ email: v("email"), password: String(fd.get("password")), name: v("name"), phone: v("phone"), remember })
          : await api.login({ email: v("email"), password: String(fd.get("password")), remember });
        ctx.setUser(r.user);
        toast(reg ? "Willkommen bei Peperoni!" : `Hallo ${r.user.name || ""}!`.replace(" !", "!"));
        render();
      } catch (ex) {
        err.textContent = ex instanceof ApiError ? ex.message : "Server nicht erreichbar.";
      } finally {
        btn.disabled = false;
        btn.classList.remove("busy");
      }
    } },
      head(reg ? "Konto erstellen" : "Anmelden"),
      h("div", { class: "cz-body" },
        h("div", { class: "seg tabs", role: "tablist" },
          h("button", { type: "button", role: "tab", "aria-selected": String(!reg), class: "seg-btn", onclick: () => { tab = "login"; render(); } }, "Anmelden"),
          h("button", { type: "button", role: "tab", "aria-selected": String(reg), class: "seg-btn", onclick: () => { tab = "register"; render(); } }, "Neu hier")),
        reg ? h("div", { class: "field" }, h("label", { for: "a-name" }, "Name"), h("input", { id: "a-name", name: "name", autocomplete: "name", maxlength: 60 })) : null,
        h("div", { class: "field" }, h("label", { for: "a-email" }, "E-Mail"), h("input", { id: "a-email", name: "email", type: "email", autocomplete: "email", required: true, maxlength: 120 })),
        h("div", { class: "field" }, h("label", { for: "a-pw" }, "Passwort"), h("input", { id: "a-pw", name: "password", type: "password", autocomplete: reg ? "new-password" : "current-password", required: true, minlength: reg ? 8 : 1, maxlength: 200 }),
          reg ? h("small", {}, "Mindestens 8 Zeichen.") : null),
        reg ? h("div", { class: "field" }, h("label", { for: "a-phone" }, "Telefon (optional)"), h("input", { id: "a-phone", name: "phone", type: "tel", autocomplete: "tel", maxlength: 25 })) : null,
        h("label", { class: "check" }, h("input", { type: "checkbox", name: "remember", checked: true }),
          h("span", {}, "Angemeldet bleiben", h("small", {}, "30 Tage auf diesem Gerät – über ein sicheres Cookie, kein Passwort im Browser."))),
        err),
      h("footer", { class: "cz-foot" }, btn));
    return form;
  }

  // ── angemeldet
  function userView(): HTMLElement {
    const u = ctx.user!;
    const hist = h("div", {}, h("p", { class: "hint" }, "Bestellungen werden geladen …"));
    api.orders().then((r) => hist.replaceChildren(history(r.orders.map((o) => ({ ref: o.ref, at: o.createdAt, total: o.total, mode: o.mode })))))
      .catch(() => hist.replaceChildren(h("p", { class: "hint" }, "Konnte Bestellungen nicht laden.")));
    const err = h("p", { class: "form-err", role: "alert" });
    const form = h("form", { class: "cz-form", onsubmit: async (e: Event) => {
      e.preventDefault();
      const fd = new FormData(form);
      const v = (k: string): string => String(fd.get(k) ?? "").trim();
      const place = v("place");
      const zone = ctx.menu.zones.find((z) => z.places.includes(place));
      try {
        ctx.setUser((await api.saveProfile({ name: v("name"), phone: v("phone"), street: v("street"), place, zoneId: zone?.id ?? "" })).user);
        toast("Gespeichert.");
      } catch (ex) { err.textContent = ex instanceof Error ? ex.message : "Fehler"; }
    } },
      head(`Hallo ${u.name || "!"}`.trim()),
      h("div", { class: "cz-body" },
        h("p", { class: "hint" }, `Angemeldet als ${u.email}`),
        h("h3", { class: "mini" }, "Meine Daten"),
        h("div", { class: "field" }, h("label", { for: "u-name" }, "Name"), h("input", { id: "u-name", name: "name", value: u.name, autocomplete: "name", maxlength: 60 })),
        h("div", { class: "field" }, h("label", { for: "u-phone" }, "Telefon"), h("input", { id: "u-phone", name: "phone", type: "tel", value: u.phone, autocomplete: "tel", maxlength: 25 })),
        h("div", { class: "field" }, h("label", { for: "u-street" }, "Straße und Hausnummer"), h("input", { id: "u-street", name: "street", value: u.street, autocomplete: "street-address", maxlength: 80 })),
        h("div", { class: "field" }, h("label", { for: "u-place" }, "Ort"),
          h("div", { class: "select" }, h("select", { id: "u-place", name: "place" },
            h("option", { value: "" }, "–"),
            ctx.menu.zones.flatMap((z) => z.places).map((p) => h("option", { value: p, selected: p === u.place }, p))))),
        err,
        h("button", { type: "submit", class: "btn btn-ghost" }, "Speichern"),
        h("h3", { class: "mini" }, "Meine Bestellungen"),
        hist),
      h("footer", { class: "cz-foot" },
        h("button", { type: "button", class: "btn btn-ghost block", onclick: async () => {
          try { await api.logout(); } catch { /* egal */ }
          ctx.setUser(null);
          toast("Abgemeldet.");
          render();
        } }, "Abmelden")));
    return form;
  }

  function render(): void {
    dlg.replaceChildren(!ctx.apiOn ? localView() : ctx.user ? userView() : authView());
    (dlg.querySelector("h2") as HTMLElement | null)?.focus();
  }

  return { open() { render(); openDialog(dlg); (dlg.querySelector("h2") as HTMLElement | null)?.focus(); } };
}
