# Live Vote — a real-time voting companion to Tap Race

A third app in the same process, shipped **alongside** Tap Race and Sequência
(separate routes, separate engine, separate pages), not a replacement. The room
scans a QR on the big screen, then votes in up to 6 **categories** — the same
list of ~120 names runs in every category, and in each one a voter picks
**exactly N** names. The host opens categories whenever they like, one or
several at a time, each on its own timer. The big screen reveals the vote moving
in real time; phones only search and vote. An admin page configures the names,
the categories and the timers, and watches for fraud.

Same live-event shape as the other two: one Cloud Run instance, in-memory state,
self-hosted assets, phones as controllers, SSE to the big screen, the same admin
password and session cookie.

## Product decisions

| Decision | Choice |
|---|---|
| Names | **One shared list** (120 in the seed, up to 300, each 1–60 chars) that runs in every category. |
| Categories | **Admin-defined**, 1–6 (5 in the seed). Each has a title and its own N. |
| Picks | **Exactly N per category**, N set by the admin per category (1–10, default 3). A ballot with fewer or more doesn't submit. One name can't be picked twice in the same category; the same name can be picked in different categories. |
| Changing | A ballot can be resubmitted until that category's time runs out; the new ballot replaces the old one. |
| Scheduling | **Admin decides each time:** open any category, or several at once, each with its own timer. |
| Timer | Default **3 min**; presets 1 · 2 · 3 · 5 · 10 min or custom (30 s – 4 h), picked at open time. |
| Live counts | **Big screen only.** Phones never see counts — the reveal lives on the screen. |
| Anti-fraud | **Room-locked, no codes** — see "Anti-fraud". |
| Identity | Anonymous. No login, no personal data. |
| Language | English UI. |
| Seed | The event's 5 categories (CUSTOMER FOCUS, COLLABORATOR CROSS-REGIONAL, COMPETITIVENESS CHAMPION, TOP "SCALER" FOR THE BUSINESS, NEW WAYS OF GROWTH (Catch the Opportunity)), pick 3 each, are built in, so every boot starts with them; the admin can still edit them. Names: the event's list from `VOTE_NAMES` (a git-ignored file at deploy), else 120 sample names. |

## Pages and routes

| Path | Who | What |
|---|---|---|
| `/vote` | phones | pick a category, search, pick N, submit |
| `/vote/screen` | projector (admin login) | the stage: live leaderboards for the categories on screen, timers, rotating QR, live feed, reveals |
| `/vote/admin` | host (admin login) | names, categories, open/close/reset per category, what's on screen, entry lock, fraud panel, results |

All three are precompressed at boot like the existing pages. The search logic is
`/vote/search.js`, a plain ES module shared by the phone, the admin page and the
unit tests.

The screen requires the admin session because it displays the live room code —
if it were public, anyone anywhere could read the code and the room lock would
mean nothing — and because it is the only place counts are shown. The host logs
in once on the projector machine (usually the same laptop as `/host`, so usually
already logged in).

