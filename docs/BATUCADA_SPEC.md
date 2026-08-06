# Batucada — a Simon Says companion to Tap Race

A second game, shipped **alongside** Tap Race (separate routes, separate engine,
separate client pages), not a replacement. Where Tap Race is a sprint — everyone
mashes a button for 30–60s and the leaderboard reorders continuously — Batucada is
paced: the room watches a sequence, then reproduces it from memory. Same live-event
shape (one Cloud Run instance, one big screen, phones as controllers, a host panel
driving rounds), different core loop.

Classic Simon Says: four colors light up in sequence, shown visually only (no
audio — see rationale below). An earlier pass themed this as a Brazilian
percussion circle (six named instruments instead of plain colors); see
"Revision: plain colors" at the end of this document for why that was dropped.

## Why this and not classic cumulative Simon Says

Classic Simon Says replays the *whole* growing sequence every round. For a live
room of 300+ people, that means round 10 opens with a 10-symbol replay before
anyone can act, and by then most of the room has usually already been eliminated
and is just watching. Batucada instead deals a **fresh sequence each round**, whose
length equals the round number. Difficulty still climbs — memorizing 8 fresh
symbols cold is hard — but every round's duration is bounded by that round's
length alone, not by the sum of every round before it.

Visual-only (no per-color sound) was chosen over audio cues because: mobile
autoplay restrictions make synced audio unreliable across hundreds of phones,
the project's "self-hosted everything" stance means shipping audio files, and a
room full of phones playing tones half a beat apart would be noise, not music.
A highlighted/glowing tile carries the same information without any of that.

## Phases

Reuses `LOBBY` and `COUNTDOWN` as Tap Race defines them (join, then a server-timed
3·2·1 before play starts). `RUNNING` is replaced by a loop of three phases that
repeats once per round; `ENDED` is the final game-over screen, not a single
window's result.

```js
export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  MEMORIZE: 'memorize',  // the screen lights the round's sequence
  RECALL: 'recall',      // phones collect taps
  REVEAL: 'reveal',      // who just got eliminated, how many remain
  ENDED: 'ended',
});
```

```
LOBBY -> COUNTDOWN -> MEMORIZE(1) -> RECALL(1) -> REVEAL(1)
                   -> MEMORIZE(2) -> RECALL(2) -> REVEAL(2)
                   -> ...
                   -> MEMORIZE(n) -> RECALL(n) -> REVEAL(n) -> ENDED
```

The sequence is generated **once per round, server-side**, and is the same for
every player — the whole room is shown (and must reproduce) one shared sequence,
the same way Tap Race's countdown is one shared, server-timed clock rather than
something each phone computes on its own.

## Timing constants (parallel to Tap Race's `DEFAULTS`)

| Name | Proposed value | Role |
|---|---|---|
| `symbols` | `['blue', 'red', 'yellow', 'green']` | alphabet; each symbol drawn uniformly at random |
| `totalRounds` | `10` | the game always runs exactly this many rounds (see Revision 2) |
| `symbolOnMs` | `900` | round-1 flash; shrinks by `symbolOnStepMs` (50) per round, floor `minSymbolOnMs` (450) |
| `symbolGapMs` | `500` | round-1 gap; shrinks by `symbolGapStepMs` (25) per round, floor `minSymbolGapMs` (250) — starts deliberately calm, ends quick |
| `recallBaseMs` | `1500` | fixed reaction/setup time added to every recall window |
| `recallPerSymbolMs` | `1200` | added per symbol in the round |
| `revealMs` | `2500` | how long REVEAL holds before the next round |
| `maxRounds` | `10` | defensive cap, see "End of game" below |

```
memorizeMs(round) = round * (symbolOnMs + symbolGapMs)
recallMs(round)   = recallBaseMs + round * recallPerSymbolMs
```

All tunable later the way Tap Race's own constants are (env-var overrides), not
fixed by this spec.

## Per-player state

Extends the identity Tap Race already assigns on `join()` (`id`, `name`, `emoji`,
`seq`, `locale` carry over unchanged):

```js
{
  alive: true,
  roundsCleared: 0,
  eliminatedRound: null,
  prefixMatched: 0,   // correct symbols in the current (or fatal) round
  elapsedMs: null,    // recall latency for that round — final tiebreak
  submitted: false,   // reset at the start of every RECALL
}
```

## Grading — the RECALL → REVEAL transition

