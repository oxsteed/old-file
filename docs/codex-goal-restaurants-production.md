# Codex goal prompt — OxSteed Restaurants: 8 iOS apps to production readiness

Paste into Codex CLI as a goal (run from the repo root on a Mac with Xcode):

---

/goal Get all 8 OxSteed Restaurants iOS apps (ios/OxSteedRestaurants{Customer,Manager,POS,Kitchen,Kiosk,Crew,Inventory,Runner}) plus ios/OxSteedFood to a production-ready, archive-able state. Read AGENTS.md first (see the 2026-06-16 session entry for what just changed).

OUTCOME (done = all true):
1. Every one of the 9 Xcode schemes builds with zero errors and launches on the iOS 17+ simulator, each opening to its correct locked startup surface (Customer→ordering, Kitchen→KDS, Kiosk→kiosk, etc.).
2. The shared FoodTheme.swift design system and the RemoteFoodImage real-photo wiring compile and render in every app; restaurant cover photos + menu item photos load (HTTPS URLs only, ATS-safe).
3. The five duplicated core Swift files (FoodModels, FoodAPIClient, FoodStore, FoodTheme, FoodRootView) are consolidated into ONE shared Swift package (e.g. ios/OxSteedRestaurantsKit), marked public where needed, with the per-app copies deleted and each target depending on the package. Each app keeps only its distinct *App.swift entry point.
4. Each app has a unique bundle id, signing config, and an app icon, and `xcodebuild archive` succeeds for every scheme.

VERIFY (evidence required, not assertion):
- Run `build_run_sim` (or `xcodebuild -scheme <name> -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`) for ALL 9 schemes; paste the pass/fail per scheme.
- Run `xcodebuild archive` for all 9; paste results.
- If a build can't be run, say so and stop — do NOT claim done.

CONSTRAINTS (do not violate):
- ADDITIVE ONLY on the backend: do NOT rename food_* tables or remove /api/food or /food/* routes (legacy surfaces depend on them). The pay-at-counter / track-only model stays — do not add required payment processing.
- Keep FoodTheme token names + foodCard(padding:) signatures stable (other code compiles against them).
- Do not regress the web surfaces or the server; if you touch server/client, keep `node --check` and `vite build` green.
- When you finish or hit a blocker (e.g. TestFlight upload needs interactive App Store Connect / Apple Developer credentials you can't access), write a progress report: per-app build status, what's archive-ready, and the exact remaining manual steps (App Store Connect app records, TestFlight internal-tester invites). Update AGENTS.md with the result.

CONTEXT: This is for a same-day pilot with real restaurants. The website already runs the full ordering loop on tablets (see docs/oxsteed-restaurants-go-live-today.md); the native apps are the parallel track. Prioritize getting builds green and archive-ready over adding features.

---

Notes for the operator (you, not Codex):
- Codex can compile, fix build errors, refactor into the shared package, and archive. It **cannot** finish TestFlight itself — creating App Store Connect records and inviting testers needs your Apple Developer login. Expect Codex to hand those steps back to you.
- If you only need a few apps for the pilot today, narrow the goal to Customer + Kitchen + Manager (+ Kiosk) and run the rest later.
