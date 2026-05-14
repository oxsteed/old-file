# OxSteed - API Endpoints Reference
**Complete API Routes for Testing**

---

## TABLE OF CONTENTS
1. [Authentication](#authentication)
2. [Jobs](#jobs)
3. [Bids](#bids)
4. [Payments](#payments)
5. [Calendar & Appointments](#calendar--appointments)
6. [Helpers](#helpers)
7. [Businesses](#businesses)
8. [Messages](#messages)
9. [Support](#support)
10. [Marketplace](#marketplace)
11. [Orders](#orders)
12. [Affiliates](#affiliates)
13. [Templates](#templates)
14. [Pricing Overrides](#pricing-overrides)
15. [Admin](#admin)
16. [Webhooks](#webhooks)

---

## AUTHENTICATION

### Register
```
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe",
  "userType": "customer|helper|business"
}

Response: { user, accessToken, refreshToken }
```

### Login
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123"
}

Response: { user, accessToken, refreshToken }
```

### Verify Registration OTP
```
POST /api/auth/verify-registration-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}

Response: { user, accessToken, refreshToken }
```

### Refresh Token
```
POST /api/auth/refresh
Authorization: Bearer <refreshToken>

Response: { accessToken, refreshToken }
```

### Logout
```
POST /api/auth/logout
Authorization: Bearer <accessToken>

Response: { success: true }
```

### Request Password Reset
```
POST /api/auth/password-reset-request
Content-Type: application/json

{
  "email": "user@example.com"
}

Response: { success: true, message: "Reset link sent" }
```

### Reset Password
```
POST /api/auth/password-reset
Content-Type: application/json

{
  "token": "reset_token",
  "newPassword": "newPassword123"
}

Response: { success: true }
```

### Verify Phone OTP
```
POST /api/auth/verify-phone-otp
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "phone": "+1234567890",
  "code": "123456"
}

Response: { success: true, verified: true }
```

---

## JOBS

### Create Job
```
POST /api/jobs
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{
  "title": "Fix kitchen sink",
  "description": "Leaking under sink...",
  "category": "plumbing",
  "skills": ["plumbing", "leak-repair"],
  "budget": 150,
  "estimatedHours": 2,
  "locationCity": "Austin",
  "locationState": "TX",
  "locationZip": "78701",
  "locationCountry": "USA",
  "images": [File, File]  // multipart files
}

Response: { job: { id, title, status, ... } }
```

### Get Job
```
GET /api/jobs/:jobId
Authorization: Bearer <accessToken> (optional)

Response: { 
  job: { 
    id, title, description, category, skills, budget, 
    location_country, recurrence, updated_at, started_at, 
    completed_at, cancelled_at, cancellation_reason, 
    escrow_status, preferred_helper_id, preferred_helper_name,
    ... 
  } 
}
```

### List Jobs
```
GET /api/jobs?status=published&category=plumbing&lat=30.2672&lng=-97.7431&radius=10&country=USA&limit=50&offset=0&sort=nearest
Authorization: Bearer <accessToken> (optional)

Query Params:
  - status: draft|published|matched|negotiating|accepted|in_progress|completed|cancelled|closed
  - category: [string]
  - lat, lng, radius: for geolocation search
  - country: [string]
  - limit: max 100 (default 50)
  - offset: pagination
  - sort: newest|oldest|nearest|bids

Response: { jobs: [...], total: number }
```

### Update Job
```
PUT /api/jobs/:jobId
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{ title, description, category, skills, budget, estimatedHours, ... }

Response: { job: { ... } }
```

### My Jobs (Customer)
```
GET /api/jobs/me/list?status=published&include_deleted=0&limit=50&offset=0
Authorization: Bearer <accessToken>

Query Params:
  - status: published|draft|matched|in_progress|completed|cancelled
  - include_deleted: 0|1 (default 0)
  - limit: max 100
  - offset: pagination

Response: { 
  jobs: [{ id, title, status, bid_count, started_at, completed_at, cancelled_at, cancellation_reason, ... }],
  total: number
}
```

### Start Job
```
POST /api/jobs/:jobId/start
Authorization: Bearer <accessToken>

Response: { job: { status: "in_progress", started_at, ... } }
```

### Complete Job
```
POST /api/jobs/:jobId/complete
Authorization: Bearer <accessToken>

Response: { job: { status: "completed", completed_at, ... } }
```

### Cancel Job
```
POST /api/jobs/:jobId/cancel
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reason": "Found another helper",
  "details": "Optional details..."
}

Response: { job: { status: "cancelled", cancelled_at, ... }, fee_charged: number }
```

### Assign Helper
```
POST /api/jobs/:jobId/assign-helper/:helperId
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "scheduledDate": "2026-05-20",
  "scheduledTime": "09:00",
  "timezone": "America/Chicago",
  "eta": "15 minutes"
}

Response: { job: { preferred_helper_id, scheduled_date, ... }, appointment: { ... } }
```

---

## BIDS

### Create Bid
```
POST /api/bids
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "jobId": "uuid",
  "amount": 150.00,
  "estimatedHours": 2,
  "message": "I can fix this quickly!"
}

Response: { bid: { id, jobId, amount, status: "pending", ... } }
```

### Get Bid
```
GET /api/bids/:bidId
Authorization: Bearer <accessToken>

Response: { bid: { id, jobId, helperId, amount, estimatedHours, message, status, ... } }
```

### My Bids
```
GET /api/bids/my-bids?status=pending&limit=50&offset=0
Authorization: Bearer <accessToken>

Query Params:
  - status: pending|accepted|rejected|withdrawn
  - limit: max 100
  - offset: pagination

Response: { 
  bids: [{ id, jobId, amount, status, job_title, ... }],
  total: number,
  'X-Total-Count': number
}
```

### Update Bid
```
PUT /api/bids/:bidId
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "amount": 175.00,
  "estimatedHours": 2.5,
  "message": "Updated bid message"
}

Response: { bid: { ... } }
```

### Withdraw Bid
```
DELETE /api/bids/:bidId
Authorization: Bearer <accessToken>

Response: { success: true, bid: { status: "withdrawn" } }
```

### Accept Bid (Customer)
```
POST /api/bids/:bidId/accept
Authorization: Bearer <accessToken>

Response: { 
  bid: { status: "accepted" },
  appointment: { id, scheduled_date, scheduled_time, ... }
}
```

### Reject Bid (Customer)
```
POST /api/bids/:bidId/reject
Authorization: Bearer <accessToken>

Response: { bid: { status: "rejected" } }
```

---

## PAYMENTS

### Create Payment Intent
```
POST /api/payments/create-payment-intent
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "amount": 15000,  // cents
  "currency": "usd",
  "jobId": "uuid" OR "cartId": "uuid",
  "description": "Job payment"
}

Response: { 
  clientSecret: "pi_..._secret_...",
  publishableKey: "pk_...",
  paymentIntentId: "pi_..."
}
```

### Capture Payment
```
POST /api/payments/capture-payment
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "paymentIntentId": "pi_...",
  "amount": 15000  // cents
}

Response: { success: true, status: "succeeded" }
```

### Get Payment
```
GET /api/payments/:paymentId
Authorization: Bearer <accessToken>

Response: { payment: { id, amount, status, currency, ... } }
```

### My Payments
```
GET /api/payments/my-payments?limit=50&offset=0
Authorization: Bearer <accessToken>

Query Params:
  - limit: max 100
  - offset: pagination

Response: { 
  payments: [{ id, amount, status, date, ... }],
  total: number,
  limit: number,
  offset: number
}
```

### Refund Payment
```
POST /api/payments/refund
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "paymentIntentId": "pi_...",
  "reason": "job_cancelled"
}

Response: { success: true, refundId: "re_..." }
```

### Get Connect Status
```
GET /api/payments/connect-status
Authorization: Bearer <accessToken>

Response: { 
  connected: boolean,
  accountId: "acct_...",
  payoutsEnabled: boolean
}
```

### Create Connect Account
```
POST /api/payments/create-connect-account
Authorization: Bearer <accessToken>

Response: { 
  accountId: "acct_...",
  onboardingUrl: "https://connect.stripe.com/..."
}
```

### Create Payout
```
POST /api/payments/payouts
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "amount": 50000,  // cents
  "currency": "usd",
  "description": "Monthly payout"
}

Response: { payout: { id, amount, status: "pending", ... } }
```

### Get Job Payment
```
GET /api/payments/jobs/:jobId
Authorization: Bearer <accessToken>

Response: { payment: { id, jobId, amount, status, ... } }
```

---

## CALENDAR & APPOINTMENTS

### Get Appointments
```
GET /api/calendar/appointments?role=customer&limit=100
Authorization: Bearer <accessToken>

Query Params:
  - role: customer|helper
  - limit: max 100

Response: { appointments: [{ id, jobId, scheduledDate, scheduledTime, status, ... }] }
```

### Create Appointment
```
POST /api/appointments
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "jobId": "uuid",
  "scheduledDate": "2026-05-20",
  "scheduledTime": "09:00",
  "timezone": "America/Chicago",
  "eta": "15 minutes",
  "source": "user|ai_chat"
}

Response: { appointment: { id, jobId, scheduledDate, status: "confirmed", ... } }
```

### Get Appointment
```
GET /api/appointments/:appointmentId
Authorization: Bearer <accessToken>

Response: { appointment: { id, jobId, helper, customer, scheduledDate, status, notes, ... } }
```

### Reschedule Appointment
```
POST /api/appointments/:appointmentId/reschedule
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "newDate": "2026-05-21",
  "newTime": "14:00",
  "reason": "Schedule conflict"
}

Response: { appointment: { scheduledDate, scheduledTime, status: "pending_reschedule", ... } }
```

### Respond to Reschedule
```
POST /api/appointments/:appointmentId/respond-reschedule
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "accept": true|false,
  "reason": "Optional reason if declining"
}

Response: { appointment: { status: "confirmed|rejected", scheduledDate, ... } }
```

### Get Availability
```
GET /api/appointments/availability/:helperId?date=2026-05-20
Authorization: Bearer <accessToken>

Query Params:
  - date: YYYY-MM-DD

Response: { availableSlots: [{ start: "09:00", end: "09:30", available: true }, ...] }
```

### Create Availability Block
```
POST /api/appointments/availability
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "startDate": "2026-05-20",
  "startTime": "09:00",
  "endDate": "2026-05-20",
  "endTime": "17:00",
  "recurrence": "weekly|daily|once",
  "type": "available|busy"
}

Response: { availability: { id, startDate, startTime, ... } }
```

### Get iCal
```
GET /api/calendar/ical/:jobId
Authorization: Bearer <accessToken>

Response: iCalendar (.ics) file download
```

---

## HELPERS

### Get Helper Profile
```
GET /api/helpers/:helperId/profile
Authorization: Bearer <accessToken> (optional)

Response: { 
  helper: { 
    id, name, displayName, avatar, coverImage, bio, 
    rating, reviewCount, responseTime, jobsCompleted,
    skills: [...], services: [...], faqs: [...], policies: [...],
    location, serviceLat, serviceLng, serviceRadiusMiles,
    activeTemplate, ...
  }
}
```

### List Helpers
```
GET /api/helpers?skill=plumbing&category=repairs&lat=30.2672&lng=-97.7431&radius=10&country=USA&sortBy=rating&limit=50&offset=0
Authorization: Bearer <accessToken> (optional)

Query Params:
  - skill, category, license, insurance: filter
  - lat, lng, radius: geolocation
  - country: [string]
  - sortBy: name|newest|oldest|rating|jobs|activity
  - limit, offset: pagination

Response: { 
  helpers: [{ id, name, avatar, rating, jobsCompleted, skills, ... }],
  total: number
}
```

### Get Helper Skills
```
GET /api/helpers/:helperId/skills
Authorization: Bearer <accessToken> (optional)

Response: { skills: [{ name, expertise, yearsExperience, hourlyRate, ... }] }
```

### Get Helper Pricing
```
GET /api/helpers/:helperId/pricing
Authorization: Bearer <accessToken> (optional)

Response: { 
  services: [{ name, category, minRate, maxRate, ... }],
  hourlyRateMin: number,
  hourlyRateMax: number,
  avgRating: number,
  reviewCount: number
}
```

### Get Helper Slots
```
GET /api/helpers/:helperId/slots
Authorization: Bearer <accessToken> (optional)

Response: { 
  slots: [{ bookingDay, totalSlots, bookedSlots, availableSlots, ... }]
}
```

### Get Helper Profile QR
```
GET /api/helpers/:helperId/profile-qr.png?w=256
Authorization: Bearer <accessToken> (optional)

Query Params:
  - w: 64-512 (width)

Response: PNG image file
```

### Helper Search Suggestions
```
GET /api/helpers/search/suggestions?q=plumb
Authorization: Bearer <accessToken> (optional)

Response: { suggestions: ["plumber", "plumbing", "plumbing repair", ...] }
```

---

## BUSINESSES

### Get Business Profile
```
GET /api/businesses/:businessId/public
Authorization: Bearer <accessToken> (optional)

Response: { 
  business: { 
    id, name, avatar, logo, coverPhoto, description,
    category, location, serviceLat, serviceLng, serviceRadiusMiles,
    owner, ownerName, ownerRating, phone, email, website,
    activeTemplate, ...
  }
}
```

### Get Business Profile Edit
```
GET /api/businesses/:businessId/profile-edit
Authorization: Bearer <accessToken>

Response: { 
  business: { 
    id, name, description, logo, coverPhoto, 
    category, location, phone, email, website,
    socialMedia, businessPhase, aiKnowledge, ...
  }
}
```

### Update Business
```
PUT /api/businesses/:businessId
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{
  "name": "New Business Name",
  "description": "...",
  "category": "repairs",
  "logo": File,
  "coverPhoto": File,
  "phone": "+1234567890",
  "email": "biz@example.com",
  "website": "https://example.com",
  "socialMedia": {...},
  "aiKnowledge": "..."
}

Response: { business: { ... } }
```

### Get Business Analytics
```
GET /api/businesses/:businessId/analytics
Authorization: Bearer <accessToken>

Response: { 
  analytics: { 
    revenue, jobsPosted, jobsCompleted,
    avgJobValue, teamSize, responseTime,
    chartData: [...]
  }
}
```

### Get Team Members
```
GET /api/businesses/:businessId/team
Authorization: Bearer <accessToken>

Response: { members: [{ id, name, role, email, joinedDate, ... }] }
```

### Invite Team Member
```
POST /api/businesses/:businessId/invite
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "email": "member@example.com",
  "role": "manager|team_member"
}

