# Marketplace Testing Guide

Complete testing procedures for OxSteed's Amazon-scale product marketplace with skill-based discovery.

## Setup

### 1. Seed Database with Sample Data
```bash
# Load sample products, categories, skills, and aliases
psql -U postgres -d oxsteed < server/seeds/productSeed.sql
```

This populates:
- 30+ sample products across all categories
- 70+ product categories with hierarchy
- Product-to-skill mappings
- Product aliases (synonyms)
- Realistic ratings and cart counts

### 2. Start Development Servers
```bash
# Terminal 1: Backend (port 3001)
cd server
npm install
npm start

# Terminal 2: Frontend (port 5173)
cd client
npm install
npm run dev
```

### 3. Verify Migration Ran
```bash
# Check that Migration 137 executed
curl http://localhost:3001/api/marketplace/products/categories/hierarchy

# Should return: 70+ categories organized by parent-child relationship
```

---

## API Endpoint Testing

Use curl, Postman, or Insomnia to test endpoints.

### Categories

#### Test: Get Hierarchical Categories
```bash
curl -X GET http://localhost:3001/api/marketplace/products/categories/hierarchy

# Expected: Root categories with children (Tools, Power Tools, Hardware, etc.)
# Check for: parent_category_id=null on roots, product_count field
```

#### Test: Get Flat Categories (Legacy)
```bash
curl -X GET http://localhost:3001/api/marketplace/products/categories

# Expected: Simple array of category names
```

### Skills

#### Test: Get All Skills
```bash
curl -X GET http://localhost:3001/api/marketplace/products/skills/all

# Expected:
# [
#   { id: 1, name: "Electrician", product_count: 50, avg_rating: 4.65 },
#   { id: 2, name: "Plumber", product_count: 35, avg_rating: 4.72 }
# ]
```

#### Test: Get Products by Skill
```bash
# Get all electrician products (skill_id=1)
curl -X GET "http://localhost:3001/api/marketplace/products/by-skill/1?limit=50&sort=relevance"

# Try different sort orders
curl -X GET "http://localhost:3001/api/marketplace/products/by-skill/1?sort=rating"
curl -X GET "http://localhost:3001/api/marketplace/products/by-skill/1?sort=price"

# Expected: Products with relevance_score field
```

### Search

#### Test 1: Exact Name Match
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/search?q=wrench&limit=9"

# Expected: "Adjustable Wrench" appears at top with highest relevance_score
```

#### Test 2: Synonym/Alias Matching
```bash
# Search "socket" should also return "Adjustable Wrench" via alias
curl -X GET "http://localhost:3001/api/marketplace/products/search?q=socket&limit=9"

# Check: Both direct products AND products with alias matches appear
```

#### Test 3: Full-Text Search
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/search?q=cordless&limit=9"

# Expected: "DeWalt 20V Cordless Drill" in results (matches description/name)
```

#### Test 4: Search with Skill Filter
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/search?q=drill&skillIds=1&limit=9"

# Expected: Only drills associated with skill_id=1 (Electrician)
# Check response: skills array contains { id: 1, name: "Electrician" }
```

#### Test 5: Search with Price Filter
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/search?q=tool&minPrice=10&maxPrice=100&limit=9"

# Expected: Only products between $10-$100
# Check: price_cents field between 1000-10000 (in cents)
```

#### Test 6: Relevance Ranking
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/search?q=wrench&limit=20" | jq '.data[].relevance_score' | sort -n

# Expected: Relevance scores in descending order
# Check order:
# 1. Exact "Wrench" in name (1000+)
# 2. Name contains "wrench" (800+)
# 3. Alias matches (400+)
```

### Browse

#### Test 1: Browse All Products
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/browse?page=1&limit=9&sortBy=newest"

# Expected: 9 products sorted by created_at DESC
```

#### Test 2: Browse with Category Filter
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/browse?category=Power%20Tools&limit=9"

# Expected: Only products with category="Power Tools"
```

#### Test 3: Browse with Skill Filter
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/browse?skillIds=1,2&limit=9"

# Expected: Products linked to both electrician (1) and plumber (2) skills
```

#### Test 4: Sort Variations
```bash
# By rating (high to low)
curl -X GET "http://localhost:3001/api/marketplace/products/browse?sortBy=rating&limit=9"

# By price (low to high)
curl -X GET "http://localhost:3001/api/marketplace/products/browse?sortBy=price_asc&limit=9"

# By price (high to low)
curl -X GET "http://localhost:3001/api/marketplace/products/browse?sortBy=price_desc&limit=9"

# Most popular (in carts)
curl -X GET "http://localhost:3001/api/marketplace/products/browse?sortBy=in_carts&limit=9"
```

### Product Details

