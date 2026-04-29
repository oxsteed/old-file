# Marketplace Architecture — Amazon-Scale Product Discovery

High-level overview of OxSteed's advanced product marketplace system with intelligent search, skill-based discovery, and category hierarchies.

## System Design

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React 18)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ProductMarketplacePage (Main)                              │
│    ├── CategoryTileGrid (10 root categories)               │
│    ├── SkillTileGrid (12 top skills)                       │
│    ├── FilterPanel/Drawer (category, skill, price)         │
│    └── ProductGrid (infinite scroll, 9 per page)           │
│                                                              │
│  Client Services:                                            │
│    └── marketplaceSearchService                            │
│        ├── search()          → /search                      │
│        ├── browse()          → /browse                      │
│        ├── getCategories()   → /categories/hierarchy        │
│        ├── getSkills()       → /skills/all                  │
│        └── getProductsBySkill() → /by-skill/:id             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│              Backend (Express.js + Node.js)                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Routes: /api/marketplace/products                          │
│    ├── GET /browse                → browseProducts          │
│    ├── GET /search                → searchProducts          │
│    ├── GET /categories/hierarchy   → getHierarchicalCat...  │
│    ├── GET /skills/all            → getSkills              │
│    ├── GET /by-skill/:id          → getBySkill             │
│    ├── GET /categories            → getCategories (legacy)  │
│    └── GET /:productId            → getProductDetail       │
│                                                              │
│  Controllers: marketplaceProductsController.js             │
│    └── Advanced search algorithm with relevance ranking    │
│    └── Category hierarchy queries                          │
│    └── Skill-product mapping queries                       │
│    └── Alias/synonym matching                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓ SQL
┌─────────────────────────────────────────────────────────────┐
│          PostgreSQL Database (13+)                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  marketplace_products (core products)                       │
│    ├── id (UUID PK)                                         │
│    ├── name, description, category                         │
│    ├── price_cents, product_image_url                      │
│    ├── avg_rating, rating_count, in_carts_count (metrics)  │
│    └── is_active, is_available                              │
│                                                              │
│  product_categories (hierarchical)                          │
│    ├── id (SERIAL PK)                                       │
│    ├── name, slug, description                              │
│    ├── parent_category_id (FK → self, for hierarchy)        │
│    ├── icon_emoji, icon_name                                │
│    ├── display_order, is_active                             │
│    └── 70+ records (Tools → Power Tools → Drills, etc.)     │
│                                                              │
│  marketplace_product_categories (many-to-many)              │
│    ├── product_id (FK)                                      │
│    ├── category_id (FK)                                     │
│    └── is_primary (main category for product)               │
│                                                              │
│  marketplace_product_skills (many-to-many)                  │
│    ├── product_id (FK)                                      │
│    ├── skill_id (FK → skills_lookup)                        │
│    └── relevance_score (0-100, used for ranking)            │
│                                                              │
│  product_aliases (synonyms)                                 │
│    ├── product_id (FK)                                      │
│    ├── alias_name (synonym, e.g., "Socket" for Wrench)     │
│    ├── alias_type (synonym|related|brand|alternative)      │
│    └── relevance_score (0-100, boost in search)             │
│                                                              │
│  skills_lookup (shared with helpers)                        │
│    ├── id, name (Electrician, Plumber, Carpenter, etc.)    │
│    └── description                                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### Product Discovery Flows

#### 1. Category-Based Discovery
```
User sees category grid → Clicks "Power Tools" 
  → GET /browse?category=Power%20Tools 
  → Shows 50+ products in Power Tools category
  → Can apply filters: skill, price, rating
```

#### 2. Skill-Based Discovery (New)
```
User sees skill grid → Clicks "Electrician" 
  → GET /by-skill/1 
  → Shows all products tagged with skill_id=1
  → Sorted by relevance_score (how relevant to that skill)
```

#### 3. Search with Ranking
```
User searches "wrench"
  → Multi-pass ranking:
     a) Exact match: "Adjustable Wrench" (score: 1000)
     b) Contains: "Wrench Socket Set" (score: 800)
     c) Full-text: descriptions mentioning wrench (score: 500)
     d) Aliases: "Socket Wrench" via alias="Socket" (score: 400)
  → Final score *= (1 + in_carts_count / max) + rating * 10
  → Results sorted by final_score DESC
```

#### 4. Advanced Filtering
```
User applies: skill=Electrician + price=$50-$500 + sort=rating
  → GET /search?q=drill&skillIds=1&minPrice=50&maxPrice=500&sortBy=rating
  → Returns drills for electricians, between $50-500, top-rated first
```

## Search Algorithm

### Relevance Ranking Formula