Response: { invitation: { id, email, expiresAt, ... } }
```

---

## MESSAGES

### Send Message
```
POST /api/messages
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "conversationId": "uuid" OR "recipientId": "uuid",
  "text": "Message content",
  "type": "text|booking_request"
}

Response: { message: { id, conversationId, text, createdAt, ... } }
```

### Get Messages
```
GET /api/messages/conversation/:conversationId?limit=50&offset=0
Authorization: Bearer <accessToken>

Query Params:
  - limit: max 100
  - offset: pagination

Response: { 
  messages: [{ id, senderId, text, createdAt, readAt, ... }],
  total: number
}
```

### Get Conversations
```
GET /api/messages/conversations?limit=50&offset=0
Authorization: Bearer <accessToken>

Query Params:
  - limit: max 100
  - offset: pagination

Response: { 
  conversations: [{ id, participantId, lastMessage, unreadCount, ... }],
  total: number
}
```

### Mark as Read
```
POST /api/messages/conversation/:conversationId/read
Authorization: Bearer <accessToken>

Response: { success: true }
```

### Block User
```
POST /api/messages/block/:userId
Authorization: Bearer <accessToken>

Response: { success: true, blocked: true }
```

---

## SUPPORT

### Create Support Ticket
```
POST /api/support/tickets
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "subject": "Ticket title",
  "description": "Detailed description",
  "category": "billing|technical|general",
  "priority": "low|medium|high|critical"
}

