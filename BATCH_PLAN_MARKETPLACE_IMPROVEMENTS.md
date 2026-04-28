# Batch Plan: ProductMarketplacePage 7-Category Improvement

## Scope & Research Findings

The ProductMarketplacePage needs enhancements across 7 categories:
1. **Enhanced Product Discovery** — Full-text descriptions, price filtering, ratings, related products
2. **Smarter Filtering & Sorting** — Sort options, skill filters, persistent state, filter pills
3. **Better Product Display** — Detail modal, gallery, availability, affiliate transparency
4. **Shopping Cart UX** — Cart persistence, quantity selector, totals, share templates
5. **Performance & Load** — Infinite scroll, sidebar filters, hover previews
6. **Trust & Context** — Helper reviews, recommended badges, frequently bought together
7. **Mobile Optimization** — Bottom sheet, responsive grid, sticky filters

**Research Findings:**
- Existing patterns: Helpers endpoint has advanced filtering (geographic, multi-criteria) — use as reference
- Database: Migration 125 establishes product schema with skills junction table, GIN full-text indexes
- Frontend: ReviewModal component shows modal pattern; ProductMarketplacePage CSS has responsive breakpoints
- i18n: Marketplace namespace exists at locales/en.json line 4854+
- API client: marketplaceApi.js structured with product/cart/share separations
- Mobile: 768px and 640px breakpoints, CSS Grid responsive without breakpoints

**Dependency Analysis:**
- Backend changes (filtering, sorting, new endpoints) can work in parallel with frontend
- Frontend components can be stubbed with mock API calls initially
- i18n can be added once strings are identified
- All units are independently mergeable

---

## Work Units (18 total)

### Phase 1: Database & API Foundations (Parallel)

**Unit 1: Database Migration — Extended Product & Analytics Schema**
- **Files:** `server/migrations/126_enhance_marketplace_products.sql`
- **Changes:** 
  - Add `avg_rating NUMERIC(2,1)`, `rating_count INT`, `in_carts_count INT` to `marketplace_products`
  - Add `helper_review_count INT DEFAULT 0` to `marketplace_products`
  - Create `product_reviews` table (helper_id, product_id, rating, review_text, helpful_count)
  - Create `frequently_bought_together` junction table (product_id, related_product_id, frequency)
  - Add indexes: `(avg_rating DESC)`, `(in_carts_count DESC)`, `(rating_count DESC)`
  - Add partial index on `(is_active, is_available)` for browse queries

**Unit 2: API Enhancements — Filtering, Sorting, Search**
- **Files:** `server/controllers/marketplaceProductsController.js`, `server/routes/marketplaceProducts.js`
- **Changes:**
  - Enhance `browseProducts()` to support: `minPrice`, `maxPrice`, `skillIds[]`, `sortBy` (price_asc, price_desc, rating, newest, in_carts)
  - Enhance `searchProducts()` to search descriptions (not just names) using PostgreSQL full-text
  - Add `getProductDetail()` endpoint returning full product data + related products + reviews
  - Add `getRelatedProducts()` endpoint
  - Add `getFrequentlyBoughtWith()` endpoint
  - Ensure all responses include `rating`, `in_carts_count`, `review_summary`

**Unit 3: API Enhancements — Product Reviews & Recommendations**
- **Files:** `server/controllers/marketplaceProductsController.js`, `server/routes/marketplaceProducts.js`
- **Changes:**
  - Add `submitProductReview(productId, rating, reviewText)` — authenticated helpers only
  - Add `getProductReviews(productId, page, limit)` — paginated reviews
  - Add `getRecommendedProducts()` endpoint — returns products filtered by helper's primary skills
  - Add `getProductsBySkillRelevance(skillId, limit)` with relevance sorting

---

### Phase 2: Frontend Filtering & Sorting UI (Parallel)

