# Review fix-up pass (acceptance round, 2026-09)

What the acceptance review still had open, and what it now does. Branch
`fix/review-2026-09`. Nothing is deployed: this is the local build.

## Gear that is lost or written off (P0-4)

- "Mark lost" defaults to **one** unit (it used to default to every outstanding
  unit), and the row badge reads **Lost ×n** or **Written off ×n** by the reason
  actually chosen.
- A lost unit leaves the still-out list but **keeps reducing availability**: it
  is not on the shelf. The Equipment card shows "n lost or written off, still
  counted in the N units" with two buttons:
  - **Take out of stock (N to N-n)**: the units are gone for good, `total` drops
    and the reminder disappears.
  - **Found, back on the shelf**: they turned up, `total` stays and availability
    recovers.
  Both write `equipment[].lostAdjusted` (units already reconciled) and land in
  the audit log.

## Document numbers (P0-6, P0-8)

- A **voided receipt burns its number**. Re-paying an invoice and pressing Issue
  receipt now mints the next free RTX number (RTX-…-0001 Void, then …-0002), the
  behaviour the Undo dialog already promised.
- A **void receipt is frozen**: no Edit, no delete, on the admin page and in the
  crew list.
- **The server has the last word on a new number** (`functions/_lib/docalloc.js`).
  If two devices mint the same number at the same instant, the PUT that arrives
  second is re-numbered into its own series and answers
  `renumbered: [{ id, from, to }]`; the client adopts it and says so in a toast.
  A number KV already knows for that id never changes, so a printed document
  keeps it.

## Open damage reports (P2-2)

A red "Open damage report on this item" banner is now on the **crew pick rows**
and the **admin Checkout rows** as well (it was only on the Assign modal and the
Equipment list). Nothing blocks the pick: the house may still hand the unit over
knowingly.

## Verification mode "None" (pre-existing, review finding)

Crew could not pick or return at all in None mode (no button on the rows). The
photo lane doubles as the tap lane, so the Out / Return button is back;
`tests/checkout-flows.mjs` and the fix-up walk cover it.

## Per-user LINE (P3-6)

No LIFF needed. Crew Profile > **LINE notifications** mints a 6-character link
code; the crew member sends it to the house LINE Official Account in a 1:1 chat
and the webhook pairs that LINE account with the employee record.

- `employees[].lineUserId` is **server-only**: `GET /api/data` exposes just
  `lineLinked: true`, and an admin save of the employees array carries the
  identity forward from KV (a client value is never trusted).
- `POST /api/notify` accepts `employeeIds` and resolves them server-side; a crew
  session may only address itself.
- Gear-request approve / deny and geo-return outcomes reach the requester's own
  LINE; a job push falls back to the roster's linked members when no group is
  connected. Nothing is sent to someone who is not linked, and the pending-request
  copy no longer promises a message the system cannot deliver.
- Team rows show a **LINE linked** badge; Profile has an **Unlink LINE** button.

## 09:00 overdue digest (P1-11)

`functions/_lib/digest.js` builds the list from the same still-out model as the
dashboard. `GET /api/overdue-digest` previews it (admin), `POST` sends it, once
per tenant day, to the house group and to every linked crew member still
holding overdue gear. The cron lives in the presence worker
(`crons = ["0 2 * * *"]` = 09:00 Asia/Bangkok) and calls the endpoint with
`X-Digest-Token`.

**Ops:** `wrangler secret put DIGEST_TOKEN` on **both** the presence worker and
the Pages project, same value. Optional `APP_URL` var on the worker to target a
preview deployment. With no `LINE_CHANNEL_ACCESS_TOKEN` nothing is sent and the
day is not marked as done.

Pick events now stamp `dueDate`, so a still-out row keeps its due date (and its
OVERDUE badge) even after the job record is deleted.

## Data safety

- **A failed save no longer overwrites another device.** The debounced save
  snapshots the versions and bases of its attempt (`src/logic/sync.js`
  `pendingSave`); the retry PUTs with those, so a field another device wrote in
  between still answers 409 and is rebased instead of clobbered. A remote
  snapshot arriving over a field this device has edited is rebased too
  (`adoptRemote`), never applied wholesale.
