# Local testing (never deploys, never touches the real KV)

All commands from the repo root. `node`/`npm` live in `~/.local/node/bin`
(`export PATH=~/.local/node/bin:$PATH`).

## 1. Boot an isolated server

```sh
PORT=8770                                   # pick a free one in 8770-8789: lsof -nP -iTCP:$PORT must be empty
node tests/local-server.mjs $PORT ./.wrangler-local --session <your-track>
```

Builds `dist` (vite), starts `wrangler pages dev dist --port $PORT --persist-to ./.wrangler-local`
detached, waits for `GET /api/public` = 200, prints the PID. Writes a random `SESSION_SECRET`
to `.dev.vars` (gitignored) if there is none: the functions refuse to run without one. `--session <name>` registers
the server in `/tmp/claude-dev-servers.json` (parallel-session etiquette). Log:
`<stateDir>/wrangler.log`. `--no-build` reuses the existing `dist`.
In a worktree use the worktree's own state dir (`<worktree>/.wrangler-local`, gitignored).

Stop it (kills ONLY the recorded PID and removes the registry entry):

```sh
node tests/local-server.mjs stop ./.wrangler-local
```

## 2. Seed

```sh
node tests/seed.mjs $PORT              # default: "Lucky Cam Rental", admin 9999, Nong 1111 / Arthit 2222 / Ploy 3333
node tests/seed.mjs $PORT prod-copy    # real data from ~/psr-backups/2026-09-16_pre-theme/data-full.json (read-only; lineGroupId nulled)
```

Default scenario: 6 gear items, job1 TVC Toyota (Confirmed, shot 2 days ago, FX6 + lens +
4 batteries picked 3 days ago, only the lens returned = overdue), job2 Netflix (Confirmed,
starts today, gear assigned, nothing picked), job3 Pencil next week, one crew INV, one
pending gear request, one pending equipment add request, one open damage report, 3
production companies (Indie House has no address), crew + admin profiles.

`PUT /api/data` merges per field (checkouts / adminRequests / equipmentRequests / invoices
keep KV-only ids), so seeding is additive: for a clean slate stop the server, delete the
state dir (or use a new one) and boot again.

Every `/api` route needs a session cookie (auth track, P0-2). The seed logs in as the
owner first (fresh state: bootstrap PIN 1234; after the default seed: 9999) and the PINs it
PUTs in the clear are hashed server-side. Scripts use `tests/apiclient.mjs`:

```js
import { apiClient } from "./apiclient.mjs";
const owner = await apiClient(base).loginAdmin("9999");        // or ("2468", staffId) for a staff account
const nong  = await apiClient(base).loginEmployee("e_nong", "1111");
await owner.get("/api/data"); await owner.put("/api/data", {...}); await nong.post("/api/pin", {...});
```

One browser = one cookie jar: a puppeteer script that switches persona must log out first
(`fetch("/api/logout", { method: "POST" })`), and a `page.reload()` keeps the session (it used to
log out because localStorage was cleared). GET /api/data never returns a PIN field.

## 3. Smoke (headless Chrome, real mouse clicks)

```sh
npm run smoke -- $PORT        # = node tests/smoke.mjs $PORT
```

Admin (1280x900): login 9999, every sidebar page, New Job / Add Equipment / Settings open +
close, TH/EN switch. Crew (390x844): Nong 1111, Today / Invoice / Gear / Profile, Gear
Request + Create Document modals, adds a production house and checks it reached KV.
Fails on any `pageerror`, any console error outside the local allowlist (`ws://…/api/session`
or `/api/chat` 503, `/api/profile/<id>` 404), or any HTTP >= 400 elsewhere. Screenshots:
`tests/.smoke-shots/` (gitignored). Needs the DEFAULT seed.

`node tests/seed.mjs` pushes the prod copy through `PUT /api/data`, which now externalizes
the photos immediately; use section 3b when you need the inline (pre-migration) shape.

