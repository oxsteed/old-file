# SOP plan completion - 2026-10-16

Base: verified GitHub default `old-files-claude`, pulled at `8e680825` before the review.
Scope: public end-user instructions; no backend, migration, permission or production flag changes.

## Gaps resolved

- Connected the real 81-guide registry to the library, role handbooks and contextual routes;
  removed sample-only route mapping. Current account mode suggests an audience without switching it.
- Added shared navigation/footer to SOP routes and discoverable library links in How It Works,
  area guides and footer Help. Contextual help is available through the shared navbar, including
  task pages that do not use PageShell. Optional help chunk failure cannot replace the task page.
- Contextual dialogs contain the same full instructions, process maps, steps and checklist as
  the canonical page. They preserve unsaved task values, support Escape, contain focus and
  return it to the opener. Full guides open in another tab.
- Connected individual guide and role-handbook downloads to their static PDF assets.
- Corrected launch-disabled car-care/planned-needs instructions to current job-posting alternatives;
  removed disabled consulting/availability/launch-status paths as actionable instructions.
  Business setup uses the actual business onboarding route. The unavailable lead pipeline has
  an explanatory card rather than a dead action link.
- Corrected hosted identity instructions to describe the OxSteed handoff without inventing
  provider screens. Ordinary account access, identity status, other work requirements and
  business permissions remain separate. Background checks may be required for certain activities
  or requested by clients.
- Replaced workstation-specific capture/PDF paths and temporary plan dependencies with portable,
  reproducible tooling. Captures build the real App using Vite production CSS splitting and
  synthetic APIs. Equivalent recipes share images; progress is resumable and failures are explicit.
- Refreshed all 326 steps in desktop/mobile viewports: 652 image references, 389 unique images.
  Removed unverified/generic callouts and retired image files. Retained 84 concrete visible
  callouts. Captions explicitly identify screen-overview examples when a described control is absent.
- Rebuilt 81 guide PDFs and five role handbooks from the same data and handbook ordering.
  Generation fails for missing screenshots; PDF input hashes prevent accepting stale downloads.
- Added CI checks for content, references, route declarations, documented source/control imports,
  launch/permission sources, screenshots, callouts, and PDF freshness. Baseline updates are explicit.
- Localized new interface labels in English, Spanish, French, Haitian Creole and Arabic,
  including namespaced/legacy parity. Guide instructions remain the English first edition.

## Executed validation

| Check | Result |
|---|---|
| Client `npm run build:ci` | Passed, including typecheck, localization and production asset verification |
| Client `npm run test:sop` | 4 tests passed; content/artifact review baseline matches |
| SOP route browser regression | Passed: real registry, guide/handbook rendering, contextual instructions, keyboard dismissal/focus and account-scoped progress |
| Navbar/footer browser regressions | 2 tests passed, including responsive controls, utility access, shared support membership and cookie/invitation flows |
| Layout matrix | 30 variants passed: 320, 390, 768, 1360, 1600px; light/dark; English/French/Arabic RTL |
| Real task preservation | Post Job title draft survives contextual help; full guide opens separately; focus returns |
| Image viewer/download | Zoom, Escape, focus return and static PDF bytes passed |
| PDF review | All 86 documents / 1,568 pages rendered; no empty-text or out-of-page text findings. Contact sheets and selected full-size pages inspected |
| Handbook destinations | Valid internal named destinations: customer 44, helper 37, business 26, restaurant 19, logistics 17 |
| Production build copy | All 475 active SOP image/PDF assets match public source bytes |
| Diff whitespace | `git diff --check` passed |

Screenshots use synthetic accounts, records and payment/identity examples. They do not establish
production outcomes or prove provider configuration. Some examples intentionally show overview,
empty or conditional states; the instructions require checking actual saved results and permissions.
Keyboard/browser checks are automated evidence, not an independent accessibility certification
or a human screen-reader acceptance pass.

## Delivery

Changes are prepared for the verified default branch. Remote CI and deployment are separate
from local verification. No deployment wait is required. See `scripts/sop/pdf/README.md` for
capture, artifact generation and review commands.