**Unit 4: Filter UI — Price Range & Skills**
- **Files:** `client/src/pages/ProductMarketplacePage.jsx`, `client/src/styles/ProductMarketplacePage.css`
- **Changes:**
  - Add price range slider component (min/max inputs or slider using rc-slider)
  - Add skill multi-select filter (checkboxes or dropdown with tags)
  - Wire to state: `selectedMinPrice`, `selectedMaxPrice`, `selectedSkills[]`
  - Trigger `fetchProducts()` on filter change
  - CSS: style sliders and skill filter UI

**Unit 5: Filter UI — Sorting & Active Filter Pills**
- **Files:** `client/src/pages/ProductMarketplacePage.jsx`, `client/src/styles/ProductMarketplacePage.css`
- **Changes:**
  - Add sort dropdown: "Best Match" (default), "Lowest Price", "Highest Price", "Top Rated", "Most Popular", "Newest"
  - Add filter pills display showing active filters (price range, skills, category) with X to clear
  - Implement clear-all button
  - Persist filter state in URL params (e.g., ?minPrice=50&maxPrice=200&skills=1,2,3&sort=rating)
  - On page load, restore filters from URL

---

### Phase 3: Product Display & Modals (Parallel)

**Unit 6: Product Detail Modal**
- **Files:** `client/src/components/ProductDetailModal.jsx` (new), `client/src/pages/ProductMarketplacePage.jsx`, `client/src/styles/ProductMarketplacePage.css`
- **Changes:**
  - Create ProductDetailModal component showing: full description, price, skills, ratings, in-carts count, affiliate link, SKU, UPC
  - Modal triggered on product card click
  - Show "Buy on Home Depot" button with affiliate URL
  - Show 5-star rating display
  - Wire to ProductMarketplacePage (state: selectedProductId, handleProductClick, handleCloseModal)

**Unit 7: Product Image Gallery**
- **Files:** `client/src/components/ProductImageGallery.jsx` (new), `ProductDetailModal.jsx`
- **Changes:**
  - Create ProductImageGallery component (carousel or grid with lightbox)
  - Support multiple image URLs (parse from API response or use placeholder)
  - Implement prev/next navigation and thumbnail selection
  - Integrate into ProductDetailModal

**Unit 8: Product Hover Preview Card**
- **Files:** `client/src/components/ProductHoverPreview.tsx` (new), `client/src/pages/ProductMarketplacePage.jsx`, `ProductMarketplacePage.css`
- **Changes:**
  - Create lightweight preview card component
  - Show on product card hover: price, rating, in-carts count, 2-3 key skills
  - CSS: positioned absolutely, light shadow, smooth fade-in
  - Integrate into product grid cards

---

### Phase 4: Layout & Navigation (Parallel)

**Unit 9: Sidebar Layout Refactor**
- **Files:** `client/src/pages/ProductMarketplacePage.jsx`, `ProductMarketplacePage.css`, `App.jsx` (if needed)
- **Changes:**
  - Refactor desktop layout: sidebar (250px width) on left with filters, main content on right
  - Sticky sidebar on scroll
  - Mobile: hamburger toggle to slide-in sidebar
  - Update grid layout to accommodate sidebar
  - Adjust breakpoints for new layout

**Unit 10: Sticky Filter Bar Mobile**
- **Files:** `ProductMarketplacePage.css`
- **Changes:**
  - Add CSS for sticky filter bar on scroll (position: sticky, top: 0)
  - Apply only on mobile (≤768px)
  - Ensure filter bar stays visible while scrolling products
  - z-index management to prevent overlap

**Unit 11: Infinite Scroll Implementation**
- **Files:** `client/src/pages/ProductMarketplacePage.jsx`, `client/src/hooks/useInfiniteScroll.ts` (new)
- **Changes:**
  - Remove pagination controls
  - Implement intersection observer for "load more" trigger (bottom of list)
  - Create useInfiniteScroll custom hook
  - Append new products to existing list instead of replacing
  - Show loading indicator while fetching next page
  - Handle "no more products" state

---

### Phase 5: Cart & Commerce Features (Parallel)

