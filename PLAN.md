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

## Scale hardening (global event, up to ~5.000 players on one instance)

Context and measurements: `docs/SCALE.md`. Load tests showed two hard blockers at
event scale: `GET /state` re-sorted every player on every request, and the fixed
150ms tap cadence demanded ~33.000 req/s at 5.000 players (Node saturates ~3.500).

- [x] `src/server.js`: drop the per-request `game.tick()` from `GET /state` (the 100ms
      loop already advances the machine); expose grace/cadence tuning via env.
- [x] `src/game.js`: server-driven adaptive tap cadence (`tapIntervalMs`) derived from
      player count and a request budget, clamped to [min,max]. Also `pollIntervalMs` for the
      lobby/countdown polls — at 5.000 players the fixed 200ms countdown poll alone would have
      demanded 25.000 req/s, so the cadence fix is incomplete without it.
- [x] `src/game.js`: end-of-round grace window — credit taps that arrive up to
      `graceMs` after `endsAt` (they were made before the buzzer; the phone is just far away).
- [x] `src/game.js`: defer the winner reveal to the end of the grace window (`settled`)
      so a late batch can never visibly change the champion; `onEnded` fires once, after settling.
- [x] `public/index.html`: RTT-compensated clock offset. Session-wide min-RTT rather than a
      per-round re-sync: at 5.000 players the countdown affords ~1 poll, too few samples to
      re-converge, and extra sync traffic is exactly what the budget cannot spare. Sampling
      piggybacks on every response, and resets if the device clock itself jumps.
- [x] `public/index.html`: adopt server `tapIntervalMs`/`pollIntervalMs`; transition
      COUNTDOWN→RUNNING off the local synced clock; gate `onTap` on `localPhase()`; tighten the
      loop near the buzzer so a final flush lands exactly at `endsAt`. Also key the optimistic
      count on `settled` rather than the phase, else the number visibly dips at the buzzer and
      climbs back when the last flush is acknowledged.
- [x] `public/screen.html`: RTT-compensated offset (SSE is one-way and cannot measure latency,
      so the screen samples `/state` — one client, so the extra request is free); settling beat
      at `endsAt`; reveal champion + confetti only once `settled`.
- [x] `test/game.test.js`: grace-window semantics (within counts / beyond does not), deferred
      settle + single `onEnded`, reset-during-settle abandons the round, adaptive cadence clamps,
      and `playerView` purity (guards the `/state` fix against regression).
- [x] `npm test` green (19 tests).

Verified beyond unit tests:
- [x] Live-server integration: a batch tapped before the buzzer but landing 400ms after it is
      credited, flips the champion, and the reveal stays hidden until settled; beyond the window
      it is refused.
- [x] Real-browser (Playwright, screen + phones): settling beat → reveal → confetti, phone count
      never dips, three back-to-back rounds with no carryover, zero console errors.
- [x] Cadence on a live server holds the aggregate at ~1.500 rps across 300 / 850 / 5.000 players
      (203ms / 570ms / 3000ms).

## Smooth operation at 5.000 (reliability pass)

The previous section made the load *survivable*. This one is about the event not
being ruined by something other than throughput. Each item below is backed by a
measurement, not a hunch; the numbers are in `docs/SCALE.md`.

Measured first, then triaged:

| Area | Measured | Verdict |
|---|---|---|
| Lobby burst | 25,5K html+css per phone → **124,7 MiB** across 5.000 | fix (compress) |
| Reload cost | `no-store` ⇒ every reload re-downloads 25,5K | fix (`no-cache` + ETag) |
| `_recount()` | **1,673ms** at 5.000 ⇒ **16,7% of the only core**, 100k objects/s of GC | fix |
| Request hot path | `playerView`+stringify **0,0039ms** ⇒ ~0,65% core at 1.667 rps | already fine |
| `src/names.js` | O(1) per join (seq counter + 2 index reads) | already fine |
| `keepAliveTimeout=0` | premise disproven (an *active* SSE stream is never closed for idleness), but the value is still right on Cloud Run | fix the comment only |

- [x] `src/server.js`: pre-compress the text assets once at boot with built-in `zlib`
      (gzip + brotli) and serve from memory. Per-request compression would burn the one
      core we have; the files never change at runtime. Measured per phone (`/` +
      `/theme.css` only — the 124,7 MiB figure had wrongly summed all four assets):
      27.873B → 10.076B gzip → 8.588B brotli, i.e. **132,9 MiB → 41,0 MiB** across 5.000.
