// Baut den fertigen, statischen Ordner public/ (für Netlify oder jeden Webspace).
import { cpSync, mkdirSync, rmSync, copyFileSync } from "node:fs";

const out = "public";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/dist`, { recursive: true });
for (const f of ["index.html", "robots.txt", "_headers", "_redirects", "api-offline.json"]) copyFileSync(f, `${out}/${f}`);
for (const d of ["css", "fonts", "images", "data"]) cpSync(d, `${out}/${d}`, { recursive: true });
cpSync("dist/src", `${out}/dist/src`, { recursive: true, filter: (p) => !p.endsWith(".map") });
console.log("public/ ist fertig.");