API:

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /vote/enter` | room code | `{code}` → sets the device cookie. The only way in. |
| `GET /vote/candidates` | – | `{listVersion, candidates:[{id,name}]}`; ETag = boot + listVersion → 304 on repeat |
| `GET /vote/live` | – | shared phone state: `{listVersion, boot, entryOpen, pollMs, categories:[{id, title, picks, phase, roundId, endsAt}]}` — no counts; one precompressed buffer for every phone. The server clock rides in an `X-Server-Now` header (the body is shared and may be older than the request); `boot` changes on every restart so phones drop drafts from before it |
| `GET /vote/me` | device | `{entered, ballots:{[categoryId]:{roundId, picks[]}}, voided:[categoryId]}` |
| `POST /vote/ballot` | device | `{categoryId, roundId, listVersion, picks[]}` → `{ballot, category}` — never counts |
| `GET /vote/events` | admin | SSE for screen + admin: counts, feed, stage, room code, fraud flags |
| `POST /vote/admin/config` | admin | `{names[], categories:[{id?, title, picks}]}` — only while no category is open |
| `POST /vote/admin/open` | admin | `{categoryIds[], durationMs}` — each starts a fresh round (zero ballots) |
| `POST /vote/admin/close` | admin | `{categoryIds[]}` — ends those rounds now |
| `POST /vote/admin/reset` | admin | `{categoryIds[]}` — back to setup, ballots cleared |
| `POST /vote/admin/stage` | admin | `{mode:'auto'}` or `{mode:'pinned', categoryIds[]}` — what the screen shows |
| `POST /vote/admin/entry` | admin | `{open: bool}` — lock/unlock new devices joining |
| `POST /vote/admin/void` | admin | `{flagId, restore?}` — void or restore a flagged group's ballots |

Admin auth reuses `checkAdmin` and the `tr_admin` session cookie — logging in on
`/host` also logs you in here, and vice versa.

## Engine — `src/vote.js`

A pure, time-injected class (`Vote`), same style as `game.js` / `batucada.js`.

**Shared state:** `candidates[]` (id = index within the current list),
`listVersion` (bumped when the names change), `categories[]`, `stage`.

**Per category:** `id`, `title`, `picks` (N), `phase` (`setup → open →
closed`), `roundId`, `endsAt`, `ballots: Map<voterId, candidateId[]>`,
`voided: Set<voterId>`, `counts[]` (votes per candidate, voided excluded),
`ballotCount`, and a ring of recent `+1` events for the feed.

**Rules:**
- `configure(names, categories)` is allowed only while **no category is open**
  (one simple rule instead of a matrix of what may change mid-vote). Names are
  trimmed, whitespace collapsed, blanks dropped; the save is **rejected**, with
  the offending lines named, if a name is over 60 chars, if there are fewer
  than 2 or more than 300 names, if two names are equal after accent/case
  folding, if there are 0 or more than 6 categories, if a title is blank or
  over 60 chars, or if a category's N is outside 1–min(10, names). Changing the
  names clears every category's ballots; changing a category's N clears that
  category's ballots; a title edit keeps them. Categories keep stable ids
  across saves; a removed category's results go with it.
- `open(categoryIds, durationMs, now)` starts a fresh round in each (zero
  ballots, new `roundId`). Opening a category that already has ballots wipes
  them — the admin page confirms first.
- `submit(voterId, categoryId, roundId, listVersion, picks, now)` is accepted
  only while that category is `open`, `now < endsAt`, the voter isn't voided
  there, and `picks` is exactly N distinct valid ids. A stale `listVersion` is
  rejected as `stale_list`, a stale `roundId` as `stale_round` (the phone
  refetches and keeps the draft where it can). The new ballot replaces the old
  one: names dropped get −1, names added get +1, unchanged picks don't move. An
  identical resubmit is a no-op.
- `void(categoryId, voterIds)` / `restore(...)` move ballots out of / back into
  the counts. `counts` and `ballotCount` stay consistent by construction.
- `tick(now)` closes each category at its own deadline. The existing 100 ms loop
  drives it — one clock for all three apps.
- Ranking per category: votes desc, then name. Equal counts share a rank; a tie
  at the top is shown as a tie.
- Device ids are capped at 20.000, so a script can't grow memory without bound.

## Anti-fraud — `src/vote-guard.js`

Pure, time-injected, unit-tested on its own; the server wires it in. What each
layer stops, honestly:

**1. Room code (presence).** The screen shows a QR to `/vote?k=K7P2Q` and the
same 5-character code in large text (for anyone whose camera can't scan from
the back row). The code is `HMAC(secret, epoch)` in an unambiguous 31-letter
alphabet (no 0/O/1/I/L), `epoch = floor(now / 30 s)`. It **rotates every 30 s**
and is accepted for the current and previous epoch, so a code works for 30–60 s.
A link or photo forwarded to a group chat goes dead within a minute. The phone
calls `POST /vote/enter`, then strips `k` from the address bar.
- Brute force: 31⁵ ≈ 28.6 M codes, 2 valid at a time. Wrong codes are throttled
  per IP at 600 failures/min, then 429 for a minute — far above anything a venue
  produces (a whole event shares one NAT address), yet guessing still takes weeks
  per IP. A real code from the last 5 minutes answers "expired" and never counts
  as a failure, so stale photos and slow typists can't lock the room out.
  Successful entries are never counted.

**2. Device cookie (one ballot per device per category).** Entering sets
`tv_voter=<id>.<hmac>`: HttpOnly, `SameSite=Strict`, Secure on TLS, 12 h.
Ballots are keyed by that id, never by anything in the request body. Clearing
`localStorage` does nothing; a forged or tampered cookie fails the HMAC. The
secret is random per boot (no secret plumbing; a restart wipes ballots anyway,
so everyone simply rescans).

**3. Scripts.** Submitting needs a valid cookie, which needs a live room code
from the projected screen. On top of that, per device and category: at most one
submit per second and 30 per round. State-changing requests must be same-origin
(`Sec-Fetch-Site`/`Origin` checked), so another site can't vote on a visitor's
behalf.

**4. Entry lock.** Once the room is in, the admin can **close entry**: devices
already in keep voting, no new device can join, even with a valid code. This
caps what a photographed QR can do.

**5. Flags + void (human in the loop).** Automatic blocking at an event is a
trap — hundreds of identical iPhones share one NAT IP and one Safari
user-agent. So the server *flags* and the admin *decides*. At 1 Hz, per
category:
- **Cluster:** devices grouped by (IP, user-agent, entry window). A group with
  ≥ 5 **identical ballots** is flagged — for N ≥ 2, the same exact set out of
  120 names is a strong signal: "6 devices · same network & browser · joined
  within 30 s · identical ballot (Ana Souza, João Silva, Bruno Lima)". For N = 1
  the same rule applies, and it is weaker; the panel says so.
- **Burst:** a candidate gains ≥ 20 votes in 10 s while appearing on ≥ 60 % of
  the ballots submitted in that window.

The fraud panel lists flags live, tagged with their category. **Void** removes
that group's ballots in that category from the counts (the screen updates
immediately) and bars those devices from it for the rest of the round;
**Restore** undoes it. A voided *cluster* also voids newcomers to that exact
group (same network, browser, entry window and identical ballot). A voided
*burst* never spreads: later voters for that candidate are shown as "N new since
void" and the host decides with one click ("Void N new"). The IP used is the client address as Google's front end
saw it (the rightmost `X-Forwarded-For` entry), never a client-supplied value.

**What still gets through:** one person with several phones, or one person
rescanning the live QR from a private tab, gets several ballots. Closing those
holes needs per-attendee codes or logins — out of scope by choice.

## Live updates

- **Phones: adaptive polling of one shared buffer.** Phones only need each
  category's phase, deadline and round, plus the list version — no counts.
  Cloud Run caps an instance at 1.000 concurrent connections, so phones can't
  each hold an SSE stream. `GET /vote/live` is identical for every phone, so it
  is serialised and gzipped **once** per change and each request just writes
  the buffer — the same trick as `/metrics`. The server tells phones how often
  to come back: `pollMs = clamp(devices / 400 rps, 3 s, 6 s)`. ±20 % jitter;
  immediate re-poll on `visibilitychange`. A `ballot` response carries the same
  view, so a voter never waits on a poll to see their ballot land.
- **Screen + admin: SSE** at `/vote/events`, broadcast from the tick loop only
  when something changed, at most 10 frames/s, plus a `:` comment every 15 s so
  an idle stream stays open. Full state per frame — ≤ 6 categories × 120 counts
  plus names is a few KB, to a handful of screens; not worth a delta protocol.
- Countdowns run locally from `endsAt` and a server-clock offset; a phone shows
  "Closed" at zero without waiting for a poll.

## Phone — `/vote` (mobile first, the search is the star)

`100dvh`, safe-area insets, rows ≥ 56 px, inputs ≥ 16 px (no iOS zoom on
focus), every action within thumb reach.

**Getting in:** arriving via the QR enters automatically. Without a valid cookie
the page still shows categories and names, read-only, with a banner: "Scan the
QR on the big screen to vote" and a field to type the 5-character code. An
expired code says so ("That code expired — scan the screen again"). With entry
locked: "Entry is closed".

**Home — categories.** One card per category: title, "Pick 3", and its state —
*Open* with a live countdown and your status ("Not voted" / "2 of 3 picked —
not submitted" / "Submitted ✓"), *Opens soon*, or *Closed*. Open ones sort
first. If exactly one category is open and you haven't submitted, the page goes
straight into it. When the host opens a category, its card animates in on the
next poll.

**Ballot — one category.**
- Sticky header: back, category title, countdown, "Pick exactly 3".
- Sticky search field, then the list. Tapping a name toggles it as a pick
  (checkmark + highlight). At N picks, tapping another name shakes the tray:
  "You've picked 3 — remove one to add Bruno Lima".
- **Tray**, pinned to the bottom within thumb reach: your picks as chips (× to
  remove), "2 of 3", and the **Submit** button — enabled only at exactly N.
  Submitted ballots show "Your 3 votes are in ✓ — you can change them until time
  runs out"; editing re-enables Submit.
- Picks are drafted in `localStorage` per category and round, so a reload or a
  lost connection never loses them. An unsubmitted or changed draft in the last
  30 s shows a "Submit before time runs out!" banner. A draft at the deadline
  does not count — the page says so plainly.

**Search** (`public/vote/search.js`, pure, instant on every keystroke — ≈ 2 ms
for 300 names on a laptop, well under a frame on a phone — no debounce):

- **Folding:** accents, case and punctuation are ignored — `joao` finds "João",
  `davila` finds "D'Ávila", `anasouza` finds "Ana Souza".
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
- **Empty query:** the full list, alphabetical, with sticky letter headers and
  a scrubber rail on the right edge (drag to jump, like phone contacts). Your
  current picks are pinned in the tray, so they're never lost in the scroll.
- **No results:** "No names found" plus up to 3 "Did you mean…?" suggestions by
  edit distance.
- Result count ("12 of 120"), a clear (×) button, and Enter toggles the top hit
  and clears the field, ready for the next search — picking 3 names is three
  quick type-and-Enter rounds.
- Input: `type=search`, `enterkeyhint=search`, autocorrect / autocapitalize /
  spellcheck off. No autofocus — the list shows first; the keyboard opens on tap.

**Failures:** a failed submit keeps the tray as it was with "Couldn't submit —
try again". `stale_list` / `stale_round` refetch and keep whatever picks are
still valid. A submit after the deadline shows "Voting closed". A voided device
sees "Your ballot in this category was removed by the organizer".

## Big screen — `/vote/screen` (16:9 projector, admin login)

**The stage** is the set of categories on screen.
- **Auto** (default): every open category; when none is open, the category
  that closed most recently (or all of those that closed together) with their
  results; before anything has run, the lobby.
- **Pinned:** the admin picks exactly which categories to show — e.g. to bring
  back category 2's result later.

**Layout adapts to the stage size:** 1 category → full width, top 10; 2 → two
columns, top 8; 3 → three columns, top 6; 4 → a 2×2 grid, top 5; 5–6 → a 3×2
grid, top 3. Each panel:
title, its own countdown, rank, name, animated bar, count, and % of ballots
that picked the name. FLIP-animated reordering (same technique as `/screen`);
a row pulses when it gains a vote.

**Always on screen:** the rotating QR + 5-character code with a thin ring
showing when it rotates next (hidden once entry is closed), total ballots, and a
**live feed** of names that just received a vote (`+1 Ana Souza · MVP`),
sliding in.

**Lobby:** a big QR + code, "Voting starts soon", the category list.

**Reveal:** when a category on stage closes, its panel turns into a top-3
podium with confetti (the self-contained confetti from `/screen`); a tie at the
top reads "It's a tie!". With several closing together, each gets its moment.

## Admin — `/vote/admin` (works on a laptop or a phone)

- Login (shared session with `/host`).
- **Names:** a textarea, one per line, with a live count and inline validation
  (duplicates, over-long lines) before saving.
- **Categories:** an editable list — title, N ("pick exactly"), add / remove /
  reorder. Saving names or categories is disabled while any category is open,
  and the page warns when a save will clear ballots ("Changing N clears 87
  ballots in MVP").
- Drafts of both are saved to this browser's `localStorage`; if the server
  comes back with the seed (a restart or deploy wiped memory), the page offers
  "Restore the setup saved in this browser".
- **Control board:** one row per category — phase, countdown, ballots, and
  Open · Close · Reset · On screen. Checkboxes + a duration picker (default
  3 min) open several at once. Opening a category that has ballots asks first.
- **Stage:** Auto, or pin the categories to show.
- **Entry:** Close entry / Reopen entry, with the number of devices in.
- **Fraud panel:** live flags with category, plain-English reason, the ballots
  involved, and Void / Restore; a running "voided ballots" total.
- **Results:** a tab per category with every candidate and their count, sorted,
  filterable with the same search; "Download CSV" exports all categories in one
  file (category, rank, name, votes), built client-side.
- Links for `/vote` and `/vote/screen` (no static phone QR — the rotating one on
  the screen is the way in).

## Out of scope

Per-attendee codes or logins (so one person with several devices still gets
several ballots); votes or config surviving a restart (in-memory, same trade as
Tap Race — mitigated for config by the admin's local draft); editing names or
categories while any category is open; automatic blocking on fingerprints;
counts on phones; more than 6 categories; ranked or weighted ballots; photos
per candidate; languages other than English.

## Testing

- `test/vote.test.js` — engine: config validation (dupes after folding, lengths,
  bounds, N range, no saves while open, what clears ballots and what doesn't);
  per-category phase machines and independent deadlines; opening several at
  once; submit — exactly-N, distinct, valid ids, replace with correct ±1
  deltas, identical no-op, `stale_list`, `stale_round`; void / restore; counts
  staying consistent; reopen clearing ballots; ranking and ties; stage auto
  resolution; the id cap.
- `test/vote-guard.test.js` — code rotation and the 30–60 s acceptance window,
  cookie sign / verify / tamper, failed-code throttle, per-device submit limits,
  identical-ballot clusters and bursts (and *not* flagging a diverse NAT group).
- `test/vote-search.test.js` — folding, every tier and their order, initials,
  any-order multi-word, typo tolerance, highlight ranges on accented names,
  empty-query ordering, suggestions.
- `scripts/vote-check.mjs` (`npm run check:vote`) — real Chromium against a
  local server: admin logs in, saves names and categories, opens two categories;
  the screen shows a code and a two-column stage; phones at 390×844 and 360×740
  enter via the QR URL, search (`joao`, `suoza`, initials), pick exactly N,
  submit, change a pick; the screen reflects it within ~1 s; no phone-facing
  response ever contains counts; `/vote/events` without a session is refused;
  an expired code, a cookie-less submit and a wrong-sized ballot are refused; a
  scripted cluster is flagged and voided; close → podium. Saves screenshots for
  review.
- `npm test` and the existing contract/browser checks must stay green — the
  new routes must not disturb Tap Race or Sequência.
