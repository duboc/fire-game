# Sequência bug hunt — root causes, fixes, evidence

This document records the bugs found in `src/batucada.js` and its clients
during a dedicated review pass, why each one happened, how it was fixed, and
the evidence that the fix actually works. Numbers here are measured or
derived, not guessed — same standard as `docs/SCALE.md`.

Both bugs below were found the same way: reading the phase machine and the
client clock code line by line and asking "what has to be true for this to be
safe, and is it actually true everywhere?" — not by fuzzing, not by load
testing. The second one started as a one-line report from live testing
("a tela apareceu em tempos diferentes… tempos distintos pra cada usuário")
and was then reproduced and proven analytically before shipping a fix, rather
than patched from a guess.

## Bug 1 — the bonus flash could vanish inside a single server tick

**Found by**: code audit of `_advance()`, not observed live.

### The code

`_advance()` drives every phase transition in the engine as a sequence of
independent `if` blocks, deliberately not `else if` — that is what lets a
zero-duration phase resolve within a single call, the same pattern
`src/game.js` uses for its own grace window. Before this fix, the bonus
round's two transitions were written the same way:

```js
if (this.phase === PHASE.BONUS_ARM && now >= this.bonusArmEndsAt) {
  this.phase = PHASE.BONUS_HIT;
  this.bonusHitStartsAt = now;
  this.bonusHitEndsAt = now + this.bonusHitWindowMs;
}
if (this.phase === PHASE.BONUS_HIT && (now >= this.bonusHitEndsAt || this._allSubmitted())) {
  // ... grade everyone, this.phase = PHASE.REVEAL
}
```

### Root cause

The `if`-sequence pattern is safe exactly when nothing can be submitted
before a phase opens. That holds for every other phase pair in the file —
`RECALL`'s own `_allSubmitted()` can't be true the instant it's entered,
because submissions are only accepted while the phase is already `RECALL`,
and `submitted` was just reset to `false` for everyone.

The bonus round breaks that assumption on purpose: tapping during the
`BONUS_ARM` suspense **is** a legal action — it's the "jumped the gun" burn —
and it sets `player.submitted = true` right then, during `ARM`, before `HIT`
even exists yet.

So: if every player in the room burned their start during the suspense, then
the moment `now >= bonusArmEndsAt` fired, the first `if` flipped the phase to
`BONUS_HIT` — and the *second* `if`, evaluated immediately after in the same
`_advance()` call, saw `phase === BONUS_HIT` (just set) **and**
`_allSubmitted() === true` (everyone burned earlier), so it fired too. Both
transitions collapsed into one call. `tick()` returns `publicState()` only
after `_advance()` fully returns, so the server never broadcasts an
intermediate `BONUS_HIT` frame — the color was chosen, graded against, and
discarded, entirely inside one 100ms tick.

### Impact

The screen would jump straight from the "⚡ REFLEXO!" suspense to the reveal,
having never shown which color the room was supposed to react to. Silent and
undetectable from the outside (no error, no crash) — the room just never
learns the answer. Most likely with small rooms (a handful of fast players
all reacting to the suspense itself rather than waiting for the flash), which
is exactly the shape of a rehearsal or a small pilot event.

### Fix

```js
if (this.phase === PHASE.BONUS_ARM && now >= this.bonusArmEndsAt) {
  this.phase = PHASE.BONUS_HIT;
  this.bonusHitStartsAt = now;
  this.bonusHitEndsAt = now + this.bonusHitWindowMs;
} else if (this.phase === PHASE.BONUS_HIT && (now >= this.bonusHitEndsAt || this._allSubmitted())) {
  // ...
}
```

`else if` guarantees at most one of the two transitions fires per call.
Entering `BONUS_HIT` and closing it are now always at least one tick (100ms)
apart, so the color is always broadcast at least once before the reveal.

### Verification

- Test-first: a new test, *"the flash still gets its own tick even if
  everyone already burned during the suspense,"* has two players burn their
  start during `ARM`, then asserts the engine still passes through
  `BONUS_HIT` — with `bonusColor` published — before reaching `REVEAL`.
  Confirmed **failing** against the old code first (`actual: 'reveal',
  expected: 'bonus_hit'`), then fixed.
- 28/28 engine tests, 83/83 across the whole suite, 180/180 HTTP contract
  assertions, full Playwright end-to-end re-run — all green.
- Manual edge case added to `docs/BATUCADA_TEST_PLAN.md` §3 for live
  confirmation on a real room: *"Everyone jumps the gun on the bonus."*
- Shipped in commit `c6e11d4`, live as revision `tap-race-00028-zzp`.

## Bug 2 — the phone's clock estimate was biased by each phone's own latency

**Found by**: live testing, reported by the user; confirmed and fixed
analytically.

### The report

> "eu senti testando que a tela apareceu em tempos diferentes com tempos
> distintos pra cada usuario"