Response: { 
  ticket: { 
    id: "ticket_123",
    subject, description, status: "open",
    createdAt, updatedAt, ...
  }
}
```

### Get Ticket
```
GET /api/support/tickets/:ticketId
Authorization: Bearer <accessToken>

Response: { 
  ticket: { 
    id, subject, description, status,
    messages: [{ id, senderId, text, createdAt, ... }],
    ...
  }
}
```

### List Tickets
```
GET /api/support/tickets?status=open&limit=50&offset=0
Authorization: Bearer <accessToken>

Query Params:
  - status: open|in_progress|resolved|closed
  - limit, offset: pagination

Response: { 
  tickets: [{ id, subject, status, priority, createdAt, ... }],
  total: number
}
```

### Reply to Ticket
```
POST /api/support/tickets/:ticketId/messages
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "text": "Reply message"
}

Response: { message: { id, text, createdAt, ... } }
```

### Close Ticket
```
POST /api/support/tickets/:ticketId/close
Authorization: Bearer <accessToken>

Response: { ticket: { status: "closed" } }
```

---

## MARKETPLACE

### Get Cart Summary
```
GET /api/carts/:cartId/session
Authorization: Bearer <accessToken>

Response: { 
  cart: { 
    items: [{ productId, name, price, quantity, ... }],
    subtotal, tax, shipping, discount, total,
    ...
  }
}
```

### Create Payment Intent (Marketplace)
```
POST /api/carts/:cartId/payment-intent
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "shippingAddress": { street, city, state, zip, country },
  "shippingMethod": "standard|express",
  "discountCode": "CODE123" (optional)
}

