# Credit statements

## Product and accounting contract

The new statement experience is bank-style presentation of existing restricted
stored-value credit records. It is **not** a bank deposit account, a new payment
ledger, proof of regulatory approval, or a deposit-insurance claim. OxSteed Credit,
each restaurant wallet, and each currency remain separate. Existing payment,
refund, approval, eligibility, and account-authority services are unchanged.

- `/oxsteed-credit/statements` and `/restaurant-credit/statements` provide account
  selection, UTC period selection, posted activity, balances, and PDF/CSV downloads.
- Opening balance plus posted credits minus posted debits must equal the closing
  balance. Every running balance is checked using integer arithmetic before any
  export is allowed. Zero-activity periods retain the previous balance.
- OxSteed Credit uses posted journal timestamps and includes original reversed
  transactions alongside their compensating entries. Restaurant Credit uses the
  original ledger `created_at`: migration 347 assigned a default `posted_at` to
  historical rows, which must not move old activity into the migration month.
- Stable sequence/ID ordering breaks timestamp ties. Historical records that
  cannot reconcile fail closed; this feature does not rewrite old evidence.
- Current pending holds are a separately labeled, current-as-of section in interim
  reports only. They are not completed charges or historical period-end holds and
  never reduce the posted closing balance.

## Issuance and retention

A full, closed UTC calendar month creates one immutable snapshot **on demand**.
Migration 682 keys it by customer, product, account, currency, and period. A unique
constraint and transaction retries make simultaneous issuance return the same
document identity and checksum. UPDATE/DELETE are rejected by a database trigger.
There is no historical backfill or automatic monthly email/scheduler.

Current-month and custom-period reports are interim reports: repeat requests can
include newly posted activity and have a new generation timestamp. UI labels make
that difference explicit. Changing form dates does not change the report or its
downloads until Apply is selected. Account/product changes hide the old report and
cancel requests; late responses cannot overwrite the current selection.

Saved monthly JSON is the issued accounting snapshot, not a second ledger. Later
ledger corrections must use existing compensating transactions, not edit the
snapshot. Downloaded PDFs are generated from that snapshot in the selected
language; their binary bytes can differ by language/rendering version. The SHA-256
checksum verifies canonical statement data, **not** a cryptographic signature of
the PDF or proof of authenticity for an outside bank. Regulatory retention,
customer-data erasure exceptions, and any future amended-statement workflow need
explicit policy approval; deleting a customer must not cascade-delete issued
financial documents.

## API and access

Customer API (the authenticated account is the only permitted owner):

- `GET /api/oxsteed-credit/documents[.pdf|.csv]`
- `GET /api/food/customer/wallets/:restaurantId/statements[.pdf|.csv]`

Query fields: `from`, `to`, `currencyCode`, `language` (en/es/fr/ht/ar). Default is
the previous completed UTC month. Owner/account IDs in the query/body are ignored.
Restaurant wallet lookup also requires the customer, restaurant, and currency.
Existing customer authentication, role/identity rules and export rate limits apply.
Suspended financial accounts can still retrieve historical statements if the user
can authenticate under existing platform policy. Existing CSV endpoints remain.

Super-admin API (existing active-session, role and MFA enforcement):

- `GET /api/admin/super/oxsteed-credit/accounts/:customerId/documents[.pdf|.csv]`
- `GET /api/admin/super/restaurant-credit/accounts/:customerId/:restaurantId/statements.pdf`

The OxSteed Credit customer-detail panel adds a current-month PDF action while
retaining its existing CSV. These routes do not grant ordinary admins access to
another customer's financial documents. Responses use private/no-store, no-cache
and nosniff. Only approved public document fields are rendered: no card credentials,
fraud notes, internal actor metadata or full account identifiers.

## Operational bounds and recovery

- Maximum period: 366 days; maximum complete report: 5,000 entries and 5,000 holds.
  Excess activity is rejected, never silently truncated. Narrow the period or
  contact support. The web table paginates 50 entries at a time.
- All database reads use one repeatable-read snapshot, a 15-second query timeout,
  and the existing export concurrency budget (default two operations).
- PDF work runs in a separate thread, not the API event loop: 60-second wall-clock
  deadline, 256 MiB old-generation / 32 MiB young-generation heap limits, 32 MiB
  result limit, and termination on disconnect/error/completion. The export slot
  remains held until the thread exits. CSV remains available when PDF cannot render.
- No external object storage, provider API, new secret, bank integration or charge
  is needed. Bundled OFL-licensed Noto fonts cover the five supported languages.
  Unsupported scripts fail explicitly in PDF rather than corrupting a name; CSV
  preserves their Unicode text. Mixed Arabic/Latin text is shaped and reordered.
- CSV neutralizes spreadsheet formula triggers, including those behind hidden
  direction marks or whitespace, and preserves minor-unit precision. Downloads
  receive attachment headers only after rendering succeeds, not for JSON errors.
- An integrity failure requires investigation of the authoritative journal and
  its existing reconciliation tooling. Do not edit snapshots, bypass the check,
  or approve a hand-calculated balance. Support should record the product,
  currency, period, statement ID and error code, not ask for passwords or card PINs.

## Verification and release checklist

Verification performed locally on 2026-10-05:

- New service/controller/renderer/worker/route tests plus existing credit/wallet,
  export-rate-limit and admin-authentication tests passed: 39 suites, 738 tests.
- Real-browser checks passed for Apply, PDF/CSV actions, pagination, account/product
  races, unavailable/error/oversize recovery, all five locales, desktop/mobile,
  RTL, keyboard focus, both themes and reduced motion. These use isolated synthetic
  fixtures, not a production charge or authenticated production certification.
- `npm run verify:i18n`, `npm run typecheck`, `npm run build:ci` passed. The statement
  unit/format/localization contract is included in `prebuild:ci`.
- Complete migrations through 682 applied to disposable PostGIS/PostgreSQL 16.
  The real-database rehearsal passed twice after the final service changes, testing
  both products, refund/fee math, timestamp ties, currencies, owner isolation,
  empty-period carryover, concurrent issuance, immutable hashes, active/expired
  holds and reconciliation-failure rollback. No production data was changed.
- Multilingual four-page synthetic PDFs were visually reviewed for headers,
  repeated table headings, all activity, page counts, balances and closing notices.
  Poppler and MuPDF independently rendered the samples. Repeated-image preview
  artifacts were cross-checked against isolated renders and identical PNG pixels;
  the saved documents retain their complete text, amounts and embedded fonts.

Repeatable commands from the respective package directories:

```sh
# client
npm run test:credit-statements
node --test scripts/creditStatements.browser-check.cjs
npm run verify:i18n
npm run typecheck
npm run build:ci

# server
npm test -- --testPathPatterns='(oxsteedCredit|foodWallet|creditStatement|adminAuthSecurity)'
node scripts/credit-statement-samples.js
```

`npm run verify:credit-statements` refuses anything except a **disposable** local
database named `credit_statement_test`. Apply the migrations in that database
first. The rehearsal creates synthetic financial fixtures and intentionally corrupt
evidence for rejection tests; never use a production dump or a shared database.

Production deployment is a separate gate: install the locked dependency tree,
deploy the client/server/fonts together, apply migration 682, confirm `/ready` and
the deployed revision, and perform an authenticated real-account read/download
smoke test for each product. This local commit does not certify deployment,
production data reconciliation, regulatory readiness, or global-scale load capacity.
