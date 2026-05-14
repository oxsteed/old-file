# OxSteed - EXPANDED API Endpoints Reference
**Additional API Routes (Second Pass) - No Duplicates**

---

## CONSULTING SYSTEM

### Consulting Intake
```
POST /api/consulting/intake
Content-Type: application/json

{
  "step": 1,
  "businessName": "My Business",
  "industry": "home-repair",
  "businessPhase": "pre-launch|launch|growth|scaling|established",
  "urgency": "low|medium|high|critical",
  "timeline": "ASAP|1-2 weeks|1 month|etc"
}

Response: { intake: { id, userId, step, status, ... } }
```

### Get Consulting Sessions
```
GET /api/consulting/sessions?status=scheduled&limit=50&offset=0
Authorization: Bearer <accessToken>

Response: { sessions: [{ id, consultantId, consultantName, scheduledDate, status, ... }] }
```

### Book Consultation
```
POST /api/consulting/sessions
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "consultantId": "uuid",
  "proposedDate": "2026-05-20",
  "proposedTime": "14:00",
  "topic": "Business launch",
  "notes": "..."
}

Response: { session: { id, status: "pending", meetingLink, ... } }
```

### Get Consulting Session Details
```
GET /api/consulting/sessions/:sessionId
Authorization: Bearer <accessToken>

Response: { 
  session: { 
    id, consultantId, consultantName, customerId,
    scheduledDate, notes, recordingUrl, transcript, ...
  }
}
```

---

## TOOL RENTALS

### List Tools for Rent
```
GET /api/tool-rentals/browse?category=power-tools&condition=new&lat=30.2672&lng=-97.7431&radius=10&priceMin=10&priceMax=100&sortBy=rating&limit=50&offset=0
Authorization: Bearer <accessToken> (optional)

Response: { 
  tools: [{ 
    id, name, description, images, owner, ownerRating,
    rentalRate, securityDeposit, condition, availability, ...
  }],
  total: number
}
```

### Get Tool Detail
```
GET /api/tool-rentals/:toolId
Authorization: Bearer <accessToken> (optional)

Response: { 
  tool: { 
    id, name, description, images, ownerName, ownerRating,
    rentalRates: { hourly, daily, weekly, monthly },
    securityDeposit, condition, accessories, damagePolicy,
    availabilityCalendar, bookingConditions, ...
  }
}
```

### Create Tool Listing
```
POST /api/tool-rentals
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{
  "name": "Cordless Drill",
  "description": "...",
  "category": "power-tools",
  "condition": "new|like-new|good|fair",
  "hourlyRate": 10,
  "dailyRate": 25,
  "weeklyRate": 60,
  "monthlyRate": 150,
  "securityDeposit": 100,
  "damagePolicy": "...",
  "images": [File, File]
}

Response: { tool: { id, name, status: "active", ... } }
```

### Book Tool Rental
```
POST /api/tool-rentals/:toolId/bookings
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "startDate": "2026-05-20",
  "endDate": "2026-05-22",
  "deliveryOption": "pickup|delivery",
  "includeInsurance": true,
  "notes": "..."
}

Response: { booking: { id, status: "pending", totalCost, ... } }
```

---

## SKILLS & LICENSES

### Add Skill to Profile
```
POST /api/skills
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "skillName": "Plumbing",
  "expertise": "beginner|intermediate|expert",
  "yearsExperience": 5,
  "hourlyRate": 50 (optional)
}

Response: { skill: { id, name, expertise, yearsExperience, ... } }
```

### Get Skills Lookup
```
GET /api/skills/lookup?q=plumb&limit=10
Authorization: Bearer <accessToken> (optional)

Response: { 
  suggestions: [{ id, name, category, aliases, ... }]
}
```

### Add License
```
POST /api/licenses
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{
  "licenseType": "state|professional",
  "licenseNumber": "LIC12345",
  "issuingBody": "Texas State Board",
  "category": "plumbing",
  "expirationDate": "2027-05-20",
  "document": File
}

Response: { license: { id, category, expirationDate, verified, ... } }
```