Response: { 
  clientSecret: "pi_...",
  paymentIntentId: "pi_...",
  publishableKey: "pk_..."
}
```

### Confirm Cart Payment
```
POST /api/carts/:cartId/confirm
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "paymentIntentId": "pi_..."
}

Response: { 
  order: { id, status: "paid", items: [...], total, ... },
  message: "Order confirmed"
}
```

---

## ORDERS

### Get Orders
```
GET /api/orders?status=paid&limit=50&offset=0
Authorization: Bearer <accessToken>

Query Params:
  - status: pending|paid|shipped|completed|cancelled
  - limit, offset: pagination

Response: { 
  orders: [{ id, status, total, items, createdAt, ... }],
  total: number
}
```

### Get Order Details
```
GET /api/orders/:orderId
Authorization: Bearer <accessToken>

Response: { 
  order: { 
    id, status, items: [...], total,
    shippingAddress, trackingNumber, shippedAt, ...
  }
}
```

### Cancel Order
```
POST /api/orders/:orderId/cancel
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reason": "Changed my mind"
}

Response: { order: { status: "cancelled" } }
```

### Get Order Stats
```
GET /api/orders/stats
Authorization: Bearer <accessToken>

Response: { 
  stats: { 
    totalOrders, completedCount, pendingCount,
    totalSpent, ...
  }
}
```

---

## AFFILIATES

### Create Affiliate Program
```
POST /api/affiliate
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "programType": "home_depot|amazon|custom",
  "commissionRate": 2.5,
  "webhookUrl": "https://example.com/webhook" (optional)
}

