# Scaling Tap Race — capacity, geography, and what actually breaks

This document records a capacity investigation of Tap Race for large, globally
distributed live events, the measurements behind it, and the changes made as a
result. Numbers here are measured, not estimated.

## The scenario

Tap Race was designed for ~300 players in one room. Two larger scenarios were put
to it:

1. **Regional event, ~850 players** — Brazil, Argentina, Chile, Colombia, plus
   ~150 in the US, all against one instance in `us-central1`.
2. **Global event, ~5.000 players**, still on a single instance.

The single-instance constraint is not incidental — it is the design. `deploy.sh`
pins `--min-instances 1 --max-instances 1` because the entire game state is one
in-memory `Map` in `src/game.js`. A second instance means a second, disconnected
leaderboard. Everything below works within that constraint.

## Method

The real server was run pinned to N cores with `taskset` to emulate Cloud Run's
`--cpu N`, with the load generator pinned to separate cores. Two kinds of test:

- **Open loop** — clients fire on a fixed wall-clock cadence regardless of
  response time, exactly like `public/index.html`'s `loop()`. Models real phones.
- **Closed loop** — a fixed number of connections issue request-after-response as
  fast as the server allows. Measures the server's saturation ceiling.

Caveats worth knowing before reusing these figures: tests ran on a single 4-core
development machine over loopback, so there is no TLS, no real network latency,
and no gVisor overhead. Cloud Run will be somewhat slower for syscall-heavy
network work. The first-generation load generator was written in Node and became
the bottleneck above ~6.000 req/s; the saturation figures below were re-measured
with a Go generator. Where a number is generator-limited rather than
server-limited, it is labelled as such.

## What we found

### Finding 1 — `GET /state` re-sorted every player, on every request

`server.js` called `game.tick(now)` inside the `/state` handler. `tick()` runs
`_recount()`, a full O(n log n) sort of every player. During countdown every phone
polls `/state` every 200ms, so at 5.000 players that is thousands of complete
sorts per second. The 100ms tick loop already does this work; the per-request call
was pure duplication.

This made **countdown the worst phase in the game**, worse than the round itself:

| Players | Phase | Achieved | p50 | p90 | p99 | Errors |
|---|---|---|---|---|---|---|
| 500 | countdown `/state` @200ms | 2.232 req/s | 11ms | 73ms | **2.4s** | 0 |
| 850 | countdown `/state` @200ms | 2.830 req/s | **3.5s** | 5.4s | 5.8s | 246 |
| 5.000 | countdown `/state` @2s | 624 req/s | **4.8s** | 10.3s | 11.5s | 315 |

Deleting the one redundant line, at 5.000 players:

| | Achieved | p50 | p90 | p99 | Errors |
|---|---|---|---|---|---|
| Before | 624 req/s | 4801ms | 10327ms | 11498ms | 315 |
| After | 2.000 req/s | **1.8ms** | 5.1ms | 68ms | **0** |

A ~2.600× improvement in median latency from removing a redundant sort.

### Finding 2 — the fixed 150ms cadence is the real scaling wall

Each phone posts `/tap` every 150ms while running. That is a per-player request
rate independent of how many players there are, so total load grows linearly:

| Players | Required req/s @150ms |
|---|---|
| 300 | 2.000 |
| 850 | 5.667 |
| 5.000 | **33.333** |

Measured against that, the RUNNING phase:

| Players | Achieved | p50 | p90 | p99 | max | Errors |
|---|---|---|---|---|---|---|
| 300 | 1.795 req/s | 1.5ms | 4.4ms | 56ms | 335ms | 0 |
| 500 | 2.970 req/s | 3.6ms | 25ms | 137ms | 833ms | 0 |
| 850 | 4.843 req/s | **419ms** | 2.0s | 3.3s | 17.6s | 15 |

850 players is already past the cliff. 5.000 is not close.

### Finding 3 — Node cannot use extra vCPU, so a bigger instance does not help

Node runs all JavaScript on one thread. Every JSON parse, every `playerView`
serialization, every `_recount()` executes on that single thread.

With **three cores available the process used 107.5% CPU** — it cannot use more
than about one, no matter how many are provisioned. Throughput across
allocations (same generator, same pinning):

