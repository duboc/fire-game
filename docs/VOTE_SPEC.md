# Votação ao vivo — a live voting companion to Tap Race

A third app in the same process, shipped **alongside** Tap Race and Sequência
(separate routes, separate engine, separate pages), not a replacement. The room
scans a QR, searches a list of ~100 names, and votes. The big screen shows the
vote moving in real time; an admin page configures the names and the time.

Same live-event shape as the other two: one Cloud Run instance, in-memory state,
self-hosted assets, phones as controllers, SSE to the big screen, the same admin
password and session cookie.

## Product decisions

| Decision | Choice |
|---|---|
| Vote rule | **One vote per phone, changeable until time runs out.** Changing moves the vote: −1 old, +1 new. |
| Identity | Anonymous. Server-issued voter id kept in `localStorage`, self-healing like `/tap`. |
| Anti-fraud | None beyond one id per browser — a private tab can vote again. Same stance as Tap Race ("no anti-cheat"). |
| Live counts on phones | **No.** Phones search and vote; the counts live on the big screen (the climax stays there, and the phone avoids a bandwagon effect). |
| Language | pt-BR UI, like Sequência. |
| Name list size | Up to 300 names (100 is the target), each 1–60 characters. |
| Voting time | Admin picks per round: presets 1 · 2 · 5 · 10 · 15 min, or custom (30 s – 4 h). Default 5 min. |
| Seed list | 100 sample names baked in, so the app works the moment it boots. |

## Pages and routes

| Path | Who | What |
|---|---|---|
| `/vote` | phones | search + vote |
| `/vote/screen` | projector | live leaderboard, timer, QR, live vote feed |
| `/vote/admin` | host | title, names, duration, open/close/reset, full live results |

All three are precompressed at boot like the existing pages. The search logic is
`/vote/search.js`, a plain ES module shared by the phone, the admin page and the
unit tests.

