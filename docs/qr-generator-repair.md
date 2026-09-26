# QR generator repair - 2026-09-25

The QR page supplied `imageOptions: undefined` and `qrOptions: undefined` when
no logo was selected. The installed QR library merges these values over its
defaults and throws `Cannot read properties of undefined (reading
'hideBackgroundDots')`. A Chrome reproduction confirmed this before the fix.
Both options now contain valid objects. Save and export buttons remain disabled
until rendering completes for the current input; clearing the URL invalidates
the old preview, and changing the title does not regenerate the QR.

The API also wrote images into `/app/public/qr-codes` while Express served
`/app/server/public/qr-codes`. Both now use the existing upload volume under
`runtime/uploads/qr-codes` (or `LOCAL_UPLOAD_DIR/qr-codes` when configured).
The old locations remain read fallbacks. Image-write failures return errors,
and metadata updates now pass the QR ID and owner ID in the correct SQL order.
Saved downloads fetch the image before reporting success.

Verification completed:

- Real Chrome page test: no-logo preview, PNG/SVG image bytes, logo upload and
  removal, blank URL guards, save payload, and saved-image download.
  Run `node --test scripts/qrGenerator.browser-check.cjs` in `client/` with
  Playwright available. This run used the desktop's bundled Playwright through
  `NODE_PATH`. The page test mocks account/API responses and uses real React,
  QR rendering, canvas, FileReader, and browser downloads.
- `npm test -- --runTestsByPath __tests__/qrCodes.test.js` in `server/`: four
  tests passed. Actual temporary image files are saved, served, and deleted;
  database queries and authentication are mocked. Write failures, correct
  owner/ID binding, and the Pro gate are covered.
- `npm run build:ci` in `client/`: passed, including localization, TypeScript,
  production build, and verification of 664 emitted assets.
- Production container inspection confirmed the upload directory has a
  persistent bind mount. No legacy saved QR images were present in the inspected
  container. No customer account records were changed during verification.
