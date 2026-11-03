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

## Remaining
- All scope items 1-8 from the brief.
- Gate + push + PR (authorized; no force-push; never merge).

## Gate status
- Not run yet.
