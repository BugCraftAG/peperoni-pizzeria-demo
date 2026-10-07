-- Peperoni: Konten, Sitzungen ("angemeldet bleiben"), Adressen, Bestellungen

CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,                 -- Argon2id, nie das Passwort selbst
    name          TEXT    NOT NULL DEFAULT '',
    phone         TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE addresses (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    street     TEXT NOT NULL DEFAULT '',
    zone_id    TEXT NOT NULL DEFAULT '',
    place      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Im Cookie steht ein zufälliges Token; hier nur dessen SHA-256.
-- Wer die Datenbank liest, kann sich damit nicht anmelden.
CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remember   INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,                    -- Unix-Sekunden
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE orders (
    id             INTEGER PRIMARY KEY,
    ref            TEXT    NOT NULL UNIQUE,
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    mode           TEXT    NOT NULL CHECK (mode IN ('delivery', 'pickup')),
    customer_name  TEXT    NOT NULL,
    customer_phone TEXT    NOT NULL,
    street         TEXT,
    zone_id        TEXT,
    place          TEXT,
    wish_time      TEXT    NOT NULL,                -- 'asap' oder 'HH:MM'
    payment        TEXT    NOT NULL CHECK (payment IN ('bar', 'karte')),
    note           TEXT,
    subtotal       INTEGER NOT NULL,                -- alle Beträge in Cent
    deposit        INTEGER NOT NULL,
    fee            INTEGER NOT NULL,
    total          INTEGER NOT NULL,
    message        TEXT    NOT NULL,                -- exakt der gesendete WhatsApp-Text
    notified       INTEGER NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'neu' CHECK (status IN ('neu', 'bestaetigt', 'fertig', 'storniert')),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX orders_user ON orders(user_id, created_at DESC);
CREATE INDEX orders_created ON orders(created_at DESC);

CREATE TABLE order_items (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id    TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    qty        INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
    unit_price INTEGER NOT NULL,
    deposit    INTEGER NOT NULL,
    details    TEXT    NOT NULL DEFAULT '',          -- z. B. "180 g Fleisch, + Speck"
    options    TEXT    NOT NULL,                     -- Auswahl als JSON
    note       TEXT
);
CREATE INDEX order_items_order ON order_items(order_id);
