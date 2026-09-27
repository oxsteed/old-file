# QR logo rendering verification

The QR library's default `imageOptions.saveAsBlob` re-fetches the normalized PNG
data URL with XMLHttpRequest. Production permits data URLs as images but not as
`connect-src` requests. The library lacks an error handler for that request, so
its drawing promise never settles and the page remains on the generating stage.

Use the already embedded PNG directly (`saveAsBlob: false`). Keep the existing
15 MiB limit, bounded header validation, pixel limits, worker normalization, and
60-second decoding timeout. Add a separate 15-second rendering deadline and
regenerate when an identical logo is selected again. Normalize worker decode
failures to the existing localized error code and release worker URLs when
worker construction fails.

Verification on this checkout:

- The browser regression reproduced the original hang with restrictive
  `connect-src 'self'` before the fix.
- `NODE_PATH=/Users/oxsteed/.codex/tmp/oxsteed-playwright/node_modules node --test
  scripts/qrGenerator.browser-check.cjs` passed from `client/`, using Chrome and
  playwright-core. It checks actual preview/export logo pixels, PNG/SVG title
  exports, repeated selection, stalled-render timeout and recovery, an 11.5 MiB
  JPEG, PNG/JPEG/WebP normalization, invalid files, save, and saved download.
- Observed small PNG preview times were 58–151 ms; the 11.5 MiB JPEG took
  1.7–3.3 seconds across two runs (the latter ran during the build). These are
  local measurements, not a guarantee for all devices.
- `npm run build:ci` passed, including validation tests, five-language checks,
  typecheck, production build, and verification of 664 emitted assets.

The browser harness uses mocked account/API responses and a real renderer under
the relevant production CSP restrictions. Production deployment was not performed.
