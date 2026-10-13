# Review and planning artifacts

Planning docs, scorecards, and the Oct 2026 site-wide process-flow review that drove PRs #492–#503 (job-edit scale, payment layers, and review-fix waves W1–W10).

These files were moved into the repo from agent workspace copies so later waves and ops handoffs stay with the code. They are historical planning artifacts, not runtime docs.

## Index

| File | What it is |
|---|---|
| [reviews-source.md](./reviews-source.md) | Original consolidated site-wide process-flow review (passes 1–3). Source of the finding IDs. |
| [reviews-code-fixable.md](./reviews-code-fixable.md) | Classification of findings into code-fixable A / ops B / skip C. |
| [reviews-implementation-scorecard.md](./reviews-implementation-scorecard.md) | Per-finding status scorecard against the review base. |
| [reviews-fix-progress.md](./reviews-fix-progress.md) | Wave tracker for W1–W10 (PRs #494–#503) plus #492/#493. |
| [reviews-remaining-waves-handoff.md](./reviews-remaining-waves-handoff.md) | Handoff for W11–W19: remaining IDs, merge order, env vars, cloud-agent prompts. |
| [oxsteed-payment-layers-spec.md](./oxsteed-payment-layers-spec.md) | Locked payment-rails decisions (implemented in PR #493; see also `docs/payment-layers.md`). |
| [oxsteed-media-spec.md](./oxsteed-media-spec.md) | OxSteed Media product/engineering spec. |
| [oxsteed-credit-everywhere-admin-approval-report.md](./oxsteed-credit-everywhere-admin-approval-report.md) | Credit-everywhere admin approval / maker-checker report. |
| [invoice-flow-findings.md](./invoice-flow-findings.md) | Business invoice flow findings. |
| [business-public-profile-recheck.md](./business-public-profile-recheck.md) | Business public-profile recheck notes. |
| [vortex-completeness-scorecard.md](./vortex-completeness-scorecard.md) | Vortex invite/access completeness scorecard. |

## Related docs already elsewhere in `docs/`

- `docs/job-editing.md` — posted-job edit design (PR #492).
- `docs/payment-layers.md` — payment-rails implementation notes (PR #493).
- `docs/job-status-transitions.md` — job state machine.
- `docs/stripe-connect-helper-business.md` — Connect sources of truth.
- Media runbooks under `docs/oxsteed-media-*`.

## Constraints carried forward

- **P3-1009** (admin credit adjustments skip KYC/sanctions) must not be changed.
- Category **C** findings are skipped.
- Credit approvals and mark-paid always require **two distinct admins** (no single-admin break-glass).
