# Restaurant payouts and credit workspace

The merchant Payouts tab now has a finance heading, permission-filtered section shortcuts, separate setup cards, a wallet earnings card, a customer credit inbox, and partner activity. Statements remain behind their existing authorization checks. Reserve and exposure controls use a native disclosure. Stripe disconnect remains confirmed and is separated from routine actions.

## Observed production issue

Clicking the existing payout Retry reproduced HTTP 503 with code `feature_disabled`. The Payments feature gate is disabled; this was not a failed Stripe account lookup. The UI now explains that bank payout setup is unavailable and offers support. This change does not enable Payments, the payout processor, customer top-ups, or partner enrollment.

Partner code `credit_partner_not_found` now shows a neutral enrollment state. Failed requests no longer render fabricated zero totals or an empty activity list, and reports remain disabled until data loads successfully. Failed customer credit inbox requests have an inline Retry instead of looking like an empty inbox. The inbox also has an explicit refresh action.

Wallet earnings load independently of Stripe status. Their unknown/error state is visible. Payout requests require the advertised processor state, minimum amount, available balance, and valid currency precision; the server remains authoritative. Existing approval, refund, grant, reserve purchase, cancellation, and ownership gates remain in place.

Stripe onboarding returns retain the selected business and `tab=payouts`. The server accepts only the numeric business ID and the fixed finance tab for merchant return queries. Arbitrary redirect parameters are discarded, and unsafe origins remain rejected.

## Verification

- Server `npx jest __tests__/restaurantPayouts.test.js --runInBand`: 18 passed, including safe onboarding return URLs and existing owner/staff/admin gates.
- Focused currency/accessibility unit checks: 6 passed.
- `npm run test:restaurant-finance-browser`: synthetic browser coverage for disabled Payments, unknown Stripe state, partner non-enrollment, failed requests versus empty results, payout minimum/maximum/processor gates, request payload/idempotency, permission-filtered actions, and keyboard section focus. Layouts checked at 320, 390, 768, 1360, and 1600 pixels in light/dark and English/French/Arabic RTL (30 combinations).
- New chrome localized in English, Spanish, French, Haitian Creole, and Arabic, with legacy/common namespace parity.
- Three related SOP guides revised, 18 screenshot references refreshed from 10 successful synthetic captures; shared older captures preserved for unrelated guides. Three guide PDFs and five role handbooks regenerated from the same registry.
- PDF verification rendered all 1,028 pages across the eight regenerated downloads with no empty pages, out-of-bounds text, or broken internal handbook destinations. Changed guide pages were visually reviewed.
- Client `npm run build:ci`: passed, including typechecking, localization checks, required regression suites, production bundling, and verification of 989 emitted assets.

Synthetic checks exercise UI behavior without real payment or identity-provider actions. No production financial writes, feature flag changes, migrations, or deployment wait are part of this change.