- [x] `src/server.js`: HTML/CSS `no-store` → `no-cache` + ETag, so a reload revalidates
      (redeploys still land instantly) but returns a ~200-byte 304 instead of 25,5K.
- [x] `src/game.js`: `_recount()` only when something changed (dirty flag). In LOBBY and
      after settling nothing can change, yet it currently runs 10×/s over every player —
      including throughout the join stampede, which is exactly when the core is scarcest.
- [x] `src/game.js`: drop the per-tick 5.000-entry `ranks` Map; write `rank` onto the
      player object instead. Same information, no allocation. Together with the reused
      sort buffer: **1,673ms → ~0,9ms** when dirty, and free when clean.
- [x] `public/index.html`: one in-flight request at a time (tap and poll each), plus an
      AbortController timeout. Today a server hiccup lets each phone stack requests
      without bound — a blip becomes a stampede precisely when the server is weakest.
- [x] `src/server.js`: `uncaughtException` / `unhandledRejection` guards. With min=max=1
      this process *is* the game; dying mid-round loses every score and the replacement
      starts empty.
- [x] `src/server.js`: 10s heartbeat log (phase, players, rps, **event-loop lag**, RSS,
      SSE clients). Event-loop lag is the single best saturation signal for Node, and
      flying blind through a 5.000-player event is its own risk.
- [x] `src/server.js` + `public/host.html`: stop returning `adminToken` from `/config`.
      Any attendee can currently read it and `/admin/reset` mid-round. Host types it once,
      remembered in localStorage.
- [x] `deploy.sh`: `--cpu 2` (measured p99 90ms → 70ms; Node can't use the second core for
      throughput, but GC and TLS get off the critical path).
- [x] Tests: dirty-flag correctness, rank-on-player, `/config` no longer leaks, compression
      + 304 round-trip against a live server, and a browser pass for the in-flight guard.
      22 unit + 51 HTTP contract + 18 browser assertions, all green.
- [x] `docs/SCALE.md` + `README.md`: record the new measurements and knobs.

Found by the 5.000-player load run, not predicted (finding 8):

The run was clean — 0 errors, p50 7,5ms, event-loop lag 5ms in steady state — except
that the opening burst (5.000 phones inside a 500ms window) took **2.107ms** to drain.
That burst is not an artifact of the generator: `loop()` deliberately wakes every phone
at exactly `endsAt` so the last batch lands inside the grace window, which makes the
final flush a perfectly synchronised 5.000-request herd. Draining it takes longer than
the 1.500ms window it has to land in, so at event scale the players furthest from the
region would silently lose their last batch — the exact unfairness `graceMs` exists to
prevent, reintroduced by the mechanism meant to fix it.

Confirmed by A/B, but only after fixing the harness. A first counterfactual seemed to
disprove the claim (unspread herd landing at 1.488ms, 12ms inside the window, nothing
lost) — that run was wrong: the generator's HTTP agent capped at `maxSockets: 256`, so
it dribbled the herd out instead of firing it. Uncapped, the unspread herd takes
**2.238–2.798ms** to drain and the server refuses **1.339–1.839 of 5.000** final
batches. Spread, it lands at 2.300ms inside a 3.834ms window: **5.001/5.000 credited,
0 refused**, loop lag across the buzzer **1.199ms → 1ms**, RSS 180MB → 97MB.
Both sides are reproducible: `npm run check:load`, `LOAD_SPREAD=0 npm run check:load`.

- [x] `src/game.js`: derive `graceMs` from the roster at `start()` — the herd needs
      `players / requestBudgetRps` seconds to drain, plus slack for one-way latency.
      Clamped to [`minGraceMs`, `maxGraceMs`]; an explicit `GRACE_MS` still pins it, so
      `0` keeps disabling the window and the existing tests keep their fixed value.
- [x] `public/index.html`: spread the final flush over `min(tapIntervalMs, graceMs*0.6)`
      instead of firing it at `endsAt` on every phone at once. Taps are credited by when
      they were *made*, not when they arrive, so spreading costs nothing but suspense.
      The rAF `frame()` loop is independent, so the button still flips to ENDED exactly
      at `endsAt` while the network loop sleeps out its jitter slice.
- [x] Re-run the load test and confirm the buzzer herd lands inside the window.

