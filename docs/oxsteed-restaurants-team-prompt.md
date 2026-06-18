# OxSteed Restaurants — Team Work Prompt

Copy everything below this line and give it to your team.

---

## Mission

Make the **8 OxSteed Restaurants iOS apps** and **`/api/food` backend** production-grade for a real independent restaurant pilot — not cosmetic UI only.

Each app is a **single-role App Store binary** (Customer, Manager, POS, Kitchen, Kiosk, Crew, Inventory, Runner) sharing one backend. Success means an owner can onboard, go live, run a full service day (kiosk → kitchen → queue → customer order/track), and customers trust what they see (live updates, honest empty states, reviews).

---

## Read first

1. **`AGENTS.md`** — authoritative status. Start at **§ OxSteed Restaurants — Remaining Work (Phased Backlog)**.
2. **`docs/oxsteed-restaurants-strategy.md`** — product vision and modules.
3. **`docs/oxsteed-restaurants-system-blueprint.md`** — in-store loop and gap analysis.
4. **`docs/oxsteed-restaurants-design-benchmarks.md`** — UX principles.
5. **`docs/oxsteed-restaurants-go-live-today.md`** — pilot runbook.

**Hard rules:** Do not rename `food_*` tables or remove `/api/food`. User-facing brand is **OxSteed Restaurants**; `food_*` is internal legacy. Pay-at-counter stays the default worldwide model; Stripe checkout is optional.

---

## What already works (do not re-build)

- Restaurant create → **draft** → menu → **Go Live** (`status: active`) via Manager **Orders → Merchant** or web `/food/merchant`
- Customer discover / order / track (+ optional Stripe hosted checkout)
- KDS, queue board, kiosk self-order
- `/restaurant-display` Socket.IO on **iOS Customer, Kiosk, Kitchen** (+ web KDS/queue)
- Operational backends: checklists, SOPs, inventory, crew training, runner tasks, Marketplace Help (varying depth)
- **Phase 4 visual shell** on all 8 apps: `FoodRoleAppShell`, floating tab bar, shared `FoodTheme.swift` (byte-identical across 8 targets)
- Logo-aware `FoodBrandMark`, crew interactive quizzes, manager priority/KPI/quick actions, runner route timeline

**All 8 schemes build** on macOS:

```bash
for app in Customer Manager POS Kitchen Kiosk Crew Inventory Runner; do
  xcodebuild -project "ios/OxSteedRestaurants${app}/OxSteedRestaurants${app}.xcodeproj" \
    -scheme "OxSteedRestaurants${app}" -configuration Debug \
    -destination 'generic/platform=iOS Simulator' build
done
```

Update **`AGENTS.md`** after meaningful progress (flip backlog `[ ]` → `[~]` / `[x]` + one-line session note at top).

---

## Architecture you must respect

| Area | Rule |
|------|------|
| **Shared design** | `FoodTheme.swift` is **byte-identical** across all 8 `OxSteedRestaurants*UI` targets — edit once, copy to all 8 |
| **Drift problem** | `FoodRootView.swift`, `FoodStore.swift`, `FoodAPIClient.swift`, `FoodModels.swift` are **duplicated per app** — minimize changes; consolidation is Phase F |
| **Dedicated apps** | Use `FoodAppShell.isDedicated` — hide horizontal `FoodModeCard` rails; use `.foodDedicatedTabBar(...)` |
| **Backend** | Additive migrations only; do not break `/api/food` contract for shipped iOS builds |
| **Real-time** | Socket enhances poll; keep 5s poll floor until socket proven everywhere |
| **Branding** | Restaurant-first (logo, name); OxSteed is “Powered by” network, not the storefront owner |

**Key paths:**