Response: { program: { id, programType, commissionRate, ... } }
```

### Get Affiliate Programs
```
GET /api/affiliate
Authorization: Bearer <accessToken>

Response: { programs: [{ id, programType, commissionRate, totalCommission, ... }] }
```

### Get Commissions
```
GET /api/affiliate/:programId/commissions?status=pending&limit=50
Authorization: Bearer <accessToken>

Query Params:
  - status: pending|confirmed|paid
  - limit: max 100

Response: { 
  commissions: [{ id, orderId, amount, status, createdAt, ... }],
  total: number
}
```

### Calculate Payout
```
POST /api/affiliate/calculate
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "programId": "uuid",
  "startDate": "2026-05-01",
  "endDate": "2026-05-31"
}

Response: { 
  payout: { 
    id, periodStart, periodEnd, totalAmount,
    commissionCount, status: "pending", ...
  }
}
```

### Process Payout
```
POST /api/affiliate/:payoutId/process
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "payoutMethod": "bank|paypal|stripe",
  "accountDetails": { ... }
}

Response: { payout: { status: "processing", payoutReference, ... } }
```

### Get Affiliate Stats
```
GET /api/affiliate/stats/all
Authorization: Bearer <accessToken>

Response: { 
  stats: { 
    lifetimeCommissions, pendingCommissions,
    commissionCount, totalPayouts, ...
  }
}
```

### Get Payout Schedule
```
GET /api/affiliate/schedule
Authorization: Bearer <accessToken>