```javascript
// Base relevance (by match type)
const baseRelevance = {
  exactNameMatch: 1000,
  nameContains: 800,
  fullTextMatch: 500,
  aliasMatch: 400,
};

// Boost by popularity and rating
final_score = baseRelevance
            * (1 + in_carts_count / MAX_CARTS)  // Popularity boost
            + avg_rating * 10;                   // Rating boost (0-50)

// Sort by final_score DESC
```

### Examples

**Search: "wrench"**
```
Results:
1. Adjustable Wrench (exact match: 1000 * 1.5 + 4.3*10 = 1543)
2. Ratchet Wrench (contains: 800 * 1.2 + 4.5*10 = 1410)
3. Socket Wrench (via alias: 400 * 0.8 + 4.6*10 = 366)
4. ...
```

**Search: "drill" with skill=Electrician**
```
1. Filter products by skill_id=1 first
2. Then apply search ranking within electrician products
3. Results: DeWalt Cordless Drill, Makita Drill, etc.
```

## Database Schema (Key Tables)

### marketplace_products
```sql
CREATE TABLE marketplace_products (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  price_cents INTEGER,
  product_image_url TEXT,
  
  -- Relevance metrics
  avg_rating NUMERIC(3,2),           -- 4.7
  rating_count INTEGER DEFAULT 0,    -- 245
  in_carts_count INTEGER DEFAULT 0,  -- 82 (popularity)
  
  is_active BOOLEAN DEFAULT TRUE,
  is_available BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search index
CREATE INDEX idx_marketplace_products_name_gin
  ON marketplace_products USING GIN(
    to_tsvector('english', name || ' ' || COALESCE(description, ''))
  );
```

### product_categories (Hierarchical)
```sql
CREATE TABLE product_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  
  parent_category_id INTEGER REFERENCES product_categories(id),
  -- null = root category (Tools, Safety, Electrical, etc.)
  -- 1 = Drills, Power Tools, Hand Tools
  
  icon_emoji VARCHAR(10),    -- "🔧", "⚡", "🔨"
  icon_name VARCHAR(50),     -- "tool", "zap", "hammer"
  display_order SMALLINT,
  is_active BOOLEAN DEFAULT TRUE
);

-- Example hierarchy:
-- Tools (id=1, parent=null)
--   ├── Power Tools (id=16, parent=1)
--   │   └── Drills (id=20, parent=16)
--   ├── Hand Tools (id=3, parent=1)
--   └── Measuring (id=7, parent=1)
-- Electrical (id=12, parent=null)
--   ├── Wire & Cable (id=57, parent=12)
--   └── Outlets & Switches (id=59, parent=12)
```

### marketplace_product_skills (Skill-Product Mapping)
```sql
CREATE TABLE marketplace_product_skills (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES marketplace_products(id),
  skill_id BIGINT NOT NULL REFERENCES skills_lookup(id),
  relevance_score SMALLINT DEFAULT 50,  -- 0-100
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, skill_id)
);

-- Examples:
-- (product_id=uuid-drill, skill_id=1)  -- Electrician
-- (product_id=uuid-drill, skill_id=4)  -- Handyman
-- (product_id=uuid-wrench, skill_id=3) -- Carpenter
```

### product_aliases (Synonyms)
```sql
CREATE TABLE product_aliases (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES marketplace_products(id),
  alias_name VARCHAR(100) NOT NULL,  -- "Socket", "Ratchet"
  alias_type VARCHAR(20) DEFAULT 'synonym',  -- synonym|related|brand
  relevance_score SMALLINT DEFAULT 50,  -- 0-100
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, alias_name, alias_type)
);

-- Examples:
-- (product_id=uuid-wrench, "Socket", synonym, 75)
-- (product_id=uuid-wrench, "Ratchet", related, 80)
-- (product_id=uuid-drill, "Power Drill", synonym, 85)
```

## Performance

### Indexing Strategy
```sql
-- Full-text search (GIN index on name + description)
CREATE INDEX idx_marketplace_products_name_gin
  ON marketplace_products USING GIN(to_tsvector('english', ...));

-- Category lookups
CREATE INDEX idx_product_categories_parent ON product_categories(parent_category_id);
CREATE INDEX idx_product_categories_slug ON product_categories(slug);

-- Skill-product mappings
CREATE INDEX idx_product_skills_skill_id ON marketplace_product_skills(skill_id);
CREATE INDEX idx_product_skills_product_id ON marketplace_product_skills(product_id);

-- Alias lookups
CREATE INDEX idx_product_aliases_alias_name ON product_aliases(alias_name);
CREATE INDEX idx_product_aliases_product_id ON product_aliases(product_id);
```

### Expected Query Times
- Search (100 products, full-text): 50-150ms
- Browse with filters (apply 2-3 filters): 50-100ms
- Category hierarchy (70 categories): 20-50ms
- Skill list (50 skills): 10-30ms
- Get products by skill (50 results): 30-80ms

