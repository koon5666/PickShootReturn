# Good morning. Here is what happened overnight (2026-09-17)

Branch **`fix/review-2026-09`** in `~/PickShootReturn`, 51 commits on top of `main` (be05373).
**Nothing pushed, nothing deployed, prod untouched.** Deploy only when you're happy, with `/pcd`, after the secrets in "Before deploying".

Verification on the final branch: `npm run build` ✓, `npx vitest run` 323/323 ✓, `npm run i18n:check` 1,129 EN / 1,129 TH ✓, smoke tour ✓, 7 merges green, acceptance QA: every P0 and P1 item confirmed fixed on a running build; two P3 items partially done (listed below).

## Test it locally (both servers are already running)

| URL | Data | Log in with |
|---|---|---|
| **http://localhost:8770** | A **migrated copy of your real prod data** (pulled 2026-09-16, `~/psr-backups/2026-09-16_pre-theme/`). Photos already moved to separate storage. LINE group id cleared so nothing can push to the real group. Crew **profiles are not in the copy** (bank details, positions, ID cards live under separate keys the data pull did not include), so crew Profile tabs start empty here. | Your admin PIN, and each crew member's own PIN (first login upgrades the PIN to a hash, local copy only) |
| **http://localhost:8771** | The reviewers' demo scenario "Lucky Cam Rental": overdue FX6, pending approvals, gear request, damage report | Admin **9999**, crew Nong **1111** / Arthit **2222** / Ploy **3333** |

Restart later: `cd ~/PickShootReturn && export PATH=~/.local/node/bin:$PATH && node tests/local-server.mjs 8770 ./.wrangler-local --session koon && node tests/seed.mjs 8770 prod-copy` (or `node tests/seed.mjs 8770` for the demo). Everything is in `tests/README.md` (boot, seed, smoke, the per-area walk-through scripts, stop).

Local runs need `.dev.vars` (already created, gitignored) with `SESSION_SECRET`, `LINE_CHANNEL_SECRET`, `DIGEST_TOKEN`.

## What changed, by review item

### P0 (all 8 fixed)
- **P0-1 KV 25 MiB cap.** Every photo now lives in its own key (`photo:<field>:<id>`); the arrays keep `{photo:null, hasPhoto:true}`; `/api/photo` reads the keys. `POST /api/migrate-photos` (admin session, idempotent, resumable) moves existing inline photos out. Proven on your prod copy: 98 photos, ~2 s, `checkouts` 20.82 MiB → 28 KiB. A PUT that would exceed 20 MiB answers 413 with a readable message instead of a 500.
- **P0-2 Auth.** Server-side sessions (httpOnly cookie, HMAC-signed, 30 days), PINs stored as PBKDF2 hashes, `POST /api/login` / `me` / `logout` / `pin`, 5 fails per 60 s rate limit (server), every `/api/*` route requires a session, `GET /api/data` never returns any PIN or hash, crew can only write their own records (server enforced), CORS locked to the origin, webhook requires `LINE_CHANNEL_SECRET`, calendar feed needs a per-tenant token (Settings / Profile). Existing plaintext PINs keep working: the first successful login rewrites each one as a hash. No PIN is rendered anywhere any more; "show PIN" became "Reset PIN".
- **P0-3 Availability.** One function (`src/logic/availability.js`) everywhere: total − other Confirmed jobs across each job's pickup..return window − units physically out − approved gear-request units − units in open damage reports − unreconciled lost units. Badges say why ("1 still out on TVC Toyota since 14 Sept"). Negative = red CONFLICT, never silently clamped.
- **P0-4 Admin receive.** Checkout > Active jobs lists every job with units out or inside its window, overdue first; per-item **Receive** with qty + condition (OK / damaged / missing) + note, and **Mark lost / written off** (unit leaves availability until you press "Take out of stock" or "Found" on the Equipment card).
- **P0-5 Deletes stick.** Tombstones honoured by every merge; "Clear checkout history" is server-side with a snapshot first; restore is server-side.
- **P0-6 Numbering.** Sequence per (issuer, document type, year); crew prefix mandatory (defaulted from nickname, editable in Profile); the server has the last word on collisions (a colliding number is re-issued with a toast; printed documents never change).
- **P0-7 PII on shared documents.** Per-document toggles: ID card copy default OFF, signature / bank default ON; share links live 72 h, revocable, view-counted; helper text + consent timestamp on the three Profile uploads.
- **P0-8 House documents.** No auto-minting on the Invoice page; explicit "Create quote from job"; drafts get a number on first save; Mark Paid asks for amount + date and refuses ฿0; receipts only via "Issue receipt"; un-mark voids the receipt with a reason; dates stamped in the app timezone.

