# OxSteed Marketplace API Documentation

**Base URL**: `https://api.oxsteed.com/api`  
**Authentication**: JWT Bearer Token in Authorization header

---

## 🛒 Shopping Cart Endpoints

### Get Cart Items
```
GET /carts/{cartId}
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "customer_id": 123,
    "name": "My Cart",
    "items": [
      {
        "id": 1,
        "product_id": 1,
        "quantity": 2,
        "unit_price_cents": 1500
      }
    ],
    "total_items": 2,
    "total_cents": 3000
  }
}
```

### Add to Cart
```
POST /carts/{cartId}/items
Authorization: Bearer <token>

{
  "product_id": 1,
  "quantity": 2
}
```

### Update Cart Item
```
PUT /carts/{cartId}/items/{itemId}
Authorization: Bearer <token>

{
  "quantity": 5
}
```

### Remove from Cart
```
DELETE /carts/{cartId}/items/{itemId}
Authorization: Bearer <token>
```

---

## 💳 Checkout Endpoints

### Get Checkout Summary
```
GET /carts/{cartId}/session
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "cartId": 1,
    "items": [
      {
        "productId": 1,
        "name": "Widget",
        "quantity": 2,
        "unitPrice": 1500,
        "totalPrice": 3000
      }
    ],
    "subtotal": 3000,
    "tax": 240,
    "total": 3240
  }
}
```

### Create Payment Intent
```
POST /carts/{cartId}/payment-intent
Authorization: Bearer <token>

{
  "email": "customer@example.com",
  "shippingAddress": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zip": "10001",
    "country": "US"
  },
  "discountCode": "SAVE10" (optional)
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "orderId": 1,
    "clientSecret": "pi_123456789_secret_abcdef",
    "paymentIntentId": "pi_123456789",
    "total": 3240,
    "publishableKey": "pk_live_..."
  }
}
```

### Confirm Payment
```
POST /carts/{cartId}/confirm
Authorization: Bearer <token>

{
  "paymentIntentId": "pi_123456789",
  "orderId": 1
}
```

---

## 📦 Orders Endpoints

### List Orders
```
GET /orders?status=paid&skip=0&limit=20
Authorization: Bearer <token>
```

**Status values**: `pending`, `paid`, `processing`, `completed`, `cancelled`, `refunded`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "status": "paid",
      "total_cents": 3240,
      "created_at": "2026-04-29T01:35:00Z",
      "customer_id": 123
    }
  ]
}
```

### Get Order Details
```
GET /orders/{orderId}
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "paid",
    "subtotal_cents": 3000,
    "tax_cents": 240,
    "shipping_cents": 500,
    "discount_cents": 300,
    "total_cents": 3440,
    "shipping_address": {
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zip": "10001",
      "country": "US"
    },
    "items": [
      {
        "id": 1,
        "product_id": 1,
        "quantity": 2,
        "unit_price_cents": 1500,
        "total_price_cents": 3000
      }
    ],
    "transaction": {
      "payment_intent_id": "pi_123456789",
      "status": "succeeded",
      "amount_cents": 3440
    }
  }
}
```

### Get Order Statistics
```
GET /orders/stats
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "total_orders": 5,
    "completed_orders": 4,
    "pending_orders": 1,
    "cancelled_orders": 0,
    "total_spent_cents": 15000,
    "average_order_value_cents": 3000
  }
}
```

### Cancel Order
```
POST /orders/{orderId}/cancel
Authorization: Bearer <token>
```

---

## 🏪 Marketplace Products

### Browse Products
```
GET /marketplace/products/browse?category=tools&price_min=0&price_max=5000&sort=rating&skip=0&limit=20
```

**Query Parameters**:
- `category`: Product category
- `price_min`, `price_max`: Price range in cents
- `sort`: `rating`, `price_asc`, `price_desc`, `newest`, `popularity`
- `skip`, `limit`: Pagination

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Hammer",
      "description": "16 oz claw hammer",
      "price_cents": 1500,
      "category": "tools",
      "rating": 4.5,
      "review_count": 125,
      "image_url": "https://...",
      "in_stock": true,
      "quantity_available": 50
    }
  ]
}
```

### Search Products
```
GET /marketplace/products/search?q=hammer&skip=0&limit=20
```

### Get Product Details
```
GET /marketplace/products/{productId}
```

### Get Product Reviews
```
GET /marketplace/products/{productId}/reviews
```

---

## 💰 Discount Codes (Admin)

### Create Discount Code
```
POST /admin/discount-codes
Authorization: Bearer <admin-token>

{
  "code": "SAVE10",
  "description": "Save 10% on orders over $50",
  "discount_type": "percentage",
  "discount_amount": 10,
  "min_order_cents": 5000,
  "usage_limit": 100,
  "start_date": "2026-04-29T00:00:00Z",
  "end_date": "2026-05-29T23:59:59Z"
}
```

### Get Discount Codes
```
GET /admin/discount-codes?status=active&skip=0&limit=50
Authorization: Bearer <admin-token>
```