- Package: `ios/OxSteedRestaurantsShared/Package.swift`
- 8 app shells: `ios/OxSteedRestaurants{Customer,Manager,...}/` — only `*App.swift`, assets, plist
- Per-app UI: `FoodRootView.swift`, `FoodStore.swift`, `FoodAPIClient.swift`, `FoodModels.swift`
- Food API: `server/routes/food.js`, `server/controllers/foodController.js`
- Restaurant ops: `server/routes/restaurants.js`, `server/controllers/restaurant{Ops,Inventory,Crew,Runner,Help,Pos,Kiosk}Controller.js`
- Migrations: `server/migrations/305`–`315`
- Web: `client/src/pages/food/*`
- Dedicated role lock: `Info.plist` keys `OX_ALLOWED_WORKSPACES`, `OX_DEFAULT_WORKSPACE`

---

## Phased backlog — work in this order

### Phase A — Pilot loop (highest priority)

Goal: **one real restaurant, four tablets, one day of service.**

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| **A1** | Ready notification E2E | When staff sets order `ready`, signed-in customer gets push/in-app; guest with phone gets SMS; guest with email gets email. Prove in staging with Twilio/VAPID/SMTP configured. Starts in `notifyFoodOrderReady()` in `foodController.js`. |
| **A2** | Real-time everywhere | Wire `/restaurant-display` socket (pattern: `RestaurantDisplaySocket.swift`, `client/src/api/restaurantDisplaySocket.js`) to **Manager, POS, Customer Track, web kiosk/confirmation**. iOS Customer/Kiosk/Kitchen already have socket. |
| **A3** | Prod migrations | Run 305–315 on staging/prod Postgres; document env checklist. No silent sample-mode in prod. |
| **A4** | Stripe E2E | Hosted checkout completes in real Stripe test mode; order marks paid via return URL. |
| **A5** | App Store Connect | Metadata + external TestFlight per app. |
| **A6** | On-device pilot QA | Kiosk lock via Guided Access or MDM; operational run-through. |
| **A7** | Honest empty states | Customer must **not** show `FoodSampleData.restaurant` when API returns empty — show real “no restaurants near you” UI. |
| **A8** | Kitchen phone KDS QA | Compact NEW/COOKING/READY inside Phase 4 shell; verify on physical iPhone. |

### Phase B — Customer trust

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| **B1–B3** | Food reviews + ratings | New `food_reviews` table: `restaurant_id`, `order_id`, `customer_id`, rating 1–5, body. One review per completed order. `GET /api/food/restaurants` returns `avg_rating` + `review_count`. Discover cards show stars. Post-order prompt on Track after `completed`. |
| **B4–B5** | Loyalty + promos | Backend ledger + customer redeem; restaurant-created promo codes (not POS-only discounts). Perks UI exists but backend is thin. |
| **B7–B8** | Hours + setup wizard | Operating hours on restaurant; block or warn when closed. Guided onboarding wizard replacing ad-hoc forms. |

### Phase C — Reliability

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| **C1** | Offline capture + replay | Kiosk/POS queue orders locally when offline; sync with dedup on reconnect. Document conflict rules. See `docs/oxsteed-restaurants-system-blueprint.md`. |

### Phase D — Operator depth

Prioritize **D1 multi-location**, **D3 brand accent hex**, **D4 permissions**, **D5 recipe→stock decrement**, **D10 quality audits**. Full table in `AGENTS.md`.

| ID | Task |
|----|------|
| **D1–D2** | Multi-location (`restaurant_locations`) + manager drill-down |
| **D3** | Backend `brand_accent_hex` (replace seed-based `FoodTheme.accent(for:)`) |
| **D4** | Fine-grained `restaurant_users` permissions enforced in apps |
| **D5–D16** | Recipes→stock, full PO lifecycle, scheduling, audits, labor/inventory reports, Marketplace bid/hire, AI ops — see AGENTS.md |

### Phase E — Role polish

Prioritize **E1 POS combos/quick-picks**, **E6–E7 delivery → auto runner task**, **E5 Runner MapKit**.