### P1 (all 14 fixed)
- **P1-1** partial returns (return 3 of 4, remainder stays out as "Missing 1" with the owner). **P1-2** daily mode buckets by a production day (default 05:00, Settings) so night shoots keep their return button. **P1-3** Save Profile / checkout Save / Settings save bars sit above the nav (hit-tested at 390×844). **P1-4** photo preview with Use photo / Retake before commit; undo a pick made this session. **P1-5** geo-gated return tells the distance and the rule, "Retry at shop", tolerance = radius + GPS accuracy, optional shop home base in Settings, request rows show item + distance, "Returns waiting for approval" section, requester notified on approve/reject. **P1-6** Thai coverage across checkout, Today, Gear, Invoice, invoice builder; th-TH dates with Buddhist year; เพนซิล; EN/TH pill on login. **P1-7** crew documents in the crew's own name (FROM block), tax ID / 13-digit ID on profile, tax ID + branch on companies, optional WHT 3% line with net payable, due date, Thai + English titles, bank block independent of the QR. **P1-8** line items wrap to two rows on phones. **P1-9** date/status edits re-check conflicts with a dialog naming the colliding jobs; Pencil soft holds. **P1-10** crew roster per job (role, call time, pickup time), "My jobs" first on Today, Invoice tab offers my jobs, LINE push only on real changes. **P1-11** dashboard "Booked today" + "Physically out", Not Returned rows with qty, due date, OVERDUE badge, crew phone, Receive; overdue in the notifications popover; 09:00 overdue digest (see secrets). **P1-12** can't delete a job/item with units out (offers Cancelled); Not Returned computed from the checkout log. **P1-13** per-field versions, 409 on stale writes, client rebases and retries with a toast. **P1-14** offline reconnect sends the pending delta instead of reloading; profile saves queue.

### P2 (15 of 17 done; P2-1 and P2-3 deliberately not attempted)
- **P2-2** damage reports carry qty + job, take units out of service, red banner on pick rows and admin Checkout rows. **P2-4** document validation + toast. **P2-5** gear request submit disabled until item + date. **P2-6** named staff accounts (owner / counter) with actor stamps on approvals, receives, KPI, deletes; audit log endpoint. **P2-7** dated backup versions (list + pick, content-addressed photos), server-side atomic restore with a pre-restore snapshot, daily auto-backup gated server-side. **P2-8** register asks for phone or LINE ID, "Pending approval" state on login, notify on approve. **P2-9** Bill To snapshot on every save; editing a shared company limited to admin or its creator. **P2-10** crew login is the primary button, admin a small link, PIN hint line. **P2-11** desktop dashboard is a 2-column grid with a "Needs action" rail; one approvals place; header New Job button. **P2-12** control sizes 28/36/44; 44px on Today/Checkout. **P2-13** Dialog primitive (Esc, backdrop, focus trap, ARIA). **P2-14** one-tap camera. **P2-15** scroll to top on tab change. **P2-16** new **Insights** page: utilisation per item, overdue export CSV, per-customer gear history, month-end statement. **P2-17** `api.putData` (Save presets works).

### P3 (6 of 8 done, 2 partial)
- Done: **P3-2** "Punishments" → "Deductions" with rules shown under the crew score and positive adjustments; **P3-3** compact crew Gear tab; **P3-4** department role list + admin-editable roles in Settings; **P3-5** item history paging + date filter + CSV; **P3-6** request rows say what happens next, per-user LINE link code in Profile; **P3-7** admin Checkout titles/dates.
- Partial: **P3-1** component tokens consolidated (fonts, badges, Icon props, emoji sweep) but no React Button/Badge primitives extracted; **P3-8** offline QR encoder ✓, timezone from settings ✓, bundle split (main chunk 1,065 KB → 132 KB) ✓, theme per tenant ✓.

## Before deploying (`/pcd`)

1. Pages secrets: **`SESSION_SECRET`** (`openssl rand -hex 32`; without it every API call answers 500 with a configuration screen), **`LINE_CHANNEL_SECRET`** (webhook refuses without it), **`DIGEST_TOKEN`** (same value on Pages and on the `pickshootreturn-presence` worker, which now carries the 09:00 cron and must be redeployed for the digest). Optional: R2 bucket bound as `BACKUPS` for off-site copies (commented block at the end of `wrangler.toml`).
2. Take a manual backup on the OLD code first (Settings > Backup), deploy, log in as owner, then run **Settings > Photo storage > "Move photos to separate storage"** once, then take another backup on the new code.
3. Everyone is logged out once by the deploy. Calendar subscriptions must be re-added with the new tokenised URL (Settings / crew Profile).
4. Behaviour changes to expect on live data: overdue or unreturned gear now reduces availability; open damage reports take units out of service; jobs/items with units out can't be deleted (Cancelled / Receive instead); the Invoice page no longer auto-creates QUO/INV; receipts only via "Issue receipt"; share links 72 h; ID card prints only when toggled per document; crew without a prefix get one from their nickname on next profile save; 4 legacy checkout ids and 1 receipt id that collided in prod are re-keyed `<id>#1` on first load (verified on the copy: no still-out figure changes); past lost events show as "n lost or written off, still counted" on the Equipment card until you press Take out of stock or Found.
5. Crew who want personal LINE messages add the OA as a friend and send the link code from their Profile once (the OA webhook must be enabled for 1:1 messages).

## Deliberately not done (your call: weeks of work or product decisions)

- **P2-1** per-unit serials / kits / condition grading. **P2-3** house quotes priced from gear × day rate. Multi-tenant / D1 control plane and self-serve onboarding. Scheduled export to R2, PDF generation, invite-by-link registration, LIFF identity (the link-code flow covers LINE identity instead). The presence/chat worker itself was not changed (the Pages proxies in front of it are now gated).

## Where to look

- Per-area walk-through scripts with screenshots: `tests/walk-*.mjs` (auth, crew UX, documents, inventory, roster/ops, review fix-ups, dedupe, bundle split). `tests/README.md` explains each.
- The review this was built from: https://claude.ai/artifact/9AvxPECXNbpKhab58fwmxD