Response: { 
  schedule: [{ id, period, amount, status, processedAt, ... }]
}
```

---

## TEMPLATES

### List Templates
```
GET /api/templates?type=helper|business
Authorization: Bearer <accessToken> (optional)

Response: { 
  templates: [{ 
    slug, name, category, isFree, monthlyPrice,
    isActive, description, ...
  }]
}
```

### Get My Template Access
```
GET /api/templates/my-access
Authorization: Bearer <accessToken>

Response: { 
  access: [{ slug, accessType, grantType, expiryDate, status, ... }]
}
```

### Get Active Template
```
GET /api/templates/active
Authorization: Bearer <accessToken>

Response: { activeTemplate: "slug_name" }
```

### Activate Template
```
POST /api/templates/:slug/activate
Authorization: Bearer <accessToken>

Response: { success: true, activeTemplate: "slug_name" }
```

---

## PRICING OVERRIDES

### Get All Pricing Overrides
```
GET /api/admin/pricing-overrides
Authorization: Bearer <accessToken> (Admin)

Response: { 
  overrides: [{ countryCode, priceCents, currency, minPrice, maxPrice, ... }]
}
```

### Get Pricing Override
```
GET /api/admin/pricing-overrides/:countryCode
Authorization: Bearer <accessToken> (Admin)

Response: { override: { countryCode, priceCents, currency, ... } }
```

### Update Pricing Override
```
PUT /api/admin/pricing-overrides/:countryCode
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "priceCents": 2999,
  "currency": "USD"
}

Response: { override: { ... } }
```

### Get Pricing Comparison
```
GET /api/admin/pricing-overrides/comparison
Authorization: Bearer <accessToken> (Admin)

Response: { 
  comparison: [{ 
    currency, minPrice, maxPrice, avgPrice,
    countryCount, ...
  }]
}
```

---

## ADMIN

### Get All Users
```
GET /api/admin/users?search=email&status=active&limit=50&offset=0
Authorization: Bearer <accessToken> (Admin)

Response: { users: [...], total: number }
```

### Get User Details
```
GET /api/admin/users/:userId
Authorization: Bearer <accessToken> (Admin)

Response: { 
  user: { 
    id, email, name, status, isSuspended,
    suspendedUntil, adminNotes, ...
  }
}
```

### Set User Password
```
POST /api/admin/users/:userId/password
Authorization: Bearer <accessToken> (SuperAdmin)
Content-Type: application/json

