## OxSteed consulting flyer exports

Source and outputs for the OxSteed Consulting flyer live in this directory.

### Files

- `oxsteed_flyer_v3_larger_font_true.html` - printable HTML source
- `oxsteed_flyer.pdf` - generated 2-page PDF handout
- `oxsteed_flyer.docx` - generated DOCX version
- `oxsteed_flyer_qr.png` - QR code for the intake form
- `oxsteed_logo.png` - rasterized logo used for DOCX export

### Regenerate

1. Install Python dependencies:
   - `python3 -m pip install -r scripts/requirements-flyer.txt`
2. Ensure Chrome or Chromium is available locally.
3. Run:
   - `python3 scripts/export_oxsteed_flyer.py`

The exporter reads the real OxSteed SVG logo from `client/public/icons/icon.svg`,
uses consulting package copy from `client/src/locales/en.json`, and writes the
HTML, PDF, DOCX, QR, and logo PNG outputs back into this directory.
