# Live Vote — a real-time voting companion to Tap Race

A third app in the same process, shipped **alongside** Tap Race and Sequência
(separate routes, separate engine, separate pages), not a replacement. The room
scans a QR on the big screen, searches a list of ~100 names, and votes. The big
screen reveals the vote moving in real time; phones only search and vote. An
admin page configures the names and the time, and watches for fraud.

Same live-event shape as the other two: one Cloud Run instance, in-memory state,
self-hosted assets, phones as controllers, SSE to the big screen, the same admin
password and session cookie.

## Product decisions

| Decision | Choice |
|---|---|
| Vote rule | **One vote per device, changeable until time runs out.** Changing moves the vote: −1 old, +1 new. |
| Live counts | **Big screen only.** Phones never see counts — the reveal lives on the screen, and no tally leaks to a phone to nudge a bandwagon. |
| Anti-fraud | **Room-locked, no codes.** You must be in the room to get in, votes are tied to a server-signed device cookie, scripts hit tokens and rate limits, and the admin sees suspicious clusters and can void them. See "Anti-fraud". |
| Identity | Anonymous. No login, no personal data. |
| Language | English UI. |
| Name list size | Up to 300 names (100 is the target), each 1–60 characters. |
| Voting time | Admin picks per round: presets 1 · 2 · 5 · 10 · 15 min, or custom (30 s – 4 h). Default 5 min. |
| Seed list | 100 sample names baked in, so the app works the moment it boots. |

## Pages and routes

| Path | Who | What |
|---|---|---|
| `/vote` | phones | search + vote |
| `/vote/screen` | projector (admin login) | live leaderboard, timer, rotating QR, live vote feed |
| `/vote/admin` | host (admin login) | title, names, duration, open/close/reset, entry lock, fraud panel, full results |

All three are precompressed at boot like the existing pages. The search logic is
`/vote/search.js`, a plain ES module shared by the phone, the admin page and the
unit tests.

The screen requires the admin session because it displays the live room code —
if it were public, anyone anywhere could read the code off `/vote/events` and the
room lock would mean nothing — and it is the only place counts are shown. The host logs in once on the projector machine
(usually the same laptop as `/host`, so usually already logged in).