**Unit 12: Cart Persistence & Sidebar**
- **Files:** `client/src/components/CartSidebar.tsx` (new), `ProductMarketplacePage.jsx`, `ProductMarketplacePage.css`
- **Changes:**
  - Create CartSidebar component showing: current cart name, item count, estimated total
  - Add cart switcher dropdown (list of user's carts)
  - Button to create new cart (existing modal)
  - Integrate into ProductMarketplacePage
  - CSS: sticky sidebar or collapse-friendly drawer

**Unit 13: Quantity Selector & Estimated Total**
- **Files:** `client/src/pages/ProductMarketplacePage.jsx`, `ProductDetailModal.jsx`, `ProductMarketplacePage.css`
- **Changes:**
  - Change "Add to Cart" button to show quantity selector (+/- or input)
  - Calculate estimated total on product card or in modal: quantity × price
  - Update CartSidebar estimated total in real-time
  - Display as currency formatted

**Unit 14: Share Cart Template**
- **Files:** `client/src/components/ShareCartModal.tsx` (new), `client/src/pages/ProductMarketplacePage.jsx`
- **Changes:**
  - Add "Save as Template" button in CartSidebar
  - Modal to name template and optionally make reusable
  - Add "Start from Template" option in new cart creation
  - API call to cartApi.saveAsTemplate() and cartApi.createFromTemplate()

---

### Phase 6: Recommendations & Trust Features (Parallel)

**Unit 15: Related Products & "Frequently Bought Together"**
- **Files:** `client/src/components/RelatedProductsSection.tsx` (new), `ProductDetailModal.jsx`, `ProductMarketplacePage.jsx`
- **Changes:**
  - Create RelatedProductsSection component (horizontal scroll or grid)
  - Show in ProductDetailModal: related products + frequently bought with this product
  - Call API endpoints: getRelatedProducts(), getFrequentlyBoughtWith()
  - Allow adding from recommendations directly to cart

**Unit 16: Helper Reviews & Ratings Display**
- **Files:** `client/src/components/ProductReviewsSection.tsx` (new), `ProductDetailModal.jsx`
- **Changes:**
  - Create ProductReviewsSection component
  - Display aggregated rating (5-star + count)
  - Show individual helper reviews in ProductDetailModal (paginated)
  - Display review text, rating, helper name
  - Allow authenticated helpers to leave reviews (button in modal)

**Unit 17: "Recommended for Your Skills" Badges**
- **Files:** `client/src/pages/ProductMarketplacePage.jsx`, `client/src/components/ProductCard.tsx`, `ProductMarketplacePage.css`
- **Changes:**
  - Add logic: if product skills match logged-in helper's skills, show "Recommended for You" badge
  - Use getRecommendedProducts() API endpoint
  - Visual badge on product card corner
  - CSS: colorful badge styling

---

### Phase 7: Mobile & i18n (Parallel)

**Unit 18: Mobile Bottom Sheet Modal & Responsive Grid**
- **Files:** `ProductMarketplacePage.jsx`, `ProductMarketplacePage.css`
- **Changes:**
  - Change modal CSS for mobile: position bottom sheet (top: auto, bottom: 0, border-radius-top only)
  - Mobile grid: 2 columns instead of 3+ (update minmax to 120px)
  - Touch-friendly adjustments: larger tap targets, more padding
  - Update media queries (640px, 768px breakpoints)
  - Test bottom sheet height and scrolling behavior

**Unit 19: i18n Keys for All New Features**
- **Files:** `client/src/locales/en.json`, `es.json`, `fr.json`, `ht.json`
- **Changes:**
  - Add marketplace.* keys:
    - Filter labels: `priceRange`, `skills`, `sortBy`, `clearFilters`, `clearAll`
    - Sort options: `bestMatch`, `lowestPrice`, `highestPrice`, `topRated`, `mostPopular`, `newest`
    - Product detail: `rating`, `reviews`, `inCarts`, `affiliateLink`, `sku`, `upc`, `availability`
    - Recommendations: `recommendedForYou`, `frequentlyBoughtTogether`, `relatedProducts`
    - Trust: `helperReview`, `submitReview`, `noReviews`
    - Cart: `saveAsTemplate`, `createFromTemplate`, `estimatedTotal`, `quantitySelector`
    - Mobile: `openFilters`, `closeFilters`
  - Translate to Spanish, French, Haitian Creole

---

## E2E Test Recipe

**Setup:**
1. Start dev server: `npm run dev` (client) + server running
2. Navigate to `/products` in Chrome
3. Ensure authenticated as a helper with skills

**Test Flows:**

1. **Filtering & Sorting:**
   - Filter by price range ($50-$150) → verify products in range
   - Filter by skills → verify products match skills
   - Sort by "Lowest Price" → verify products ordered ascending
   - Verify URL params update as filters change
   - Click "Clear All" → verify all filters reset

2. **Product Discovery:**
   - Hover over product card → verify hover preview appears
   - Click product → verify detail modal opens
   - Verify rating/reviews display in modal
   - Verify "Frequently Bought Together" shows
   - Click related product → add to cart

3. **Cart & Quantity:**
   - In browse or modal, adjust quantity → verify cart sidebar updates total
   - Add to cart → verify item appears in cart sidebar
   - Switch carts via sidebar → verify correct cart items shown
   - Save cart as template → verify template created

4. **Infinite Scroll:**
   - Scroll to bottom → verify "loading" indicator
   - Wait for next batch → verify new products append
   - Scroll to absolute bottom → verify "no more products" message

5. **Mobile (640px viewport):**
   - Filter bar should be sticky at top
   - Sidebar should collapse to hamburger
   - Modal should appear as bottom sheet
   - Grid should show 2 columns
   - Verify all touch targets are 44px+

6. **Trust Features:**
   - If helper has matching skills, verify "Recommended for You" badge
   - Click badge → verify filter applied
   - In product modal, verify reviews section displays
   - Submit review → verify posted and appears in list

7. **i18n:**
   - Change language to Spanish → verify all new strings translated
   - Verify no raw translation keys showing

**Pass Criteria:**
- All filters update URL and refetch correctly
- Infinite scroll appends without jumping
- Modal opens, detail displays, reviews show
- Cart sidebar persists and updates total
- Mobile layout is responsive and touch-friendly
- i18n keys fully translated
- No console errors

---

## Worker Instructions (Copy to Each Agent)

After completing your unit:

1. **Run linter/syntax check** — Ensure no JS/CSS syntax errors
2. **Update i18n keys** (if your unit adds user-visible strings) — Add to en.json, then mirror to es.json, fr.json, ht.json
3. **Simplify** — Run `Skill` tool with `skill: "simplify"` to review and optimize code
4. **Test end-to-end** — Follow the e2e test recipe above for your unit's specific feature
5. **Commit & push** — Clear message explaining the change, push branch, create PR with `gh pr create`
6. **Report** — End with single line: `PR: <url>` so coordinator can track

---

## Dependency Graph

```
Unit 1 (Migration) → Units 2, 3 (APIs) → Units 4, 5, 6, 7, 8 (Frontend)
                     ↓
              Units 9, 10, 11 (Layout)
                     ↓
              Units 12, 13, 14 (Cart)
                     ↓
              Units 15, 16, 17 (Trust)
                     ↓
              Units 18, 19 (Mobile + i18n)
```

**Parallel Strategy:**
- Unit 1 runs first (migration)
- Units 2-3 start immediately after migration (APIs can stub missing data)
- Units 4-8 can start in parallel (use mock API if needed)
- Units 9-11 parallel with 4-8
- Units 12-14 parallel with above
- Units 15-17 parallel
- Units 18-19 parallel at the end

**Critical Path:** Unit 1 → Unit 2 → any Units 4+ (rest are truly parallel)

---

## Success Criteria

✅ All 18 units land as PRs
✅ E2E tests pass for each feature category
✅ i18n complete (4 languages)
✅ No console errors in dev tools
✅ Responsive on 640px, 768px, 1920px viewports
✅ All new features discoverable and working end-to-end
✅ Backward compatible with existing cart/marketplace flows
