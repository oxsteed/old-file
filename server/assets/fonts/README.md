# Embedded statement fonts

Unmodified Noto Sans and Noto Sans Arabic Regular/Bold TrueType fonts from
the Noto Project. Bundled and embedded under the SIL Open Font License 1.1
in `OFL.txt`. No operating-system fonts are required or redistributed.

Pinned upstream revision:
https://github.com/notofonts/noto-fonts/tree/ffebf8c1ee449e544955a7e813c54f9b73848eac

Upstream paths: `hinted/ttf/NotoSans/` and `hinted/ttf/NotoSansArabic/`.

SHA-256:

- NotoSans-Regular.ttf: b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5
- NotoSans-Bold.ttf: c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a
- NotoSansArabic-Regular.ttf: ceea25b464a656dc3b26849bab9356740401af62aedf1bfa8b7f0d9b75925b1b
- NotoSansArabic-Bold.ttf: ed2711b387750ae991b6a980b8dd16fdd65e6702b97e9f52adf3a8edf09ef4df

These families cover all five supported statement languages. Unicode text in
scripts outside these families is preserved in CSV. PDF rendering rejects
unsupported glyphs explicitly rather than silently substituting empty boxes.
Unicode bidi ordering uses `bidi-js` before PDFKit/fontkit shapes Arabic runs,
including mixed Latin references and amounts.
