# PLAN — Tap Race (single Cloud Run, in-memory, auto-names, individual ranking)

Locked product decisions: no teams · auto-generated names · phone shows position ·
no anti-cheat (anti-accident clamp only) · server-driven countdown · climax on big screen.

## Build
- [x] Scaffold project: `package.json` (ESM, express + qrcode, optional firestore), `.gitignore`, `.dockerignore`.
- [x] `src/names.js`: adjective+animal+`#seq` factory, unique by seq, emoji per animal.
- [x] `src/game.js`: pure, time-injected state engine (join/tap/start/reset/tick, rank snapshot, results).
- [x] `src/persist.js`: optional, best-effort Firestore dump at round end (never blocks game).
- [x] `src/server.js`: express + `/join` `/tap` `/state`, SSE `/events`, `/admin/start|reset`, `/qr.svg`, `/healthz`, 100ms tick+broadcast, graceful shutdown.
- [x] `public/index.html`: phone — big button, local feedback, batch+keepalive, name+rank HUD, iOS hardening, countdown overlay.
- [x] `public/screen.html`: big screen — SSE, server-synced 3·2·1·VAI, FLIP leaderboard + interpolated bars/counts, self-contained confetti, QR lobby.
- [x] `public/host.html`: host — start/reset, duration, admin token, live status, QR/links.
- [x] `test/*.test.js`: name uniqueness, tap windowing, clamp, ranking + ties, phase machine, onEnded-once, reset. (14 passing)
- [x] `Dockerfile` + `deploy.sh` (min=max=1, concurrency 1000, no-cpu-throttling, timeout 3600) + `README.md`.

## Verify
- [x] `npm test` green (14 tests).
- [x] `npm install` + local smoke test (endpoints + a simulated round).
- [x] Real-browser integration test (Playwright): lobby/countdown/running/ended across screen+host+3 phones, live leaderboard, confetti, no console errors.
- [x] Adversarial review workflow (29 agents, 24 findings → 9 confirmed); all 9 fixed:
  - [x] HIGH server: refuse to boot in prod with default/unset ADMIN_TOKEN; host page no longer ships `value="dev"`.
  - [x] HIGH phone: reset optimistic count on `roundId` change (fixes carryover on back-to-back rounds).
  - [x] MED server: bound the `/qr.svg` cache.
  - [x] MED phone: show server-authoritative count once the round ends (gate optimism on RUNNING).
  - [x] LOW server: keep header-slowloris protection (don't zero headersTimeout); drop admin token via query string.
  - [x] LOW phone: `/state` self-heals (re-register) after a server restart.
  - [x] LOW screen: fix row-entry animation (don't clobber the `enter` class).
  - [x] LOW deploy: `npm ci` for reproducible images.
- [x] Re-verified back-to-back rounds (count resets to 0) and confetti on consecutive rounds.