Runs once, when `now >= recallEndsAt`, for every player still `alive`:

```
prefixMatched = length of the longest prefix where submitted[i] === sequence[i]
                (no submission at all ⇒ prefixMatched = 0)

if prefixMatched === sequence.length:
    roundsCleared = round        // full match: stays alive
else:
    alive = false
    eliminatedRound = round      // partial or no match: eliminated this round
```

`prefixMatched` and `elapsedMs` are kept from this grading step even for
eliminated players — they are what makes the final ranking a strict order instead
of a tie (see below).

## End of game and ranking

This is the part that needed resolving: elimination alone doesn't produce a
single winner when several players fail in the same round. The fix is to never
treat survival as binary on the leaderboard — every player gets a composite score
that produces a strict order almost always, and a fully deterministic one always.

Transition at the end of REVEAL:

```
aliveCount = number of players with alive === true

if aliveCount <= 1 or round >= maxRounds:
    phase = ENDED
    ranking = players sorted by:
        roundsCleared  desc,   // who got furthest
        prefixMatched  desc,   // within the same fatal round, who matched more before diverging
        elapsedMs      asc,    // still tied: who answered faster
        seq            asc     // final, deterministic tiebreak — same pattern as _recount()'s a.seq - b.seq
    winner = ranking[0]
else:
    round += 1
    sequence = freshSequence(round)
    phase = MEMORIZE
```

If `maxRounds` is reached with more than one player still perfect (very unlikely
with a real crowd, but not impossible), no special-case code is needed: those
survivors share the same `roundsCleared` and `prefixMatched`, so they fall
straight through to the `elapsedMs` tiebreak. The cap exists purely to bound the
segment's wall-clock length for the event, not to change how ranking works.

## Screen vs. phone split

Follows the precedent already set by Tap Race: the shared screen is the
spectacle, the phone is the input device.

- **MEMORIZE** — only the shared screen lights the sequence. The phone shows a
  passive "watch the screen" state, no input.
- **RECALL** — the phone shows a grid of the four colors; taps build a local
  `sequence[]` and auto-submit once its length reaches the round's length.
- **Eliminated** — the phone becomes a live spectator: it keeps polling
  `/state` and shows its own result ("out in round 6 — 4/6 correct") plus the
  live `aliveCount`, through to `ENDED`. It does not get its own end screen or
  drop out of the loop — everyone rides the same phases to the same finish, the
  same way Tap Race never removes a player from the room mid-round.

## Network contract

```
Phone   POST /join {locale}                     -> identity (unchanged from Tap Race)
        POST /recall {id, sequence:number[]}     -> {accepted, phase, timing}
        GET  /state?id=                          -> phase + timing + {alive, roundsCleared}
Screen  GET  /events (SSE)                       -> {phase, round, sequence (MEMORIZE only), aliveCount, top10, timing}
Host    POST /admin/start|reset                  -> unchanged trigger; start now begins round 1
Dash    GET  /metrics                            -> + aliveCount, current round
```

`/recall` replaces `/tap`: it is one POST per round, not a continuous batched
stream. That means none of Tap Race's adaptive-cadence machinery
(`tapIntervalMs`, the request-budget derivation) is needed on this path — request
volume is inherently gated by the round loop rather than continuous mashing.

## Files affected

A separate engine, not an extension of `Game` — the phase machine and state shape
diverge enough that folding both games into one class would make neither easy to
read. `names.js` is reused as-is for identity.

- `src/batucada.js` — new: `PHASE`, `DEFAULTS`, the `Batucada` class (grading,
  round generation, ranking), pure with respect to time like `Game` (every
  method that depends on "now" takes it as an argument).
- `src/server.js` — new routes under their own namespace, additive only; no
  existing Tap Race route changes.
- `public/batucada/` — new phone and screen pages; `/host` panel can likely be
  extended rather than rebuilt.
- `test/batucada.test.js` — unit tests for grading and ranking, contract test
  extension for the new routes.

## Open assumptions, confirmed

1. Batucada ships **next to** Tap Race — new routes and files, existing game
   untouched.
2. An eliminated player becomes a **live spectator** through to `ENDED`, rather
   than getting a separate end-of-run screen.

## Revision: plain colors instead of a percussion theme