### Update Discount Code
```
PUT /admin/discount-codes/{codeId}
Authorization: Bearer <admin-token>

{
  "status": "inactive",
  "usage_limit": 50,
  "end_date": "2026-05-15T23:59:59Z"
}
```

### Get Discount Code Usage
```
GET /admin/discount-codes/{codeId}/usage
Authorization: Bearer <admin-token>
```

---

## 🛍️ Admin Products

### Create Product
```
POST /admin/products
Authorization: Bearer <admin-token>

{
  "name": "Hammer",
  "description": "16 oz claw hammer",
  "price_cents": 1500,
  "category": "tools",
  "quantity_available": 100,
  "image_url": "https://...",
  "affiliate_url": "https://homedepot.com/p/123"
}
```

### Update Product
```
PUT /admin/products/{productId}
Authorization: Bearer <admin-token>

{
  "price_cents": 1200,
  "quantity_available": 50
}
```

### Delete Product
```
DELETE /admin/products/{productId}
Authorization: Bearer <admin-token>
```

### Bulk Create Products
```
POST /admin/products/bulk-create
Authorization: Bearer <admin-token>

{
  "products": [
    {
      "name": "Hammer",
      "price_cents": 1500,
      "quantity_available": 100
    },
    {
      "name": "Wrench",
      "price_cents": 800,
      "quantity_available": 50
    }
  ]
}
```

---

## 🤝 Affiliate Program

### Create Affiliate Program
```
POST /affiliate
Authorization: Bearer <helper-token>

{
  "program_type": "home_depot",
  "commission_rate": 2.5
}
```

### Get Affiliate Programs
```
GET /affiliate
Authorization: Bearer <helper-token>
```

### Get Commissions
```
GET /affiliate/{programId}/commissions?status=pending&skip=0&limit=50
Authorization: Bearer <helper-token>
```

### Calculate Payout
```
POST /affiliate/calculate
Authorization: Bearer <helper-token>

{
  "programId": 1,
  "periodStart": "2026-04-01",
  "periodEnd": "2026-04-30"
}
```

### Process Payout
```
POST /affiliate/{payoutId}/process
Authorization: Bearer <helper-token>

{
  "payout_method": "stripe_direct",
  "payment_method_id": "ba_1234567890abcdef"
}
```

### Get Affiliate Stats
```
GET /affiliate/stats/all
Authorization: Bearer <helper-token>
```

---

## 🔑 API Products (Digital Products)

### Create API Product
```
POST /api-products
Authorization: Bearer <creator-token>

{
  "name": "Weather API",
  "description": "Real-time weather data",
  "pricing_type": "recurring",
  "monthly_price_cents": 2999,
  "max_requests_per_month": 10000,
  "documentation_url": "https://docs.example.com"
}
```

### Publish API Product
```
POST /api-products/{productId}/publish
Authorization: Bearer <creator-token>
```

### Generate API Key
```
POST /api-products/{productId}/keys/generate
Authorization: Bearer <customer-token>

Response includes: apiKey (returned once), keyPrefix, createdAt
```

### Get API Keys
```
GET /api-products/{productId}/keys
Authorization: Bearer <customer-token>
```

### Revoke API Key
```
POST /api-products/{keyId}/revoke
Authorization: Bearer <customer-token>
```

### Get API Product Usage
```
GET /api-products/{productId}/usage
Authorization: Bearer <creator-token>
```

---

## 🔄 Webhook Events

### Payment Intent Succeeded
```
Event: payment_intent.succeeded
Metadata: {
  "orderId": "123",
  "cartId": "456",
  "userId": "789"
}
```

### Order Status Changed
```
Event: order.status_changed
Data: {
  "orderId": 1,
  "oldStatus": "pending",
  "newStatus": "paid"
}
```

---

## ⚠️ Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "error": "Validation failed",
  "errors": {
    "email": "Invalid email format",
    "quantity": "Must be positive"
  }
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "error": "Missing or invalid authorization"
}
```

### 429 Rate Limited
```json
{
  "success": false,
  "error": "Too many requests. Try again later."
}
```

### 500 Server Error
```json
{
  "success": false,
  "error": "Internal server error"
}
```

---

## 📋 Rate Limits

- **Unauthenticated**: 200 requests / 15 minutes per IP
- **Authenticated**: 500 requests / 15 minutes per user
- **Auth endpoints**: 15 requests / 15 minutes per IP
- **Account deletion**: 5 requests / hour per user

---

## 🔐 Authentication

Include JWT token in Authorization header:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 📦 Examples

### Complete Checkout Flow
```bash
# 1. Create payment intent
curl -X POST https://api.oxsteed.com/api/carts/1/payment-intent \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "shippingAddress": {"street": "123 Main St", "city": "NYC", "state": "NY", "zip": "10001", "country": "US"},
    "discountCode": "SAVE10"
  }'

# 2. Confirm payment with Stripe
# (Use clientSecret with Stripe.js frontend)

# 3. Confirm on backend
curl -X POST https://api.oxsteed.com/api/carts/1/confirm \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentIntentId": "pi_123456789",
    "orderId": 1
  }'
```

---

**Last Updated**: 2026-04-29  
**Version**: 1.0
