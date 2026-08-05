# Sequência — manual test plan (post-deploy)

(Internally the code and routes still say "Batucada" — `/batucada/*`,
`src/batucada.js` — only the player-facing name changed. See
`docs/BATUCADA_SPEC.md`, "Revision: plain colors instead of a percussion
theme".)

Automated coverage already passing before this plan starts: 65 unit tests
(`npm test`), 173 HTTP contract assertions (`npm run check:contract`), and one
Playwright end-to-end pass (host login → round → elimination → champion). This
plan is what those can't cover: real phones, real network, real projector,
one person's judgment about whether it *feels* right.

**Live URL**: `https://tap-race-a4er43fhfq-uc.a.run.app` (revision
`tap-race-00017-tbq`). Devices needed: 1 laptop (host + screen, or two
machines), 2+ phones on real mobile data or venue wifi (not the same LAN as
the laptop, to catch real latency).

## 0. Before anything: clear the room

Any prior smoke test or rehearsal leaves players in the lobby. Open `/host`,
log in, hit **Sequência → Clear the room**. Do this before every real session
anyway — same habit as Tap Race.

- [ ] `/host` → Sequência panel shows `LOBBY`, `Alive 0 / 0` after reset.

## 1. Golden path (2–3 phones)

- [ ] Scan the QR on `/batucada/screen` (or open `/batucada` directly) from
  each phone. Each gets a name within ~1s, no login, no typing.
- [ ] `/host` → **Start (3·2·1·decore)**. Screen counts down in sync with the
  phones (no visible drift between devices).
- [ ] Round 1 (screen only): one colored tile lights up. Phones show "Olhe
  para a tela" — confirm the phone does **not** also show the sequence.
- [ ] Recall opens on phones: a 2×2 grid of 4 colors. Tap the one that lit up.
- [ ] Correct tap → phone immediately shows "Isso mesmo!" without waiting for
  the round to formally end.
- [ ] Round 2+: sequence is new and one symbol longer each round. Confirm you
  actually have to remember it — the screen doesn't replay earlier rounds.
- [ ] Deliberately tap wrong on one phone in some round → that phone shows
  "Você caiu na rodada N — X/N certos" and switches to a live spectator view
  (`aliveCount` ticking on its own, no more grid).
- [ ] Game ends when one player remains (or nobody can be trusted to lose —
  see §3). Screen shows confetti + champion + a top-5 podium. The champion's
  phone shows "Você é o campeão!".
- [ ] `/host` Sequência panel reflects `ENDED` and the correct alive/total the
  whole time, without needing a page refresh.

## 2. Timing & feel (the actual point of this game)

- [ ] Countdown-to-memorize handoff has no visible stutter or double-flash on
  the screen.
- [ ] The flash cadence (900ms on / 500ms gap by default) reads as calm and
  deliberate, not a hair-trigger reflex test — and is comfortably readable
  from across a room-sized distance, not just close up.
- [ ] The recall window feels fair for the round length — round 1 (1 symbol)
  isn't a hair-trigger, and by round 5+ (5 symbols) the timer doesn't run out
  before an honestly-remembering player can finish tapping.
- [ ] On a real (non-wifi) phone connection, tapping still feels responsive —
  no multi-second lag between tap and visual feedback on the phone itself
  (that part is local/optimistic and shouldn't depend on network at all).

## 3. Edge cases

- [ ] **Mid-game join**: while a round is in progress, join with a new phone.
  It should land as a spectator immediately (`aliveCount`/`total` visible, no
  grid, no "watch the screen" state) — never dropped into an in-progress
  round.
- [ ] **Phone reload mid-game**: reload a phone's tab mid-round. It should
  resume its own identity and current status (alive/eliminated) rather than
  re-joining as a new player.
- [ ] **Kill wifi on a phone for a few seconds, then restore it**: the phone
  should recover on its own (self-heal) rather than getting stuck.
- [ ] **Double-tap / fast double submit**: rapidly tap two different tiles as
  your very last symbol before the grid should already be locked. Confirm
  only the first completed sequence is graded (no way to "take back" a
  submitted answer).
- [ ] **Reset mid-round**: hit **Clear the room** while a round is live.
  Screen and phones should all fall back to an empty lobby; a phone that
  reloads afterward gets a brand-new name.
- [ ] **Everyone fails the same round simultaneously** (deliberately have all
  active phones answer wrong in the same round): confirm the game still ends
  cleanly with one ranked winner (whoever matched more symbols / answered
  faster), not a tie or a stuck screen. This is the scenario the whole
  ranking design (`roundsCleared` → `prefixMatched` → `elapsedMs` → `seq`)
  exists for — worth deliberately forcing at least once.
- [ ] **Two games at once**: with Sequência mid-round, also start a Tap Race
  round from `/host`. Confirm the two don't interfere (separate counters,
  separate screens, one shared login).

## 4. Regression: Tap Race still works

Nothing in this deploy should have touched Tap Race's own behavior — confirm:

- [ ] A normal Tap Race round on `/`, `/screen`, `/host` still runs
  start-to-finish (countdown → tapping → leaderboard reorders live → champion
  + confetti).
- [ ] `/dashboard` still loads and shows live numbers.
- [ ] The admin password/session still works for both games from one login.

## 5. Sign-off

- [ ] All of §1 and §4 pass without intervention.
- [ ] At least one edge case in §3 was deliberately forced, not just assumed.
- [ ] Screen is legible and the flow makes sense to someone who has never
  seen this game before (grab a colleague if possible — you already know how
  it works, which is exactly why your judgment about "is this clear" is the
  least reliable in the room).

If §1–§4 all pass: the deploy is ready for a real room. If anything in §2 or
§3 feels off, it's a tuning problem (the constants in `src/batucada.js`'s
`DEFAULTS`), not an architecture problem — adjust and redeploy before the
event, not during it.
