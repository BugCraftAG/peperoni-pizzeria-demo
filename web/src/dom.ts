/** Kleiner, sicherer DOM-Baukasten: Text wird nie als HTML interpretiert. */

type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(typeof c === "object" ? c : String(c));
  }
}

/** SVG aus eigenem, statischem Markup (nie aus Nutzereingaben) */
export function svg(markup: string): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGSVGElement;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Element fehlt: ${sel}`);
  return el;
};

export function announce(msg: string): void {
  const live = document.getElementById("live");
  if (!live) return;
  live.textContent = "";
  window.setTimeout(() => (live.textContent = msg), 30);
}

export function toast(msg: string): void {
  const box = document.getElementById("toasts");
  if (!box) return;
  const t = h("div", { class: "toast", role: "status" }, msg);
  box.append(t);
  window.setTimeout(() => t.classList.add("out"), 2600);
  window.setTimeout(() => t.remove(), 3100);
}
