# Authentication and accounts (auth track, review items P0-2 / P2-6 / P2-8 / P2-10)

## What changed

- Nobody's PIN ever leaves the server. `POST /api/login` checks it against a PBKDF2-SHA256
  hash (100k iterations, per-account salt) and sets an httpOnly `psr_session` cookie
  (SameSite=Lax, Secure on https, 30 days, renewed while in use). `GET /api/data` never
  returns `adminPin`, `adminPinHash`, `employees[].pin|pinHash`, `staff[].pinHash` or a
  member-register `requestedPin*`. The app never renders a PIN anywhere.
- Every `/api` function requires the session: data, photo, profile, backup, backup_auto,
  history-clear, tombstone, migrate-photos, notify, invoice-share, calendar-token, audit,
  session (presence) and chat. `/api/invoice-view/<key>` (shared link) stays public by
  design. CORS `*` is gone (same-origin only) and a mutating request whose `Origin` is not
  the site is refused.
- Roles on `PUT /api/data`: an admin may write any field; a crew session only
  `checkouts`, `equipmentRequests`, `adminRequests`, `invoices`, `reports` and
  `productionCompanies`, and inside them only records that belong to the session
  (`employeeId`, or `addedBy` for production houses). Foreign records are kept exactly as
  KV has them. Invoice ownership is the session, the old `_invoiceEmployeeId` is ignored.
- Profiles are keyed to the session: crew read/write only `profile_<own id>`, admin any.
- The login screen: crew first ("Crew / ทีมงาน"), admin a small link, EN/TH pill, "Your PIN
  comes from the rental house". Wrong PINs: 5 per 60 s per IP + account, then a 429 with the
  countdown coming from the server (a reload does not reset it).
- Registration asks for a phone or LINE ID, hashes the requested PIN at once, shows
  "Waiting for approval" on the device that asked, and the approval (server-side,
  `POST /api/approve-member`) creates the account, stamps who approved and pushes to the
  LINE group when one is connected.
- Staff accounts (P2-6): Settings > Admin accounts (owner only). The legacy admin PIN is the
  **owner**; add named counter / owner logins with their own PINs. Every admin session keeps
  `id: "admin"` (house documents, presence and chat are unchanged); `user.name` /
  `staffId` / `staffRole` say who. Approvals, admin pick / return / lost / receive events,
  KPI deductions and invoice soft-deletes carry `by: <name>`; tombstones carry `deletedBy`;
  backups, restores, clear-history, PIN resets, staff changes and job / equipment / company
  deletes land in the server-owned `auditLog` field (`GET /api/audit`, admin).
- Calendar feed: `GET /api/calendar?token=<calendarToken>`. The token is created at the
  first login after this deploy and shown (with a rotate button) in Settings and in the
  crew Profile. **Existing calendar subscriptions stop working** until they are
  re-subscribed with the new URL.
- The LINE webhook now refuses to run without `LINE_CHANNEL_SECRET`.

## Before deploying (Koon)

1. Cloudflare Pages > pickshootreturn > Settings > Environment variables (Production):
   - `SESSION_SECRET` = a long random string, for example `openssl rand -hex 32`.
     Without it every API call answers 500 "SESSION_SECRET not configured" and the app
     shows a configuration error screen. Rotating it logs everyone out.
   - `LINE_CHANNEL_SECRET` = the channel secret from the LINE Developers console (the
     webhook refuses events without it; `LINE_CHANNEL_ACCESS_TOKEN` stays as before).
2. No data migration. The prod KV keeps working as is: the first successful login of the
   owner (with the current admin PIN) and of each crew member (with their current PIN)
   rewrites that PIN as a hash and deletes the plaintext. Verified against the
   2026-09-16 prod copy (`tests/walk-auth.mjs`, section 6 of `tests/README.md`).
3. After the first owner login: Settings > Admin accounts > give the owner a display name
   (it becomes the actor stamp), add counter staff if wanted, and copy the new calendar URL
   to whoever subscribed to the old one.
4. Everyone is logged out once by this deploy (there was no server session before).

## Local development

`node tests/local-server.mjs <PORT> ./.wrangler-local` writes a random `SESSION_SECRET` to
`.dev.vars` (gitignored) if the file has none. `wrangler pages dev` reads it from there.
A fresh (empty) local KV accepts the bootstrap owner PIN `1234` once, then hashes it.

## Endpoints added

| Route | Who | Purpose |
|---|---|---|
| `POST /api/login {role, empId?, staffId?, pin}` | public | issue the session cookie (429 + Retry-After on abuse) |
| `GET /api/me` | public | `{ user }` or `{ user: null }` |
| `POST /api/logout` | any | clear the cookie |
| `GET /api/public` | public | company name, crew names, staff names, pending registrations (login screen) |
| `POST /api/register {name, contact, pin}` | public, rate-limited | member-register request with a hashed PIN |
| `POST /api/approve-member {requestId, approve}` | admin | create the employee from the request / reject |
| `POST /api/pin {oldPin, newPin}` | any | change your own PIN |
| `POST /api/employees/:id/pin {pin, name?}` | admin | set / reset a crew PIN (creates the member with `name`) |
| `GET/POST /api/staff`, `PUT/DELETE /api/staff/:id`, `POST /api/staff/:id/pin` | owner | staff accounts |
| `POST /api/calendar-token {rotate?}` | admin | the calendar feed token |
| `POST /api/audit`, `GET /api/audit` | any / admin | actor log |

KV fields added (server-owned, never written through `PUT /api/data`, included in backups):
`adminPinHash`, `staff`, `calendarToken`, `auditLog`. `adminPin` is deleted on upgrade.