#### Test: Get Product Detail
```bash
# Get a product ID from search results first
PRODUCT_ID="<uuid-from-search>"
curl -X GET "http://localhost:3001/api/marketplace/products/$PRODUCT_ID"

# Expected: Full details including skills array
# Check: name, description, price_cents, avg_rating, in_carts_count, skills
```

#### Test: Get Related Products
```bash
curl -X GET "http://localhost:3001/api/marketplace/products/$PRODUCT_ID/related?limit=10"

# Expected: Products sharing similar skills
```

---

## Frontend Testing

### Setup
1. Navigate to http://localhost:5173/marketplace
2. Ensure Navbar and Footer load
3. Check browser console for errors

### Test 1: Category Grid Loads
- Hero section displays search bar
- Below: Category tile grid with 10 root categories
- Each tile shows icon emoji + category name + product count
- Click category → products filter to that category
- Click again → clears filter

**Check:**
```
✓ Hero section title: "Discover Products"
✓ Search input functional (type + debounce works)
✓ 10 category tiles visible
✓ Clicking category filters results
✓ Product grid updates
```

### Test 2: Skill Grid Shows
- Below category grid: Skill tile grid
- Shows top 12 skills (Electrician, Plumber, Carpenter, etc.)
- Each tile shows skill name + product count + lightning bolt icon

**Check:**
```
✓ Skill grid title: "Browse by Skill"
✓ At least 6-12 skills visible
✓ Product counts display
✓ Clicking skill filters products to that skill
✓ Grid shows only products for selected skill
```

### Test 3: Product Grid Displays
- 3-column grid on desktop, 2 on tablet, 1 on mobile
- Each card shows:
  - Product image
  - Name
  - Price
  - Rating + review count
  - In-cart count
  - "Add to Cart" + "View Details" buttons
- Infinite scroll: scrolling down loads more products

**Check:**
```
✓ 9 products load initially
✓ Cards are clickable (opens detail modal)
✓ Scrolling triggers next page load
✓ Products append (not replace)
✓ Loader shows during fetch
```

### Test 4: Search Works
- Type "drill" in hero search box
- Results update with debounce (300ms delay)
- Products containing "drill" in name/description appear

**Check:**
```
✓ Typing "drill" → "DeWalt Drill" appears
✓ Typing "wrench" → "Socket Wrench" + "Adjustable Wrench" both appear
✓ No results for "xyz123" → empty state shows
✓ Search clears when category is selected
```

### Test 5: Desktop Sidebar Filters
On desktop (lg breakpoint), left sidebar shows:
- Sort By (dropdown): best_match, lowest_price, highest_price, top_rated, newest, most_popular
- Category (checkboxes): click to filter, product count shows
- Skills (checkboxes): click to filter by skill
- Price Range: min/max inputs

**Check:**
```
✓ Sort dropdown works: changing sort updates grid
✓ Category checkboxes work: selecting/deselecting filters
✓ Only one category selectable at a time
✓ Skills checkbox works
✓ Price filters apply (entering 50-200 shows products in range)
✓ Multiple filters combine (category + skill + price all apply)
```

### Test 6: Mobile Filters
On mobile:
- "Filters" button with count badge appears
- Clicking opens bottom drawer
- Drawer shows all filters
- "Show Results" button closes drawer and applies filters

**Check:**
```
✓ Filters button visible on mobile
✓ Badge shows active filter count (if > 0)
✓ Clicking button opens drawer
✓ Drawer slides up from bottom
✓ Filters in drawer functional
✓ Close button (X) closes drawer
✓ "Show Results" button closes + applies filters
```

### Test 7: Product Detail Modal
Click "View Details" on any product:
- Modal opens with full product info
- Shows image, name, full description, price
- Shows skills (badges)
- Shows related products carousel
- "Add to Cart" button functional

**Check:**
```
✓ Modal opens with product data
✓ Close button (X) closes modal
✓ Background clicks close modal
✓ Skills display as badges
✓ Related products load
✓ Add to Cart button works
```

### Test 8: URL State Persistence
- Select category, search, apply filters
- URL updates with query params: `?q=drill&category=power-tools&skill=1&minPrice=50`
- Refresh page → filters stay applied
- Back button → restores previous search

**Check:**
```
✓ URL updates when filters change
✓ URL contains: q, category, skill, minPrice, maxPrice, sort
✓ Page refresh maintains state
✓ Browser back button works
```

### Test 9: Responsive Design
- Desktop (1024px+): 3-column grid, sidebar visible
- Tablet (768-1023px): 2-column grid, sidebar off, filters in drawer
- Mobile (< 768px): 1-column grid, filters in drawer

**Check:**
```
✓ Desktop: grid is 3 cols, sidebar on left
✓ Tablet: grid is 2 cols, sidebar hidden, filters button visible
✓ Mobile: grid is 1 col, stack vertically
✓ Drawer works on tablet + mobile
✓ No horizontal scroll
```

