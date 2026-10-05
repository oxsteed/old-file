# Manual statement screen-reader pass

Status: prepared 2026-10-05; **not executed**. This checklist supplements automated
checks and is not a conformance certificate. Companion evidence:
[verification report](statement-payout-verification-2026-10-05.md).

## Record the environment and sample evidence

- [ ] Assign a human tester familiar with the reader and a fluent reviewer for
  each language: English, Spanish, French, Haitian Creole, and Arabic.
- [ ] Record date, tester, operating system/version, reader/version, PDF
  viewer/version or browser/version, selected voice/language, application
  revision, document/rendition ID, and SHA-256 of tested PDF bytes.
- [ ] Use synthetic statements in an isolated fixture. Any later real-account
  smoke test must use an authorized account; keep its documents and recordings
  private. A recording is optional; a task-by-task result is required.
- [ ] Test intended customer combinations explicitly: NVDA with Acrobat Reader
  on Windows; JAWS with Acrobat Reader for any supported enterprise claim;
  VoiceOver with the intended macOS PDF viewer. For HTML include NVDA/browser
  and VoiceOver/Safari. Record unsupported combinations as unsupported, not pass.
- [ ] Use the actual screen reader. Acrobat's Read Out Loud is a text-to-speech
  tool, not a screen reader.
  [Adobe accessibility reference](https://helpx.adobe.com/pdf/adobe_reader_reference.pdf)

## Sample matrix

For every supported reader/viewer pair, cover the following with a fluent listener
in all five locales. Record each cell pass, fail, blocked, or not run.

| Sample | Required content |
| --- | --- |
| Short monthly Credit | Opening, credits, debits, closing; purchase, load, refund |
| Long monthly Credit | At least 120 rows, multipage table, long wrapped descriptions |
| Restaurant credit and settlement | Independent restaurant identity/currency; requested, processing, completed and failed transfer disclosures |
| Helper earnings and business | Activity/settlement limitations, totals and labeled sections |
| Empty and interim | Zero activity, carryover, current pending holds distinguished from posted transactions |
| Precision and bidi | USD two-decimal, JPY zero-decimal, KWD three-decimal; zero, negative and large values; Arabic mixed with Latin references |
| Amended statement | Amended-version label, original link, reason, corrected period and continuity disclosure |

Generate or fetch fixtures from the current renderers, not a hand-authored PDF.
`server/scripts/credit-statement-samples.js` supplies five-locale illustrative
PDFs for an initial pass. It does not supply the entire matrix above.
For an issued fixture document, the authorized rendition routes are:

```text
GET /api/statements/documents/:documentId/renditions/:language/pdf
GET /api/statements/documents/:documentId/renditions/:language/html
```

Test the exact issued original separately from an accessible rendition. A passing
new rendition never establishes that a historical original was accessible.

## Tasks to perform by listening and keyboard

1. Open the document without a mouse. Hear its title, product/account identity,
   language, period, and original/rendition/amended status. Confirm focus begins
   in useful content and headings form a navigable hierarchy.
2. Read opening balance, credits, debits, closing balance, and currency. Ask the
   listener to state each amount back. Minus signs, decimal precision and zero
   must be distinguishable. Do not accept a value inferred visually.
3. Navigate the transaction table using the reader's table navigation. For the
   first, middle and last rows identify date, description/reference, debit,
   credit and running balance. Column headings must stay understandable.
4. Read continuously across every page transition in the long sample. Verify
   no skipped/duplicated row, description/amount interleaving, or detached amount.
   Repeated table headings should orient the listener; decorative page furniture
   should not interrupt each row or repeat the whole header excessively.
5. Hear Arabic descriptions and Latin references in a sensible order. Verify
   digit grouping and currency against expected facts with a fluent listener.
   Record absent language voices as an environment block, not a renderer pass.
6. Distinguish current holds, posted transactions, transfer initiation, Connect
   transfer completion and bank receipt. Hear the document's limitations without
   relying on color, layout, or footnotes that the reader cannot reach.
7. Reach and activate support, original/amendment and recovery links where
   present. Hear useful names. Return focus to a predictable position.
8. Perform the same fact-finding tasks on the HTML rendition. Hear table caption,
   headings, scoped columns, and account/reference text. Compare its financial
   facts with the PDF; do not accept HTML success as a substitute for PDF results.
9. In the statement application, use only keyboard and reader to choose an
   account, apply dates, paginate, download, encounter an invalid period or
   unavailable document, and recover. Confirm errors and loading/completion are
   announced and focus is visible/predictable. Exercise desktop/mobile layouts,
   both themes and reduced motion on supported combinations.

## Acceptance and record

Any skipped row, wrong spoken amount, ambiguous debit/credit column, inaccessible
essential disclosure or unreachable recovery action fails that combination.
Record viewer-specific defects separately and retest after a fix using the same
fixture facts. All required cells need evidence before making a broad claim.

| Date / tester | Reader + viewer + versions | Locale / fixture / byte hash | Task | Expected speech or fact | Heard / actual result | Status / defect / retest |
| --- | --- | --- | --- | --- | --- | --- |
| Not run | | | | | | Not run |

Report narrowly: "Human-tested with [reader/viewer versions] on [revision and
document samples], [locales], [date]." Report remaining combinations as not run
or blocked. Tags and automated passes alone support neither "screen-reader
verified" nor PDF/UA conformance.