- **Closing the tab inside the 3 s save window no longer loses the action**: the
  pending delta goes out on `pagehide` as a keepalive PUT, and the page re-reads
  KV if it comes back.
- **The manual "Save All Settings" waits for an in-flight autosave**, so the two
  cannot race into a 409.
- **A restore sticks**: it stamps `restoredAt` on the id-merged arrays and the
  merges drop incoming records KV does not know that predate it, so a device that
  loaded before the restore cannot re-add what it removed.
- **The photo migration cannot drop a concurrent write**: it re-reads the field
  before the array write and yields the batch (`retry: true`) instead.
- **Crew damage reports are ownership-filtered** on the server (a crew session
  could rewrite or wipe every report), a **pending registrant's hashed PIN
  survives the admin's first save** of `adminRequests`, and **invoice share
  tokens** of other people are stripped from a crew GET.
- Crew can **fill in an EMPTY billing address / tax id / branch** on a
  house-registered company again (existing values and the name stay locked),
  client and server.

## Admin-owned crew roles (P3-4 F18)

Settings > **Crew roles**: one role per line, optional Thai name after a slash
and department after a bar (`Gaffer / หัวหน้าไฟ | Lighting`). When the list has
entries it replaces the built-in department list everywhere (crew profile
positions, admin positions, the job roster, the invoice position picker). Empty =
the built-in list. New KV field `roleList` (in FIELDS / DATA_FIELDS /
SAVE_FIELDS / VERSIONED, so it syncs, version-checks and is in every backup).

## Backups (P2-7)

- The daily auto-backup is **gated server-side** (20 h): a second admin device or
  a cleared browser reuses the day's version instead of minting another one and
  evicting older dailies.
- **Optional off-site copy**: bind an R2 bucket as `BACKUPS` and every manual and
  daily version is also written as `psr/<kind>/<date>/<id>.json` (see the
  commented block in `wrangler.toml`). No binding = no-op; an R2 error never
  fails the backup.

## UI clean-up (P3-1, P3-8, review findings)

- Emoji swept out of the admin UI (Dashboard, Job Bookings, Settings, approvals,
  reports, language picker) in favour of the SVG icon set; hard-coded English
  plurals now go through `tCount`; the two "flat" OT toggles are no longer both
  called flat.
- Em dashes removed from every on-screen string (JSX + base-dictionary overrides
  in `src/i18n/tracks/z-review-fixup.js`).
- Dialogs pick up the palette on the dark themes (they portal to `body`, which
  the theme CSS did not reach).
- The approvals list scrolls instead of clipping, so an expanded geo-return keeps
  its Approve / Reject reachable.
- The crew gear-out card at 390px: "Request early return" is a full-width row
  under the job title, which no longer wraps one word per line.
- Bundle: jsQR is a dynamic import (loaded when a scanner opens) and React, the
  i18n dictionary and the QR encoder are their own chunks: one 1,090 KB file
  became a 689 KB app chunk plus cached vendor chunks.

## Not done

- **Badge / Button / Input / Textarea React primitives** were not extracted. The
  tokens already live in one place (`S.badge` / `S.btn` / `S.input` with the CSS
  variables); turning them into components touches hundreds of call sites across
  a 11k-line file, which is not a safe last-night change. The visible half of the
  finding (status casing, the "Paid ✓" button reading as a status, Thai "จ่ายแล้ว"
  for the Mark Paid action) is fixed.

## Verify locally

```sh
export PATH=~/.local/node/bin:$PATH
node tests/local-server.mjs 8770 ./.wrangler-local --session <name>
node tests/seed.mjs 8770
npm test && npm run i18n:check && npm run build
node tests/smoke.mjs 8770
node tests/walk-review-fixups.mjs 8770     # this pass, API level
node tests/checkout-flows.mjs 8770         # P0-4 lost / receive, None mode
node tests/walk-documents.mjs 8770         # numbers, receipts, company fill-in
```

`.dev.vars` needs `LINE_CHANNEL_SECRET` and `DIGEST_TOKEN` (any value locally)
next to `SESSION_SECRET`.
