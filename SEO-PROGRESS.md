# SEO Improvement Progress (branch fix/seo-2026-11-02)

Base: origin/old-files-claude @ 3b237c925 (PR #670 merge tip).
Ordered by Emile 2026-11-02 ~20:13 EST: independent SEO build, push branch and open PR at the end. Emile merges PRs himself; never merge.
Budget: about 4 hours. Breadth first, depth second, stop at a clean gated PR.

## Status
- 2026-11-02 ~20:15 EST: Worktree created at ~/workspace/.fix-worktrees/seo-2026-11-02, branch fix/seo-2026-11-02, HEAD 3b237c925, clean tree. node_modules symlinked from main checkout. Audit done.
- 2026-11-02 ~20:20 EST: Three tracks fanned out in parallel, each in its own worktree/branch, each told NOT to push (coordinator merges):
  - Track S (server): worktree seo-track-s, branch fix/seo-track-s-2026-11-02. Sitemap extension + redirect cleanup, robots, canonical, prerender/crawler, ?lang= verification.
  - Track M (client meta): worktree seo-track-m, branch fix/seo-track-m-2026-11-02. seoMeta utility, App.jsx route-meta wiring, index.html base tags, noindex table, hreflang via ?lang= scheme.
  - Track P (client pages): worktree seo-track-p, branch fix/seo-track-p-2026-11-02. JsonLd component, JSON-LD on key public pages, H1/alt/link-text/lazy hygiene.
  - File ownership partitioned to avoid merge conflicts: S owns server routes/middleware; M owns App.jsx + index.html + locales; P owns page components + JsonLd. Coordinator owns this file and the final gate/push/PR.

## Baseline (already in repo, from parent audit)
- client/index.html: base description, canonical https://oxsteed.com/, OG + Twitter tags, robots index,follow, sitemap link.
- Server: server/routes/sitemap.js, server/routes/robots.js, server/middleware/canonicalHost.js, server/middleware/prerenderHelperProfile.js, server/utils/seoProfileDescription.js.

## Tracks (each in its own worktree/branch, merged back by coordinator)
- Track S (server): sitemap extension, robots verification, canonical host consistency, hreflang support.
- Track M (client meta): per-route meta utility + App wiring, base index.html improvements, no-index for private routes.
- Track P (client pages): JSON-LD components, H1/heading/alt/link-text hygiene on key public pages, safe performance hints.
- Gate: client build:ci FIRST, then FULL server suite, on the final merged tree. Growth instrumentation --write/--check if growth routes touched.

## Done
- Track S COMPLETE and verified by coordinator: branch fix/seo-track-s-2026-11-02 @ 29bae9985, clean tree, 6 files (+485/-1): sitemap.js, robots.js, prerenderHelperProfile.js, sitemap/robots/prerenderMarketing tests. Sitemap gains /learn, /careers, /media + public career openings (lastmod); robots gains private-area disallows; careers prerender gap fixed (was served noindex despite indexable pages; now MARKETING_PAGES + JobPosting JSON-LD). Tests: 4 suites, 22 tests pass. Sitemap XML parses (43 URLs in mocked run). Corrections to brief: /direct/service-area is a real server page (kept); /discover redirects to /jobs, not /restaurants (omitted, /jobs already listed); canonicalHost unchanged (trailing-slash normalization already in prerender layer); ?lang= honored by client + server.
- OPEN DECISION for merge: /learn is in the sitemap but noindex in two layers (LearnModePage PageMeta + prerender). Track S left the noindex in place (policy call, client file out of scope). Coordinator to decide at merge: drop /learn from sitemap OR lift the noindex if M/P evidence supports indexing it. Do not ship a noindexed URL in the sitemap without a decision.
- Track M COMPLETE and verified by coordinator: branch fix/seo-track-m-2026-11-02 @ 193497555, clean tree, 9 files (+1674/-1). New seoMeta.js (plain DOM, no new dep; data-seo-route tags, hreflang via ?lang= scheme, verified honored) + seoMeta.test.mjs (10/10 pass, caught a resolver collision bug pre-commit) + App.jsx RouteMeta wiring (imports + one component line, no routing refactor) + index.html og:image 512x512 + alt (image verified) + seoRoute keys in all five locales (51 keys, parity, no em dashes, descriptions ≤160 chars, split script run, shards gitignored). Route table: indexable meta for all public groups incl. /learn, /careers, /direct, /restaurants, /food, /jobs/public, /businesses/public, /b/:slug, media public pages; noindex for admin/auth/dashboards/checkout/cart/account/media-private/direct-private/ops + unmatched 404s + all redirect routes (/discover verified redirecting to /jobs via LaunchScopeRouteGate, /features, /hire, /translator, /register, /direct/service-area, /h/:helperId, etc.). Detail pages get truthful generic fallback at route layer; PageMeta on entity pages overrides with real data; buildDetailMeta/applyDynamicRouteMeta exported for pages. JSON-LD skipped (ProfileJsonLd exists, pages track owns it). Growth check: coverage 1, files to annotate 0, no --write needed (RouteMeta returns null). build:ci exit 0 on track branch (incl. verify:i18n, typecheck, client tests). NOT run: live browser meta check (no live browser), server suite (no server files touched). Open items: /logistics/campaigns list/detail indexable only because Guarded without ProtectedRoute (flip to noindex if member-only); media meta applies only while media flag on; seoRoute keys live in legacy catalogs, not namespaced common catalogs.
- Track P COMPLETE and verified by coordinator: branch fix/seo-track-p-2026-11-02 @ e3c6d8dc2, clean tree, 16 files (+362/-10). New JsonLd.jsx (JSON.stringify-only, escaped, no other dangerouslySetInnerHTML). JSON-LD: Home Organization+WebSite graph (no sameAs, none declared); restaurant list ItemList; restaurant detail Restaurant + BreadcrumbList (address gated on real fields, hours only from structured pairs, rating only when reviewCount>0); helper directory ItemList; helper profile ProfessionalService + Breadcrumb + gated FAQ (pre-existing Person block left intact); business profile Breadcrumb + gated FAQ (existing LocalBusiness left intact); careers ItemList; career opening JobPosting + Breadcrumb; how-it-works Breadcrumb + guide ItemList; guide detail Breadcrumb; direct skills ItemList; legal terms/privacy Breadcrumb. H1 fixed: profiles were 0, now name renders H1 via nameHeadingTag prop threaded through BusinessHeader (used only by the two profile pages, verified) -> Hero -> SummaryCard, default H3, rendering unchanged; career opening sections demoted H3 to H2. Alt: restaurant hero/logo + profile avatar now named (were empty); no new lazy loading needed (below-fold images already lazy, hero is LCP); no link-text fixes needed. Verification: esbuild syntax pass on all 16 files; JSON round-trip for every block type incl. hostile </script> escape check (caught and fixed an address-cleaning bug pre-commit); H1 counts traced; diff check clean; no em dashes in added lines. NOT run: build:ci (coordinator runs it on merged tree); full-page bundle attempt fails only on missing generated locale shards in a fresh worktree (not in git), unrelated to new imports. Gaps: Learn (existing HowTo kept, no per-guide URLs to list), About (Organization lives on Home, not duplicated), Direct landing/services/tools (no per-item detail URLs), layout-based legal pages (shared layout untouched), BusinessPublicProfilePage.tsx (not routed), template-branch H1s (template renderer unverified).

## Remaining
- All scope items 1-8 from the brief.
- Gate + push + PR (authorized; no force-push; never merge).

## Merge (coordinator)
- All three tracks merged clean, no conflicts: 88b204f91 (S), d91ea3d08 (M), 30bda250f (P). Merge head before gate fix: 30bda250f.
- /learn decision RESOLVED at merge (commit 609f5d15d): /learn dropped from the sitemap and moved to noindex in the route resolver, because it is noindex in both LearnModePage PageMeta and the prerender shell, and that noindex looks deliberate (Learn is a gated mode experience). The seoRoute.learn locale key was removed from all five locales (exactly 4 lines each, byte-preserving otherwise) and shards regenerated. Sitemap test updated to assert /learn absent. If Emile ever wants Learn indexed, lift PageMeta noIndex + prerender noIndex and re-add all three.
- Targeted re-verification after merge fix: seoMeta tests 10/10 pass; sitemap + robots + canonicalHost suites pass. prerenderMarketing suite fails (13 tests) ONLY because this fresh worktree has no client/dist yet (Track S used a temporary fixture); the gate runs build:ci first for exactly this reason.

## Gate status (final tree, head 2295e0dd8 before this entry)
- Client build:ci: EXIT 0 (built in 1m 22s, 1141 emitted assets verified). Run with NODE_OPTIONS=--max-old-space-size=4096, solo.
- Growth instrumentation --check: coverage 1, interactive 2733, named 2733, files to annotate 0. No --write needed.
- Full server suite: 10,267 passed, 11 failed, 464 skipped, 10,742 total, 812.9s, fresh DB migrated (1065 tables). The 11 failures are EXACTLY the known local base: querystringSecurity (8) + restaurantDevicePairingAudit.db (3). No branch-caused failures.
- Prerender/sitemap/robots/canonical suites with real client/dist: 22/22 pass (the 13 prerender failures seen pre-build were purely the missing-dist fixture artifact).
- Targeted: seoMeta node tests 10/10 pass.
- Tree clean at push. 32 files, +2546/-12 vs base. No migrations, no lightmode file, no money/checkout changes.
- Live verification NOT done: served sitemap/robots and rendered per-page meta against production require a deploy (Emile's domain); sitemap XML was parser-verified from a mocked-router run and JSON-LD blocks JSON-round-trip verified.

## Delivered
- Pushed fix/seo-2026-11-02; PR opened (see receipt). NOT merged (Emile merges).
