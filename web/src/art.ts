/**
 * Illustrationen, im Code gezeichnet – keine fremden Fotos, keine Lizenzfragen,
 * gestochen scharf auf jedem Bildschirm und nur ein paar Kilobyte groß.
 */

/** Deterministischer Zufall, damit die Pizza bei jedem Laden gleich aussieht */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number): string => n.toFixed(1);

/** Punkte gleichmäßig auf einer Scheibe verteilen (Sonnenblumen-Muster + Zittern) */
function scatter(n: number, radius: number, r: () => number, offset = 0): [number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const d = radius * Math.sqrt((i + 0.5) / n);
    const a = i * golden + offset;
    pts.push([d * Math.cos(a) + (r() - 0.5) * 10, d * Math.sin(a) + (r() - 0.5) * 10]);
  }
  return pts;
}

/** Unregelmäßiger Kreis – nichts in einer echten Küche ist perfekt rund */
function blob(cx: number, cy: number, radius: number, wobble: number, r: () => number, points = 10): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = radius * (1 + (r() - 0.5) * wobble);
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  let d = `M${f((pts[0]![0] + pts[1]![0]) / 2)},${f((pts[0]![1] + pts[1]![1]) / 2)}`;
  for (let i = 1; i <= points; i++) {
    const p = pts[i % points]!;
    const q = pts[(i + 1) % points]!;
    d += ` Q${f(p[0])},${f(p[1])} ${f((p[0] + q[0]) / 2)},${f((p[1] + q[1]) / 2)}`;
  }
  return d + "Z";
}

