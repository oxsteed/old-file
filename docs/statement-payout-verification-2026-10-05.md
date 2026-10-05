# Payout and statement handoff verification

The initial review below was against local HEAD
`0fc4b8d6dba8e2942676a55947ed51662996f2d3`. During follow-up work on local
`main`, the transaction-helper contract bug was fixed and the payout regression
suite was updated. No migration, provider setting, production configuration,
or payout activation was changed.

## Restaurant payouts

The unsafe ordering is present in `server/services/restaurantPayoutService.js`:
`executePayout` sets processing, calls Stripe, posts the journal, then records
completion and the transfer ID. A journal failure after Stripe succeeds leaves
no committed journal entry or transfer ID. The failure-status update in the
Stripe catch also rolls back when the error is rethrown.

The initial review found the service called `withTransaction(callback, name)`
while `server/utils/transaction.js` requires
`withTransaction(pool, callback, name)`. That caused request, approve, and reject
to fail before reaching their database work, and callback-first test mocks hid
the mismatch. The service now passes the real pool and the focused test mock
asserts that contract. The payout service and deployment wiring suites passed
43 tests after the fix. Fixing the transaction call does not repair the
transfer-before-journal failure window or the separate accounting blocker below.

Two corrections to the supplied description:

- `approvePayout` begins with a **requested** row and writes approved inside the
  same transaction. A rollback in this flow restores requested, not approved.
- The keys share the payout identity but are distinct strings: Stripe uses
  `restaurant-payout-transfer:<id>`, the journal uses `restaurant-payout:<id>`.
  Stripe can prune idempotency keys after at least 24 hours; reuse after pruning
  starts a new request. A delayed blind retry is therefore unsafe.
  [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)

Transfer-created/updated/reversed handlers already exist for Credit settlements
and customer withdrawals in `oxsteedCreditTopupService.js`. They do not handle
the restaurant transfer's `restaurant_payout_id` metadata. The external Credit
reconciler reads other Credit flows, not `restaurant_payouts`. No restaurant
payout outbox, recovery sweeper, automatic payout schedule, or automatic approval
threshold was found in current source. This is a restaurant-specific gap.

The transfer credits a connected Stripe account; it is not proof of arrival at
the restaurant's external bank. Current statement inventory already discloses
that limitation. Keep `PAYOUT_PROCESSOR_ENABLED` unset or false. Its live value
was not inspected during this pass.

### Accounting blocker found during redesign review

Migration 632 and `server/services/oxsteedCreditSubBankService.js` define each
restaurant/currency sub-bank balance as the aggregate outstanding customer
food-wallet balances. `restaurantPayoutService` debits that sub-bank for a
restaurant payout without reducing those customer wallet balances. A payout
can therefore consume funds that the ledger invariant treats as backing
customer wallet value; later customer spending can conflict with the sub-bank
floor. An outbox or retry worker would make Stripe delivery more recoverable,
but would preserve this unsafe accounting basis.

Do not implement or enable a payout processor until the owner/accounting policy
identifies and approves the source account for restaurant-earned, settled
proceeds separately from customer-backed wallet balances, including how
proceeds are recognized and transferred into that payable balance. Then
redesign the journal and payout state machine around that approved source, with
durable intent, Stripe idempotency, webhook reconciliation, and a
stuck-processing sweeper. Keep `PAYOUT_PROCESSOR_ENABLED` unset or false in the
meantime.

Before the signature fix, a synthetic harness with no database or provider
access reproduced both the helper mismatch and the latent Stripe-success then
journal-failure rollback. The harness was temporary and is not a regression
test; its helper-mismatch assertion no longer applies after the source fix. The
result was control-flow evidence, not a PostgreSQL or live Stripe rehearsal.

Future redesign acceptance checklist (not implemented in this pass):

- [ ] Commit the approved intent, balance reservation/appropriate pending or
  clearing journal, immutable transfer parameters, and outbox atomically before
  an external call. First identify an approved payable source distinct from
  customer-backed wallet balances. Do not label cash as transferred before
  provider evidence.
- [ ] Use short transactions and fenced worker leases; no Stripe call inside
  a database transaction. Concurrent approvals cannot overdraw the sub-bank.
- [ ] Persist attempt identity before sending; recover an uncertain outcome
  through provider lookup and metadata matching. Never blindly resend after
  possible idempotency-key expiry.
- [ ] Validate transfer ID, amount, currency, destination, and restaurant payout
  identity on signed webhooks and provider reconciliation. Handle duplicate,
  delayed, reordered, and reversed transfers idempotently.
- [ ] Commit completion/failure evidence and append-only compensating entries
  atomically; compensate a reservation only after an outcome is known.
- [ ] Reconcile stale processing rows and orphan provider transfers; surface
  unresolved outcomes to operators without erasing evidence.
- [ ] Rehearse journal/commit failure, crash after transfer creation, timeout,
  duplicate workers, webhook loss, reversal, and recovery after key expiry on
  disposable PostgreSQL and Stripe sandbox targets.