puppeteer-core is imported from the shared scratchpad checkout
(`…/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js`);
override with `PUPPETEER_CORE=/path/to/puppeteer-core.js`, Chrome with `CHROME_PATH`.

## 3b. Photo migration proof on the prod copy (backend-data track)

The server now stores every photo in its own KV key (`photo:<field>:<id>`,
`functions/_lib/photos.js`); `PUT /api/data` externalizes on the way in, so the only way
to reproduce the real pre-migration shape locally is to load the raw dump straight into KV:

```sh
node tests/prod-copy-kv.mjs ./.wrangler-prod                 # wrangler kv bulk put --local (photos inline)
node tests/local-server.mjs $PORT ./.wrangler-prod --no-build
node tests/migrate-proof.mjs $PORT                           # migrates in batches, verifies 98/98 photos + backup/restore
```

Or drive it from the UI: admin > Settings > Photo storage > "Move photos to separate storage".
`GET /api/migrate-photos` shows progress without writing.

API helpers in this area (all local, admin session): `POST /api/tombstone {field,id}`,
`POST /api/history-clear`, `GET /api/backup?list=1`, `GET /api/backup?id=`,
`PUT /api/backup {label?}`, `POST /api/backup {id}` (restore, owner only, safety copy first).
`PUT /api/data` accepts `_v` (per-field versions from GET) and answers 409 on a stale
whole-value field, 413 on a value over 20 MiB.

## 4. Unit tests and i18n

```sh
npm test               # vitest: src/**/*.test.js + functions/**/*.test.js (node env)
npm run i18n:check     # EN/TH key parity for src/i18n/base.js + every src/i18n/tracks/*.js
npm run build          # vite build (also the only JSX syntax check)
```

Pure logic belongs in `src/logic/*.js` (client) or `functions/_lib/*.js` (server) with a
test beside it. Never put a `*.test.js` under `functions/api/` (every file there is a route).
New UI strings go in `src/i18n/tracks/<track>.js` (see `src/i18n/tracks/README.md`).

## 9. Review fix-up track walk-through (acceptance pass)

```sh
node tests/walk-review-fixups.mjs $PORT   # API-level, needs a FRESH default seed
```

Server-side pieces that have no UI of their own: the per-user LINE link (code ->
webhook pairing -> the identity never reaches a client -> survives an admin
`employees` save), the overdue digest (preview, one send per tenant day, cron
token gate), server-side document-number allocation (two devices minting one
number), the `roleList` field (owner writes it, crew 403, backups carry it),
crew report ownership + invoice share tokens, and the 20 h auto-backup gate.

Two extra secrets in `.dev.vars` (any value locally, both are Pages secrets in
production): `LINE_CHANNEL_SECRET` (the webhook refuses to run without it) and
`DIGEST_TOKEN` (the cron worker's key for POST /api/overdue-digest). Without a
`LINE_CHANNEL_ACCESS_TOKEN` nothing is pushed locally and the digest refuses to
mark the day as sent, which the walk asserts.

## Before you finish a track

`npm run build && npm test && npm run i18n:check && npm run smoke -- $PORT`, then stop your
server with `node tests/local-server.mjs stop <stateDir>`.

## 5. Documents track walk-through

```sh
node tests/walk-documents.mjs $PORT   # needs a FRESH default seed (it creates documents)
```

Crew (390x844, Nong): profile helper text / prefix / tax ID / OT example + flat ฿/h,
Create Document (own-name header, next-number preview, two-row line items, WHT 3%,
attachments, save validation, toast), printed HTML (bilingual titles, WHT + net, no ID
card), Mark Paid dialog + Issue receipt + Undo paid (voids the receipt), shared production
house read-only vs own editable (tax ID + branch), 72 h share link + view counter + revoke,
Thai modal. Admin (1280x900): nothing minted on mount, Create quote from job, Create invoice
from quote, paid dialog, Issue receipt, void, Companies tax ID, Presets Save, positions OT
example, and the same modal at 390px. Screenshots in `tests/.walk-shots/`.

## 6. Auth track walk-through

```sh
node tests/walk-auth.mjs $PORT        # needs a FRESH default seed (it registers / adds accounts)
```

Login screen (crew primary, admin link, LangPill, PIN hint, TH), 5 wrong PINs -> the
server's 429 countdown (survives a reload), owner Settings (no PIN shown, My PIN needs the
current PIN, staff accounts add / reset / owner name), Team (no show toggle, Reset PIN and
Add Member go to `/api/employees/:id/pin`), KPI event stamped with the actor, register with
a contact -> "Waiting for approval" on that device -> admin approves (row shows the contact,
never the PIN, `approvedBy`) -> "Your account is ready", counter staff Bee logs in through
the account picker and her approval is stamped `by: Bee`, logout really ends the session,
crew PIN self-change (wrong current PIN refused), a crew page cannot write another crew's
invoice / profile / checkout, offline boot from the cached session + cache. Screenshots in
`tests/.auth-shots/`.

