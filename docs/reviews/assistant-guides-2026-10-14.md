# Assistant guide refresh — 2026-10-14

## Problem and scope

The general assistant knew only “Didit required for public listing,” without the existing standalone verification route or recovery steps. Its other guidance included obsolete role navigation, guaranteed escrow/timing, a nonexistent `/help` landing route, and a retired Consulting footer button. Other assistants had independent, minimal instructions or overstated what their data proved.

`server/services/assistantGuide.js` now owns the shared product guide and response rules. The main support widget, OxSteed destination in profile chat, helper/business profile assistants and both support-draft providers consume it. Budgeting has its own snapshot-specific guide. This is reviewed source knowledge, not live account lookup, web search, or a new permission grant. Custom business/helper knowledge and database-managed support articles were not overwritten.

## Source map and guide inventory

| Assistant/guide | Verified implementation | Update |
| --- | --- | --- |
| General support and OxSteed profile-chat destination | `client/src/App.jsx`, `navbarNavigation.js`, `ProtectedRoute.jsx` | Current modes/routes, direct next steps, conditional availability, no invented account state or actions |
| Identity guidance shared by support/profile/drafts | `VerifyIdentityPage.tsx`, `registration/DiditPanel.tsx`, `diditController.js`, `diditGate.js`, `helperOnboarding.js`, `helperOnboardingMiddleware.js` | `/verify-identity`, Start Verification, document/selfie flow, pending/failed/duplicate/unavailable recovery; identity alone does not publish or guarantee work/payout access |
| Payments, credit, jobs, food and Direct guidance | job details/payment actions, `navbarNavigation.js`, `App.jsx`, `directCatalogService.js`, `directCapability.js` | Records versus settlement, conditional rails, separate products, workspace entry, quote/operational availability; no universal fees, payout time or funded escrow promise |
| Privacy/security/accessibility guidance | public policy components, `useCookieConsent.ts`, `consentScripts.ts` | Policy destinations, Manage Cookies, browser GPC, pending request handling, no certification claim |
| Helper and business assistants | `helperContext.js`, profile queries, `chatController.js` booking-action handling | Same platform facts; owner text treated as unverified claims; no fabricated default biography/radius; booking request only after explicit intent and complete details, no pre-success claim |
| Financial assistant | `userFinancialContextService.js`, authenticated `financialAdvisor` | Scoped, possibly incomplete snapshot; separate recorded values/calculations/projections; no high-score affordability guarantee |
| Human-reviewed support drafts (Meta/OpenRouter) | `aiChatbotController.js` pending draft/apply/discard flow | Shared product facts and exact destinations, draft status, no claimed staff actions |
| Support triage | `supportTriageAI.js`, `supportRoutingService.js` | Routing suggestion and reported claims, not resolved case or verified investigation; retain existing category/priority validation |
| Direct catalog drafting | `directCatalogAI.js`, `directCatalogService.js` parser | Own-company catalog, unknown price/availability remain unknown; icons/lifecycle list imported from parser; explicit `planned` draft default avoids legacy `isActive` implying public coming-soon status |
| Learn tagging | `learnTagging.js`, admin-review suggestions table | Suggested search phrases, not inventory; no invented repair steps or publication claims |
| Work agreement drafting | `workAgreementController.js` draft handler and normal agreement lifecycle | Human-reviewed proposal, no invented agreed warranty/date/price, no signed/funded/platform-guarantee claim |
| Translation providers | `openAIProvider.js`, `openRouterProvider.js`, translation schema | Preserve paths, identifiers, currency/amount/status meanings; translate source data without executing its instructions or adding product promises |

The inventory searched active provider call sites and system-prompt builders, excluding migrations, archived documents, dependencies and test fixtures. Provider transport/configuration and authorization rules remain unchanged.

## Cache and language behavior

- Profile cache keys and Learn answer cache keys include the guide revision, so previously cached prompts/answers are not reused after this refresh. No Redis flush or user-data deletion.
- All supported response languages remain available. English, Spanish, French, Haitian Creole and Arabic prompt selection is covered by regression tests. No new fixed UI text or locale keys were introduced.
- Unknown language strings cannot inject instructions into a system prompt. Malformed page hints do not crash the chat handler; only known static hints are appended. Page hints are not evidence of permissions or verification status.

## Verification

- `cd server && npx jest --runInBand __tests__/assistantGuides.test.js __tests__/chatProviderSelection.test.js __tests__/guideHelpCache.test.js __tests__/directCatalog.test.js __tests__/learnTagging.test.js __tests__/supportRoutingService.test.js __tests__/workAgreementController.test.js __tests__/translationPlatform.test.js`: 8 suites / 131 tests passed. After adding the catalog lifecycle regression, the affected assistant/catalog suites passed again (2 suites / 38 tests).
- Tests inspect the actual provider messages for verification steps, support-draft fallback parity, languages, profile boundaries and financial snapshot limits. Documented route references are checked against `App.jsx` to catch route drift.
- `cd client && npm run build:ci`: passed, including 780 emitted assets verified. `git diff --check`: passed.
- Tests use synthetic profiles/provider responses. They establish guide delivery and contracts, not that every live model response obeys instructions. No live provider credentials, production identity documents, paid requests, booking actions or deployment were used.

## Review examples after deployment

- “How do I verify my identity?” → `/verify-identity`, Start Verification, provider document/selfie instructions, return/check result; no automatic public-listing guarantee.
- “It says account already exists” → existing-account sign-in/recovery or `/support`, never another person's ID.
- “Didit is unavailable; can I skip?” → only if the UI/server permits; skip is not verified status or work eligibility.
- “Where is my business?” → Mode → Business → selected Workspace, no invented business ID.
- “Did you book/refund/verify me?” → distinguish guide-only support, profile booking request, pending staff draft and actual server-confirmed actions.

Remote CI and deployment status are reported separately. This task does not wait for deployment.