### Get My Licenses
```
GET /api/licenses
Authorization: Bearer <accessToken>

Response: { 
  licenses: [{ 
    id, licenseType, licenseNumber, category,
    expirationDate, status, verified, ...
  }]
}
```

### Add Insurance
```
POST /api/insurance
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{
  "insuranceType": "liability|bonding|workers-comp",
  "provider": "Provider Name",
  "policyNumber": "POL12345",
  "coverageAmount": 1000000,
  "expirationDate": "2027-05-20",
  "certificate": File
}

Response: { insurance: { id, type, expirationDate, verified, ... } }
```

---

## ADVANCED SCHEDULING

### Set Recurring Availability
```
POST /api/appointments/recurring-availability
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "dayOfWeek": "monday|tuesday|wednesday|thursday|friday|saturday|sunday",
  "startTime": "09:00",
  "endTime": "17:00",
  "recurrence": "weekly|daily|biweekly|monthly",
  "timezone": "America/Chicago"
}

Response: { availability: { id, dayOfWeek, startTime, endTime, ... } }
```

### Bulk Upload Availability
```
POST /api/appointments/availability/bulk-upload
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{
  "file": File (CSV/Excel)
}

Response: { 
  result: { 
    uploadedCount: number,
    errors: [{ row, error }]
  }
}
```

### Get Exception Dates
```
GET /api/appointments/availability/exceptions
Authorization: Bearer <accessToken>

Response: { 
  exceptions: [{ id, date, reason, allDay, ... }]
}
```

### Add Exception Date (Holiday/Day Off)
```
POST /api/appointments/availability/exceptions
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "date": "2026-05-28",
  "reason": "Holiday",
  "allDay": true
}

Response: { exception: { id, date, reason, ... } }
```

---

## DIRECT BOOKING

### Get Available Booking Slots
```
GET /api/bookings/availability/:helperId?date=2026-05-20
Authorization: Bearer <accessToken> (optional)

Response: { 
  slots: [{ time: "09:00", available: true, duration: 30 }, ...]
}
```

### Create Booking Request
```
POST /api/bookings
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "helperId": "uuid",
  "requestedDate": "2026-05-20",
  "requestedTime": "09:00",
  "serviceType": "service-name",
  "notes": "Special requests",
  "duration": 60
}

Response: { 
  booking: { 
    id, status: "pending", helperRespondsBy, 
    confirmationWindow, ...
  }
}
```

### Respond to Booking (Helper)
```
POST /api/bookings/:bookingId/respond
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "accept": true|false,
  "reason": "optional reason if declining"
}

Response: { 
  booking: { 
    status: "accepted|declined", 
    appointment: { id, ... } (if accepted)
  }
}
```

### Convert Booking to Job
```
POST /api/bookings/:bookingId/post-job
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "makePublic": true,
  "jobTitle": "...",
  "jobDescription": "...",
  "budget": 150
}

Response: { job: { id, status: "published", ... } }
```

---

## AI CHAT & FEATURES

### Get Profile Context for AI
```
GET /api/chat/profile-context/:type/:id
Authorization: Bearer <accessToken> (optional)

Query Params:
  - type: helper|business
  - id: user_id or business_id

Response: { 
  context: { 
    name, skills, faqs, services, availabilitySummary,
    pricing, businessPhilosophy, policies, ...
  }
}
```

### Send AI Chat Message
```
POST /api/chat/messages
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "profileId": "uuid",
  "profileType": "helper|business",
  "message": "What services do you offer?",
  "threadId": "uuid" (optional, for continuing chat)
}

Response: { 
  response: { 
    text: "AI response text",
    threadId: "uuid",
    bookingRequest: { id, ... } (if AI generated booking)
  }
}
```

### Get Chat History
```
GET /api/chat/threads/:threadId
Authorization: Bearer <accessToken>

Response: { 
  thread: { 
    id, profileId, messages: [{ role, content, timestamp }],
    bookingRequests: [...]
  }
}
```

