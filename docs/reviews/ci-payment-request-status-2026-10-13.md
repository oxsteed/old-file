# Payment request initialization CI repair

GitHub CI run 38420398361 on branch `fix/review-w10_5-post-merge`
failed during `verify:frontend-references` at
`PaymentRequestCard.jsx:78`: `status` was read in an effect dependency list
before its declaration. This also causes a render-time initialization error.

Initialize the derived request status after its state declarations, before
registering the polling effect. Payment eligibility and polling behavior remain
unchanged.

Validation performed on October 13, 2026:

- `cd client && npm run build:ci`: passed, including the frontend reference
  check (zero findings), regression scripts, localization checks, TypeScript,
  Vite production build, and verification of 777 emitted assets.
- `git diff --check`: passed.

Remote CI must be verified separately after the push. No merge or deployment
is part of this repair, and this does not complete the remaining review waves.
