# SOP PDF generation

Builds the downloadable PDFs for the Visual SOP library from the guide data
source. The online HTML guides are the primary edition; these PDFs are
generated snapshots.

## What is produced

- `client/public/sop/pdfs/guides/<guide-id>.pdf` - one PDF per guide (81).
  Each has a first-page note pointing at its online URL
  (`/how-it-works/<area>/<slug>`), an "English" label, revision info, the
  process map, numbered steps with desktop screenshots and annotation
  callouts, the text equivalent of the process map, expected results,
  recovery table, and support/related/link sections. Checklists are
  intentionally omitted (device-only feature). Steps whose screenshot is
  still planned render a labeled placeholder box instead of failing.
- `client/public/sop/pdfs/handbooks/<role>.pdf` - one per role
  (`customer`, `helper`, `business`, `restaurant`, `logistics`). Each has a
  cover page (title, role, revision date, "English" label, revision info),
  a linked table of contents, page numbers on every page
  ("Page X of Y" in the footer), and a revision-history line per guide
  (guide ID + revision number).

No em dashes are emitted in any PDF (replaced with " - ").

## Regenerate

```bash
cd ~/workspace/old-file
node scripts/sop/pdf/generate.mjs
```

Options:

```bash
node scripts/sop/pdf/generate.mjs --guides-only      # skip handbooks
node scripts/sop/pdf/generate.mjs --handbooks-only   # skip individual guides
node scripts/sop/pdf/generate.mjs --guide <guide-id> # rebuild one guide PDF
```

## Dependencies

- Node 18+.
- `playwright-core` (already vendored in `client/node_modules`; the script
  imports it by absolute path so it also runs outside an npm workspace).
- A headless Chromium binary. Default:
  `~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`
  Override with the `SOP_PDF_CHROME` environment variable.
- For visual review: `pdftoppm`, `pdfinfo`, `pdftotext` (poppler-utils) and
  optionally `pypdf` (`pip install pypdf`) to assert link annotations.

## Inputs (read-only; this script never writes to them)

- `client/src/sop/guides/<family>/<guide-id>.js` - guide data (the same
  source the online pages render).
- `client/src/sop/screenshots.json` - screenshot sidecar: image `src`,
  `alt`, `caption`, and annotation callout coordinates, keyed
  `<guideId>/<stepId>/<viewport>`.
- `client/public/sop/screenshots/` - optimized JPEGs, embedded as base64
  data URIs (no network requests during rendering).

Intermediate print HTML goes to `/tmp/sop-pdf-html/` (ephemeral).

## Revision bumping

Each guide data file carries a `revision` number. Bump it whenever that
guide's content changes, then re-run this script (or `--guide <guide-id>`
for a single guide). The revision date stamped on covers and revision
lines is the generation date (US Eastern).

## Size budget

Keep `client/public/sop/pdfs/` under ~200MB total. As of 2026-10-16 the 86
PDFs total roughly 70MB with original-quality JPEG embeds. If the total
approaches the budget, reduce embed quality: add a JPEG encoder (e.g.
`sharp`) and recompress in `imageDataUri()` in `generate.mjs` before
base64-encoding (quality 60 is the agreed fallback).

## Visual review checklist (after regenerating)

1. `pdfinfo` every PDF: opens, page count > 0.
2. Render pages with `pdftoppm` and check: readable text (no overflow or
   clipping), annotation badges legible, sane page breaks, cover and TOC
   of every handbook.
3. Verify TOC links: extract `/Annots` with pypdf and confirm `/Link`
   annotations with `/Dest` entries exist on the TOC pages.
4. Spot-check at least one full guide PDF and ten pages of one handbook
   by eye.
