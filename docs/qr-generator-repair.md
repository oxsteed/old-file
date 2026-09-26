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

## Larger logo uploads

The logo picker now accepts up to 15 MiB (shown as 15 MB in the UI) for PNG,
JPEG, and WebP. The source file stays in the browser; the server still receives
only the final generated QR PNG and keeps its existing 1 MB JSON-body limit.

Before decoding, the browser reads at most 64 KiB of headers, checks that the
content matches the declared supported image type, and rejects dimensions above
24 million pixels or 8192 pixels per side. Files whose dimensions cannot be
determined within that bounded header are rejected. Header parsing uses pinned
`image-size@2.0.4` with only its PNG/JPEG/WebP parsers imported; see its
[buffer API documentation](https://github.com/image-size/image-size#passing-in-a-bufferuint8array).
Header checks are followed by actual browser decoding. The accepted image is
redrawn to a PNG of at most 512 pixels per side, preserving aspect ratio and
transparency while dropping original metadata. Decoding times out after 10
seconds. Changing/removing an upload cancels stale work, and object URLs are
revoked after processing. Client validation protects this browser flow; it is
not a replacement for server-side request limits or authorization.

The real Chrome test accepted an 11.5 MiB JPEG, verified PNG/JPEG/WebP resizing,
and rejected forged PNG content and a file over 15 MiB. Unit tests cover the
exact size boundary, empty/corrupt images, mismatched file types, and excessive
pixel dimensions. The four unit tests now run automatically before `build:ci`.