Legacy data: load the prod copy straight into KV (section 3b) and log in with the old
plaintext PINs; the first successful login of each account rewrites it as a hash and deletes
the plaintext (`functions/_lib/accounts.js`).
## 7. Crew UX / Thai track walk-through

```sh
node tests/sticky.mjs $PORT          # P1-3: every [data-sticky-primary] button is hittable at 390x844
node tests/walk-crew-ux.mjs $PORT    # P1-6, P2-5, P2-12, P2-13, P2-15, P3-1, P3-2, P3-3, P3-6
```

`sticky.mjs` scrolls Profile / checkout / Settings to several offsets and asserts
`document.elementFromPoint` at the centre of the Save button returns the button itself
(the bottom nav used to win), then really clicks Save Profile. `walk-crew-ux.mjs` (Nong,
390x844, then admin 1280x900): login EN/TH pill, 44px controls + 11px nav labels, crew label
from profile positions, gear-request submit gated with an inline reason, the Dialog
primitive (role=dialog in body, Esc, Tab trap, dirty backdrop confirm, focus return), scroll
reset on tab change, Gear list rows + sort select + no QR in photo mode, KPI rules under the
score, Thai mode on the checkout screen / Today / Gear / Invoice / both modals, admin
"Deductions" wording and a +5 / -10 adjustment persisted to KV. Screenshots in
`tests/.sticky-shots/` and `tests/.walk-crew-shots/`.

Both scripts log in through the auth-track Login (Crew / ทีมงาน, Rental house admin) and
read KV through `tests/apiclient.mjs`; run them on a fresh default seed (walk-auth changes
Nong's PIN, so reseed after it).

## 8. Roster-ops track walk-through

```sh
node tests/walk-roster-ops.mjs $PORT   # needs a FRESH default seed (it edits jobs, sets lineGroupId, creates a job offline)
```

Admin (1280x900): 2-column dashboard (Needs action rail + schedule, header New Job, no
FAB), the bell lists the same needs-action items and deep-links, Team only points at the
Dashboard for gear requests, crew roster on a job (KV `crew` + `checkoutRoles`), LINE push
gated on real changes (contact edit silent, roster / date change pushes once), Insights page
(utilisation, not returned, customer history, crew statement), per-tenant `theme` in KV,
QR label window with inline SVG and no CDN. Admin 390px: stacked + FAB + Insights in the
bottom nav. Crew Nong / Arthit (390x844): my jobs first with pickup + call time, other
crews' jobs collapsed, Invoice tab my jobs + show all. Offline (P1-14): boot from the
cache with `/api/data` blocked, create a job, reconnect -> the job reaches KV; a crew
profile save made offline is queued and drained. Screenshots in `tests/.walk-roster-shots/`.