export function heroPizza(seed = 31): string {
  const r = rng(seed);
  const parts: string[] = [];

  // Käse-Flecken
  for (const [x, y] of scatter(26, 150, r)) parts.push(`<path d="${blob(x, y, 20 + r() * 16, 0.5, r, 8)}" fill="url(#cheese)" opacity="${f(0.75 + r() * 0.25)}"/>`);
  // angebräunte Stellen
  for (const [x, y] of scatter(18, 160, r, 1.2)) parts.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(4 + r() * 6)}" ry="${f(3 + r() * 4)}" fill="#c27b2c" opacity="${f(0.35 + r() * 0.3)}"/>`);
  // Salami / Peperoni-Scheiben
  for (const [x, y] of scatter(13, 128, r, 0.4)) {
    const rad = 21 + r() * 5;
    parts.push(`<g transform="translate(${f(x)} ${f(y)})"><circle r="${f(rad)}" fill="url(#salami)"/><circle r="${f(rad)}" fill="none" stroke="#7d1414" stroke-width="2.5" opacity=".6"/>${[0, 1, 2, 3].map(() => `<circle cx="${f((r() - 0.5) * rad)}" cy="${f((r() - 0.5) * rad)}" r="${f(1.6 + r() * 1.8)}" fill="#f2c6a6" opacity=".7"/>`).join("")}<ellipse cx="${f(-rad * 0.35)}" cy="${f(-rad * 0.4)}" rx="${f(rad * 0.35)}" ry="${f(rad * 0.18)}" fill="#fff" opacity=".18" transform="rotate(-30)"/></g>`);
  }
  // Oliven
  for (const [x, y] of scatter(9, 140, r, 2.1)) parts.push(`<g transform="translate(${f(x)} ${f(y)})"><circle r="8" fill="#1d1a17"/><circle r="3.4" fill="#4a2c1d"/><circle cx="-3" cy="-3" r="1.6" fill="#fff" opacity=".35"/></g>`);
  // Pfefferoni-Ringe
  for (const [x, y] of scatter(8, 145, r, 3.3)) parts.push(`<g transform="translate(${f(x)} ${f(y)}) rotate(${f(r() * 360)})"><ellipse rx="10" ry="8" fill="none" stroke="#7fb03a" stroke-width="4"/><circle cx="2" cy="1" r="1.4" fill="#f4e7b5"/></g>`);
  // Basilikum
  for (const [x, y] of scatter(6, 110, r, 0.9)) {
    const rot = r() * 360;
    parts.push(`<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})"><path d="M0,-17 C11,-10 11,9 0,17 C-11,9 -11,-10 0,-17Z" fill="url(#basil)"/><path d="M0,-15 L0,15" stroke="#2c5e1e" stroke-width="1.3"/></g>`);
  }
  // Oregano-Krümel
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 165;
    parts.push(`<rect x="${f(d * Math.cos(a))}" y="${f(d * Math.sin(a))}" width="2.2" height="1.4" fill="#3d5a22" transform="rotate(${f(r() * 180)} ${f(d * Math.cos(a))} ${f(d * Math.sin(a))})"/>`);
  }

  const crustSpots = Array.from({ length: 34 }, (_, i) => {
    const a = (i / 34) * Math.PI * 2 + r() * 0.1;
    const d = 196 + (r() - 0.5) * 10;
    return `<ellipse cx="${f(d * Math.cos(a))}" cy="${f(d * Math.sin(a))}" rx="${f(5 + r() * 7)}" ry="${f(2 + r() * 3)}" transform="rotate(${f((a * 180) / Math.PI + 90)} ${f(d * Math.cos(a))} ${f(d * Math.sin(a))})" fill="#7b3f12" opacity="${f(0.25 + r() * 0.35)}"/>`;
  }).join("");

  const cuts = [0, 45, 90, 135].map((a) => `<line x1="-214" y1="0" x2="214" y2="0" transform="rotate(${a})" stroke="#2a1a10" stroke-width="2.2" opacity=".28"/>`).join("");

  return `<svg viewBox="-240 -240 480 480" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration: Pizza mit Salami, Oliven, Pfefferoni und Basilikum">
  <defs>
    <radialGradient id="crust" r=".5"><stop offset=".82" stop-color="#e0a458"/><stop offset=".93" stop-color="#c47a32"/><stop offset="1" stop-color="#8e4a17"/></radialGradient>
    <radialGradient id="sauce" r=".5"><stop offset="0" stop-color="#d63a22"/><stop offset=".9" stop-color="#b52a18"/><stop offset="1" stop-color="#8f1d10"/></radialGradient>
    <radialGradient id="cheese" r=".6"><stop offset="0" stop-color="#fff3c4"/><stop offset=".7" stop-color="#f6d77c"/><stop offset="1" stop-color="#e9b84f"/></radialGradient>
    <radialGradient id="salami" r=".6" cx=".45" cy=".4"><stop offset="0" stop-color="#d23a2c"/><stop offset=".8" stop-color="#a5221b"/><stop offset="1" stop-color="#7a1512"/></radialGradient>
    <linearGradient id="basil" x1="0" x2="1"><stop offset="0" stop-color="#3f8a2a"/><stop offset="1" stop-color="#5fae3a"/></linearGradient>
    <radialGradient id="shadow" r=".5"><stop offset=".8" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <circle r="236" cy="10" fill="url(#shadow)"/>
  <path d="${blob(0, 0, 214, 0.035, r, 24)}" fill="url(#crust)"/>
  ${crustSpots}
  <path d="${blob(0, 0, 182, 0.05, r, 22)}" fill="url(#sauce)"/>
  ${parts.join("")}
  ${cuts}
</svg>`;
}

