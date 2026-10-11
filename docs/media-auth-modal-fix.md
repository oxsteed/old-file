# Media authentication modal repair

The live response on 2026-10-10 used `frame-src` allowing Stripe and Didit,
but not same-origin frames. The Media login iframe was therefore blocked by
Chrome. The previous browser assertion only inspected the iframe URL.

Sign-in, registration, and password recovery now mount the existing React
pages in the dialog, sharing the application's AuthContext. Auth links keep
the dialog open; successful login navigates to the current Media return path
and closes the dialog, including when the path is unchanged. The full-page
link remains available. Standalone auth pages retain their existing layout.
Security headers and server authentication requirements are unchanged.

The return destination includes the current query and fragment after Media
navigation, and survives switching forms. Registration retains its existing
mode-specific onboarding destination. Identity-gated login uses the existing
Media identity verification page with the return destination.

Verification:

- `node --test scripts/mediaShell.browser-check.cjs`: 13 passed.
- The browser fixture enforces production's frame policy and renders actual
  auth forms. It exercises registration rendering, password recovery navigation,
  failed login, successful login, shared session updates, close/focus behavior,
  and return navigation after a Media route change. Auth responses are synthetic.
- `npm run build:ci`: passed, including typecheck and emitted-asset validation.
- Production-build preview at 390px and 1366px: sign-in fields visible, zero auth
  iframes, no horizontal overflow, and no browser runtime errors. Screenshots
  inspected after animations completed.

Local checks do not establish that a release has deployed or that live credentials
were used. No real login or registration was submitted during verification.
