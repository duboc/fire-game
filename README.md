# 🔥 Tap Race

A 30–60 second mass-tapping game for live events. Everyone scans a QR, taps a
giant button as fast as they can, and a live leaderboard reorders on the big
screen until confetti rains on the winner.

- **Self-service**: scan → playing in ~3 s. No login, no name typing.
- **Auto-generated identities**: `🐧 Pinguim Furioso #142` — unique, fun, zero moderation.
- **Individual ranking** (no teams). Each phone shows *your* live position.
- **One Cloud Run instance, in-memory counter.** No database in the hot path.
- **Self-hosted everything** (QR, confetti, fonts) — survives flaky event wifi.

## Run locally

```bash
npm install
npm start
# Players → http://localhost:8080/
# Big screen → http://localhost:8080/screen
# Host panel → http://localhost:8080/host   (admin token: "dev")
```

Open `/screen` on a projector, `/host` on your laptop, and `/` on phones.
On the host panel pick a duration and hit **INICIAR** — the screen runs
3·2·1·VAI and the round begins.

```bash
npm test   # unit tests for the game engine (no network needed)
```

## Deploy to Cloud Run (single instance)

```bash
PROJECT=my-gcp-project REGION=us-central1 ADMIN_TOKEN=supersecret ./deploy.sh
```

The script pins the service to **exactly one instance** and keeps CPU always-on.
Those flags are correctness, not tuning — see comments in `deploy.sh`.

## Architecture

```
Phone   POST /tap {id,n}          -> {yourRank, yourCount, total, phase, timing}   (batch ~150ms)
        GET  /state?id=           -> phase + timing (used during lobby/countdown)
Server  Map<id,{name,count}> in memory; rank snapshot recomputed every 100ms
Screen  GET  /events (SSE)        -> {phase, top10, total, totalTaps, winner, timing}   (every 100ms)
Host    POST /admin/start|reset   -> drives the authoritative countdown
End     onEnded -> optional Firestore dump (history only, never in the hot path)
```

**The phone only writes; the screen only reads.** The single persistent
connection (SSE) is the big screen. Phones never hold a socket — they learn
their rank from the `/tap` response itself.

### Why a single instance / in-memory?

300 players × ~5 taps/s ≈ 1500 req/s, batched on the client down to a few
hundred req/s — trivial for one box. The counter must live in **one** process,
so the service is pinned `min=max=1`. Firestore can't drive the real-time loop
(1 write/s per document); it's only used once, at the end, for history.

## Design decisions (locked)

| Decision | Choice |
|---|---|
| Teams vs individual | **Individual** ranking, top-10 live leaderboard |
| Names | **Auto-generated** (adjective + animal + `#seq`), no typing, no moderation |
| Phone shows rank? | **Yes** — `#47 de 300` updates from each `/tap` response |
| Anti-cheat | **None.** Only an anti-*accident* clamp (`n ≤ 100` per batch) |
| Countdown source of truth | **Server** timestamps; phones/screen render from them |
| Climax | Confetti + winner **only on the big screen** |

## Mobile/UX hardening

- `touch-action: manipulation/none` + `preventDefault` → no iOS double-tap zoom.
- Instant **local** button feedback on `pointerdown` (never waits for the server).
- `keepalive` + `sendBeacon` flush on background/close → final taps still count.
- Interpolated bars and FLIP row animation → smooth, never "jumpy".
- `navigator.vibrate` used where supported (no-op on iOS, visual feedback covers it).

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `ADMIN_TOKEN` | `dev` | Required for `/admin/*`. In production (`NODE_ENV=production` or on GCP) the server **refuses to boot** with a default/unset token. |
| `DURATION_MS` | `30000` | Default round length (host can override per round) |
| `TICK_MS` | `100` | Snapshot + broadcast cadence |
| `PERSIST` | `off` | `on` to write results to Firestore (needs ADC + `@google-cloud/firestore`) |
| `FIRESTORE_COLLECTION` | `tap_race_rounds` | Where round results are stored |
