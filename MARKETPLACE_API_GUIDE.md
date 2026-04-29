# Marketplace API Guide — Amazon-Scale Product Discovery

Complete API documentation for OxSteed's advanced product marketplace with skill-based discovery, category hierarchies, and intelligent search.

## Base URL
```
/api/marketplace/products
```

## Endpoints

### Browse & Search

#### 1. Browse Products (Advanced Filtering)
```
GET /api/marketplace/products/browse
```

Query parameters:
- `page` (number, default: 1) — Page number for pagination
- `limit` (number, default: 20, max: 100) — Results per page
- `category` (string) — Filter by category name (case-insensitive substring match)
- `skillIds` (string) — Comma-separated skill IDs to filter by (e.g., `1,2,3`)
- `minPrice` (number) — Minimum price in dollars
- `maxPrice` (number) — Maximum price in dollars
- `sortBy` (string, default: `newest`) — Sorting option: `newest`, `price_asc`, `price_desc`, `rating`, `in_carts`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Product Name",
      "description": "...",
      "category": "Power Tools",
      "price_cents": 4999,
      "product_image_url": "https://...",
      "is_available": true,
      "avg_rating": 4.7,
      "rating_count": 245,
      "in_carts_count": 82,
      "skills": [
        { "id": 1, "name": "Electrician" }
      ]
    }
  ]
}
```

**Example:**
```bash
curl "http://localhost:3001/api/marketplace/products/browse?category=Power%20Tools&minPrice=10&maxPrice=100&sortBy=rating&page=1&limit=9"
```

---

#### 2. Search Products (Full-Text + Alias Matching)
```
GET /api/marketplace/products/search
```

Query parameters:
- `q` (string, required, min 2 chars) — Search query (matches name, description, aliases)
- `page` (number, default: 1) — Pagination
- `limit` (number, default: 20, max: 100) — Results per page
- `skillIds` (string) — Filter by skills
- `minPrice` (number) — Min price in dollars
- `maxPrice` (number) — Max price in dollars

**Advanced Ranking Algorithm:**
1. Exact name match (relevance: 1000)
2. Name contains term (relevance: 800)
3. Full-text match in name/description (relevance: 500)
4. Alias/synonym match (relevance: 400)
5. Boost by popularity (`in_carts_count`) and rating (`avg_rating`)

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "...", "name": "...", "relevance_score": 950, ... }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "hasMore": true
  }
}
```

**Example:**
```bash
# Search for "wrench" - also returns "socket" and "ratchet" via aliases
curl "http://localhost:3001/api/marketplace/products/search?q=wrench&limit=9"

# Search for "drill" filtered by electrician skill
curl "http://localhost:3001/api/marketplace/products/search?q=drill&skillIds=1"
```

---

### Categories

#### 3. Get Categories (Legacy — All Categories)
```
GET /api/marketplace/products/categories
```

Returns a flat list of all unique categories in products table.

**Response:**
```json
{
  "success": true,
  "data": {
    "categories": ["Tools", "Safety Gear", "Hardware", ...]
  }
}
```

---

#### 4. Get Hierarchical Categories (New)
```
GET /api/marketplace/products/categories/hierarchy
```

Returns categories organized by parent-child relationships with product counts.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Tools",
      "slug": "tools",
      "description": "All tools",
      "parent_category_id": null,
      "icon_emoji": "🔧",
      "icon_name": "tool",
      "display_order": 1,
      "product_count": 245,
      "children": [
        {
          "id": 16,
          "name": "Drills",
          "slug": "drills",
          "parent_category_id": 1,
          "product_count": 42,
          "children": []
        }
      ]
    }
  ],
  "totalCategories": 70
}
```

---

### Skills

#### 5. Get Skills (All Available)
```
GET /api/marketplace/products/skills/all
```

Returns all skills with product counts and average ratings.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Electrician",
      "description": "Electrical work and wiring",
      "product_count": 145,
      "avg_rating": 4.65
    },
    {
      "id": 2,
      "name": "Plumber",
      "product_count": 87,
      "avg_rating": 4.72
    }
  ],
  "pagination": {
    "total": 42
  }
}
```

**Use Case:** Populate skill-based discovery grid on ProductMarketplacePage
- User sees "Electrician (145 products)" tile
- Clicking it calls `GET /by-skill/1` to fetch all electrical products

---

#### 6. Get Products by Skill
```
GET /api/marketplace/products/by-skill/:skillId
```

Fetch all products related to a specific skill.

Query parameters:
- `limit` (number, default: 50, max: 200) — Max results
- `sort` (string, default: `relevance`) — Sort by: `relevance`, `rating`, `price`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "DeWalt 20V Cordless Drill",
      "price_cents": 4999,
      "avg_rating": 4.7,
      "in_carts_count": 82,
      "relevance_score": 85
    }
  ],
  "skillId": 1,
  "pagination": {
    "limit": 50,
    "total": 42,
    "hasMore": false
  }
}
```

**Example:**
```bash
# Get all electrician products sorted by relevance (highest relevance_score first)
curl "http://localhost:3001/api/marketplace/products/by-skill/1?limit=50&sort=relevance"

