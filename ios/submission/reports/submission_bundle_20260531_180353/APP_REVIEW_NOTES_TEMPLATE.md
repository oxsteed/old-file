# App Review Notes Template (OxSteed)

Paste/adapt this into **App Store Connect -> App Review Information -> Notes**.

## Reviewer Access
- Test account email: `<REVIEWER_EMAIL>`
- Test account password: `<REVIEWER_PASSWORD>`
- If prompted for 2FA: `<REVIEWER_2FA_FLOW_OR_BYPASS_CODE_PROCESS>`

## Backend Availability
- Production-like backend is enabled during review.
- API base used by app build: `https://oxsteed.com`
- Auth base used by app build: `https://oxsteed.com`

## Core Flows To Validate
1. Sign in with test account.
2. Browse/open jobs and helper marketplace.
3. Open messaging, send message, and use in-thread report/block actions.
4. Open Payments and view escrow/payout flows (real-world services only).
5. Open Settings and verify Privacy Policy link + Export Data + Delete Account.

## Payments Business Model Clarification (Guideline 3.1.3(e))
- OxSteed facilitates payments for **real-world services performed outside the app** (home services, consulting, logistics, rentals).
- No in-app sale of digital consumable/non-consumable content unlocks.
- Payment processing is handled via Stripe-based card flows for real-world services.

## UGC Moderation / Safety (Guideline 1.2)
- User messaging includes report and block actions.
- Client-side content screening exists before submission, with server-side moderation pipeline.

## Account / Privacy (Guideline 5.1.1)
- In-app Delete Account flow is available from Settings.
- Privacy Policy is accessible in-app and in App Store metadata.

## Notes for Reviewer
- If any account state needs reset (jobs, payments, role), contact: `support@oxsteed.com`.
