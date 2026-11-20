# Helper work execution on PR 805

Integration baseline inspected: `d54c291bc164a272def620c62996a553c83233b6`.
Source backlog: `OxSteed-persona-roadmap.md` supplied by the user. Numbered
backlog entries describe desired behavior; they do not establish authorization.

## Delivered slice

| Roadmap item | Behavior delivered | Entry / outcome |
|---|---|---|
| 176 Active assignment board | Current helper assignments, active/completed filters, scheduled dates, job links and work-record entry | Helper dashboard → Work board; up to 100 recent assignments |
| 178 Work checklist | Persistent per-job checklist with check/uncheck, add/remove tasks, reusable private checklist templates, and private work notes | Work board or assigned job → Work record |
| 179 Progress update | Append-only customer-visible progress entries with timestamps and retry-safe submission | Helper shares; customer reads in the same job |
| 180 Completion handover | Persistent customer-visible handover, versioned with the work record | Job detail; existing job completion remains a separate action |
| 20 Aftercare instructions | Persistent customer-visible instructions linked to the actual job | Job detail, including completed jobs |
| 152 Review question inbox | Needs-information applications surface in the helper work board and link to the exact existing application editor | Work board → Applications; existing resubmission workflow |
| 164 Bid deadline reminders (partial) | Visible expiry notices, expired-bid notices, and reconfirmation entry for pending changed jobs | My Bids → job revision/reconfirmation workflow; no new email scheduler |
| 151 Resume helper application (entry improvement) | Direct Applications/setup entry from the work board; existing cross-device application persistence reused | Work board → Applications |
| 162 Saved job filters (entry improvement) | Direct entry to the existing saved-search manager | Work board → Saved searches; no duplicate search storage |

Private checklist templates are intentionally work-preparation templates. They
are not itemized quotes or pricing rules. Adding a supply reminder records a
checklist task; it does not schedule a notification.

## Access and isolation contract

- Persona/mode strings grant no authority. Every helper operation resolves
  effective `helper.offer_services` access on the server.
- Reading/writing a helper's work record also checks the live job assignment.
  The customer owns a limited read containing handover, aftercare and progress;
  the response never includes checklist/private notes.
- Reassignment creates a separate helper/job record. Neither the old helper nor
  replacement can read the other's private notes. The customer sees the current
  helper's shared record. Recipient/site-contact access is not expanded.
- Progress writes are append-only via the API and idempotent per helper/request
  UUID. Reusing that UUID for another job/content returns a conflict.
- Work-record updates require the expected version. Conflicts preserve the
  client draft and require explicit reload/review; reload warns before replacing
  unsaved content. Templates reset task completion when reused.
- Reads set `Cache-Control: no-store`. User/session changes remount the UI;
  access changes clear the selected work record and refresh. Obsolete reads or
  writes cannot restore earlier data. User-authored content is excluded from
  growth tracking through the private instrumentation boundary.
- No job status, payout, financial ownership, grant or membership is changed by
  this package. Existing arrival, completion, dispute and payment actions retain
  their existing domain workflows. The new routes/UI have no launch flag and
  are available by default to eligible users.

## Verification

Commands executed against this delivery source:

- `client/npm run build:ci`: passed, including locale parity, typecheck,
  production build and emitted-asset verification (1238 emitted assets).
- `node --test client/scripts/helperWork.browser-check.cjs`: passed. Tests draft
  preservation after conflict, persisted checklist/template behavior, shared
  updates, bid reminders, question links, board selection, Arabic RTL,
  revocation, and a delayed pre-revocation response.
- `node --test client/scripts/jobDetail.browser-check.cjs`: passed, including
  its 90 viewport/theme/locale/viewer combinations and job actions.
- `server/npm test -- __tests__/helperWork.db.test.js __tests__/progressiveAccessHelperEnforcement.test.js __tests__/g1ActivationCarveOut.test.js` with
  `ACCESS_TEST_DATABASE_URL` targeting a newly migrated disposable PostGIS
  database: 3 suites / 50 tests passed, 9.578 seconds. Includes real resolver,
  HTTP cache/privacy checks, two-helper isolation, revoked old-link denial,
  expected-version concurrency, validation and idempotency.
- `node --test scripts/check-migration-history.test.cjs`: 6 tests passed.
- Growth instrumentation check: passed, full named coverage.
- `git diff --check`: passed.

The English catalog now uses four generated shards. Normal/recovery loaders and
recovery tests handle that count; no catalog is copied into a monolithic bundle.
The job-detail browser fixture now implements the new work-record response.

GitHub CI must validate the pushed commit. Browser checks use synthetic APIs;
database checks use a disposable local database. No production acceptance or
human screen-reader pass is claimed. Progress refreshes on explicit reload or
access change, with no claim of instant cross-device delivery.

## Remaining scope and rollback

This is an execution slice, not completion of all 50 helper features or the
1,000-entry backlog. Itemized bid/material templates, scheduled deadline
notifications, daily capacity limits, travel-time enforcement, replacement
handoff and ownership migration remain separate work. Existing quote, calendar,
profile, earnings, onboarding and application flows are reused.

The migration is additive. Roll back application code if needed while retaining
the tables and their data; never rewrite an applied migration or discard work
records. No production enablement or deployment was performed here.