| Server cores | Throughput | vs 1 core |
|---|---|---|
| 1 | 5.598 req/s | — |
| 2 | 6.176 req/s | +10% |
| 3 | 6.314 req/s | +13% |

Memory is a non-issue: **118 MB RSS with 5.000 players registered**, against the
512Mi provisioned.

There is still one reason to run `--cpu 2`: p99 improved 90ms → 70ms while
throughput barely moved. That is GC and platform overhead getting their own core
instead of preempting the event loop. Buy it for latency stability, not capacity.

### Finding 4 — the platform caps concurrency at 1000 per instance

Cloud Run allows at most [1000 concurrent requests per
instance](https://docs.cloud.google.com/run/docs/about-concurrency). This rules
out WebSockets or SSE for the phones: 5.000 persistent connections would be 5.000
concurrent requests, and `--max-instances 1` leaves nowhere to overflow.

Short-lived HTTP polling is therefore the *correct* architecture here, not a
compromise. In-flight requests equal arrival rate × service time, so 2.000 req/s
at ~2ms service time sits at roughly 4 concurrent. Do not "upgrade" to WebSockets.

The corollary is that the failure mode is a cliff, not a slope: once service time
rises, in-flight requests climb, and past 1000 Cloud Run sheds load with no
second instance to absorb it. That is the source of the errors in the tables above.

### Finding 5 — geography biases fairness at both ends of the round

Latency does **not** lose taps. `loop()` calls `flushTaps()` fire-and-forget and
reschedules on a wall clock regardless of RTT, and a failed flush restores
`pending`. A phone on a slow link still ships every tap.

But distant players lost time at both ends, in the same direction:

- **Late start.** `clockOffset = serverNow - Date.now()` had no round-trip
  compensation. `serverNow` was generated one-way-latency ago, so every client
  underestimated server time by exactly its one-way latency.
- **Early cutoff.** `game.js` counted taps only while `now < endsAt` in *server*
  time. A final flush leaving São Paulo just before the buzzer arrived after it
  and was silently discarded.

At the old 150ms cadence this cost a Brazilian player roughly 250–300ms of a 30s
round versus a US player — about 1%, or 2–3 taps. Small, but systematic and always
in the same direction.

Critically, **slowing the cadence makes this dramatically worse**: at a 2s cadence
a distant player would lose up to a full 2 seconds of tapping, around 16 taps.
Any cadence increase must be paired with the grace window described below.

### Finding 6 — the lobby stampede is fine on the instance, but wasteful

5.000 phones scanning the QR at once (page + stylesheet + join):

| | Result |
|---|---|
| Wall clock | 5.4s to onboard all 5.000 |
| Throughput | 919 phones/s, 15.000 requests, 0 errors |
| Egress | 108.7 MiB (20.0 MiB/s) |
| Per-phone | p50 397ms · p90 502ms · p99 854ms |

It survives, but two thirds of those requests are static assets served with
`Cache-Control: no-store` (so every reload re-fetches). That belongs on a CDN, not
on the instance holding the game state.

### Finding 7 — the cheapest wins were compression, caching, and not re-sorting

Three measurements, taken after the cadence work, each with an obvious fix:

| Area | Measured | Fix |
|---|---|---|
| Assets per phone (`/` + `/theme.css`) | 27.873B uncompressed ⇒ **132,9 MiB** across 5.000 | pre-compress at boot |
| Reload | `no-store` ⇒ every reload re-downloads all 27.873B | `no-cache` + ETag ⇒ ~200-byte 304 |
| `_recount()` at 5.000 | **1,673ms**, run 10×/s ⇒ **16,7% of the only core** | dirty flag |

Compression is done once at process start with the built-in `zlib` (gzip
`Z_BEST_COMPRESSION`, brotli quality 11) and held in memory. Per-request
compression would spend the one core we have on work whose input never changes:

| Encoding | Per phone | Across 5.000 |
|---|---|---|
| identity | 27.873B | 132,9 MiB |
| gzip | 10.076B | 48,0 MiB |
| brotli | 8.588B | **41,0 MiB** |

`_recount()` was rebuilding a 5.000-entry `ranks` Map every tick even in LOBBY,
where nothing can change, and throughout the join stampede, where the core is
scarcest. Writing `rank` onto the player object and reusing the sort buffer took
the dirty pass to **~0,9ms**; the dirty flag makes the clean pass free.

For contrast, two things measured and deliberately *not* changed: the request hot
path (`playerView` + stringify at **0,0039ms**, about 0,65% of a core at 1.667
rps) and `src/names.js` (O(1) per join). Both were already fine.

### Finding 8 — clock sync turns the buzzer into a thundering herd

The fairness fix in finding 5 has a consequence. Every phone shares a synced
clock and deliberately schedules its last flush at `endsAt`, so the final flush
is not spread out at all — it is 5.000 requests released on the same millisecond.

This one took two tries to measure. A first A/B suggested the unspread herd was
harmless (landing 1.488ms in, 12ms inside the old fixed 1.500ms window, nothing
lost). That result was an artifact: the load generator's HTTP agent was capped at
`maxSockets: 256`, so it was dribbling out the very herd it was supposed to fire.
With the cap lifted:

| Buzzer behaviour | Drain | Credited | Refused | Loop lag across the buzzer | RSS |
|---|---|---|---|---|---|
| Unspread, fixed 1.500ms window | 2.238–2.798ms | 3.162–3.662 | **1.339–1.839** | **166–1.199ms** | 144–180MB |
| Spread, adaptive 3.834ms window | 2.300ms | **5.001** | **0** | 1ms | 95MB |

Reproduce either side with `npm run check:load` and `LOAD_SPREAD=0 npm run
check:load`.

So roughly **a quarter to a third of the room silently loses its last batch** —
the exact unfairness `graceMs` exists to prevent, reintroduced by the mechanism
meant to fix it. Two changes, both needed:

- The window sizes itself to the roster at `start()`:
  `clamp(minGraceMs, players / requestBudgetRps × 1000 + lateArrivalMs, maxGraceMs)`.
  At 5.000 that is 3.834ms; a small room still gets 1.500ms.
- Each phone spreads its final flush over `min(tapIntervalMs, graceMs × 0.6)`.
  Taps are credited by when they were *made*, not when they arrive, so spreading
  costs nothing but suspense. The rAF render loop is separate from the network
  loop, so the button still flips to ENDED exactly at `endsAt`.

**A note on measuring this.** An in-flight-request gauge was added to the
heartbeat first, to watch the 1000-concurrency cap of finding 4 directly. It is
useless here and was removed: every handler on this server is synchronous, so
Express is never inside two requests at once and the gauge printed `1/1000` while
the server was refusing 1.339 taps. The backlog lives in the kernel accept queue,
which userland cannot see. **Event-loop lag is the metric that catches a herd**
(1.199ms vs 1ms above), which is why the heartbeat leads with it.

## What changed

1. **Removed the redundant `game.tick()` from `GET /state`.** The 100ms loop
   already advances the phase machine; `/state` is now a pure read. Cost: state
   can be up to 100ms stale, which is irrelevant for a 3-second countdown.
2. **Server-driven adaptive cadence.** The server knows the player count, so it
   computes a tap interval against a request budget and publishes `tapIntervalMs`
   in every response. Small rooms stay snappy, large ones automatically back off.
   No hardcoded compromise, no redeploy to change scale.
3. **End-of-round grace window.** Taps arriving up to `graceMs` after `endsAt` are
   still credited — they were made before the buzzer, the phone is just far away.
4. **Deferred winner reveal.** Because late taps can still land, the champion is
   not computed at `endsAt` but at the end of the grace window (`settled`). The big
   screen shows a brief settling beat, then reveals. This prevents a visible
   champion change, and reads as suspense rather than a bug.
5. **Client-side fairness fixes.** RTT-compensated clock offset (min-RTT sample,
   re-synced each round); COUNTDOWN→RUNNING now transitions off the local synced
   clock rather than waiting for a poll; `onTap` is gated on the local synced clock
   so everyone stops at the same instant; and the loop tightens near the buzzer so
   a final flush lands exactly at `endsAt`.

6. **Text assets pre-compressed at boot and revalidated, not re-downloaded.**
   gzip + brotli built once into memory; `no-cache` + ETag so a reload costs a
   304 instead of 27,9K, while a redeploy still lands instantly.
7. **`_recount()` only when the leaderboard actually changed**, with `rank`
   written onto the player object instead of into a per-tick Map.
8. **The buzzer herd is spread and the grace window sizes itself** to the roster
   (finding 8).
9. **Guard rails for a single instance.** One in-flight request at a time per
   phone (tap and poll each) with an AbortController timeout, so a server hiccup
   cannot let phones stack requests without bound; `uncaughtException` /
   `unhandledRejection` handlers keep the process alive, because with min=max=1
   this process *is* the game and its replacement starts empty; and a heartbeat
   log line (`phase players taps rps conns lag_max rss sse`) so the event is not
   flown blind.
10. **`adminToken` is no longer returned by `/config`.** That endpoint is public,
    so anyone in the room could read it and reset the round. The host types it
    once per laptop and the browser remembers it.

Together these let a single instance handle 5.000 players. At 5.000 players and
2.000 req/s the server measured p50 1.8ms / p99 68ms with zero errors.

The end-to-end run after all of the above, at 5.000 players over a 20s round:
**38.142 requests, 0 errors, p50 0,8ms, p99 6,8ms**; join burst 5.000 in 1,7s
(2.995/s); steady-state loop lag 1–3ms and 95MB RSS; **5.001 of 5.000 final
flushes credited, 0 refused.**

## Operating guidance

- **Region.** For a South-America-heavy audience, `us-central1` is the wrong
  choice; `southamerica-east1` serves that bulk at a fraction of the latency and
  penalizes only the minority. For a genuinely global audience no region is kind
  to everyone, and the fairness fixes above matter more than region choice.
- **CPU.** `--cpu 2` for latency stability. Beyond that is wasted money on Node.
- **Memory.** Leave at 512Mi. 118 MB is the observed working set at 5.000 players.
- **Static assets.** Now pre-compressed and revalidated, which takes the lobby
  burst to ~41 MiB. Moving `index.html`, `theme.css`, and the fonts behind a CDN
  would remove the rest along with two thirds of the request count; that is an
  infrastructure change, not a code one, and it has not been done.
- **Concurrency.** Keep `--concurrency 1000`. Remember it is a cliff.
- **Watch the heartbeat, and watch `lag_max` first.** Sustained lag above ~50ms
  means the loop is losing. `conns` is open sockets, not in-flight requests —
  useful as a fan-in signal, but it is not the concurrency counter Cloud Run
  enforces against, and nothing in the process can see that one.
- **Residual risk, accepted.** All state is one in-memory `Map`. The crash guards
  keep the process up through an unexpected throw, but an instance *restart*
  mid-round still loses every score. Surviving that means external state, which
  is a different architecture.

## If you need more than this

The ceiling here is Node's single thread. A Go prototype of the same hot path
(stdlib `net/http` + `encoding/json`, same payload, same 100ms sort) was
benchmarked against the Node server with an identical generator:

| Runtime | Cores | Throughput | Server CPU | p50 | p99 |
|---|---|---|---|---|---|
| Node | 1 | 3.528 req/s | 100.0% (pegged) | 50.1ms | 75.1ms |
| Go | 1 | **20.313 req/s** | 97.0% (pegged) | 9.4ms | 23.7ms |
| Go | 2 | ≥23.528 req/s (generator-limited) | 153.2% | 7.4ms | 26.8ms |

Both single-core rows are genuinely saturated, so ~5.8× per core is real. The CPU
column is the structural difference: Go reached 153% where Node cannot exceed
~107% at any allocation.

That would buy back the 150ms cadence at 5.000 players, which is the honest fix
for the buzzer fairness problem rather than the grace window. It is worth doing
only if you want 150ms responsiveness at that scale, or you are targeting well
beyond 5.000 players. It does not lift the 1000-concurrency cap, which is a
platform limit. And it introduces a bug class that cannot exist today: Node's
single-threaded loop makes `player.count += n` atomic for free, whereas real
parallelism requires atomics or locks, with the leaderboard snapshot as the
delicate part.