### Create Booking from AI Chat
```
POST /api/chat/booking-requests
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "threadId": "uuid",
  "proposedDate": "2026-05-20",
  "proposedTime": "14:00",
  "notes": "From AI chat"
}

Response: { bookingRequest: { id, status: "pending", ... } }
```

---

## REPORTING & MODERATION

### Create Report
```
POST /api/reports
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reportType": "user|content|review|listing|fraud",
  "reportedUserId": "uuid" (if user report),
  "contentId": "uuid" (if content report),
  "reason": "Abusive behavior",
  "description": "Detailed description",
  "evidence": ["url or file paths"]
}

Response: { report: { id, status: "pending", ... } }
```

### Get Reports (Admin)
```
GET /api/admin/reports?status=pending&type=user&limit=50
Authorization: Bearer <accessToken> (Admin)

Response: { 
  reports: [{ id, type, reportedUser, reason, status, ... }],
  total: number
}
```

### Resolve Report (Admin)
```
POST /api/admin/reports/:reportId/resolve
Authorization: Bearer <accessToken> (Admin)
Content-Type: application/json

{
  "decision": "approved|denied|warning|restriction|suspension|ban",
  "reason": "...",
  "enforcementDetails": { duration, type, ... }
}

Response: { report: { status: "resolved", ... } }
```

### Flag Review
```
POST /api/reviews/:reviewId/flag
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reason": "spam|fake|abusive|off-topic"
}

Response: { review: { flagged: true, ... } }
```

---

## REPUTATION

### Get Reputation Score
```
GET /api/reputation/:userId
Authorization: Bearer <accessToken> (optional)

Response: { 
  reputation: { 
    score: number,
    badges: ["top-rated", ...],
    jobsCompleted: number,
    cancellationCount: number,
    averageRating: 4.8,
    trendVs30Days: "+5%",
    ...
  }
}
```

### Get Fee History
```
GET /api/reputation/:userId/fee-history
Authorization: Bearer <accessToken>

Response: { 
  feeHistory: { 
    totalFeesPaid: number,
    cancellationCount: number,
    recentFees: [{ 
      id, jobId, jobTitle, helperName,
      amount, date, reason, ...
    }]
  }
}
```

### Recalculate Reputation (Admin)
```
POST /api/admin/reputation/:userId/recalculate
Authorization: Bearer <accessToken> (Admin)

Response: { reputation: { score, badges, ... } }
```

---

## ADVANCED SEARCH

### Global Search
```
GET /api/search/global?q=plumbing&type=jobs|helpers|products|services&limit=50
Authorization: Bearer <accessToken> (optional)

Response: { 
  results: {
    jobs: [...],
    helpers: [...],
    products: [...],
    services: [...]
  }
}
```

### Search Suggestions
```
GET /api/search/suggestions?q=plumb&type=skills|helpers|jobs|categories
Authorization: Bearer <accessToken> (optional)

Response: { 
  suggestions: [{ text, type, icon, ... }]
}
```

### Get Trending
```
GET /api/search/trending?category=home-repair&region=Austin
Authorization: Bearer <accessToken> (optional)

Response: { 
  trending: { 
    searches: ["plumbing", "electrician", ...],
    helpers: [...],
    jobs: [...],
    services: [...]
  }
}
```

---

## SUBSCRIPTIONS & TIERS

### Get Subscription Status
```
GET /api/subscriptions/status
Authorization: Bearer <accessToken>

Response: { 
  subscription: { 
    tier: "free|pro",
    status: "active|trial|cancelled",
    trialEndsAt: "2027-05-14",
    renewsAt: "2026-06-14",
    price: 99,
    currency: "USD",
    ...
  }
}
```

### Create Subscription
```
POST /api/subscriptions
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "tier": "pro",
  "billingCycle": "monthly|yearly"
}

Response: { 
  subscription: { tier, status: "active", renewsAt, ... }
}
```