API:

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /vote/enter` | room code | `{code}` → sets the device cookie. The only way in. |
| `GET /vote/candidates` | – | `{listVersion, title, candidates:[{id,name}]}`; ETag = listVersion → 304 on repeat |
| `GET /vote/live` | – | shared phone state: `{phase, roundId, listVersion, endsAt, now, pollMs, entryOpen}` — no counts; one precompressed buffer for every phone |
| `GET /vote/me` | device | `{entered, myVote, voided}` |
| `POST /vote/cast` | device | `{candidateId, listVersion}` → `{myVote, phase}` — never counts |
| `GET /vote/events` | admin | SSE for screen + admin: counts, feed, room code, fraud panel |
| `POST /vote/admin/config` | admin | `{title, names[]}` — only when voting is not open |
| `POST /vote/admin/open` | admin | `{durationMs}` — starts a fresh round (zero votes) |
| `POST /vote/admin/close` | admin | ends the round now |
| `POST /vote/admin/reset` | admin | back to setup, votes cleared, names kept |
| `POST /vote/admin/entry` | admin | `{open: bool}` — lock/unlock new devices joining |
| `POST /vote/admin/void` | admin | `{flagId, restore?}` — void or restore a flagged group's votes |

Admin auth reuses `checkAdmin` and the `tr_admin` session cookie — logging in on
`/host` also logs you in here, and vice versa.

## Anti-fraud — `src/vote-guard.js`

Pure, time-injected, unit-tested on its own; the server wires it in. What each
layer stops, honestly:

**1. Room code (presence).** The screen shows a QR to `/vote?k=K7P2Q` and the
same 5-character code in large text (for anyone whose camera can't scan from
the back row). The code is `HMAC(secret, epoch)` rendered in an unambiguous
31-letter alphabet (no 0/O/1/I/L), where `epoch = floor(now / 30 s)`. It
**rotates every 30 s** and is accepted for the current and previous epoch, so a
code works for 30–60 s. A link or photo forwarded to a WhatsApp group goes dead
within a minute. The phone calls `POST /vote/enter`, then strips `k` from the
address bar.
- Brute force: 31⁵ ≈ 28.6 M codes, 2 valid at a time. Wrong codes are throttled
  per IP (20 failures/min, then 429 for a minute). Successful entries are *not*
  limited per IP — a whole event behind one NAT scans at once.

**2. Device cookie (one vote per device).** Entering sets `tv_voter=<id>.<hmac>`:
HttpOnly, `SameSite=Strict`, Secure on TLS, 12 h. Votes are keyed by that id,
never by anything in the request body. Clearing `localStorage` does nothing;
a forged or tampered cookie fails the HMAC. The secret is random per boot
(no secret plumbing; a restart wipes votes anyway, so everyone simply rescans).

**3. Scripts.** Casting needs a valid cookie, which needs a live room code from
the projected screen. On top of that, per device: at most one vote change per
second and 30 per round. State-changing requests must be same-origin
(`Sec-Fetch-Site`/`Origin` checked), so another site can't vote on a visitor's
behalf.

**4. Entry lock.** Once the room is in, the admin can **close entry**: devices
already in keep voting, no new device can join, even with a valid code. This
caps what a photographed QR can do.

**5. Flags + void (human in the loop).** Automatic blocking at an event is a
trap — hundreds of identical iPhones share one NAT IP and one Safari
user-agent. So the server *flags* and the admin *decides*. At 1 Hz:
- **Cluster:** devices grouped by (IP, user-agent, entry window). A group of
  ≥ 5 where ≥ 80 % currently vote for the same candidate is flagged: "6
  devices · same network & browser · joined within 30 s · 6 for Ana Souza".
- **Burst:** a candidate gains ≥ 20 votes in 10 s while taking ≥ 60 % of all
  votes in that window.

The admin's fraud panel lists flags live. **Void** removes that group's votes
from every count (the screen updates immediately) and bars those devices
for the rest of the round; **Restore** undoes it. The IP used is the client
address as Google's front end saw it (the rightmost `X-Forwarded-For` entry),
never a client-supplied value.

**What still gets through:** one person with several phones, or one person
rescanning the live QR from a private tab, gets several votes. Closing those
holes needs per-attendee codes or logins — out of scope by choice.

## Engine — `src/vote.js`

A pure, time-injected class (`Vote`), same style as `game.js` / `batucada.js`.

**Phases:** `setup → open → closed`. `open` can start from `setup` or `closed`;
`close` and the deadline both end it; `reset` returns to `setup`.

**State:** `title`, `candidates[]` (id = index within the current list),
`listVersion` (bumped on every config save), `phase`, `roundId`, `endsAt`,
`votes: Map<voterId, candidateId>`, `voided: Set<voterId>`, `counts[]` and
`total` (voided votes excluded), plus a ring of recent `+1` events for the feed.

**Rules:**
- `setNames(title, lines)` trims, collapses whitespace, drops blank lines, then
  **rejects** (does not silently fix) the save if any name is over 60 chars, if
  there are fewer than 2 or more than 300 names, or if two names are equal after
  accent/case folding (two "Ana Souza" would make votes ambiguous). The error
  names the offending lines. Allowed only outside `open`. Clears votes and
  returns to `setup`.
- `cast(voterId, candidateId, listVersion, now)` is accepted only while `open`,
  `now < endsAt`, and the voter isn't voided. A `listVersion` mismatch is
  rejected as `stale_list` (the phone refetches names — guards against voting by
  index into a list the admin has since edited). Re-voting the same candidate is
  a no-op; a different one moves the vote.
- `void(voterIds)` / `restore(voterIds)` move votes out of / back into the
  counts. `counts` and `total` stay consistent by construction.
- `tick(now)` closes the round at the deadline. The existing 100 ms loop drives
  it — one clock for all three apps.
- Ranking: votes desc, then name. Equal top counts are a tie, and the UI says so.
- Device ids are capped at 20.000 per round, so a script can't grow memory
  without bound.

## Live updates

- **Phones: adaptive polling of one shared buffer.** Phones only need the
  phase, the deadline and the list version — no counts. Cloud Run caps an
  instance at 1.000 concurrent connections, so phones can't each hold an SSE
  stream. `GET /vote/live` is identical for every phone, so it is serialised and
  gzipped **once** per change and each request just writes the buffer — the
  same trick as `/metrics`. The server tells phones how often to come back:
  `pollMs = clamp(devices / 400 rps, 3 s, 6 s)`. ±20 % jitter; immediate re-poll
  on `visibilitychange`. Every `cast` response carries the same view, so a voter
  never waits on a poll to see their own vote land.
- **Screen + admin: SSE** at `/vote/events`, broadcast from the tick loop only
  when something changed, at most 10 frames/s, plus a `:` comment every 15 s so
  an idle stream stays open. Full state per frame (~2–3 KB for 100 names, to a
  handful of screens) — not worth a delta protocol's sync bugs.
- The countdown runs locally from `endsAt` and a server-clock offset; phones show
  "Voting closed" at zero without waiting for a poll.

## Phone — `/vote` (mobile first, the search is the star)

Layout: sticky header (title + countdown), sticky search field, then the list. `100dvh`, safe-area insets, rows ≥ 56 px, inputs ≥ 16 px
(no iOS zoom on focus), every action within thumb reach.

**Getting in:** arriving via the QR enters automatically. Without a valid cookie
the page still shows the list, read-only, with a banner: "Scan
the QR on the big screen to vote" and a field to type the 5-character code. An
expired code says so ("That code expired — scan the screen again"). With entry
locked: "Entry is closed".

**Search** (`public/vote/search.js`, pure, instant on every keystroke — < 1 ms
for 300 names, no debounce):

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
  a scrubber rail on the right edge (drag to jump, like phone contacts).
- **No results:** "No names found" plus up to 3 "Did you mean…?" suggestions by
  edit distance.
- Result count ("12 of 100"), a clear (×) button, and Enter picks the top hit.
- Input: `type=search`, `enterkeyhint=search`, autocorrect / autocapitalize /
  spellcheck off. No autofocus — the list shows first; the keyboard opens on tap.

**Voting:** tap a name → a bottom sheet ("Vote for **Ana Souza**?" or "Change
your vote from X to Y?") with one big confirm button; the keyboard is dismissed
when the sheet opens. On success: a check animation, a short vibration where
supported, and a pinned "Your vote: Ana Souza ✓ — tap another name to change"
card.

**Phases:** `setup` — browse and search; the vote button reads "Voting hasn't
started yet". `open` — votes go through. `closed` — "Voting closed — see the
results on the big screen", with your vote still shown.

**Failures:** a failed cast keeps the sheet open with "Couldn't vote — try
again". `stale_list` refetches names and asks again. A cast after the deadline
shows "Voting closed". A voided device sees "Your vote was removed by the
organizer".

## Big screen — `/vote/screen` (16:9 projector, admin login)

- **setup:** title, a big rotating QR + the 5-character code (with a thin ring
  showing when it rotates next), "Voting starts soon", name count.
- **open:**
  - main column — live **top 10**: rank, name, animated bar, count, %.
    FLIP-animated reordering (same technique as `/screen`); a row pulses when
    it gains a vote.
  - right rail — big countdown, total votes, the rotating QR + code (hidden
    once entry is closed), and a **live feed**: the last ~8 names that just
    received a vote (`+1 Ana Souza`), sliding in.
- **closed:** a podium reveal of the top 3 with confetti (the self-contained
  confetti from `/screen`); a tie at the top reads "It's a tie!".

## Admin — `/vote/admin` (works on a laptop or a phone)

- Login (shared session with `/host`).
- **Title** ("Who's the MVP of the year?").
- **Names:** a textarea, one per line, with a live count and inline validation
  (duplicates, over-long lines) before saving. Disabled while voting is open.
  The draft is saved to this browser's `localStorage`; if the server comes back
  with the seed list (a restart or deploy wiped memory), the page offers
  "Restore the list saved in this browser".
- **Time:** preset chips + a custom minutes field.
- **Controls:** Open voting · Close now · Reset votes · Close entry / Reopen
  entry, with a status pill (phase, countdown, totals, devices in).
- **Fraud panel:** live flags with a plain-English reason, the votes involved,
  and Void / Restore; a running "voided votes" total.
- **Live results:** every candidate with their count, sorted, filterable with
  the same search; "Download CSV" builds the file client-side.
- Links for `/vote` and `/vote/screen` (no static phone QR — the rotating one on
  the screen is the way in).

## Out of scope

Per-attendee codes or logins (so one person with several devices still gets
several votes); votes or config surviving a restart (in-memory, same trade as
Tap Race — mitigated for config by the admin's local draft); automatic
blocking on fingerprints; counts on phones; photos per candidate; several simultaneous polls;
languages other than English.

## Testing

- `test/vote.test.js` — engine: config validation (dupes after folding, length,
  bounds), phase machine and deadline, cast / change / no-op, void / restore,
  counts staying consistent, `stale_list`, reopen clearing votes, ranking and
  ties, the id cap.
- `test/vote-guard.test.js` — code rotation and the 30–60 s acceptance window,
  cookie sign / verify / tamper, failed-code throttle, per-device change limits,
  cluster and burst detection (and *not* flagging a diverse NAT group).
- `test/vote-search.test.js` — folding, every tier and their order, initials,
  any-order multi-word, typo tolerance, highlight ranges on accented names,
  empty-query ordering, suggestions.
- `scripts/vote-check.mjs` (`npm run check:vote`) — real Chromium against a
  local server: admin logs in, saves names, opens; the screen shows a code;
  phones at 390×844 and 360×740 enter via the QR URL, search (`joao`, `suoza`,
  initials), vote, change their vote; the screen reflects it within ~1 s; no
  phone-facing response ever contains counts; `/vote/events` without a session
  is refused; an expired code and a cookie-less cast are refused; a scripted cluster is
  flagged and voided; close → podium. Saves screenshots for review.
- `npm test` and the existing contract/browser checks must stay green — the
  new routes must not disturb Tap Race or Sequência.