{
  "newPassword": "tempPassword123"
}

Response: { success: true }
```

### Suspend User
```
POST /api/admin/users/:userId/suspend
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "durationHours": 24,
  "reason": "Abusive behavior"
}

Response: { user: { isSuspended: true, suspendedUntil, ... } }
```

### Add User Restriction
```
POST /api/admin/users/:userId/restrict
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "restrictionType": "bidding|job_posting|checkout|all",
  "durationDays": 30,
  "reason": "Violation"
}

Response: { restriction: { id, type, expiresAt, ... } }
```

### Get All Businesses
```
GET /api/admin/businesses?status=active&sortBy=name&limit=50&offset=0
Authorization: Bearer <accessToken> (Admin)

Response: { businesses: [...], total: number }
```

### Get Business Detail
```
GET /api/admin/businesses/:businessId
Authorization: Bearer <accessToken> (Admin)

Response: { 
  business: { 
    id, name, status, deletedAt, adminNotes,
    owner, createdAt, ...
  }
}
```

### Flag Business
```
PUT /api/admin/businesses/:businessId/flag
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "reason": "Suspicious activity"
}

Response: { business: { flagged: true, ... } }
```

### Update Admin Notes
```
PUT /api/admin/businesses/:businessId/admin-notes
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "notes": "Admin notes here..."
}

Response: { business: { adminNotes: "..." } }
```

### Delete Business
```
PUT /api/admin/businesses/:businessId/delete
Authorization: Bearer <accessToken> (Admin)

Response: { business: { deletedAt: timestamp } }
```

### Get All Orders
```
GET /api/admin/orders?status=paid&limit=50&offset=0
Authorization: Bearer <accessToken> (Admin)

Response: { orders: [...], total: number }
```

### Mark Order as Shipped
```
PUT /api/admin/orders/:orderId/ship
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "trackingNumber": "TRACK123456"
}

Response: { order: { shippedAt, trackingNumber, ... } }
```

### Process Order Refund
```
POST /api/admin/orders/:orderId/refund
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "reason": "Damaged item"
}

Response: { order: { refundId, refundAmount, ... } }
```

---

## WEBHOOKS

### Stripe Webhook
```
POST /api/webhooks/stripe
Content-Type: application/json
Stripe-Signature: t=timestamp,v1=signature

{
  "id": "evt_...",
  "type": "payment_intent.succeeded|payment_intent.payment_failed|charge.refunded|...",
  "data": { object: { ... } }
}

Response: { received: true }
```

### Didit Webhook
```
POST /api/webhooks/didit
Content-Type: application/json
Authorization: Bearer <diditWebhookSecret>

{
  "type": "verification.completed",
  "applicantId": "...",
  "status": "approved|rejected",
  ...
}

Response: { received: true }
```

---

## TESTING NOTES

### Authentication Headers
All protected endpoints require:
```
Authorization: Bearer <accessToken>
```

### Response Format
All responses follow:
```json
{
  "success": true|false,
  "data": { ... },
  "message": "Optional message",
  "error": "Optional error details"
}
```

### Rate Limiting
- General API: 100 requests / 15 minutes / IP
- Auth endpoints: 15 requests / 15 minutes / IP
- Strict operations: 5 requests / hour / IP

### Error Codes
- 400: Bad Request (validation error)
- 401: Unauthorized (missing/invalid token)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 409: Conflict (duplicate, state conflict)
- 429: Too Many Requests (rate limited)
- 500: Internal Server Error

### Test Account Credentials
```
Email: test@oxsteed.com
Password: TestPassword123!
```

### Test Data
- Test card (Stripe): 4242 4242 4242 4242 (any future expiry, any CVC)
- Test bank account (Stripe): 110000000 (routing), 000123456789 (account)

---

**Document Version:** 1.0  
**Last Updated:** 2026-05-14  
**Status:** Complete API Reference for Testing