- [ ] Retain explicit admin approval. Automatic schedules and approval thresholds
  remain separate policy decisions; safe manual approval processing can be
  redesigned without inventing those policies.

## Statement accessibility

Current source has tagged PDF structure and semantic HTML renditions. The HTML
endpoint is mounted at
`/api/statements/documents/:documentId/renditions/:language/html` and generates
an authorized rendition on demand. This does **not** mean every original PDF
already has a separately stored HTML object. Renditions are distinct audit rows;
inline responses are recorded staged, not as verified ready R2 objects.

The automated tests check headings, tables, language, links, marked content,
amount extraction, multipage row continuity, RTL, and unsupported-script recovery.
The browser fixture rerun passed all five locales, light/dark, desktop/mobile,
RTL, reduced motion, and the keyboard-focus assertions it implements. It does
not establish complete keyboard usability or real screen-reader behavior.

The existing matrix explicitly says manual screen-reader verification was not
performed. No human listening evidence was established here. Do not claim
screen-reader verification or PDF/UA conformance. Use
[the manual pass checklist](statement-screen-reader-checklist.md).

## Private statement artifacts

The missing-bucket fail-closed behavior is confirmed. The dedicated adapter also
requires a valid dedicated bucket, an accepted HTTPS Cloudflare R2 endpoint,
dedicated R2 credentials, and `STATEMENT_R2_PRIVACY_ATTESTED=1`. It rejects the
configured public-upload and backup bucket names. The attestation records an
operator's review; the application cannot itself prove dashboard privacy settings.

Original object keys are opaque and contain UUIDs. Publication reads bytes back
and compares size and SHA-256 before ready. There is no public/local storage
fallback. On 2026-10-05, the open Cloudflare account was used to create
`oxsteed-statement-artifacts`. The settings page confirmed Eastern North America
(ENAM), Standard storage, 0 B / no objects, no custom domain, public development
URL disabled, and no bucket lock rules. The overview showed public access
disabled. No object lifecycle retention rule was configured. These are directly
observed provider settings; no token was created and no Coolify secret, runtime
variable, deployment, issuance, or object download was changed. Follow
[the R2 setup and acceptance checklist](statement-r2-setup-checklist.md).

## Commands and results from this pass

From `server/`:

```sh
npm test -- --runTestsByPath __tests__/restaurantPayoutService.test.js __tests__/statementPrivateStorage.test.js __tests__/creditStatementPdf.test.js
```

3 suites / 61 tests passed. Payout tests mock the transaction helper; they do
not override the reproduction above.

```sh
npm test -- --runTestsByPath __tests__/statementAccessibility.test.js --testNamePattern='accessible tagged PDF|accessible HTML rendition|unsupported-script path'
```

Initial run: 7 passed, 4 failed because local `pdf2json` was missing, 2 database
tests excluded. At the time, `pdf2json@3.1.5` was declared. The later branch
merge includes Dependabot's `pdf2json@3.2.2` update in server/package.json and
the lockfile. Temporary setup and rerun used the merged version:

```sh
npm install --prefix /tmp/oxsteed-statement-review-2026-10-05 --no-save --package-lock=false --ignore-scripts pdf2json@3.2.2
NODE_PATH=/tmp/oxsteed-statement-review-2026-10-05/node_modules npm test -- --runTestsByPath __tests__/statementAccessibility.test.js --testNamePattern='accessible tagged PDF|accessible HTML rendition|unsupported-script path'
```

11 passed; 2 database rendition-recording tests intentionally excluded. The
parser emitted fake-worker/link-form warnings. Passing text extraction and
structural checks do not prove assistive-technology behavior.

From `client/`:

```sh
node --test scripts/creditStatements.browser-check.cjs
```

4 tests passed, including the 20 locale/theme/viewport combinations. This uses
synthetic HTTP fixtures; downloads are mock payloads, not rendered PDFs.

`client/npm run build:ci` passed; Vite reported an existing duplicate `item_id`
key warning in `RestaurantAuditPanels.jsx`. The full server Jest run completed
with 404 passed, 4 skipped, and 57 failed across 409 suites; failures came from
database tests unable to connect to local PostgreSQL and the local missing
`pdf2json` package. The 11 parser-dependent accessibility tests then passed
using temporary `pdf2json@3.2.2`. The isolated Colima app passed `/ready` with
690/690 migrations and its smoke test verified a pending maker-checker load
without changing the wallet ledger; its disposable containers and volumes were
removed. This does not substitute for the full database-backed Jest run.

No authenticated production smoke test, payout provider write, or manual
screen-reader session was run. Next actions: resolve the payable-source
accounting blocker with the owner; execute and record the human reader checklist;
complete the R2 credential, retention, deployment, and issuance checks in the
setup checklist. Only then implement a payout state machine against the approved
payable balance.
