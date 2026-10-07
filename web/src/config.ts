/**
 * Zentrale Einstellungen.
 *
 * DEMO = true  → Hinweisbalken sichtbar, Bestellungen gehen an die Testnummer.
 * Vor dem Livegang: DEMO auf false und WHATSAPP_TARGET auf die Nummer der
 * Pizzeria setzen (nur mit Zustimmung des Inhabers).
 */
export const DEMO = true;

/** Empfänger der Bestellungen (international, nur Ziffern und +) */
export const WHATSAPP_TARGET = "+436645112794";

/**
 * Basis-URL der API. Leer = gleiche Domain (/api), so wie im Docker-Setup,
 * wo der Rust-Server auch die Website ausliefert. Kann über
 * <meta name="peperoni-api" content="https://…"> überschrieben werden.
 */
export function apiBase(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="peperoni-api"]')?.content.trim();
  return (meta || "") + "/api";
}