| ID | Task |
|----|------|
| **E1** | POS combos / quick-picks / forced-modifier rush flow |
| **E2** | Kitchen station routing (grill/fry/expo) |
| **E3** | Kiosk true i18n (language chips must change strings, not just stored preference) |
| **E4** | Inventory barcode scan receiving |
| **E5** | Runner MapKit/GPS |
| **E6–E7** | Delivery end-to-end: address/fees + auto-create runner task from `food_orders` (`food_order_id` exists on runner API but is not wired from order creation) |
| **E8** | Customer dispute/refund UX |

### Phase F — Engineering debt

Do in a dedicated refactor PR, not mixed with features.

| ID | Task |
|----|------|
| **F1–F2** | Consolidate 8× `FoodRootView.swift` and 8× `FoodStore`/`FoodAPIClient`/`FoodModels` into shared package targets |
| **F7** | E2E test: kiosk → KDS → queue board → customer notify |

---

## Rules of engagement

1. **Smallest correct diff** — match existing naming, patterns, and `FoodTheme` conventions.
2. **`FoodTheme.swift`** — edit once, copy to all 8 UI targets; verify byte match.
3. **No force-push to main**; no git config changes; do not commit unless lead asks.
4. **Verify builds** for every app you touch (all 8 if shared files change).
5. **Backend changes** — additive migrations only.
6. **Real-time** — socket enhances poll; never remove poll floor until socket proven.
7. **Pay-at-counter stays default** — online payment is optional enhancement.
8. Update **`AGENTS.md`** backlog checkboxes when you ship a slice.
9. **No secrets** in git; document env vars in runbook if needed.

---

## How a restaurant goes live today (for QA)

1. Owner signs in (OxSteed account).
2. **Manager → Orders → Merchant → Add restaurant** (starts `draft`).
3. Add menu items.
4. Tap **Go Live** → `status: active`.
5. Customer app calls `GET /api/food/restaurants` — only **`active`** restaurants appear.

Reviews, hours, and wizard are **not** in this flow yet — that is Phase B.

---

## Suggested team split

| Owner | Focus |
|-------|--------|
| **Backend** | A1, A3, B1–B5, B7, C1, D1, D3, E7 |
| **iOS platform** | A2, A7, A8, F1–F2, shared `FoodTheme` / shell components |
| **Customer app** | B1–B3, B4–B5, Track socket, review prompt |
| **Manager/POS** | A2, D1–D2, D4, E1 |
| **Kitchen/Kiosk** | A2, A8, E2, E3 |
| **Runner/Inventory** | E4–E7 |
| **DevOps/Release** | A3–A5, A6 pilot |

---

## Definition of done (per task)

- [ ] Code merged with tests or manual test notes
- [ ] All affected iOS schemes **BUILD SUCCEEDED**
- [ ] `node --check` on touched server files
- [ ] `AGENTS.md` backlog item updated
- [ ] If user-facing: screenshot or short screen recording attached to PR

---

## Verification commands

```bash
# All 8 iOS apps
for app in Customer Manager POS Kitchen Kiosk Crew Inventory Runner; do
  xcodebuild -project "ios/OxSteedRestaurants${app}/OxSteedRestaurants${app}.xcodeproj" \
    -scheme "OxSteedRestaurants${app}" -configuration Debug \
    -destination 'generic/platform=iOS Simulator' build
done

# Server syntax
node --check server/controllers/foodController.js server/routes/food.js server/index.js
```

---

## First sprint (2 weeks)

**Goal:** Pilot restaurant feels instant and trustworthy.

1. **A1** — Ready notification E2E
2. **A2** — Socket on Manager, POS, Customer Track
3. **A7** — Remove sample fallback
4. **B1–B3** — Reviews MVP

Everything else waits unless blocked.

---

## Out of scope

- Renaming `food_*` tables or removing `/api/food`
- Force-push, amending pushed commits
- New markdown docs beyond `AGENTS.md` updates
- Replacing pay-at-counter with mandatory in-app payments

---

**Start with Phase A (A1 + A2 + A7).** Phase B reviews is the next trust multiplier after the loop works in a real restaurant.