### Cancel Subscription
```
POST /api/subscriptions/cancel
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reason": "too expensive|not using|other"
}

Response: { subscription: { status: "cancelled", endsAt, ... } }
```

---

## PHOTO GALLERY & MEDIA

### Upload Profile Photos
```
POST /api/profile/photos
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

{
  "photos": [File, File, File],
  "category": "services|portfolio|team|workspace"
}

Response: { 
  photos: [{ id, url, category, order, ... }]
}
```

### Reorder Photos
```
PUT /api/profile/photos/reorder
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "orders": [{ photoId, newOrder }]
}

Response: { success: true }
```

### Delete Photo
```
DELETE /api/profile/photos/:photoId
Authorization: Bearer <accessToken>

Response: { success: true }
```

### Get Photo Gallery
```
GET /api/profiles/:userId/photos
Authorization: Bearer <accessToken> (optional)

Response: { 
  photos: [{ id, url, category, ... }],
  total: number
}
```

---

## INVOICING

### Create Invoice
```
POST /api/invoices
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "customerId": "uuid",
  "invoiceDate": "2026-05-14",
  "dueDate": "2026-06-14",
  "items": [
    { description, quantity, unitPrice, ... }
  ],
  "notes": "Thank you for your business",
  "paymentTerms": "net_30"
}

Response: { invoice: { id, invoiceNumber, total, ... } }
```

### Get Invoice
```
GET /api/invoices/:invoiceId
Authorization: Bearer <accessToken>

Response: { 
  invoice: { 
    id, invoiceNumber, customerName, items,
    subtotal, tax, total, status, dueDate, ...
  }
}
```

### Send Invoice
```
POST /api/invoices/:invoiceId/send
Authorization: Bearer <accessToken>

Response: { invoice: { status: "sent", sentAt, ... } }
```

### Generate Invoice PDF
```
GET /api/invoices/:invoiceId/pdf
Authorization: Bearer <accessToken>

Response: PDF file download
```

### Track Invoice Payment
```
POST /api/invoices/:invoiceId/payment
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "paymentId": "stripe_pi_...",
  "amount": 15000,
  "date": "2026-05-20"
}

Response: { invoice: { status: "paid", paidAt, ... } }
```

---

## TAX MANAGEMENT

### Get Tax Rates
```
GET /api/taxes/rates?country=US&state=TX&postal=78701
Authorization: Bearer <accessToken> (optional)

Response: { 
  taxRate: { state: "TX", rate: 8.25, type: "sales_tax", ... }
}
```

### Configure Tax Settings
```
PUT /api/taxes/settings
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "taxId": "12-3456789",
  "taxableServices": true,
  "taxableProducts": true,
  "taxOnShipping": false
}

Response: { settings: { ... } }
```

### Get Tax Report
```
GET /api/taxes/report?startDate=2026-01-01&endDate=2026-03-31&groupBy=category
Authorization: Bearer <accessToken>

Response: { 
  report: { 
    period, totalRevenue, totalTaxCollected,
    byCategory: [{ category, revenue, tax, ... }]
  }
}
```

### Export Tax Data
```
GET /api/taxes/export?startDate=2026-01-01&format=csv|pdf
Authorization: Bearer <accessToken>

Response: CSV/PDF file download
```

---

## ADVANCED SETTINGS

### Get All Settings
```
GET /api/settings
Authorization: Bearer <accessToken>

Response: { 
  settings: { 
    profile, notifications, privacy, security,
    location, billing, ...
  }
}
```

### Update Notification Settings
```
PUT /api/settings/notifications
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "frequency": "real-time|daily|weekly|off",
  "channels": { email: true, sms: true, push: true },
  "quietHoursStart": "22:00",
  "quietHoursEnd": "08:00",
  "byEvent": {
    "newMessage": "real-time",
    "appointmentReminder": "email"
  }
}

Response: { settings: { ... } }
```

### Enable Two-Factor Authentication
```
POST /api/settings/security/2fa
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "method": "authenticator|sms|email",
  "phoneNumber": "+1234567890" (if SMS)
}

Response: { 
  secret: "JBSWY3DP...",
  backupCodes: ["12345678", ...],
  qrCode: "data:image/png;base64,..."
}
```

