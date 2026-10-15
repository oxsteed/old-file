# Account-first Statements

Replaces the product-card regrouping in `74c68993`. The center now presents
actual authorized accounts in Personal and Work & business. Selecting one opens
its record types, currency/restaurant-location scope, period controls, review,
and downloads within `/statements`. Full-page destinations remain available
with account, currency and period context. Business record switches retain the
chosen year/month. No unlike balances are added together.

Restaurant settlement scopes now include their business ID so their credit
journal and settlement documents can share a business selection with business
records. Customer-owned restaurant wallets remain Personal accounts, separate
from merchant records. Wallet scopes include their existing account IDs for
precise archive filtering. These are additive fields on the existing authorized
response; there are no new APIs, authorization changes or migrations.

The center no longer uses the old preview modal. It embeds the established
credit and archive views with a fixed account scope, one navbar/footer, and no
nested main landmarks. Missing products do not produce account cards. Partial
errors remain explicit; retry and account changes cancel obsolete requests and
hide stale financial views. New copy exists in the active `statements.center`
namespace and matching legacy `statementCenter` catalogs in en/es/fr/ht/ar.

## Verification

- `node --test scripts/statementAccounts.test.mjs scripts/creditStatements.test.mjs`:
  16 passed, including ID-based grouping, currency isolation, irrelevant-account
  suppression, full-page routing, and five-language namespace/legacy parity.
- `npx jest __tests__/statementCenter.test.js --runInBand --forceExit --silent`:
  12 passed against the existing mocked database, including the additive IDs.
- `node --test scripts/creditStatements.browser-check.cjs`:
  4 passed with the center suite, retaining applied-period downloads, pagination,
  account race protection, error recovery, locales and theme coverage.
- `node --test scripts/statementCenter.browser-check.cjs`: 4 passed. Exercises real center,
  credit and archive components with synthetic API data. Covers customer account
  and currency selection, PDF download, archive scope, keyboard focus return,
  restaurant/business grouping, helper account scope, personal restaurant wallet,
  record switching, browser Back, partial failure/retry, and stale user requests.
  Layout checks cover all five locales, light/dark, and 320/390/768/1360/1600px;
  French and Arabic also exercise the selected business with a long name.
  French desktop and Arabic mobile screenshots were inspected locally.
- `npm run build:ci`: passed all required client checks, localization validation,
  TypeScript, production build and emitted-asset verification.
- Final production build was repeated after the last period-preservation edit.
- `git diff --check`: passed.

An initial browser assertion compared optional undefined query keys incorrectly;
it was corrected. Focus return now waits for router navigation to commit before
checking the focused element.

## Limits and release

These are synthetic browser and mocked-service checks, not acceptance against
production financial accounts or a human screen-reader session. The broader
statement audit (case follow-up, reconciliation, correction comparison, search
coverage, and export handling) is outside this navigation delivery and remains
separate work. This delivery does not declare the complete Credit goal finished.

Deployment is separate from local verification. Do not wait for deployment;
check the pushed revision's GitHub CI and report its current state at handoff.
