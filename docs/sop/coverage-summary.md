# SOP coverage and review

Reviewed against default branch `old-files-claude` on 2026-10-16. The published registry contains 81 English end-user guides and five role handbooks. One additional lead-pipeline workflow is explicitly unavailable; it has no action link or fabricated walkthrough.

| Family | Supported | Conditional |
|---|---:|---:|
| account | 9 | 0 |
| business-work | 9 | 1 |
| financial | 7 | 1 |
| helper-work | 10 | 1 |
| hiring | 13 | 0 |
| logistics | 10 | 2 |
| other | 7 | 2 |
| restaurants | 9 | 0 |

## Plan reconciliation

- Shared full instructions in canonical guide pages and contextual dialogs; Close returns focus and full guides open separately.
- Shared navigation/footer, search, area/audience filters, current-mode suggestions, and library links in How It Works and Help.
- Device-only reading progress is scoped by account, guide and revision. It does not perform an action or establish its success.
- 326 numbered steps have both desktop and mobile synthetic screenshots. Captures use the actual client and production CSS splitting. Only concrete, visible callouts are retained; other images are captioned as screen overviews.
- Individual guide PDFs and five role handbooks use the same guide data and ordering. PDF generation fails for missing screenshots and records its exact inputs.
- CI checks route declarations, relevant screen/control imports, launch/permission sources, guide content, screenshots and PDF freshness. Normal checks never update the review baseline.
- Account access and work eligibility are separate. Identity approval/skip does not complete other onboarding checks; business access follows business permissions.
- Legacy car-care/planned-needs surfaces redirect, so their guides explain current job-posting alternatives. Business setup uses its real onboarding page. Consulting intake does not promise access to a disabled consulting portal.

## Conditional workflows

- **Submit specialized intake requests (maintenance, trades, beauty, creative, professional, continuity)**: Specialized intake requests require the specializedProfileTemplates launch flag, which is off by default. While it is off, the intake entry buttons are hidden on business profile pages and the public intake API returns 404. The hub intake triage tabs (beauty-ops, creative-ops, continuity-ops, professional-ops, trades-ops, maintenance) are already registered so they appear automatically at launch.
- **Use OxSteed Credit (top-ups, transfers, withdrawals, cards)**: OxSteed Credit requires the oxsteed_credit_enabled feature flag. It is ON in production as of 2026-10-11. If the rail is off, the page shows "OxSteed Credit is temporarily paused" and spending, top-ups, and withdrawals stay paused while balances and history remain visible.
- **View your earnings overview**: The Earnings tab on the helper dashboard is visible only while the helperEarnings launch flag is enabled (it is off by default). Your payouts at /helper/payouts and your earnings statements at /helper-earnings/statements stay available while the tab is hidden.
- **Publish and accept quotes**: Requires LOGISTICS_PAYMENTS_ENABLED=true (default off). While disabled, the quote lifecycle routes answer 503 and the checkout shows a disabled state.
- **Confirm payments at checkout**: Requires LOGISTICS_PAYMENTS_ENABLED=true (default off). While disabled, every checkout route answers 503 and the checkout shows the disabled state "Online payments are not enabled yet. Please try again later."
- **Get help with vehicle care**: This specialized workspace is not available in the current launch. Its legacy address redirects to your dashboard.
- **Arrange recurring household work**: This specialized workspace is not available in the current launch. Its legacy address redirects to your dashboard.

## Evidence boundaries

Screenshots and browser checks use synthetic accounts and API responses. Empty, gated and overview examples do not imply that a record exists or an action was performed. Provider-owned identity/payment steps are explained using the OxSteed handoff, without invented provider screens. Published guides retain actual eligibility and permission requirements; no production flag, backend API, migration or authorization policy was changed.

See `completion-2026-10-16.md` for the executed validation and `scripts/sop/pdf/README.md` for regeneration.
