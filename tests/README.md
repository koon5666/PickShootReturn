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

puppeteer-core is imported from the shared scratchpad checkout
(`…/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js`);
override with `PUPPETEER_CORE=/path/to/puppeteer-core.js`, Chrome with `CHROME_PATH`.

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