### Test 10: Loading States
- Initial page load: skeleton loaders (pulsing cards)
- Category/skill selection: briefly shows skeletons while loading
- Infinite scroll: loader + "Loading" text appears at bottom

**Check:**
```
✓ Skeletons appear on first load (not actual products)
✓ After ~500ms, products render
✓ Switching category shows skeletons briefly
✓ Infinite scroll shows loader
✓ No console errors during loading
```

### Test 11: Empty States
- Search for non-existent term: "xyz123random"
- No filters selected + no products: empty state shows icon + message

**Check:**
```
✓ Search "xyz123" → "No results" message appears
✓ Message says: "No results found for 'xyz123'. Try browsing by category..."
✓ Icon shows (magnifying glass emoji)
✓ Categories still visible above (can click to browse)
```

---

## Database Verification

### Check Migration Ran
```sql
-- Connect to DB
psql -U postgres -d oxsteed

-- Verify tables exist
SELECT tablename FROM pg_tables WHERE schemaname='public' 
  AND tablename LIKE 'product%';

-- Expected tables:
-- product_aliases
-- product_categories
-- marketplace_product_categories

-- Count records
SELECT COUNT(*) FROM product_categories;  -- Should be 70+
SELECT COUNT(*) FROM product_aliases;     -- Should be 10+
SELECT COUNT(*) FROM marketplace_products; -- Should be 30+
```

### Check Skill Mappings
```sql
-- Get products linked to Electrician skill
SELECT mp.name, COUNT(mps.id) as skill_count
FROM marketplace_products mp
LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
WHERE mps.skill_id = 1
GROUP BY mp.id, mp.name
LIMIT 10;
```

### Check Aliases
```sql
-- Verify aliases created
SELECT product_id, alias_name, relevance_score
FROM product_aliases
LIMIT 10;

-- Search should now return these
```

---

## Performance Testing

### 1. Load Testing
Test with realistic data volume:
- ~1000 products
- ~100 categories
- ~50 skills
- ~500 aliases

```bash
# Simulate search with load
ab -n 100 -c 10 "http://localhost:3001/api/marketplace/products/search?q=drill&limit=20"

# Expected: < 200ms response time
```

### 2. Pagination
Ensure efficient pagination:
```bash
# Fetch page 50 (offset 490 products)
curl "http://localhost:3001/api/marketplace/products/browse?page=50&limit=20"

# Should still be fast (< 100ms)
```

### 3. Complex Filters
Test compound filtering:
```bash
# All filters at once
curl "http://localhost:3001/api/marketplace/products/browse?category=Power%20Tools&skillIds=1,2&minPrice=50&maxPrice=500&sortBy=rating&limit=20"

# Should complete in < 300ms
```

---

## Common Issues & Fixes

### Issue: "Product IDs are not all the same type"
- **Cause:** Foreign key type mismatch (BIGINT vs UUID)
- **Fix:** Run migration 137 again, check product_id types

### Issue: "Skills not showing in grid"
- **Cause:** No skills linked to products
- **Fix:** Run productSeed.sql to populate skill_id mappings

### Issue: "Search returns empty"
- **Cause:** Full-text index not built
- **Fix:** Manually rebuild: `REINDEX INDEX idx_marketplace_products_name_gin;`

### Issue: "Aliases not matching"
- **Cause:** Alias table empty
- **Fix:** Run productSeed.sql to populate aliases

### Issue: "Frontend doesn't load categories"
- **Cause:** API not responding or CORS issue
- **Fix:** Check backend is running on port 3001, verify CORS headers

---

## Browser DevTools Checklist

Open browser DevTools (F12) and check:

### Network Tab
- ✓ `/api/marketplace/products/categories/hierarchy` — 200, < 100ms
- ✓ `/api/marketplace/products/skills/all` — 200, < 100ms
- ✓ `/api/marketplace/products/browse` — 200, < 200ms
- ✓ `/api/marketplace/products/search?q=...` — 200, < 300ms

### Console
- ✓ No red errors
- ✓ No CORS warnings
- ✓ No undefined function calls

### Application > Local Storage
- ✓ `oxs:language` — stores current language
- ✓ Tokens stored if authenticated

---

## Regression Tests

After any code changes:
1. Run all endpoint curl tests
2. Load ProductMarketplacePage in browser
3. Test search, browse, filters
4. Verify mobile responsiveness
5. Check database record counts unchanged

---

## Sign-Off

Before deploying to production:

- [ ] All API endpoints tested
- [ ] Frontend displays all pages correctly
- [ ] Search works with synonyms
- [ ] Skill-based discovery functional
- [ ] Filters (desktop + mobile) work
- [ ] Infinite scroll functional
- [ ] Product detail modal opens
- [ ] No console errors
- [ ] Database migrations ran
- [ ] Seed data populated
- [ ] Performance acceptable (< 300ms responses)
- [ ] Mobile responsive (tested on 375px, 768px, 1024px)