### Pagination
- Default: 20 results/page
- Max: 100 results/page
- Uses LIMIT/OFFSET for simplicity (consider keyset pagination for very large datasets)

## Frontend Integration

### Import & Use
```javascript
import { marketplaceSearchService } from '../services/marketplaceSearchService';

// Search with ranking
const results = await marketplaceSearchService.search('wrench', {
  skillIds: [1],
  minPrice: 10,
  maxPrice: 100,
  limit: 9
});

// Skill-based discovery
const electricalProducts = await marketplaceSearchService.getProductsBySkill(1, {
  limit: 50,
  sort: 'relevance'
});

// Load categories
const categories = await marketplaceSearchService.getCategories();
// Result: [{ id: 1, name: 'Tools', children: [...], product_count: 245 }]

// Load skills
const skills = await marketplaceSearchService.getSkills();
// Result: [{ id: 1, name: 'Electrician', product_count: 145 }]
```

## Scalability Considerations

### Current Limits (1,000 products)
- ✓ Full-text search: O(log n) via GIN index
- ✓ Browse: O(n) with LIMIT (efficient)
- ✓ Category hierarchy: O(n) with FK join (70 categories)
- ✓ Skill filtering: O(n*m) with join (n products, m skills)

### Future Optimization (100,000+ products)
1. **Keyset Pagination:** Replace LIMIT/OFFSET with cursor-based
2. **Search Clustering:** Elasticsearch/OpenSearch for advanced full-text
3. **Caching Layer:** Redis for category/skill queries (rarely change)
4. **Materialized Views:** Pre-compute category product counts
5. **Sharding:** Partition products by category if > 10M
6. **Relevance Tuning:** A/B test ranking weights

## API Contract

### Request Format
```bash
GET /api/marketplace/products/search?q=drill&skillIds=1&minPrice=50&maxPrice=500&page=1&limit=9
```

### Response Format
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Product Name",
      "price_cents": 4999,
      "avg_rating": 4.7,
      "rating_count": 245,
      "in_carts_count": 82,
      "skills": [
        { "id": 1, "name": "Electrician" }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 9,
    "total": 150,
    "hasMore": true
  }
}
```

## Error Handling

### HTTP Status Codes
```
200 OK                   — Success
400 Bad Request          — Invalid params (q < 2 chars, invalid skill ID)
401 Unauthorized         — Auth required (reviews, recommendations)
404 Not Found            — Product/skill/category doesn't exist
500 Internal Server Error — Database error, unhandled exception
```

### Error Response Format
```json
{
  "success": false,
  "error": "Search query must be at least 2 characters"
}
```

## Future Enhancements

1. **AI-Powered Recommendations:** Use product embeddings for "customers also liked"
2. **Search Analytics:** Track popular searches, zero-result searches
3. **Dynamic Ranking:** Machine learning model to optimize relevance weights
4. **Faceted Search:** Auto-suggest filters based on results
5. **Inventory Sync:** Real-time sync with Home Depot/Lowes APIs
6. **Product Variants:** Handle size/color/material options
7. **Review Aggregation:** Pull reviews from external sources
8. **Pricing Alerts:** Notify users when prices drop
9. **Wish Lists:** Save products for later
10. **Collaborative Filtering:** Recommendations based on similar users

## Files Reference

| File | Purpose |
|------|---------|
| `server/migrations/137_product_aliases_and_categories.sql` | Schema: categories, aliases, product mappings |
| `server/controllers/marketplaceProductsController.js` | API logic: search, browse, categories, skills |
| `server/routes/marketplaceProducts.js` | Route definitions |
| `client/src/pages/ProductMarketplacePage.jsx` | Main UI page with category/skill grids |
| `client/src/services/marketplaceSearchService.js` | Centralized API client |
| `MARKETPLACE_API_GUIDE.md` | Complete endpoint documentation |
| `MARKETPLACE_TESTING_GUIDE.md` | Testing procedures |
| `server/seeds/productSeed.sql` | Sample data (30+ products) |

## Deployment Checklist

Before going live:
- [ ] Migration 137 runs successfully
- [ ] Sample data seeded (productSeed.sql)
- [ ] All endpoints tested with curl
- [ ] Frontend loads all categories and skills
- [ ] Search with synonyms works
- [ ] Skill-based discovery functional
- [ ] Filters (desktop + mobile) apply correctly
- [ ] Infinite scroll pagination works
- [ ] Product detail modal opens
- [ ] No console errors in browser
- [ ] Database indexes created
- [ ] Performance meets SLA (< 300ms responses)
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Error logging configured

---

## Questions?

See:
- **API Reference:** MARKETPLACE_API_GUIDE.md
- **Testing:** MARKETPLACE_TESTING_GUIDE.md
- **Code:** Search `marketplaceProductsController.js` for implementation details
