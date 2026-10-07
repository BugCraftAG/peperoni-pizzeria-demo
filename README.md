# Peperoni – Pizzeria · Kebap · Burger (Website-Entwurf)

> **Entwurf / Pitch-Demo** von [David Tomoiaga](https://david-tomoiaga.netlify.app) für die Pizzeria Peperoni,
> Langgasse 31, 8490 Bad Radkersburg. **Keine offizielle Seite.** Bestellungen gehen an eine Testnummer.

Online-Speisekarte mit Warenkorb und Bestellung per WhatsApp – plus ein Rust-Server mit SQLite-Datenbank,
der Konten („angemeldet bleiben“), Adressen und den Bestellverlauf speichert. Alles läuft in einem Docker-Container.

**Live-Vorschau (ohne Server):** https://peperoni-demo.netlify.app

---

## Was die Seite kann

| | |
|---|---|
| **Speisekarte** | 62 Gerichte in 8 Kategorien, Suche (findet auch „doner“ → „Döner“), Filter vegetarisch / scharf / Hausspezialität, Allergene A–R |
| **Zusammenstellen** | Pizza mit Extra-Zutaten (je € 2,00), Wunschpizza (5 Zutaten inklusive), Burger 100 g / 180 g mit Extras, Nudelsorte + Sauce, Lasagne überbacken, Anmerkungen |
| **Warenkorb** | Lieferung oder Abholung, 4 Liefergebiete mit Mindestbestellwert und Liefergebühr, Pfand, Fortschrittsbalken bis zum Mindestbestellwert |
| **Bestellung** | Wunschzeit im 15-Minuten-Raster (nur innerhalb der Öffnungszeiten, Vorlauf 20/45 Min.), Bar/Karte, fertig formatierte WhatsApp-Nachricht |
| **Live-Status** | „Offen bis 21:00“ / „Zu · wieder morgen ab 11:00“ – immer in Wiener Zeit, egal wo das Gerät steht |
| **Daten merken** | ohne Server: Name/Telefon/Adresse nur im Browser · mit Server: echtes Konto, Login bleibt 30 Tage |

## Aufbau

```
shared/
  menu.json            ← EINZIGE Quelle für Gerichte, Preise, Zonen, Öffnungszeiten
  price-vectors.json   ← Testfälle, die Website UND Server bestehen müssen
web/                   ← Frontend: HTML, CSS, TypeScript (keine Frameworks)
  src/pricing.ts       ← Preisregeln
  src/order.ts         ← WhatsApp-Text, Telefonnummern
  src/hours.ts         ← Öffnungszeiten, Zeitfenster
  src/*.ts             ← Speisekarte, Dialoge, Warenkorb, Konto
  tests/               ← node:test
server/                ← Backend: Rust (Axum + SQLx + SQLite)
  migrations/          ← SQL-Schema
  src/pricing.rs       ← dieselben Preisregeln wie pricing.ts
  src/auth.rs          ← Argon2id-Passwörter, Sitzungen
  src/routes.rs        ← /api/…
  tests/api.rs         ← Ende-zu-Ende-Tests
Dockerfile, docker-compose.yml
```

**Warum Preise doppelt?** Die Website rechnet sofort (kein Warten), der Server rechnet beim Bestellen
noch einmal selbst und ignoriert jeden Preis aus dem Browser. Damit beide garantiert gleich rechnen,
laufen sie gegen dieselben Testfälle in `shared/price-vectors.json`. Alle Beträge sind ganze Cent.

## Starten

### Nur die Website (ohne Server)

```bash
cd web
npm install
npm run build      # TypeScript → dist/, kopiert menu.json
npm start          # http://localhost:8080
```

Die Seite merkt, dass kein Server läuft, und arbeitet im lokalen Modus.

### Komplett mit Server, Datenbank und Login (Docker)

```bash
cp .env.example .env      # optional anpassen
docker compose up -d --build
# → http://localhost:8080
```

Die Datenbank liegt im Volume `peperoni-data` und überlebt Neustarts und Updates.
Der Container läuft ohne Root-Rechte, mit schreibgeschütztem Dateisystem und eingebautem Healthcheck.

### Server ohne Docker

```bash
cd server
cargo run          # liefert ../web aus, Datenbank: peperoni.db
```

## API

| Methode | Pfad | |
|---|---|---|
| GET | `/api/health` | Status |
| POST | `/api/register` | `{email, password, name?, phone?, remember}` → setzt HttpOnly-Cookie |
| POST | `/api/login` | `{email, password, remember}` – `remember: true` = 30 Tage angemeldet |
| POST | `/api/logout` | Sitzung löschen |
| GET / PUT | `/api/me` | eigenes Profil und Lieferadresse |
| POST | `/api/orders` | Bestellung: Server prüft und berechnet alles neu, speichert, liefert WhatsApp-Link |
| GET | `/api/orders` | eigener Bestellverlauf |
| GET | `/api/admin/orders` | alle Bestellungen für die Pizzeria (`Authorization: Bearer $ADMIN_TOKEN`) |

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | |
|---|---|---|
| `WHATSAPP_TARGET` | `+436645112794` | Empfänger der Bestellungen |
| `PEPERONI_DEMO` | `true` | `true` = Bestellen auch außerhalb der Öffnungszeiten |
| `COOKIE_SECURE` | `false` | hinter HTTPS auf `true` |
| `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY` | – | jede Bestellung zusätzlich automatisch per WhatsApp an die Pizzeria ([CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/), kostenlos) |
| `ADMIN_TOKEN` | – | aktiviert `/api/admin/orders` (mind. 16 Zeichen) |
| `DATABASE_URL` | `sqlite:///data/peperoni.db` | |

## Tests

```bash
cd web && npm test          # 30 Tests: Preise, Öffnungszeiten, WhatsApp-Text
cd server && cargo test     # 13 Tests: Preise, Bestellungen, Login, Sitzungen, Rate-Limit
```

## Sicherheit & Datenschutz

- Passwörter mit **Argon2id**; im Cookie steht ein Zufallstoken, in der Datenbank nur dessen SHA-256
- Cookie: `HttpOnly`, `SameSite=Lax`, optional `Secure`; API akzeptiert nur JSON (kein CSRF über fremde Formulare)
- Login-Versuche begrenzt, gleiche Antwortzeit für existierende und nicht existierende Konten
- Content-Security-Policy ohne Inline-Skripte, keine externen Skripte, Schriften lokal (DSGVO), kein Tracking
- `noindex` + `robots.txt`, solange es ein Entwurf ist

## Vor dem Livegang

1. **Zustimmung des Inhabers** einholen – Name, Speisekarte und Preise gehören der Pizzeria.
2. In `web/src/config.ts` → `DEMO = false` und `WHATSAPP_TARGET` auf die Handynummer der Pizzeria (bzw. im Docker-Setup `WHATSAPP_TARGET`).
3. Hinweisbalken in `index.html` entfernen, `noindex` und `robots.txt` entfernen.
4. Impressum und Datenschutzerklärung der Pizzeria ergänzen.
5. Preise mit der aktuellen Karte abgleichen (`shared/menu.json`).

## Lizenz

Code: MIT. Name, Speisekarte und Preise: Pizzeria Peperoni, Bad Radkersburg – nur für diesen Entwurf verwendet.
Schriften: Anton, DM Sans, Caveat – SIL Open Font License (siehe `web/fonts/`).