# Get top-rated plumber products
curl "http://localhost:3001/api/marketplace/products/by-skill/2?limit=20&sort=rating"
```

---

### Product Details

#### 7. Get Product Detail
```
GET /api/marketplace/products/:productId
```

Get full product details including reviews, related products, skills.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "DeWalt 20V Cordless Drill",
    "description": "Professional-grade cordless drill...",
    "category": "Power Tools",
    "price_cents": 4999,
    "product_image_url": "https://...",
    "sku": "DCD777C2",
    "upc": "...",
    "is_available": true,
    "avg_rating": 4.7,
    "rating_count": 245,
    "in_carts_count": 82,
    "skills": [
      { "id": 1, "name": "Electrician" },
      { "id": 4, "name": "Handyman" }
    ],
    "created_at": "2026-04-29T...",
    "updated_at": "2026-04-29T..."
  }
}
```

---

#### 8. Get Related Products
```
GET /api/marketplace/products/:productId/related
```

Get products related by shared skills.

Query parameters:
- `limit` (number, default: 10, max: 50) — Max results

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "...", "name": "...", ... }
  ]
}
```

---

#### 9. Get Frequently Bought Together
```
GET /api/marketplace/products/:productId/frequently-bought
```

Products commonly purchased with this product.

---

### Reviews

#### 10. Get Product Reviews
```
GET /api/marketplace/products/:productId/reviews
```

Get paginated reviews for a product.

Query parameters:
- `page` (number, default: 1)
- `limit` (number, default: 10, max: 50)

---

#### 11. Submit Product Review
```
POST /api/marketplace/products/:productId/reviews
```

**Auth Required:** YES (authenticate middleware)

Request body:
```json
{
  "rating": 5,
  "title": "Great drill!",
  "review_text": "Excellent build quality..."
}
```

---

## Frontend Integration Examples

### 1. Populate Category Grid
```javascript
// Load hierarchical categories
const { data } = await marketplaceApi.get('/categories/hierarchy');
const rootCategories = data.data.filter(c => !c.parent_category_id);

// Render tiles
rootCategories.map(cat => (
  <button onClick={() => filterByCategory(cat.id)}>
    {cat.icon_emoji} {cat.name}
    <span>{cat.product_count} products</span>
  </button>
))
```

### 2. Populate Skill Grid
```javascript
// Load all available skills
const { data } = await marketplaceApi.get('/skills/all');

// Render skill tiles
data.data.map(skill => (
  <button onClick={() => fetchProductsBySkill(skill.id)}>
    <Zap /> {skill.name}
    <span>{skill.product_count}</span>
  </button>
))
```

### 3. Fetch Products by Skill (Skill-Based Discovery)
```javascript
// User clicks "Electrician" skill tile
const handleSkillClick = async (skillId) => {
  const { data } = await marketplaceApi.get(`/by-skill/${skillId}`, {
    params: { limit: 50, sort: 'relevance' }
  });
  
  setProducts(data.data);
  setSelectedSkill(skillId);
}
```

### 4. Advanced Search with Ranking
```javascript
// User searches "wrench" - gets exact matches + related items + skill matches
const handleSearch = async (query) => {
  const { data } = await marketplaceApi.get('/search', {
    params: {
      q: query,
      minPrice: 10,
      maxPrice: 100,
      skillIds: '1,2',  // Filter by electrician + plumber
      page: 1,
      limit: 9
    }
  });
  
  // Results ranked by relevance_score
  setProducts(data.data);
}
```

### 5. Browse with Category Filter
```javascript
// User selects "Power Tools" category
const handleCategoryFilter = async (categoryId) => {
  const { data } = await marketplaceApi.get('/browse', {
    params: {
      category: 'Power Tools',
      sortBy: 'rating',
      page: 1,
      limit: 9
    }
  });
  
  setProducts(data.data);
}
```

---

## Search Algorithm Details

The advanced search implements a **multi-pass relevance ranking system**:

### Pass 1: Name Matching
- Exact name match → relevance: 1000
- Name contains query → relevance: 800

### Pass 2: Full-Text Search
- PostgreSQL `ts_rank()` on name + description → relevance: 500

### Pass 3: Alias Matching
- Product aliases (synonyms) matching query → relevance: 400

### Final Scoring
```
final_score = base_relevance 
            * (1 + in_carts_count / max_carts_count) 
            + avg_rating * 10
```

**Example:**
- User searches "wrench"
- Found:
  - "Adjustable Wrench" (exact match) → base 1000
  - "Socket Set" (alias="Socket Wrench") → base 400
  - "Ratchet Wrench" (name contains) → base 800
- Final ranking considers popularity + rating

---

## Performance Notes

- **Index on full-text search:** GIN index on `(name || description)` for fast matching
- **Category hierarchy:** Efficient recursive query with parent_id FK
- **Alias lookups:** B-tree index on `alias_name` for fast joins
- **Pagination:** LIMIT/OFFSET with efficient query planning
- **Caching:** Use React Query's `staleTime` to cache results (default: 5 min for browse, 30 min for categories/skills)

---

## Error Handling

All endpoints return standard error responses:

```json
{
  "success": false,
  "error": "Search query must be at least 2 characters"
}
```

HTTP Status Codes:
- `200` — Success
- `400` — Invalid parameters
- `401` — Unauthorized (for review submission)
- `404` — Product/skill/category not found
- `500` — Server error

---

## Sample Seed Data

See `server/seeds/productSeed.sql` for initial product database.

Contains:
- 30+ sample products across all categories
- Product aliases (synonyms)
- Skill-product mappings
- Initial ratings and cart counts
- Real-world product names and prices
