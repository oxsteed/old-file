# Continuation handoff: W10.5 and W11–W19

Prepared 2026-10-13. The goal is **paused and incomplete**. This is a checkpoint,
not a closure report. Resume only when the human authorizes continuation. Do not
repeat an earlier premature claim that the entire goal was completed.

## Checkout and delivery

- Work in `/Users/oxsteed/Documents/GitHub/6`, not the chat's iOS default directory.
- Repository: `oxsteed/old-file`; default: `old-files-claude` (verified with `gh`).
- Continue branch `fix/review-w10_5-post-merge`, originally PR505's branch.
- Verified checkpoint base: `ec76210f191e5bce00fb332e4521d7424709623c`.
  A subsequent explicitly labeled WIP commit preserves the Learn implementation
  and this handoff. Inspect `git log -1` for its exact hash and verify remote parity.
- W10.5 merged as PR567, merge `c790370a9ae686c86df8c0c9f2b43057fc00c674`.
- W11 commits `c408d4c6` and `ec76210f` were pushed. No open PR for this branch
  was found at handoff. The human subsequently authorized committing and pushing
  the unfinished Learn changes as a WIP checkpoint, without claiming validation
  or opening a ready PR. Verify the push result before relying on remote contents.
- Preserve all local work. Fetch and inspect before syncing; do not reset, clean,
  overwrite, or switch away from a dirty checkout. The WIP checkpoint makes the
  unfinished implementation transferable through the continuation branch.
- Finish one entire wave, validate, open a ready PR, obtain green CI and merge;
  then use the fresh default base for the next wave. No W12 before W11 merges.
- Never touch P3-1009. Always retain two distinct admins for maker/checker;
  no self-approval, break-glass, environment bypass or single-admin override.
- Do not wait for deployment. Report local validation, remote CI and deployment
  separately. Follow repository AGENTS.md and use authenticated `gh`.

## Read first and reconcile every ID

1. `docs/reviews/resolution-audit-v2-2026-10-13.md`
2. `docs/reviews/reviews-remaining-waves-handoff.md`
3. `docs/reviews/reviews-source.md` (original finding descriptions)
4. `docs/reviews/w11-reconciliation-2026-10-13.md` (33-ID W11 matrix/evidence)
5. `docs/reviews/review-wave-closure-audit-2026-10-13.md`

W10.5 is merged with green exact-head CI. Its default post-merge verification
run38386697851 succeeded. These results do not prove the new W11 code passes CI.
W11 has only partial local evidence; W12–W19 remain uncompleted/unverified.
Reconcile source IDs rather than relying on historical closed labels.

## Committed W11 checkpoint

Local behavior evidence exists for P1-348, P1-350/351, P1-361/362/363/365/366,
and P2-485. See the matrix for exact scope and limitations. P2-453/454 overlap
the W10.5 audit-column repair and must be recorded as dropped overlaps.

The last committed checkpoint passed 12 focused server suites / 261 tests,
five-language pagination parity, client `npm run build:ci` (776 assets), and
actual support/warranty and Learn pagination browser checks. Those checks
covered requested widths, themes, French/Arabic RTL and keyboard behavior.
They **predate** the dirty Learn implementation. Full W11/full-server/remote
checks remain necessary. Tests are in `server/__tests__/`; browser fixtures are
`client/scripts/w11SupportWarranty.browser-check.cjs` and
`client/scripts/w11LearnPagination.browser-check.cjs`.

## Immediate next task: validate and finish WIP Learn work

The WIP changes target P1-345/346/347/349, with affected P1-350/351 regression
checks. They include migration793, canonical video identity, moderation blocks
that survive deletion, transactional review/flag decisions and audits, durable
review notices/retries, worker wiring, localized notices and admin action errors.
They have **not** passed their required regression tests or build.

New files:

- `server/migrations/793_w11_learn_review_integrity.sql`
- `server/utils/learnVideoIdentity.js`
- `server/utils/learnReviewCopy.js`
- `server/services/learnVideoIntegrityService.js`
- `server/services/learnVideoReviewAlerts.js`

