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
# Host panel → http://localhost:8080/host
```

Open `/screen` on a projector, `/host` on your laptop, and `/` on phones.
On the host panel type the admin password, pick a duration and hit **Start** —
the screen runs 3·2·1·GO and the round begins.

```bash
npm test              # unit tests for the game engine (no network needed)
npm run check:contract  # HTTP contract against a live server: compression, ETags,
                        # 304s, admin auth, a full round, the heartbeat
npm run check:browser   # real Chromium: host login flow, a full round, crash guards
npm run check:load      # 5.000-player load run (spawns its own server; ~40s)
```

`check:load` also does the A/B behind the grace window — `LOAD_SPREAD=0
npm run check:load` reproduces the unspread buzzer herd that loses a third of the
room. `check:browser` needs Chromium: `npx playwright install chromium`.

## Deploy to Cloud Run (single instance)

```bash
PROJECT=my-gcp-project REGION=us-central1 ./deploy.sh
```

The script pins the service to **exactly one instance** and keeps CPU always-on.
Those flags are correctness, not tuning — see comments in `deploy.sh`.

No secret is passed to the deploy: only a `scrypt` hash of the host password is
compiled into the image (see [Admin access](#admin-access)). The script also
clears any `ADMIN_TOKEN` a previous deploy left on the service, since that env
var would silently override the password.

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
| Phone shows rank? | **Yes** — `#47` updates from each `/tap` response |
| Anti-cheat | **None.** Only an anti-*accident* clamp (`n ≤ 100` per batch) |
| Countdown source of truth | **Server** timestamps; phones/screen render from them |
| Climax | Confetti + winner **only on the big screen** |

## Mobile/UX hardening

- `touch-action: manipulation/none` + `preventDefault` → no iOS double-tap zoom.
- Instant **local** button feedback on `pointerdown` (never waits for the server).
- `keepalive` + `sendBeacon` flush on background/close → final taps still count.
- Interpolated bars and FLIP row animation → smooth, never "jumpy".
- `navigator.vibrate` used where supported (no-op on iOS, visual feedback covers it).

## Player names

Names are auto-generated as animal + adjective + `#seq` (`Capivara Furiosa #47`)
in the **player's own language** — Portuguese, Spanish, English, French, Italian
or German, taken from the browser's `Accept-Language`. Anything else falls back
to English: those six are what the self-hosted Roboto renders, and a readable
name beats tofu boxes on the projector. The leaderboard therefore mixes
languages at an international event, which is the point; the emoji and `#seq`
keep every row unambiguous.

Adjectives agree with the animal's gender (`Lobo Furioso` / `Capivara Furiosa`,
and German's three-way `Wütender Wolf` / `Wütende Eule` / `Wütendes Pferd`).
Both forms are written out in `src/locales/*.js` rather than derived by a
suffix rule, because `Turbo`, `Laser`, `Ninja` and `Relâmpago` end in the letters
such a rule would happily rewrite. To add a language: copy a locale file,
translate all 42 animals from `src/locales/animals.js`, and register it in
`src/names.js` — a missing animal fails at boot, not on the big screen.

### Overriding the name language

`?lang=` on the phone pins it, whatever the browser asks for: a link handed out
as `/?lang=de` mints German names. The page forwards it to `POST /join`.
Unsupported or malformed values fall back to English rather than erroring.

## Interface language

**The interface itself is English only** — the names are the localised part.

Six languages of chrome shipped briefly and were removed: all six had to be in
every page for the client to pick from (the alternative, `Vary: Accept-Language`,
fragments the cache and kills the shared 304), and that measured **+2,8 KB
brotli** on `/`. Across 5.000 phones on a cold lobby load that is ~13 MiB added
to the heaviest moment of the event — a ~24% tax on the one minute that decides
whether the room gets in. Not worth it for chrome that is mostly `TAP!` and a
countdown.

The work is in commit `31aeb82` if the trade ever changes.

## Admin access

`/host` is a public URL, so `/admin/start` and `/admin/reset` are behind a
password. The password itself is **not in this repository** — only a `scrypt`
hash of it, which is enough to check a password and useless for reading one
back. That means the app needs no secret plumbing to deploy, and a clone of the
repo does not let anyone reset a live round.

