# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A minimal H5 (mobile web) clipboard app for sending short text snippets between devices via a 6-character code. No build step, no framework, no database — a single Node `http` server plus a static `public/` folder.

## Commands

- `npm start` — runs `node server.js` (requires Node >= 18 for global `fetch`)
- No build, lint, or test scripts exist in this repo.
- Setup: `cp .env.example .env`, then edit `PORT`, `APP_BASE_URL`, `TTL_SECONDS`, `MAX_TEXT_BYTES`.

## Architecture

**Encryption is client-side, not server-side.** Despite what the README says, the server never sees plaintext or holds any key. `public/app.js` does AES-256-GCM encryption/decryption entirely in-browser via `crypto.subtle`, using PBKDF2 (120,000 iterations, SHA-256) to derive a key from a per-clip random secret. The server (`server.js`) only stores/serves opaque `{ciphertext, iv, salt}` blobs — it's a dumb relay, not a secrets vault. `CLIPBOARD_MASTER_KEY` in `.env`/`.env.example` is vestigial and unused by current `server.js`.

**Code scheme**: each clip gets a 6-character code split as `locator (3 chars) + secret (3 chars)`. The locator is the server-side lookup key (`/api/clips/*` endpoints key off it); the secret never leaves the client except embedded in the share code/URL — it's the PBKDF2 input and is never sent to the server. This is why the server can't decrypt: it stores ciphertext keyed by locator but never receives the secret.

**Storage**: in-memory `Map` (`store` in `server.js`) — no persistence, no database. Restarting the process discards all pending clips. TTL is enforced both server-side (`pruneExpired`, interval every 10s) and client-side (`startCountdown`/`startManualCountdown` in `app.js`); allowed values are restricted to `[600, 1800, 3600]` seconds (`normalizeTtlSeconds`).

**Server routing**: `server.js` is a single `http.createServer` callback with a manual if-chain on `(method, pathname)` — no router library. All API responses go through `sendJson`; static files go through `serveFile` with `normalizePublicPath` guarding against path traversal outside `public/`.

**Visit/usage stats**: a separate, unrelated feature for tracking unique visitors (`stats.json` in `.data/`, hashed IPs via a simple FNV-1a `hashIp`, geo lookup via `ip-api.com` with an in-memory/disk cache `geoCache`). Exposed via `/api/visits` and surfaced in the frontend by triple-tapping the footer (`handleFooterTap` in `app.js`) — not a documented user-facing feature, treat as an internal debug panel.

**QR code generation** proxies to `api.qrserver.com` server-side (`handleQr`) so the client never makes a third-party request directly.

**Frontend** (`public/index.html` + `public/app.js`) is three mutually-exclusive views toggled via `showOnly`: send view, receive view (auto-decrypt from a `?code=` URL param), and manual view (6-cell code entry). No framework — vanilla DOM manipulation, Tailwind via CDN `<script>` (not a build-time dependency).

## Key invariants to preserve when editing

- Never add a server-side decrypt path or log/persist the `secret` half of a code — that would break the end-to-end design even though the server already stores ciphertext.
- TTL values are an enum (`[600, 1800, 3600]`), not arbitrary — both `normalizeTtlSeconds` (server) and `getSelectedTtlSeconds` (client) must stay in sync if this changes.
- Locators are single-use: `handleCreateClip` rejects on collision (409) and `handleConsumeClip` deletes on read, so a clip can be fetched (`/api/clips/fetch`, non-destructive, used for polling/validation) multiple times but consumed only once.