### Update Privacy Settings
```
PUT /api/settings/privacy
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "profilePublic": true,
  "searchable": true,
  "showPhone": false,
  "showEmail": false,
  "allowMessages": true,
  "dataCollection": true
}

Response: { settings: { ... } }
```

---

## TEAM COLLABORATION

### Get Team Permissions
```
GET /api/business/:businessId/team/permissions
Authorization: Bearer <accessToken>

Response: { 
  permissions: { 
    owner: { jobs: "full", customers: "full", finance: "full" },
    manager: { jobs: "edit", customers: "view", finance: "view" },
    member: { jobs: "view", customers: "none", finance: "none" }
  }
}
```

### Set Role Permissions
```
PUT /api/business/:businessId/team/:memberId/permissions
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "role": "owner|manager|member",
  "customPermissions": { jobs: "edit", finance: "view", ... }
}

Response: { member: { role, permissions, ... } }
```

### Get Team Performance
```
GET /api/business/:businessId/team/performance
Authorization: Bearer <accessToken>

Response: { 
  performance: [{ 
    memberId, name, jobsCompleted, rating,
    revenue, responseTime, ...
  }]
}
```

---

## ACTIVITY & HISTORY

### Get Activity Timeline
```
GET /api/activity/timeline?type=job|payment|job|team&limit=50
Authorization: Bearer <accessToken>

Response: { 
  activities: [{ 
    id, type, timestamp, actor, action, details, ...
  }]
}
```

### Get Audit Log (Admin)
```
GET /api/admin/audit-logs?user=uuid&action=create|update|delete&startDate=2026-01-01&limit=50
Authorization: Bearer <accessToken> (Admin)

Response: { 
  logs: [{ 
    id, timestamp, userId, action, resource, before, after, ...
  }],
  total: number
}
```

### Export Activity (CSV)
```
GET /api/activity/export?startDate=2026-01-01&endDate=2026-05-14&format=csv
Authorization: Bearer <accessToken>

Response: CSV file download
```

---

## BULK OPERATIONS (ADDITIONAL)

### Get Bulk Import Status
```
GET /api/bulk/imports/:importId
Authorization: Bearer <accessToken>

Response: { 
  import: { 
    id, status: "pending|processing|completed|failed",
    uploadedCount, successCount, errorCount,
    errors: [{ row, error }]
  }
}
```

### Get Bulk Export Status
```
GET /api/bulk/exports/:exportId
Authorization: Bearer <accessToken>

Response: { 
  export: { 
    id, status: "pending|generating|ready",
    downloadUrl, expiresAt, ...
  }
}
```

---

## REAL-TIME (SOCKET.IO)

### WebSocket Events
```
// Subscribe to room
socket.emit('join', { conversationId: '...' })

// Send message
socket.emit('message', { text: '...', conversationId: '...' })

// Receive message (listen)
socket.on('message', (data) => { console.log(data) })

// Typing indicator
socket.emit('typing', { conversationId: '...' })
socket.on('typing', (data) => { ... })

// User online status
socket.on('userOnline', (userId) => { ... })
socket.on('userOffline', (userId) => { ... })

// Notification
socket.on('notification', (notification) => { ... })
```

---

## TESTING CHECKLIST (API)

**Total API Endpoints:** 100+

**Endpoints Tested:** _____ / _____

**Authentication Errors:** [ ] 401 [ ] 403

**Validation Errors:** [ ] 400 [ ] 422

**Not Found Errors:** [ ] 404

**Rate Limit Errors:** [ ] 429

**Server Errors:** [ ] 500

**All Routes Return Proper JSON:** [ ] YES [ ] NO

**All Protected Routes Require Auth:** [ ] YES [ ] NO

---

**Document Version:** 2.0 (Expanded)  
**Total API Endpoints:** 100+  
**Status:** Complete with comprehensive additions