The host types the password once. The server exchanges it for an **HttpOnly,
SameSite=Strict** session cookie, so from then on the secret exists nowhere the
page can read it — not in `localStorage`, not in `document.cookie`, not in the
field (it is wiped on success). A laptop mirrored to the projector shows
`🔓 signed in`, never the password. The session lasts 12h; **sign out** ends it.

Failed logins are throttled — the delay grows per consecutive failure, capped at
2s and capped again at 16 delayed responses in flight, so guessing gets slow
without giving anyone a way to stall the instance or lock the host out.

To change the password:

```bash
npm run admin:hash    # prompts twice, echo off; prints a scrypt$… line
```

Paste it over `ADMIN_PASSWORD_HASH` in `src/server.js` and redeploy. Setting the
`ADMIN_TOKEN` env var **overrides** the password entirely — useful for tests,
but it means a deploy that sets it disables the built-in one.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `ADMIN_TOKEN` | *(unset)* | **Overrides** the built-in password (see below). Leave unset in production. If set, it must be ≥12 chars or the server refuses to boot on GCP. |
| `ADMIN_PASSWORD_HASH` | *(baked in)* | Overrides the compiled-in `scrypt$…` hash without a rebuild. |
| `ADMIN_SESSION_MS` | `43200000` | How long a host login stays valid (12h). |
| `DURATION_MS` | `30000` | Default round length (host can override per round) |
| `TICK_MS` | `100` | Snapshot + broadcast cadence |
| `PERSIST` | `off` | `on` to write results to Firestore (needs ADC + `@google-cloud/firestore`) |
| `FIRESTORE_COLLECTION` | `tap_race_rounds` | Where round results are stored |

### Scale knobs

Defaults are tuned for a single instance up to ~5.000 players and shouldn't need
touching — see [`docs/SCALE.md`](docs/SCALE.md) for the measurements behind them.

| Var | Default | Purpose |
|---|---|---|
| `REQUEST_BUDGET_RPS` | `1500` | Aggregate request target the server divides among players to derive their polling cadence |
| `MIN_TAP_INTERVAL_MS` / `MAX_TAP_INTERVAL_MS` | `150` / `3000` | Clamps on the derived `/tap` cadence |
| `MIN_POLL_INTERVAL_MS` / `MAX_POLL_INTERVAL_MS` | `600` / `5000` | Clamps on the derived lobby/countdown `/state` cadence |
| `MIN_GRACE_MS` / `MAX_GRACE_MS` | `1500` / `6000` | Clamps on the derived grace window |
| `LATE_ARRIVAL_MS` | `500` | Slack added to the grace window for the furthest player's one-way latency |
| `GRACE_MS` | *(unset)* | Set it to **pin** the grace window instead of deriving it. `0` disables the window entirely. |
| `HEARTBEAT_MS` | `10000` | Interval of the `beat …` log line |

The server publishes the resulting `tapIntervalMs` / `pollIntervalMs` in every
response and the clients obey them, so a 300-player room stays at the 150ms floor
while a 5.000-player event backs off automatically — no redeploy to change scale.

The **grace window** — the period after the buzzer in which late-arriving taps
are still credited, and before which the champion is not revealed — sizes itself
the same way, at `start()`, from the actual roster:

```
graceMs = clamp(MIN_GRACE_MS, players / REQUEST_BUDGET_RPS × 1000 + LATE_ARRIVAL_MS, MAX_GRACE_MS)
```

Every phone shares a synced clock, so without this the final flush is 5.000
requests on the same millisecond and the window has to be wide enough to drain
them. A small room gets 1.500ms; 5.000 players get 3.834ms. Phones also spread
their final flush across the window rather than firing it all at `endsAt`. With a
fixed 1.500ms window and no spread, a measured **1.339–1.839 of 5.000 players
lost their last batch** (`docs/SCALE.md`, finding 8).

### Watching a live event

The server logs a heartbeat every `HEARTBEAT_MS`:

```
beat phase=running players=5001 taps=260928 rps=1674 conns=45 lag_max=1ms rss=95MB sse=0
```

`lag_max` is event-loop lag, and it is the number to watch — it is the earliest
signal that Node's single thread is losing, and the only one that catches a
buzzer herd. Single digits are healthy; sustained triple digits are not.
