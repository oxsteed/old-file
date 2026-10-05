# Customer dashboard credit-card crash

## Root cause

The signed-in `/dashboard` browser console reported
`ReferenceError: oxsteedCreditAccount is not defined` from its dashboard chunk.
The customer credit card added in `b1e72c1f` read parent account state inside
`LaunchCustomerDashboard`, without declaring or receiving the account prop.
Once loading finished, the entire route rendered its error boundary.

## Repair and prevention

- Pass the existing account state into the launch component explicitly.
- Default its optional account prop to `null`, preserving the empty state.
- Keep account fetching, permissions, balances, and financial rules unchanged.
- Extend the existing dashboard quick-link suite (already in `build:ci`) with
  real React render coverage for loading, missing/null accounts, reserved funds,
  available balance, and zero available balance. Also assert parent prop wiring.

## Verification

- Rendered the original committed component and reproduced the exact live error.
- `node --test scripts/dashboardQuickLinks.test.mjs`: all 6 tests passed.
- `npm run build:ci`: passed, including translation checks, TypeScript,
  production build, and verification of 699 emitted assets.
- `git diff --check`: passed.

Deployment acceptance requires the fixed revision to be running and the user's
signed-in customer dashboard to render after loading. This document does not
claim live acceptance before that check. Unrelated audit files were preserved.