The first version themed the six symbols as Brazilian percussion instruments
(Surdo, Pandeiro, Cuíca, Agogô, Tamborim, Reco-reco) with icons and Portuguese
labels on every tile. Played back, the theme made the *mechanic* harder to
read, not easier: recognizing and remembering an unfamiliar instrument name
added a layer of work on top of the actual task, which is just to remember a
position in a sequence. Classic Simon Says solved this decades ago by using
nothing but color.

Changed, additively (no route or file renames — only visuals and copy):

- `src/batucada.js`: `INSTRUMENTS` → `SYMBOLS`, now four plain color keys
  (`blue`, `red`, `yellow`, `green`) instead of six instrument names. Fewer
  options is itself part of the simplification — a 2×2 grid reads instantly,
  the way a 2×3 grid of icons with labels did not.
- `DEFAULTS.symbolOnMs`/`symbolGapMs`: 700/300 → 900/500. Slower on purpose —
  the whole point of this game next to Tap Race is cadence and attention, not
  reflexes, and the faster cadence read as "hurry up" rather than "notice
  this."
- `public/batucada/phone.html` and `screen.html`: tiles are solid color
  squares, no icon, no label. The user-facing name changed from "Batucada" to
  "Sequência" throughout the UI — routes, file names, and the `Batucada`
  class are unchanged internally, since renaming those would break nothing
  for a player but would churn every reference in this document and the
  server for no user-visible benefit.

## Revision 2: scoring instead of elimination, a fixed 10-round arc

Played again after the color simplification, the elimination model showed its
real problem: with a small room the game is over in one or two rounds — the
end condition `aliveCount <= 1` fires the moment one of two players misses.
The whole point of the game is a *building* memory challenge, which needs
guaranteed length. So elimination is gone entirely; the sections above that
describe `alive`/`eliminatedRound` are superseded by this one.

**The model now:** every player plays every round; the game always runs
exactly `totalRounds` (10). A miss costs the round's points, never the seat.

- Per-player score: `cleared` (rounds fully matched), `symbols` (cumulative
  matched prefix across all rounds — partial credit, so a player who got 7 of
  9 symbols outranks one who got 2), `elapsedTotalMs` (cumulative recall
  latency). Ranking: `cleared` desc → `symbols` desc → `elapsedTotalMs` asc →
  `seq` asc. Same strict-order guarantee the elimination tiebreak had.
- Not answering a round grades as prefix 0 **and** adds the full recall
  window to `elapsedTotalMs` — answering slowly must never rank better than
  answering at all.
- Difficulty ramps on two axes: sequence length (+1 per round, up to 10) and
  flash speed (`symbolOnFor(round)`/`symbolGapFor(round)`: 900/500ms in round
  1 shrinking 50/25ms per round to a 450/250ms floor in round 10 — late
  rounds are fast, never subliminal). The engine publishes the *effective*
  per-round speeds so the screen animates at exactly the pace the server
  timed.
- A latecomer joins as a normal player and simply scores zero for the rounds
  they missed — the spectator state is gone along with elimination.
- `SEQ_*` env vars (`SEQ_ROUNDS`, `SEQ_SYMBOL_ON_MS`, …) override the
  constants without a rebuild, for test harnesses and event-day pacing.

This also flushed out a latent client bug the elimination model had been
masking: the phone reset its input state (`submitted`, the tapped sequence)
per *game*, not per *round* — harmless when no two-player test room ever
survived to round 2, fatal the moment everyone plays all 10. Input state now
keys off the round number.

## Revision 3: perceptual pacing, 12 rounds, and the Reflexo bonus round

Three changes, all in service of attention rather than reflexes:

**The ramp now respects the eye.** Encoding a visual item into working memory
takes roughly 400–600ms of exposure — and this is a projector read from
across a room. The floor moved from 450/250ms to **550/300ms**, the game grew
to **12 rounds**, and the steps shrank (32/18ms per round) so the glide from
900/500ms reaches the floor exactly at round 12. The acceleration is felt as
a continuous tightening, never as a jump, and round 12 is fast but always
followable.

**No dead air.** RECALL (and the bonus window) now closes the moment the last
player has answered, instead of always sitting out the full window — a
round-12 window is ~16s, and a room that answered in 5 should not stare at a
frozen screen for the other 11. With stragglers the window still holds, so
nothing changes at scale; in an engaged room the pace tightens itself.

**Reflexo! — the mid-game bonus round** (after round 6; `SEQ_BONUS_AFTER=0`
disables). A palate cleanser that tests the opposite skill of memory:

1. `BONUS_ARM` — the screen holds a suspense beat of *unpredictable* length
   (2–5s, drawn from the injected rng). The phone grid is live, which is the
   trap: tapping during the suspense **burns your start** — locked out, zero
   points. The color and the arm deadline are deliberately withheld from
   `publicState` during this phase, so a phone reading `/batucada/state`
   cannot script the reflex; the screen learns the color on the same phase
   flip the room does.
2. `BONUS_HIT` — ONE tile lights. Tap that color on the phone: points scale
   with speed (`bonusMaxPts` 10 down to 1 across the 2.5s window). Wrong
   color or no tap: zero.
3. The reveal (flagged `bonusReveal` in both views) shows how many reflexes
   hit, then the memory rounds resume where they left off.

Bonus points land in `symbols` only — never in `cleared` — so memory stays
the primary ranking axis and the bonus spices the score without letting a
fast thumb outrank a good memory.

## Revision 4: slower still, a lead-in breath, and an unmissable flash

Played on the live deploy, Revision 3 still failed the only test that
matters — "eu não to vendo a tela piscando". Three fixes, all client-visible:

- **The whole band slowed again**: 1200/700ms in round 1 gliding to a
  750/450ms floor at round 12 (steps 41/23ms). Round 1 is a deliberate 1,9s
  per symbol; even round 12 gives 1,2s.
- **`memorizeLeadInMs` (1200ms)**: a breath between "the stage appeared" and
  the first flash. Without it the first symbol fired *during* the phase
  transition and was half-seen — on round 1, whose whole memorize pass lasted
  under 1,5s, that alone explained "I never saw it blink". The engine adds it
  to the memorize window and publishes it; the screen subtracts it before
  animating.
- **The flash itself got loud**: at rest the tiles sit at 22% opacity; the
  lit one pops to 122% scale with a thick white ring and floods its own color
  as glow (contrast carries further than brightness on a washed-out
  projector). A row of progress dots under the tiles fills as the sequence
  advances, so you always know how many symbols have gone by.

## Revision 5: host-picked round count, surprise round always in the middle

The slower pacing made a 12-round game genuinely long (~5 min), which is
sometimes exactly right and sometimes too much for the slot. So the length
became the host's call, and the bonus stopped being tied to a fixed round:

- `/batucada/admin/start` accepts `{ totalRounds }`; the host panel offers
  6/8/10/12 (default 8) next to the Start button, mirroring Tap Race's
  duration selector. Clamped server-side to 1–30 (`Batucada.MIN_ROUNDS`/
  `MAX_ROUNDS`) — a typo guard, not an anti-cheat, same as `Game`'s duration
  clamp. `reset()` forgets the per-game pick.
- `bonusAfterRound` default changed from `6` to `null` = **auto**: the
  surprise round always plays, halfway through whatever length was picked
  (`floor(totalRounds/2)`) — after round 3 of 6, round 4 of 8, round 6 of 12.
  `0` still disables it and a positive value still pins it (tests, env).

## Revision 6: the crowd on the screen

Three additions that put the room itself on the projector, none of which
touch the sacred phase (MEMORIZE stays silent):

- **Answer pulse (RECALL).** The engine keeps an incremental
  `submittedCount` per round; the screen renders "34 de 120 já responderam"
  with a filling progress bar. RECALL was the screen's deadest phase — now
  it is the room watching itself finish, and the bar filling up is also the
  early-close approaching.
- **Torcida (crowd emojis).** `POST /batucada/react {id, r}` — four emojis
  (🔥 👏 😱 ❤️, order shared by both pages), throttled per player (250ms)
  and blocked during `memorize`/`bonus_arm`/`bonus_hit`. Deliberately NOT
  engine state: the counts live in server.js, ride the next SSE frame as
  deltas (`reactions: [n,n,n,n]`) and are dropped when no screen is
  connected. The screen floats them up Instagram-live style, clamped at 24
  per frame so a big room reads as a shower, not a wall. The phone shows the
  reaction bar only when tapping it can't hurt anyone's focus: lobby,
  reveal, ended, and recall *after your own answer is in*.
- **Spotlights (REVEAL).** Zero new input — the engine derives, per round:
  the fastest correct answer (`lastElapsedMs`, ties to the earlier joiner)
  and the longest active streak of cleared rounds (2+; a 1-round streak is
  not news). Published as `spotlight` during REVEAL only, wiped at the next
  round. The bonus reveal spotlights the fastest reflex the same way.

