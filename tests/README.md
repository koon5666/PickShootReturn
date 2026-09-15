# Local testing (never deploys, never touches the real KV)

All commands from the repo root. `node`/`npm` live in `~/.local/node/bin`
(`export PATH=~/.local/node/bin:$PATH`).

## 1. Boot an isolated server

```sh
PORT=8770                                   # pick a free one in 8770-8789: lsof -nP -iTCP:$PORT must be empty
node tests/local-server.mjs $PORT ./.wrangler-local --session <your-track>
```

Builds `dist` (vite), starts `wrangler pages dev dist --port $PORT --persist-to ./.wrangler-local`
detached, waits for `GET /api/data` = 200, prints the PID. `--session <name>` registers
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

API helpers in this area (all local): `POST /api/tombstone {field,id,adminPin}`,
`POST /api/history-clear {adminPin}`, `GET /api/backup?list=1`, `GET /api/backup?id=`,
`PUT /api/backup {label?}`, `POST /api/backup {id,adminPin}` (restore, safety copy first).
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

## 6. Roster-ops track walk-through

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