Tried and reverted: a `peak_inflight=N/1000` gauge in the heartbeat, meant to watch the
Cloud Run concurrency cap. Every handler here is synchronous, so Express is never inside
two at once — it printed `1/1000` while the server was refusing 1.339 taps. Worse than
useless: it reads as headroom. Replaced with `conns` (open sockets) and the note that
loop lag is what actually catches a herd.

Deliberately **not** doing:
- Serving assets from a CDN — the right fix for the 45 MiB that remains, but it is an
  infrastructure change, not a code one. Noted in `docs/SCALE.md`.
- Compressing `/tap` and `/state` — responses are ~400 bytes; per-request gzip at
  1.667 rps costs more core than it saves bytes. SSE must not be compressed at all.
- Surviving an instance restart mid-round. State is one in-memory `Map` by design;
  recovering a round in flight is a different architecture. Residual risk, stated.

## A real admin password, and keeping it off every screen

The event token becomes a real password. Removing it from `/config` (previous
section) stopped it being *served*; it was still typed on a laptop that is often
mirrored to the projector and kept in `localStorage` in the clear.

**Scope: the application only.** Cloud Run env vars, Secret Manager and
`deploy.sh` are explicitly out — the deployed app must accept the password with
no secret plumbing at all.

That rules out an env var, and committing the plaintext is off the table: anyone
who cloned the repo could then reset a live round. So the app ships a **scrypt
hash** of the password instead. A hash is enough to *check* a password and
useless for reading one back, so `git` never sees the secret and the deployment
needs no configuration. `ADMIN_TOKEN` still overrides it when set, which is how
the check harnesses authenticate with a cheap throwaway token.

- [x] `scripts/admin-hash.mjs` (`npm run admin:hash`): echo-off double prompt,
      prints the `scrypt$N$r$p$salt$hash` line to paste into `src/server.js`.
      Prompts rather than taking an argument, so the password stays out of shell
      history and the process list.
- [x] `src/server.js`: `ADMIN_PASSWORD_HASH` baked in, verified with **async**
      `scrypt` on the threadpool — never `scryptSync`, which would stall the one
      event loop 5.000 phones are sharing. The `ADMIN_TOKEN` override compares
      with SHA-256 + `timingSafeEqual`; digest first so it is constant-time
      across *lengths* too.
- [x] `src/server.js`: booting with no configuration is now safe, so the fatal
      check narrowed — it fires only on an *explicitly* weak `ADMIN_TOKEN`,
      which is how test tokens reach production by accident.
- [x] `src/server.js`: `POST /admin/login` exchanges the password for an HttpOnly,
      SameSite=Strict session cookie held in memory; `/admin/*` accepts the cookie
      or the header. The point is that the host page then never has to keep the
      password anywhere JavaScript can read it. `POST /admin/logout` clears it,
      `GET /admin/session` lets the page render the right state after a reload.
- [x] `src/server.js`: bounded throttle on failed admin auth. The event password
      is the kind a bored attendee guesses from the event name itself, and
      `/host` is a public URL. Delay grows with consecutive failures and resets
      on success; capped at 2s, and capped again at 16 delayed responses in
      flight, so it can never become a DoS on the single instance or on the host.
- [x] `public/host.html`: `type="password"` with a show/hide toggle, and stop
      writing the raw token to `localStorage` — log in once, keep the cookie.
      The first Start/Reset click doubles as the login, so it is still one action.
- [x] Tests: 15 contract assertions for the login/cookie flow, cookie flags, 401s,
      the throttle, and that the password appears in no served asset; 13 browser
      assertions that the field is masked, that the peek toggle works, that
      neither storage nor `document.cookie` holds anything, and that the session
      survives a reload. `npm test` 22, `check:contract` 66, `check:browser` 27.

## Names in the player's own language

Six locales — **pt, es, en, fr, it, de** — chosen because Roboto already renders
all of them. English is the fallback for anything else, so a Dutch or Japanese
attendee gets a readable name rather than tofu boxes on the projector. Only the
*name* is localised; the rest of the UI stays Portuguese (a separate, much
larger job).

The interesting part is not the plumbing, it is the grammar. The current
Portuguese list is **already wrong**: all 41 adjectives are masculine while 11 of
the 42 animals are feminine, so `Capivara Furioso` and `Raposa Atômico` can
already reach the big screen. Word-for-word translation would repeat that
mistake five more times, so agreement is designed in rather than bolted on:

- **Adjectives are stored pre-inflected**, `{ m: 'Furioso', f: 'Furiosa' }`, not
  derived by a suffix rule at runtime. Rules look tidy and then quietly mangle
  the exceptions — `Turbo`, `Laser`, `Ninja` and `Relâmpago` are nouns in
  apposition and never inflect, yet they end in the letters a rule would rewrite.
  Explicit pairs are more lines and zero cleverness, and a reviewer can check
  them by eye.
- **Word order lives in the locale**, as a `compose(animal, adjective)` function.
  pt/es/it/fr put the adjective after the noun, en/de before it. German declines
  attributively, so it carries three forms (`Wilder`/`Wilde`/`Wildes`).
- **The animal roster is defined once** (`src/locales/animals.js`: key + emoji)
  and each locale supplies only the words. That guarantees every language has the
  same 42 animals with the same emoji, and makes a missing translation a test
  failure instead of a runtime `undefined`.

- [x] `src/locales/animals.js`: canonical `[{key, emoji}]` roster, 42 entries.
- [x] `src/locales/{pt,es,en,fr,it,de}.js`: `animals` (key -> `[word, gender]`),
      `adjectives`, `compose`. Kept pt's full 41 adjectives; 35-40 for the rest.
      Curated for words that are invariant or regularly inflected — a shorter
      correct list beats a longer one with errors, and the pair is cosmetic
      anyway (uniqueness comes from `#seq`).
- [x] `src/names.js`: `makeNameFactory(rng)` returns `next(locale)`; added
      `normalizeLocale(input)`. Locale is **untrusted input** — normalized
      (`pt-BR` -> `pt`), bounded in length and in tag count, and looked up in a
      `Map` rather than an object, so `__proto__` and friends resolve to English
      like any other unknown tag. Went further than planned on negotiation: it
      returns the first *supported* tag in the list, so `zh-CN,fr;q=0.9` yields
      French rather than falling all the way back to English.
- [x] `src/game.js`: `join(id, locale)` threads it to `_nextName`; `_identity`
      reports the locale the server actually resolved (join only, never on the
      `/tap` hot path).
- [x] `src/server.js`: `/join` and the `/tap` self-heal both read the locale.
- [x] ~~`public/index.html`: send `navigator.language`~~ — **not needed.**
      `Accept-Language` is on every request already, so the phone needed no
      change at all: no extra bytes, no new body field to parse on the hot path,
      and the self-healing rejoin (server.js:303) gets the language for free.
      That path was the whole reason the client-side approach looked necessary.
- [x] Tests: 13 unit (roster coverage per locale, shared emoji across locales,
      agreement in pt/es/it/fr, German three-gender declension, word order,
      `pt-BR` -> pt, first-supported-tag negotiation, and 18 hostile inputs
      including `__proto__` and a 10.000-tag header); 9 contract (real HTTP,
      240 live joins all checked against the set of grammatically legal names,
      plus the `/tap` self-heal keeping its language); 1 browser (Chromium
      launched with `locale: 'es-AR'` is named in Spanish).
      Mutation-checked: reverting `compose` to the old always-masculine form
      fails the agreement test, and deleting one animal from a locale fails at
      boot rather than rendering `undefined`.

## Batucada — a Simon Says companion game

Executes `docs/BATUCADA_SPEC.md`. Ships next to Tap Race, in the same process:
new files only, no changes to Tap Race's routes, `src/game.js`, or existing
public pages except `public/host.html` (extended with a second panel, not
replaced). Two things the spec left implicit, resolved here:

- **One process, one password.** Same Express app, same Cloud Run instance —
  no reason to stand up a second service for one more in-memory game. Reuses
  the existing session cookie / `checkAdmin`.
- **No second timer.** The existing 100ms `tickTimer` also drives Batucada's
  `tick()` + SSE broadcast, rather than a second clock that can drift against
  the first.
- Persistence (`onEnded` → Firestore) is **out of scope for v1**.

### Engine (test-first)