### Revision 6.1: presence tuned by feel

Played again; three adjustments, all about how alive the room feels:

- **Reactions fly through the center.** The emoji spawn band narrowed from
  the full width to 32–68vw and the glyphs grew — the middle of the screen
  is where every eye already is, so that is where the crowd shows.
- **The reveal breathes.** `revealMs` 2.500 → 4.500ms, and the screen
  staggers the blocks in (count → detail → spotlights → standings, ~2s of
  entrance beats) — unhurried, not waiting.
- **Answers are visible people.** Each landing answer pops that player's
  animal emoji up from the pulse bar (`pops` on the SSE frame, drained per
  broadcast like reactions, clamped 12/frame). Retries never double-pop:
  the server keys on `submittedCount` actually moving.
- **The torcida bar earns its place.** Big glowing buttons with an entrance
  animation and an explicit call-out ("Manda uma reação pro telão 👇") in
  the lobby and after answering — it is the player's only voice between
  answers, so it stopped whispering.

### Revision 6.2: the round has a hero

- **Hero card on every reveal.** The fastest correct answer owns the round:
  huge animal emoji, display-size name, the deed underneath ("⚡ resposta
  mais rápida — 0,9s"). When nobody cleared, the card flips to a playful
  "Essa pegou todo mundo! 😅" — the beat lands either way.
- **Climber spotlight.** The engine snapshots everyone's rank at the start
  of each memory round (`prevRank`); whoever cleared AND rose past someone
  becomes `spotlight.climber` ("📈 Subiu N posições"). Ties go to the bigger
  jump, then the earlier joiner. The bonus never crowns a climber — it
  shuffles points, not the narrative.
- **Confetti every round.** Any round somebody cleared gets a 120-particle
  burst (the finale keeps its full 280-rain). Guarded once per reveal — the
  SSE frame repeats 10×/s and a burst must never become a hose.
- Standings/spotlight chips got a full size bump for the back of the room.

### Revision 6.3: the instruction owns its moment

First-timers were meeting the flash before they knew what to do with it.
Both action phases now open with a big, centered, blinking cue that owns the
screen until the action starts, then hands off:

- **MEMORIZE**: "👀 Rodada N — DECORE!" blinks through the lead-in (bumped
  1.200 → 1.600ms so it can actually be read), then swaps for the small
  round tag the instant the first tile lights.
- **BONUS_ARM**: "⚡ REFLEXO!" blinks over the rule line ("quando uma cor
  acender, TOQUE NELA no celular — tocar antes queima a vez!") for the whole
  suspense; on the flash it snaps to a static green "AGORA!".
- **Phone**: the memorize card pulses ("OLHE PARA A TELA — decore a
  ordem!") and the bonus instruction line turns yellow and pulses while the
  grid is armed.

The blink is a soft opacity/scale pulse (1,1s), not a hard strobe — urgency
without assault, and `prefers-reduced-motion` still kills all of it via the
global rule in theme.css.

## Bug fix: the bonus flash could vanish inside a single tick

Found by code audit, not by play: `_advance()` checked `BONUS_ARM -> BONUS_HIT`
and `BONUS_HIT -> REVEAL` as two independent, sequential `if`s in the same
method. That is deliberate everywhere else in the file — it is what lets a
zero-duration phase resolve within one call — but it has a precondition that
quietly broke for this one pair: nothing can be submitted before a phase
opens, *except* the bonus, where an "early" tap during the ARM suspense
already counts as a submission.

If every player jumped the gun during ARM, `_allSubmitted()` was already true
the instant the code flipped to `BONUS_HIT` a few lines later in the *same*
call — so the second `if` fired too, and the phase advanced straight to
`REVEAL` without ever being returned from `_advance()` as `BONUS_HIT`. Since
the server only broadcasts whatever `publicState()` looks like *after*
`_advance()` returns, the color the room was supposed to react to was
computed, graded against, and discarded, all inside one 100ms tick — the
screen would jump from suspense straight to the reveal.

Fixed by making the pair `if / else if`: at most one of the two transitions
can fire per call, so `BONUS_HIT` is always observable — and therefore always
broadcast — for at least one tick before it is allowed to close. Covered by a
unit test that has every player burn their start and asserts the engine still
passes through `BONUS_HIT` with the color published before reaching `REVEAL`.