/** Kleine Kategorie-Symbole, einheitlicher Strich, currentColor */
const ICON: Record<string, string> = {
  pizza: `<path d="M12 3c-3.7 0-7 1.3-9 3.2L12 21l9-14.8C19 4.3 15.7 3 12 3Z"/><path d="M4.8 8.9C6.8 7.7 9.3 7 12 7s5.2.7 7.2 1.9"/><circle cx="10" cy="11" r="1.3"/><circle cx="14" cy="14" r="1.1"/><circle cx="13.5" cy="10" r=".9"/>`,
  stangerl: `<path d="M4 17c3-1 4-9 8-10s5 2 8 1"/><path d="M4 13c3-1 4-9 8-10"/><path d="M4 21c3-1 4-9 8-10s5 2 8 1"/>`,
  kebap: `<path d="M12 2v20"/><path d="M8 5h8l-1 3H9Z"/><path d="M7.5 8h9l-1 4h-7Z"/><path d="M8 12h8l-1 4H9Z"/><path d="M9.5 16h5l-.5 2.5h-4Z"/>`,
  burger: `<path d="M4 10a8 6 0 0 1 16 0Z"/><path d="M3 13h18"/><path d="M4 16h16"/><path d="M5 16v1.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V16"/><path d="M9 7h.01M12 6h.01M15 7h.01"/>`,
  nudeln: `<path d="M3 11h18a9 7 0 0 1-18 0Z"/><path d="M7 11c0-3 1-6 2-8"/><path d="M11 11c0-3 1-6 3-8"/><path d="M15 11c0-2 1-4 3-6"/>`,
  salat: `<path d="M3 11h18a9 7 0 0 1-18 0Z"/><path d="M7 11c-1-3 1-5 3-5 0 2 0 3-1 5"/><path d="M12 11c0-3 2-6 5-6 0 3-2 5-4 6"/><circle cx="10" cy="9" r="1"/>`,
  beilagen: `<path d="M6 10h12l-1.5 11h-9Z"/><path d="M8 10 7 3"/><path d="M11 10V2"/><path d="M14 10l1-7"/><path d="M16.5 10l2-5"/>`,
  getraenke: `<path d="M7 3h10l-1.5 18h-7Z"/><path d="M7.4 8h9.2"/><path d="M14 3l3-2"/>`,
};

export function icon(name: string, cls = "ico"): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] ?? ICON.pizza}</svg>`;
}

/** Schematische Karte der Liefergebiete: Ringe um Bad Radkersburg */
export function zoneMap(zones: { name: string; places: string[] }[]): string {
  const rings = zones.map((_, i) => 46 + i * 46).reverse();
  const shades = ["#2b1f1a", "#3a2620", "#4f2b22", "#7a2a22"];
  const labels: string[] = [];
  // Winkel pro Zone so gewählt, dass sich nichts überlappt
  const angles = [[0], [-120, -60, 60, 120], [-170, -10, 10, 170], [-60, 120]];
  zones.forEach((z, i) => {
    if (i === 0) return;
    const mid = 46 + i * 46 - 23;
    z.places.forEach((p, j) => {
      const deg = angles[i]?.[j] ?? (j * 360) / z.places.length;
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * mid;
      const y = Math.sin(a) * mid;
      const left = Math.cos(a) < 0;
      labels.push(`<circle cx="${f(x)}" cy="${f(y)}" r="2.6" fill="#f5ecd9"/><text x="${f(x + (left ? -6 : 6))}" y="${f(y + 3.5)}" text-anchor="${left ? "end" : "start"}">${p}</text>`);
    });
  });
  return `<svg viewBox="-200 -200 400 400" role="img" aria-label="Schematische Darstellung der vier Liefergebiete rund um Bad Radkersburg">
  ${rings.map((rr, k) => `<circle r="${rr}" fill="${shades[k] ?? "#2b1f1a"}" stroke="#f5ecd9" stroke-opacity=".14" stroke-dasharray="3 5"/>`).join("")}
  <g font-family="DM Sans, sans-serif" font-size="10.5" fill="#f5ecd9" fill-opacity=".85">${labels.join("")}</g>
  <circle r="7" fill="#e63323"/><circle r="15" fill="none" stroke="#e63323" stroke-opacity=".5"><animate attributeName="r" values="8;22;8" dur="2.6s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values=".6;0;.6" dur="2.6s" repeatCount="indefinite"/></circle>
  <text y="28" text-anchor="middle" font-family="Anton, sans-serif" font-size="15" letter-spacing="1" fill="#f5ecd9">BAD RADKERSBURG</text>
  ${zones.map((_, i) => `<text x="0" y="${-(46 + i * 46) + 13}" text-anchor="middle" font-family="DM Sans, sans-serif" font-weight="700" font-size="9" fill="#f2b234" letter-spacing="1.5">ZONE ${i + 1}</text>`).join("")}
</svg>`;
}

export const LOGO = `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#e63323"/><path d="M14 13c2-3 5-4 8-3" stroke="#3f8a2a" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M13.5 15.5c-3 5-1 13 6 15.5 4 1.4 8.5 0 10-2.5-4.5.2-8-2.5-9.5-7-1-3-1.8-5.5-6.5-6Z" fill="#f5ecd9"/></svg>`;