- [x] `test/batucada.test.js`: failing tests for `src/batucada.js` covering —
  phase transitions on injected `now` (`LOBBY -> COUNTDOWN -> MEMORIZE(1) ->
  RECALL(1) -> REVEAL(1) -> MEMORIZE(2) -> ...`, same time-injected purity as
  `Game`); an injectable `sequenceFactory` (mirrors `nameFactory`) so rounds are
  deterministic in tests; grading (full match keeps a player alive and sets
  `roundsCleared`, partial/no match sets `alive:false` + `eliminatedRound` +
  `prefixMatched`); ranking/tiebreak — `roundsCleared` desc, `prefixMatched`
  desc, `elapsedMs` asc, `seq` asc — including several players eliminated in
  the *same* round; end of game at `aliveCount <= 1` or at `maxRounds` (with
  survivors still ranked correctly, no special-casing); a join arriving after
  `COUNTDOWN` is `alive:false`/`roundsCleared:0` immediately — spectator from
  the start, never injected into a round in progress; a duplicate `/recall`
  for the same player/round is a no-op; `reset()` matches `Game.reset()`.
- [x] `src/batucada.js`: `PHASE`, `DEFAULTS`, class `Batucada` (`join`,
  `recall`, `start`, `reset`, `tick`, `publicState`, `playerView`) until green.
  9/9 new tests pass on first implementation; full suite 64/64 green, no
  regressions in Tap Race's tests. Sequence randomness is injectable via an
  `rng(n)` option (integer in `[0,n)`) rather than a `sequenceFactory` —
  same determinism goal as `nameFactory`, simpler contract, no float precision
  edge cases in tests.

### Server integration

- [x] `src/server.js`: construct `const batucada = new Batucada({...})` next to
  `game`.
- [x] Routes, additive only: `POST /batucada/join`, `POST /batucada/recall`
  `{id, sequence}`, `GET /batucada/state?id=` (pure read, no `tick()` on the
  request path — same reason as `/state` today), `GET /batucada/events` (SSE,
  its own client `Set`), `POST /batucada/admin/start` (no `durationMs` — round
  length is derived from the round number) / `POST /batucada/admin/reset`
  (both reuse `checkAdmin`).
- [x] Extend the existing `tickTimer` callback to also `batucada.tick(now)` +
  broadcast to Batucada's SSE set.
- [x] Add the new static pages to the `precompress()` calls.

### Client pages

- [x] Define the shared instrument list once — `surdo, pandeiro, cuica, agogo,
  tamborim, reco-reco` — as the single source both the engine (wire format is
  indices into this array) and the client pages render from; order must match
  exactly on both ends. Colors: 4 reused Google colors from `theme.css` plus
  two custom accents (`#A142F4` purple, `#00BCD4` cyan) since only 6 distinct
  Google-brand colors don't exist; instrument name is always shown as text so
  identification never depends on color alone.
- [x] `public/batucada/phone.html`: join, then render by phase — waiting
  (lobby/countdown), "watch the screen" (memorize, no input), instrument grid
  that builds and auto-submits a sequence on tap (recall), your result + live
  `aliveCount` (reveal, and continuously as a spectator after elimination
  through to ended), final rank (ended). Uses a simple raw clock offset
  (`serverNow - Date.now()`, no RTT compensation) since it only drives a
  cosmetic progress bar — grading is gated server-side by the `/recall` POST's
  own arrival time, never by the phone's local phase guess.
