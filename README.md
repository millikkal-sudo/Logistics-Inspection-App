# Van pre-departure quality check — Calo UAE

A supervisor clears each chilled van for dispatch at the Central Warehouse.
Temperature readings, photo evidence on every failure, and a hard dispatch hold
when a critical check fails.

Next.js 15 · Supabase · Vercel. Email and password sign-in.

---

## Setup

### 1. Supabase — schema

SQL Editor → New query → paste all of
`supabase/migrations/20260820000000_schema.sql` → Run.

Verify in Table Editor: nine tables, with 6 rows in `check_items`, 6 in `vans`,
6 in `drivers`. Safe to re-run if anything looks short.

### 2. Supabase — storage

Storage → New bucket:
- Name `inspection-photos`
- Public **OFF**

Then Policies → New policy → "For full customisation", create two:
- `INSERT`, role `authenticated`, expression `true`
- `SELECT`, role `authenticated`, expression `true`

### 3. Supabase — auth

Authentication → Providers → Email:
- **"Allow new users to sign up" OFF**
- **"Confirm email" OFF**

The signup toggle is the access boundary. Only accounts you create exist. Leave
it on and anyone with the URL can register themselves.

Turn the Google provider **off** — this build does not use it.

### 4. Supabase — accounts

Authentication → Users → Add user → Create new user. Tick **Auto Confirm User**.
One per supervisor, never a shared login.

A `profiles` row appears automatically. Set `role` there: `admin` for you,
`manager` for Kuldeep and Darius, `supervisor` for everyone else.

### 5. Vercel

Import the repo, then add five environment variables:

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page — **never** prefix with `NEXT_PUBLIC_` |
| `SLACK_WEBHOOK_URL` | Slack → Apps → Incoming Webhooks |
| `SLACK_ALERT_CHANNEL` | `#uae-fleet-ops` |

Deploy. On the supervisor's phone: open in Chrome → Add to Home screen.

---

## Test before anyone relies on it

1. Sign in. You should land on a list of six vans.
2. Run a check with the temperature outside 0–5 °C, plus a photo and a note.
   You should get the amber **Dispatch held** screen.
3. Then verify all four landed:
   - `inspections` has a row with `dispatch_blocked = true`
   - Storage → `inspection-photos` has the photo
   - Slack `#uae-fleet-ops` got the message
   - `alerts` says `delivered = true`
4. Try editing that `inspections` row in the Table Editor. **It must refuse.**

If the photo is missing, the bucket policies did not take. If Slack is silent
but `alerts` has a row with an error, the webhook URL is wrong.

---

## How it fits together

```
src/lib/types.ts                 domain types + resolveStatus. Vendor-free.
src/lib/supabaseClients.ts       PORT — server clients
src/lib/supabaseBrowser.ts       PORT — browser client, photo upload
src/lib/session.ts               PORT — identity
src/lib/alerts.ts                PORT — Slack
src/lib/inspectionRepository.ts  persistence
src/lib/fleetRepository.ts       vans joined to drivers
src/app/page.tsx                 server render, loads everything in one pass
src/components/VanCheckApp.tsx   the phone UI
src/app/api/inspections/route.ts authorization + orchestration
```

**Authorization is in route handlers, not RLS.** RLS has read policies only, as
defence in depth against a leaked anon key. Writes go through the service role
after an explicit check in `session.ts`.

**The verdict is computed once.** `resolveStatus` in `types.ts` runs on both the
phone and the server, so they cannot disagree about whether a van was cleared.

**Records are immutable.** Triggers block `UPDATE` and `DELETE` on `inspections`
and `inspection_results`. A correction is a new inspection with `supersedes_id`;
the reporting view hides superseded rows. Nobody — including you holding the
service key — can quietly rewrite a temperature reading.

**Photos are compressed in the browser** to 1280px / 70% JPEG before upload. A
raw phone photo is around 4 MB.

## Changing the checklist

Add a row to `check_items`. `sort_order` sets the order, `input_type` is
`boolean` or `temperature`, `critical` decides whether a failure holds dispatch.
No deploy needed.

---

## Operating notes

**Password resets land on you.** No email delivery is configured, so you set new
passwords from the Supabase dashboard. Fine for five people.

**Offboarding is manual.** Google SSO would have cut access centrally. Here you
must set `active = false` in `profiles` when someone leaves. Put it on the
handover checklist.

## Known gaps

**No offline mode.** Loading bays and basement parking lose signal, and a
supervisor who loses six checks at 06:30 stops using the app by week two. Queue
submissions in IndexedDB and sync on reconnect. Do this before more than one
person uses it.

**Photos are not shown in the report.** They upload and the keys are stored;
nothing renders them yet.

**Report is today-only.** No date range, no CSV export for an audit pack.

**No re-check flow.** `supersedes_id` is honoured by the schema and the view,
but nothing in the UI pre-fills it from a held van.

## Tech radar note

Calo's radar puts Vercel on HOLD and does not list Supabase; the ADOPT path is
Amplify + Cognito + Aurora + S3. This stack is a deliberate, recorded deviation
to get the app into supervisors' hands without waiting on AWS provisioning. The
`PORT` files above are where that migration would happen.