Inspect `git status` for modified controllers, schedule, delivery service, admin
page, Learn page and all ten locale catalogs. Migration793 was not applied as of
this checkpoint; recheck numbering against fresh base and all open PRs before
applying. Migration792 has already been applied twice in isolated tests; do not
rewrite it. Edit en.json textually: it has duplicate keys. Preserve five-language
legacy/namespaced parity and logical RTL CSS.

Important runtime discovery: the scheduler passes an options object into its
worker, while `publishDueGuideVideos(db = pool, {limit} = {})` expects a database
first. The original direct registration silently skipped publication because
options.query was undefined. The dirty schedule uses a wrapper forwarding
`undefined, options`. Prove actual scheduled execution, not merely registration.
Retain the existing 24-hour auto-publication policy.

Next verification work:

- Add isolated real-PostgreSQL tests for SQL/JS identity parity, percent-encoded
  aliases, historical pending/live/pinned duplicates, concurrent submissions,
  fail-closed query errors, moderation/worker races and audit rollback.
- Prove block/delete tombstones survive cascades and prevent aliased re-entry;
  check multiple flags, dismissal, move duplicates and target moderation.
- Prove notice jobs persist on failure, retry safely, use recipient-specific
  idempotency keys and honor actual admin grants/TOTP/status. Do not equate an
  in-app notification acknowledgement with proof of email delivery/retry.
- Review fractional alert batch limits; finish busy/disabled flag buttons and
  44px changed action targets; test localized failure/retry in the actual page.
- Update SQL-aware fixtures in `learnGuideVideos.test.js` for new transaction
  queries and the blocked counter. Never skip or weaken existing assertions.
- Re-run actual notification delivery/parity tests, browser checks and build.
  Record only proven findings, then commit/push progress on this branch.

## Remaining W11 after Learn

The matrix remains authoritative. Open scope includes complaint barriers
(P1-154/360), ticket SLA (P1-364), account enforcement and suspension/session
revocation, financial maker/checker gaps, business moderation and purpose-bound
reads (P2-455–466), onboarding/identity/tax/directory/Stripe refresh behavior
(P2-483/484/486/487/488). Review each original description and verify behavior;
do not replace the complete scope with the easy subset. Only after all W11
findings are proven should the full-wave ready PR and CI/merge happen.

## Isolated environment and evidence

Use `docker --context colima`. The previous disposable PostgreSQL container was
`oxsteed-credit-test-ci-repair-20261013-postgres-1`, loopback55439. Check it still
exists. Tests use synthetic credentials configured in `/tmp/oxsteed-ci-compose.env`
and compose override `/tmp/oxsteed-ci-compose.override.yml`; do not print secrets.
Prefer a random isolated schema and production migration SQL. Do not run test
financial writes or broad cleanup on production. An existing public-schema FK
cleanup issue means broad deletion is particularly inappropriate.

Prior logs, if retained: `/tmp/oxsteed-w11-final-focused.log`,
`/tmp/oxsteed-w11-pagination-build.log`, `/tmp/oxsteed-w11-learn-browser.log`,
`/tmp/oxsteed-w11-browser.log`, `/tmp/oxsteed-w105-remote-verification.log`.
Re-run checks after changes; historical logs alone are not current proof.

Required whole-wave checks include full server Jest, relevant client test/verify
scripts and browser checks, `client/npm run build:ci`, and root
`node scripts/migration-rehearsal.cjs` against the disposable DATABASE_URL.
Watch Server/Client Verification, PostgreSQL rehearsal, Media harness and CodeQL
until green; diagnose failures and retry genuine registry429s. No deployment wait.

## Portable preservation

A local snapshot of modified/untracked non-ignored files, a binary Git diff and
base/status metadata are saved outside this repository under
`/Users/oxsteed/Documents/Codex-Handoffs/review-w11-2026-10-13/`.
The snapshot is unfinished source, not a verified release. On this machine,
prefer the existing checkout. Before restoring elsewhere, inspect destination
status and base and avoid overwriting unrelated work.
