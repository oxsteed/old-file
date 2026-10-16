# Visual guide artifacts

The online guides, contextual instruction dialogs and PDFs use `client/src/sop/guides/index.js`.
Five role handbooks follow the same guide ordering as the online handbook pages.
English instructions are the first edition; the surrounding UI is localized.

## Refresh workflow

Run from the repository root after installing client dependencies. Chromium/Google Chrome must
be installed locally. CI uses its installed Chrome. Set `SOP_CHROME_PATH` or
`SOP_PDF_CHROME` to override the executable; no workstation-specific path is assumed.

1. Review changed sources and instructions using `node scripts/sop/check-manifest.mjs`.
2. Capture the real client with synthetic API responses:
   `node client/scripts/sop/capture.cjs all`.
   Use an area plus `--guide <id> --force` for a targeted refresh, or `--missing` for missing assets.
   Equivalent route/state recipes share one image. Desktop captures use 1360px and mobile 390px.
   Progress is resumable in the OS temporary directory. Failed actions and unresolved annotation
   targets make the capture command nonzero; review its report instead of ignoring the failure.
   `node client/scripts/sop/discover.cjs <area>` lists actual controls and requested APIs for repair.
3. Inspect the images. A screen overview is explicitly captioned when a requested control is
   absent; do not add a numbered marker to an unrelated element. Hosted provider steps use
   the actual OxSteed handoff, never an invented Didit or Stripe screen.
4. Generate downloads: `node scripts/sop/pdf/generate.mjs`.
   Options: `--guide <id>`, `--guides-only`, `--handbooks-only`.
   Static outputs are under `client/public/sop/pdfs/{guides,handbooks}` and require no
   production browser process. Missing screenshots abort generation.
5. Render and inspect every PDF page:
   `python3 scripts/sop/pdf/verify.py` (PyMuPDF and Pillow required).
   Page images, contact sheets and text-bound checks go under `/tmp/sop-pdf-review`.
   Also inspect selected full-size pages and linked handbook contents.
6. After reviewing content, captures and PDFs, record the baseline:
   `node scripts/sop/check-manifest.mjs --regenerate`.
   This does not bypass stale PDF checks. `docs/sop/pdf-build.json` records the actual
   guide/image inputs used by the PDF generator.
7. Run `cd client && npm run test:sop`, the SOP browser check, and `npm run build:ci`.
   `node scripts/sop/verify-layouts.cjs` checks 320/390/768/1360/1600px, light/dark,
   English/French/Arabic shells, zoom dismissal/focus return and PDF bytes using synthetic data.

`docs/sop/source-manifest.json` records hashes for documented controls, imports, routes,
launch/permission gates, guide revisions, images and downloads. Normal checks never update it.
Source changes identify affected guides and their screenshot keys. Regenerate artifacts and
review them before accepting a new baseline. Reading a guide or checking its device-only
checklist does not perform, approve, verify, book or pay for an action.
