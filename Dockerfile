# syntax=docker/dockerfile:1.7
# Peperoni – Website + Rust-Server + SQLite in einem kleinen Image.
#   docker compose up -d --build   →   http://localhost:8080

# ── 1) Frontend: TypeScript → JavaScript
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared /src/shared
COPY web/tsconfig.json ./
COPY web/src ./src
COPY web/tests ./tests
RUN npx tsc -p . \
 && node --test "dist/tests/*.test.js" \
 && mkdir -p data && cp ../shared/menu.json data/menu.json

# ── 2) Server: Rust, Release-Build (Tests laufen mit)
FROM rust:1-slim-bookworm AS server
WORKDIR /src/server
COPY shared /src/shared
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/migrations ./migrations
COPY server/src ./src
COPY server/tests ./tests
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/server/target \
    cargo test --release --locked \
 && cargo build --release --locked \
 && cp target/release/peperoni-server /usr/local/bin/peperoni-server

# ── 3) Laufzeit: nur Binary + statische Dateien, ohne Root-Rechte
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --home /data peperoni \
 && mkdir -p /data /app/web && chown peperoni /data
COPY --from=server /usr/local/bin/peperoni-server /usr/local/bin/peperoni-server
COPY web/index.html web/robots.txt /app/web/
COPY web/css    /app/web/css
COPY web/fonts  /app/web/fonts
COPY web/images /app/web/images
COPY --from=web /src/web/dist/src /app/web/dist/src
COPY --from=web /src/web/data     /app/web/data

ENV DATABASE_URL=sqlite:///data/peperoni.db \
    WEB_DIR=/app/web \
    BIND=0.0.0.0:8080 \
    RUST_LOG=info,tower_http=warn,sqlx=warn

USER peperoni
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["peperoni-server", "healthcheck"]
ENTRYPOINT ["peperoni-server"]