API:

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /vote/candidates` | – | `{listVersion, title, candidates:[{id,name}]}`; ETag = listVersion, so repeat loads are a 304 |
| `GET /vote/state?id=` | – | phone view: `{phase, roundId, listVersion, endsAt, now, myVote}` |
| `POST /vote/cast` | – | `{id?, candidateId, listVersion}` → `{id, myVote, phase, …}` |
| `GET /vote/events` | – | SSE for screen + admin: full public state |
| `POST /vote/admin/config` | admin | `{title, names[]}` — only when voting is not open |
| `POST /vote/admin/open` | admin | `{durationMs}` — starts a fresh round (zero votes) |
| `POST /vote/admin/close` | admin | ends the round now |
| `POST /vote/admin/reset` | admin | back to setup, votes cleared, names kept |

Admin auth reuses `checkAdmin` and the `tr_admin` session cookie — logging in on
`/host` also logs you in here, and vice versa.

## Engine — `src/vote.js`

A pure, time-injected class (`Vote`), same style as `game.js` / `batucada.js`, so
the whole thing is unit-testable without a network.

**Phases:** `setup → open → closed`. `open` can start from `setup` or `closed`;
`close` and the deadline both end it; `reset` returns to `setup`.

**State:** `title`, `candidates[]` (id = index within the current list),
`listVersion` (bumped on every config save), `phase`, `roundId`, `endsAt`,
`votes: Map<voterId, candidateId>`, `counts[]`, `total`, plus a small ring of
recent `+1` events for the screen's live feed.

**Rules:**
- `setNames(title, lines)` trims, collapses whitespace, drops blank lines, then
  **rejects** (does not silently fix) the save if any name is over 60 chars, if
  there are fewer than 2 or more than 300 names, or if two names are equal after
  accent/case folding (two "Ana Souza" would make votes ambiguous). The error
  names the offending lines. Allowed only outside `open`. Clears votes and
  returns to `setup`.
- `cast(voterId, candidateId, listVersion, now)` is accepted only while `open`
  and `now < endsAt`. A `listVersion` mismatch is rejected as `stale_list` (the
  phone refetches names — guards against voting by index into a list the admin
  has since edited). Re-voting the same candidate is a no-op; a different one
  moves the vote. `counts` and `total` stay consistent by construction.
- `tick(now)` closes the round at the deadline. The existing 100 ms loop drives
  it — one clock for all three apps.
- Ranking: votes desc, then name (pt-BR collation). Equal top counts are a tie,
  and the screen says so.
- The voter id set is capped (100.000) so a script minting ids cannot grow
  memory without bound.

## Live updates

- **Screen + admin: SSE** at `/vote/events`, broadcast from the tick loop only
  when something changed (a vote, a phase change, a config save) — at most 10
  frames/s — plus a `:` comment every 15 s so an idle stream stays open. A frame is the full public
  state, candidates included: ~100 names + counts is ~2–3 KB, sent to a handful
  of screens, so a delta protocol isn't worth its sync bugs.
- **Phones: polling, not SSE.** Cloud Run caps an instance at 1.000 concurrent
  connections; a room of phones each holding an SSE stream would hit it. Phones
  poll `/vote/state` every 4 s ±1 s jitter (immediately on `visibilitychange`),
  and every `cast` response carries the same view, so a voter never waits on a
  poll to see their own vote. The countdown runs locally from `endsAt` and a
  server-clock offset; the phone shows "encerrada" at zero without waiting.

## Phone — `/vote` (mobile first, the search is the star)

Layout: sticky header (title + countdown), sticky search field, then the list.
`100dvh`, safe-area insets, rows ≥ 56 px, body text ≥ 16 px (no iOS zoom on
focus), one-handed reach for every action.

**Search** (`public/vote/search.js`, pure, instant on every keystroke — no
debounce needed at this size, < 1 ms for 300 names):

- **Folding:** accents, case, and punctuation are ignored — `joao` finds
  "João", `davila` finds "D'Ávila", `anasouza` finds "Ana Souza".
- **Ranked tiers**, best first:
  1. full-name prefix — `ana s` → "Ana Souza"
  2. every query word prefixes a different name word, any order — `souza ana`, `sou an`
  3. initials — `as` → "Ana Souza", `jps` → "João Pedro Silva"
  4. substring anywhere — `uza`
  5. typo-tolerant — each query word within 1 edit (4–7 letters) or 2 edits
     (8+) of a name word, transpositions counting as one — `suoza` → "Souza",
     `mariane` → "Mariana"

  Ties within a tier break on earlier match position, then shorter name, then
  alphabetical.
- **Highlighting:** matched letters are highlighted in the original spelling —
  ranges are mapped back through the folding, so accents never shift them.
- **Empty query:** the full list, alphabetical, sticky letter headers, and an
  A–Z scrubber rail on the right edge (drag to jump, like phone contacts).
- **No results:** "Nenhum nome encontrado" plus up to 3 "Você quis dizer…?"
  suggestions by edit distance.
- Result count ("12 de 100"), a clear (×) button, and Enter picks the top hit.
- Input: `type=search`, `enterkeyhint=search`, autocorrect / autocapitalize /
  spellcheck off. No autofocus — the list shows first; the keyboard opens on tap.

**Voting:** tap a name → a bottom sheet ("Votar em **Ana Souza**?" or "Trocar
seu voto de X para Y?") with one big confirm button; the keyboard is dismissed
when the sheet opens. On success: a check animation, a short vibration where
supported, and a pinned "Seu voto: Ana Souza ✓" card at the top of the list
("toque em outro nome para trocar").

**Phases:** `setup` — browse and search, the vote button reads "a votação ainda
não começou". `open` — votes go through. `closed` — "Votação encerrada · veja o
resultado no telão", with your vote still shown.

**Failures:** a failed cast keeps the sheet open with "Não foi possível votar —
tentar de novo". `stale_list` refetches the names and asks again. A cast that
lands after the deadline shows "encerrada".

## Big screen — `/vote/screen` (16:9 projector)

- **setup:** title, a big QR to `/vote`, "A votação começa em breve", name count.
- **open:**
  - main column — live **top 10**: rank, name, animated bar, count, %.
    FLIP-animated reordering (same technique as `/screen`); a row pulses when
    it gains a vote.
  - right rail — big countdown, total votes (= voters, one each), the QR, and a
    **live feed**: the last ~8 names that just received a vote (`+1 Ana
    Souza`), sliding in. This is the "who is being voted right now" view.
- **closed:** a podium reveal of the top 3 with confetti (the self-contained
  confetti from `/screen`); a tie at the top reads "Empate!".

## Admin — `/vote/admin` (works on a laptop or a phone)

- Login (shared session with `/host`).
- **Title** ("Quem é o destaque do ano?").
- **Names:** a textarea, one per line, with a live count and inline validation
  (duplicates, over-long lines) before saving. Disabled while voting is open.
  The draft is saved to this browser's `localStorage`; if the server comes back
  with the seed list (a restart or deploy wiped memory), the page offers
  "Restaurar a lista salva neste navegador".
- **Time:** preset chips + a custom minutes field.
- **Controls:** Abrir votação · Encerrar agora · Zerar votos, with a status pill
  (phase, countdown, totals).
- **Live results:** every candidate with their count, sorted, filterable with
  the same search; "Baixar CSV" builds the file client-side.
- Links + QR codes for `/vote` and `/vote/screen`.

## Out of scope

Per-person login or anti-fraud; votes or config surviving a restart (in-memory,
same trade as Tap Race — mitigated for config by the admin's local draft);
photos per candidate; several simultaneous polls; i18n beyond pt-BR; showing
live counts on phones.

## Testing

- `test/vote.test.js` — engine: config validation (dupes after folding, length,
  bounds), phase machine and deadline, cast / change / no-op, counts staying
  consistent, `stale_list`, reopen clearing votes, ranking and ties, the id cap.
- `test/vote-search.test.js` — folding, every tier and their order, initials,
  any-order multi-word, typo tolerance, highlight ranges on accented names,
  empty-query ordering, suggestions.
- `scripts/vote-check.mjs` (`npm run check:vote`) — real Chromium against a
  local server: admin logs in, saves names, opens; phones at 390×844 and
  360×740 search (`joao`, `suoza`, initials), vote, change their vote; the
  screen reflects it within ~1 s; close → podium. Saves screenshots for review.
- `npm test` and the existing contract/browser checks must stay green — the
  new routes must not disturb Tap Race or Sequência.