- [x] `public/batucada/screen.html`: lobby QR + count, countdown, flash the
  sequence (memorize), countdown + `aliveCount` (recall), who fell this round
  (reveal), final ranking + winner (ended) — reuse `theme.css` and the
  confetti/QR patterns already in `screen.html`. Uses full NTP-style clock
  sync (like Tap Race's screen.html) because the flash animation genuinely
  needs the precision; a single client, so the extra `/batucada/state` sample
  is free.
- [x] Extend `public/host.html` with a second panel (start/reset for
  Batucada), reusing the existing login/session UI.
- Added two fields to the engine beyond the original spec, discovered while
  building the clients: `memorizeStartsAt` + `symbolOnMs`/`symbolGapMs` on
  `publicState`/`playerView` (the screen needs a start timestamp and the
  per-symbol timing to animate the flash — a total duration alone isn't
  enough), and `yourRank` on `playerView` once `ENDED` (so the client never
  has to reimplement the tiebreak chain itself). Both covered by new engine
  tests before implementation.

### Verification

- [x] `npm test` green — 65/65 (10 Batucada engine tests).
- [x] Manual run: Playwright end-to-end through `/batucada/` — host login,
  start, countdown, the sequence flash read directly off the rendered tiles
  (not the API, since the screen never exposes it elsewhere), one phone
  answering correctly and one deliberately wrong, live elimination, the
  spectator view, the champion screen, and the host panel's live status.
  Found and fixed one real bug this way: the screen's podium list said "1
  rodadas" instead of "1 rodada" (the champion card already had the
  singular/plural check; the podium loop didn't).
- [x] Extend `npm run check:contract` with the new routes' happy path:
  `/batucada/join` identity shape, `/batucada/state` known/unknown, admin auth
  enforced on `/batucada/admin/start`, `/batucada/recall` self-heals an
  unknown id, `/batucada/events` pushes a valid `publicState` SSE frame on
  connect, and `/batucada/admin/reset` clears the room. 173/173 assertions
  green (10 new).

### Revision: plain colors instead of a percussion theme

Deployed, then played by hand — and the percussion theme (six instruments,
icons, Portuguese labels) obscured the actual mechanic instead of dressing it
up. Simplified to classic Simon Says: four plain colors, no icon, no label,
and a slower blink (900/500ms vs 700/300ms) so the pace reads as attentive
rather than reflexive. Full rationale in `docs/BATUCADA_SPEC.md`, "Revision:
plain colors instead of a percussion theme".

- [x] `src/batucada.js`: `INSTRUMENTS`/`instruments` → `SYMBOLS`/`symbols`,
  six instrument keys → four color keys, `DEFAULTS.symbolOnMs`/`symbolGapMs`
  700/300 → 900/500. `test/batucada.test.js` updated to match; 10/10 still
  green.
- [x] `public/batucada/phone.html` + `screen.html`: instrument grid → plain
  2×2 color-tile grid, all percussion copy and icons removed, user-facing
  name "Batucada" → "Sequência" throughout. Routes, file paths and the
  `Batucada` class name are unchanged — internal, invisible to a player, and
  renaming them would only have churned this document and the server for no
  visible benefit.
- [x] `public/host.html`: panel branding updated to match.
- [x] Re-verified: `npm test` 65/65, `npm run check:contract` 173/173,
  Playwright end-to-end pass re-run against the new grid and copy — same
  golden path (join → countdown → memorize → recall → elimination →
  champion), screenshots confirm the 2×2 color grid reads cleanly.
- [x] Re-deployed to `riojucu` (see README, "Deploy to Cloud Run") and
  smoke-checked the live routes.

### Revision 2: scoring instead of elimination, fixed 10-round arc

Requirement: the game must run a *minimum of six rounds* with gradually
increasing difficulty — which the elimination model can't guarantee (with a
small room, `aliveCount <= 1` ends it in round 1–2, exactly what every test
run showed). Decision: no elimination (a miss costs points, never the seat)
and exactly 10 rounds. Full model in `docs/BATUCADA_SPEC.md`, "Revision 2".

- [x] `src/batucada.js` rewritten: per-player `cleared`/`symbols`/
  `elapsedTotalMs` replace `alive`/`eliminatedRound`; game ends only at
  `totalRounds`; flash speed ramps per round (900/500 → 450/250ms floor) and
  the effective per-round speeds ride on `publicState` so the screen animates
  at the server's pace; latecomers just play from the round they walked into.
  `test/batucada.test.js` rewritten first — 12 tests, including "a miss never
  ends the game", the speed-ramp clamp, and the new tiebreak chain.
- [x] `public/batucada/phone.html`: spectator state removed; per-round
  feedback ("Isso mesmo!" / "Errou essa — a próxima já vem") with a running
  score line; **fixed a latent bug elimination had masked** — input state
  reset per game instead of per round, so `submitted` from round 1 leaked
  into round 2 and the grid never came back. Never surfaced before because
  no test room survived to round 2.
- [x] `public/batucada/screen.html`: REVEAL shows how many cleared the round
  plus a top-5 running standings; chips show round `N/10`.
- [x] `src/server.js`: `SEQ_*` env overrides (rounds + timing) for test
  harnesses and event pacing. `public/host.html`: Alive → Players, round
  `N/total`. `scripts/contract-check.mjs` updated to the new field names.
- [x] Verified: 67 unit / 173 contract / Playwright e2e with `SEQ_ROUNDS=2`
  proving the key new behavior — a player who misses round 1 gets their grid
  back in round 2 and finishes ranked #2 with partial credit.