Translated: the shared moments — the 3·2·1 countdown, the recall timer —
felt like they landed at different real-world instants depending on who was
watching, when they should have felt simultaneous.

### The code

`public/batucada/phone.html` estimated the server's clock like this:

```js
const s = await r.json();
if (typeof s.serverNow === 'number') clockOffset = s.serverNow - Date.now();
```

with the comment: *"Rough offset only — used for a cosmetic
countdown/progress bar, never to gate scoring… Full RTT compensation buys
nothing here."* That reasoning is correct about **fairness** (grading really
is keyed off the server's own clock at the moment `/batucada/recall` lands,
never off what the phone thinks the time is) and wrong about **feel** — the
countdown overlay and the recall progress bar are rendered directly from this
same `clockOffset`, once per animation frame, and nothing about "cosmetic"
makes a biased estimate look synchronized.

### Root cause

`serverNow` is a timestamp the server stamped *before* the response finished
traveling back across the network. By the time the phone reads it at `t1`,
real server time has already advanced by roughly one-way network delay —
call it `owd`. The naive formula computes:

```
clockOffset = serverNow − t1  ≈ −owd  (instead of 0)
estServerNow() = Date.now() + clockOffset  ≈ trueServerNow − owd
```

The phone underestimates the server's clock by almost exactly its own
one-way latency — and since round-trip time is rarely symmetric in practice
but averages out close to `rtt/2` each way, the error tracks roughly half of
that phone's *own* round-trip time. A phone on bad wifi and a phone on good
wifi therefore compute two **different** estimates of the same real instant,
each biased by their own connection quality — precisely "tempos distintos
pra cada usuário."

### Why this shipped as "fine" the first time

The original design note weighed this against Tap Race's `index.html`, which
*does* do full RTT compensation, and judged the phone's version cosmetic
because scoring doesn't depend on it. True, but incomplete: the countdown
counting down together is not a cosmetic detail in a game whose entire
premise is a room sharing one moment of attention. The bar for "does this
need to be synchronized" should have been "is this rendered for more than
one person to compare," not "does it affect the score."

### Fix

Ported the exact NTP-style algorithm already proven in `public/index.html`
and already used by this game's own `public/batucada/screen.html`:

```js
let bestRtt = Infinity;
function syncClock(serverNow, t0, t1){
  const rtt = t1 - t0;
  if (rtt < 0 || rtt > 5000) return;                          // nonsense sample
  if (Math.abs((serverNow - t1) - clockOffset) > 5000) bestRtt = Infinity; // device clock jumped
  if (rtt > bestRtt) return;                                  // only keep the least-delayed sample
  bestRtt = rtt;
  clockOffset = serverNow + rtt / 2 - t1;                     // correct for one-way delay
}
```

`+rtt/2` is the fix in one term: it adds back the estimated one-way travel
time the naive version silently dropped, and keeping only the
least-delayed sample of all polls so far means one slow response can't drag
the estimate around later.

### Verification

A live two-phone Playwright race (one phone with an artificial 450ms
per-request delay, one clean) proved **too noisy over a 3-second countdown**
to be conclusive by itself — both versions happened to converge to matching
`GO!` readings by the end of that short window, with only transient
mismatches during the first second while samples were still arriving. That
noise is inherent to timing two independent headless browsers against a
finite number of 300ms polling cycles; it is not evidence either way. So
this was verified **analytically** instead, extracting the exact same
`syncClock` code and driving it with controlled, known latencies:

| Phone | Round-trip time | Naive offset error | Fixed offset error |
|---|---|---|---|
| Fast (good wifi) | 20ms | −10ms | 0ms |
| Slow (bad wifi) | 450ms | **−225ms** | 0ms |

Before the fix, two phones on the same countdown could disagree by up to
**215ms** (the gap between −10ms and −225ms) about what time it is — enough
to be felt, not just measured. After the fix, both converge to zero error
regardless of latency.

- Engine untouched — this is a client-only change, confirmed by the full
  unit suite passing unmodified (client JS has no automated unit coverage;
  Tap Race's own `syncClock` in `index.html` is likewise only verified via
  browser checks, not a numeric test, which this follows).
- Full Playwright end-to-end re-run green (join → countdown → rounds →
  bonus → champion).
- Shipped in commit `e0c19f6`, live as revision `tap-race-00029-7kd`.

## Where to look next

Both bugs lived at the same kind of seam: a piece of logic that was copied
correctly from a proven pattern (`Game`'s phase machine, `index.html`'s clock
sync) but had one precondition of that pattern quietly not hold in the new
context (the bonus accepts input before its own phase starts; the phone's
sync was judged non-critical when it fed something users compare against
each other). When extending this game further, the question worth asking
for any new timing- or phase-sensitive code is the same one that found both
of these: *what does this code assume is true, and is that assumption still
true here?*
