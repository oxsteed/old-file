# PR 805 helper activation CI repair

Inspected PR head: `1a649ea1e2882732fbefb9c187c6c6abc576e058`.
Failed run: https://github.com/oxsteed/old-file/actions/runs/44633650437

The four failing database suites seeded effective helper grants and identity /
terms evidence but omitted the payout readiness restored in `35efeaa9b`.
This stopped invoice and bid requests at activation, and job acceptance at the
helper eligibility check, before their intended domain assertions ran.

A shared disposable-test fixture now supplies synthetic W-9, fresh Didit and
Connect readiness. It grants no access and does not mock access enforcement.
The signup journey additionally asserts that bidding is denied with
`activation_incomplete` before this evidence is supplied. Production code and
activation policy are unchanged.

Local verification on the repair source, 2026-11-19:

- All migrations applied to a fresh disposable PostGIS 16 database.
- `npm test -- __tests__/jobEditRace.db.test.js __tests__/paymentLayers.db.test.js __tests__/progressiveAccessSignup.db.test.js __tests__/progressiveAccessInvoices.db.test.js` with both database opt-ins: 4 suites, 39 tests passed, 40.638 seconds.
- `npm test -- __tests__/g1ActivationCarveOut.test.js __tests__/progressiveAccessHelperEnforcement.test.js`: 2 suites, 42 tests passed, 3.586 seconds.
- `git diff --check`: passed.

GitHub CI on the pushed repair commit must provide the final full-suite result.
No production acceptance or deployment is claimed by these local checks.
