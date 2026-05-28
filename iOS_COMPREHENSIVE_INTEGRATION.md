# OxSteed iOS - Comprehensive Production Integration Guide

**Last Updated:** May 27, 2026  
**API Base URL:** `https://api.oxsteed.com`  
**Status:** Production Ready  
**Version:** 2.0

---

## Table of Contents

1. [Authentication Flow](#authentication-flow)
2. [Core Data Models](#core-data-models)
3. [Authentication Endpoints](#authentication-endpoints)
4. [Jobs API](#jobs-api)
5. [Bids API](#bids-api)
6. [Helpers Directory API](#helpers-directory-api)
7. [Helper Profile Management](#helper-profile-management)
8. [Calendar & Appointments API](#calendar--appointments-api)
9. [Booking Requests API](#booking-requests-api)
10. [Messages API](#messages-api)
11. [Chat API](#chat-api)
12. [Notifications API](#notifications-api)
13. [Payments API](#payments-api)
14. [File Upload Endpoints](#file-upload-endpoints)
15. [Socket.IO Real-Time Events](#socketio-real-time-events)
16. [Error Handling](#error-handling)
17. [Rate Limiting](#rate-limiting)
18. [Keychain Security](#keychain-security)

---

## Authentication Flow

### OAuth 2.0 with JWT

1. **Login/Register** → Receive `accessToken` (15m) + `refreshToken` (7d)
2. **Store Tokens** → Use Keychain (iOS-native secure storage)
3. **Attach Token** → Include in every API request via `Authorization: Bearer {accessToken}`
4. **Handle Expiry** → On 401 response, auto-refresh token and retry
5. **Logout** → Clear tokens from Keychain and invalidate server-side session

### Token Structure

```swift
struct AuthTokens {
    let accessToken: String      // JWT, 15m TTL
    let refreshToken: String     // 7d TTL
    let expiresIn: Int          // Seconds until accessToken expires
}
```

---

## Core Data Models

### User Response

```json
{
  "id": "uuid",
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "role": "customer",
  "email_verified": true,
  "is_verified": false,
  "onboarding_step": "active",
  "onboarding_completed": true,
  "membership_tier": "pro",
  "effective_tier": "pro",
  "is_trial_active": false,
  "trial_days_left": 0,
  "trial_ends_at": null,
  "id_verified": false,
  "background_check_passed": false,
  "didit_status": "not_started",
  "display_name_preference": "first_last",
  "default_mode": "customer",
  "avatar_url": "https://...",
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-15T12:30:00Z"
}
```

### User Modes (Self-Selectable)

```
customer           → Browse & post jobs
investor           → Customer variant with investment focus
helper             → Bid on jobs, earn
business_owner     → Run business, hire helpers
consultant         → Offer consulting services
tool_owner         → Rent tools
franchise_applicant → Apply to franchise
life_only          → Life dashboard only
logistics          → Logistics operations
```

### Onboarding Steps

Progress through: `registered` → `email_verified` → `profile_complete` → `plan_selected` → `tax_complete` → `active`

---

## Authentication Endpoints

### POST /api/auth/register

Create a new account.

**Request:**
```swift
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+1234567890",
  "language": "en"  // Optional: en, es, fr, ht
}
```

**Response (201):**
```json
{
  "user": { /* User object */ },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900
}
```

**Errors:**
- 400: Validation failed (email already exists, password too weak, etc.)
- 422: Missing required fields

---

### POST /api/auth/login

Authenticate user.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response (200):**
```json
{
  "user": { /* User object */ },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900
}
```

**Errors:**
- 401: Invalid credentials
- 429: Rate limited (max 15 attempts / 15 min per IP)

**Rate Limit:** `authLimiter` - 15 attempts per 15 minutes per IP

---

### POST /api/auth/refresh

Refresh access token using refresh token.

**Request:**
```json
{
  "refreshToken": "eyJhbGc..."
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900
}
```

**Errors:**
- 401: Invalid or expired refresh token

---

### POST /api/auth/logout

Invalidate session and refresh token.

**Auth Required:** Yes  
**Response (200):**
```json
{ "ok": true }
```

---

### GET /api/auth/me

Get current authenticated user.

**Auth Required:** Yes  
**Response (200):**
```json
{ /* User object */ }
```

**Errors:**
- 401: Not authenticated

---

### PUT /api/auth/profile

Update user profile (name, phone, etc.).

**Auth Required:** Yes  
**Request:**
```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "phone": "+1987654321",
  "display_name_preference": "first_last"  // or "business"
}
```

**Response (200):**
```json
{ /* Updated User object */ }
```

---

### POST /api/auth/switch-role

Switch user's role/mode.

**Auth Required:** Yes  
**Request:**
```json
{
  "mode": "helper"
}
```

**Response (200):**
```json
{
  "user": { /* Updated User object with new mode */ }
}
```

---

## Jobs API

### GET /api/jobs

Browse all published jobs (public, no auth required).

**Query Parameters:**
```
page              : int (default: 1)
limit             : int (default: 25, max: 100)
category          : string (e.g., "plumbing")
category_id       : uuid
skills            : string[] (comma-separated, all required)
lat               : float (latitude for distance filter)
lng               : float (longitude for distance filter)
radius            : float (miles, requires lat/lng)
sort              : string (newest|highest_rated|closest|most_bids)
budget_min        : int (cents)
budget_max        : int (cents)
status            : string (published|matched|negotiating|accepted|in_progress|completed|cancelled)
location_country  : string
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "title": "Fix leaking kitchen faucet",
    "description": "Kitchen faucet has been leaking for 2 weeks...",
    "category": "plumbing",
    "category_id": "uuid",
    "status": "published",
    "budget_type": "range",
    "budget_min": 5000,
    "budget_max": 15000,
    "currency": "USD",
    "urgency": "high",
    "location_address": "123 Main St",
    "location_city": "Austin",
    "location_state": "TX",
    "location_zip": "78701",
    "location_country": "US",
    "location_lat": 30.2672,
    "location_lng": -97.7431,
    "scheduled_date": "2026-06-01",
    "scheduled_time": "10:00",
    "customer_id": "uuid",
    "customer_name": "John Doe",
    "customer_rating": 4.8,
    "bid_count": 3,
    "accepted_bid_id": null,
    "preferred_helper_id": null,
    "required_skills": ["drain_cleaning", "faucet_repair"],
    "media_urls": ["https://..."],
    "created_at": "2026-05-27T10:00:00Z",
    "updated_at": "2026-05-27T10:00:00Z",
    "distance_miles": 2.5
  }
]
```

**Rate Limit:** `generalLimiter` - 100 req / 15 min per IP

---

### POST /api/jobs

Create a new job (authenticated customer).

**Auth Required:** Yes  
**Requirements:**
- Email verified
- Onboarding step: "active"
- No job posting restrictions

**Request:**
```json
{
  "title": "Fix leaking kitchen faucet",
  "description": "Kitchen faucet has been leaking for 2 weeks, needs expert plumber",
  "category_id": "uuid",
  "category_name": "plumbing",
  "budget_type": "range",
  "budget_min": 5000,
  "budget_max": 15000,
  "urgency": "high",
  "location_address": "123 Main St",
  "location_city": "Austin",
  "location_state": "TX",
  "location_zip": "78701",
  "location_country": "US",
  "location_lat": 30.2672,
  "location_lng": -97.7431,
  "scheduled_date": "2026-06-01",
  "scheduled_time": "10:00",
  "required_skills": ["drain_cleaning", "faucet_repair"],
  "media_urls": ["https://..."]
}
```

**Response (201):**
```json
{ /* Job object */ }
```

**Validation:**
- Title: min 10 chars, max 200 chars
- Description: min 50 chars, max 5000 chars
- City: required
- Country: required
- Budget: must be valid range if type is "range"

---

### GET /api/jobs/{jobId}

Get job details (public or authenticated).

**Auth Required:** No (but more data if authenticated)  
**Response (200):**
```json
{ /* Full Job object */ }
```

**Errors:**
- 404: Job not found

---

### PUT /api/jobs/{jobId}

Update job (authenticated owner only).

**Auth Required:** Yes  
**Request:** Same fields as POST /api/jobs (partial update)  
**Response (200):** Updated job object

---

### POST /api/jobs/{jobId}/cancel

Cancel a job.

**Auth Required:** Yes (owner only)  
**Request:**
```json
{
  "cancellation_reason": "Found another helper"
}
```

**Response (200):**
```json
{
  "ok": true,
  "cancellation_fee_cents": 500
}
```

---

### GET /api/jobs/me/list

Get current user's jobs (authenticated).

**Auth Required:** Yes  
**Query Parameters:**
```
status             : string (draft|published|matched|etc.)
include_deleted    : 1 (default: off)
limit              : int (default: 50, max: 100)
offset             : int (default: 0)
```

**Response (200):**
```json
[
  { /* Job objects */ }
]
```

---

### POST /api/jobs/{jobId}/start

Mark job as in_progress.

**Auth Required:** Yes (helper with accepted bid)  
**Response (200):**
```json
{ /* Updated Job object */ }
```

---

### POST /api/jobs/{jobId}/complete

Mark job as completed.

**Auth Required:** Yes (helper with accepted bid)  
**Request:**
```json
{
  "notes": "Job completed successfully",
  "media_urls": ["https://..."]
}
```

**Response (200):**
```json
{ /* Updated Job object with completion timestamp */ }
```

---

## Bids API

### GET /api/bids/me

Get current user's bids (authenticated).

**Auth Required:** Yes  
**Query Parameters:**
```
status            : string (pending|accepted|rejected|withdrawn)
limit             : int (max: 100)
offset            : int
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "job_id": "uuid",
    "helper_id": "uuid",
    "helper_name": "Jane Smith",
    "helper_rating": 4.9,
    "amount": 10000,
    "status": "pending",
    "message": "I can fix this quickly",
    "estimated_hours": 2,
    "created_at": "2026-05-27T10:00:00Z",
    "updated_at": "2026-05-27T10:00:00Z"
  }
]
```

**Headers:**
- `X-Total-Count`: Total number of bids (for pagination)

---

### GET /api/bids/job/{jobId}

Get all bids for a specific job (authenticated owner only).

**Auth Required:** Yes  
**Response (200):** Array of bid objects

---

### POST /api/bids

Place a new bid on a job.

**Auth Required:** Yes  
**Requirements:**
- Email verified
- Onboarding step: "active"
- Pro tier (trial or paid)
- No bidding restrictions

**Request:**
```json
{
  "job_id": "uuid",
  "amount": 10000,
  "message": "I can fix this quickly",
  "estimated_hours": 2.5
}
```

**Validation:**
- Amount: required, > 0, ≤ 10,000,000 cents
- Message: max 2000 chars
- Estimated hours: 0-480

**Response (201):**
```json
{ /* Bid object */ }
```

**Errors:**
- 400: Job not found, job is deleted, duplicate bid on same job
- 403: Email not verified, onboarding incomplete, restrictions active, wrong tier

---

### PUT /api/bids/{bidId}

Accept or reject a bid (authenticated job owner).

**Auth Required:** Yes  
**Request:**
```json
{
  "status": "accepted"  // or "rejected"
}
```

**Response (200):** Updated bid object

---

### POST /api/bids/{bidId}/withdraw

Withdraw a bid (authenticated bidder).

**Auth Required:** Yes  
**Response (200):**
```json
{ "ok": true }
```

---

## Helpers Directory API

### GET /api/helpers

Browse helpers directory (public).

**Query Parameters:**
```
query                 : string (search name/bio)
categories            : string[] (any of these)
skills                : string[] (all of these)
verified              : boolean
backgroundChecked     : boolean
availableToday        : boolean
minRating             : float
minPrice              : float (cents)
maxPrice              : float (cents)
lat                   : float
lng                   : float
radius                : float (miles)
sort                  : best_match|highest_rated|most_reviews|lowest_price|fastest_response|newest
page                  : int
limit                 : int (max: 25)
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "profileUrl": "/helpers/uuid",
    "businessName": "Smith Plumbing",
    "ownerName": "Jane Smith",
    "avatar": "https://...",
    "rating": 4.9,
    "reviewCount": 127,
    "jobsCompleted": 342,
    "memberSince": "2024-01-15",
    "verified": true,
    "backgroundChecked": true,
    "categories": ["plumbing"],
    "skills": ["drain_cleaning", "faucet_repair", "pipe_installation"],
    "licenses": ["plumbing_license"],
    "insurance": ["liability_insurance"],
    "topServices": ["Faucet Repair - $75/hr", "Drain Cleaning - $150/hr"],
    "startingPrice": 7500,
    "startingPriceUnit": "cents",
    "responseTime": "15 min",
    "responseMinutes": 15,
    "city": "Austin",
    "state": "TX",
    "serviceRadius": 25,
    "availableToday": true,
    "shortBio": "Expert plumber with 10+ years experience"
  }
]
```

**Rate Limit:** `directoryLimiter`

---

### GET /api/helpers/{helperId}/profile

Get detailed helper profile.

**Auth Required:** No  
**Response (200):**
```json
{
  "id": "uuid",
  "firstName": "Jane",
  "lastName": "Smith",
  "profileHeadline": "Expert Plumber",
  "bioShort": "10+ years experience",
  "bioLong": "I specialize in residential plumbing...",
  "profilePhoto": "https://...",
  "coverImage": "https://...",
  "rating": 4.9,
  "reviewCount": 127,
  "jobsCompleted": 342,
  "memberSince": "2024-01-15",
  "verified": true,
  "backgroundChecked": true,
  "licenses": ["plumbing_license"],
  "insurance": ["liability_insurance"],
  "services": [
    {
      "id": "uuid",
      "name": "Faucet Repair",
      "description": "Professional faucet repair service",
      "price": 7500,
      "priceUnit": "flat",
      "popular": true
    }
  ],
  "faqs": [
    {
      "question": "How long does a typical repair take?",
      "answer": "Usually 1-2 hours..."
    }
  ],
  "policies": [
    {
      "title": "Cancellation Policy",
      "content": "24 hour notice required..."
    }
  ],
  "gallery": [
    {
      "url": "https://...",
      "caption": "Kitchen renovation"
    }
  ],
  "availability": {
    "monday": [{ "start": "09:00", "end": "17:00" }],
    "tuesday": [{ "start": "09:00", "end": "17:00" }]
  },
  "availableNow": true,
  "serviceCity": "Austin",
  "serviceState": "TX",
  "serviceRadius": 25,
  "ratePreference": "hourly",
  "hourlyRateMin": 5000,
  "hourlyRateMax": 15000,
  "activeTemplate": "default",
  "aiKnowledge": "Custom profile information..."
}
```

---

### GET /api/helpers/{helperId}/availability

Get helper's available time slots.

**Query Parameters:**
```
from_date    : YYYY-MM-DD
to_date      : YYYY-MM-DD
```

**Response (200):**
```json
{
  "slots": [
    {
      "date": "2026-06-01",
      "time": "10:00",
      "available": true,
      "duration_minutes": 60
    }
  ]
}
```

---

## Helper Profile Management

### GET /api/helper-profile/me

Get authenticated helper's full profile (dashboard editor).

**Auth Required:** Yes (helper role)  
**Response (200):**
```json
{
  "profile_headline": "Expert Plumber",
  "bio_short": "10+ years",
  "bio_long": "Detailed biography...",
  "profile_photo_url": "https://...",
  "cover_photo_url": "https://...",
  "service_city": "Austin",
  "service_state": "TX",
  "service_zip": "78701",
  "service_radius_miles": 25,
  "hourly_rate_min": 5000,
  "hourly_rate_max": 15000,
  "rate_preference": "hourly",
  "flat_rate_available": true,
  "contact_for_pricing": false,
  "is_available_now": true,
  "availability_json": { /* weekly schedule */ },
  "ai_knowledge": "Custom AI profile info...",
  "services": [ /* array of services */ ],
  "faqs": [ /* array of FAQs */ ],
  "policies": [ /* array of policies */ ],
  "gallery": [ /* array of gallery images */ ]
}
```

---

### PUT /api/helper-profile/core

Update core profile fields.

**Auth Required:** Yes (helper role)  
**Request:**
```json
{
  "profile_headline": "Expert Plumber",
  "bio_long": "I specialize in residential plumbing...",
  "bio_short": "Expert plumber",
  "hourly_rate_min": 5000,
  "hourly_rate_max": 15000,
  "rate_preference": "hourly",
  "service_city": "Austin",
  "service_state": "TX",
  "service_zip": "78701",
  "service_radius_miles": 25,
  "is_available_now": true,
  "ai_knowledge": "Custom AI knowledge up to 8000 chars"
}
```

**Response (200):**
```json
{ "ok": true }
```

---

### PUT /api/helper-profile/photo

Update profile photo or cover photo URLs.

**Auth Required:** Yes  
**Request:**
```json
{
  "profile_photo_url": "https://...",
  "cover_photo_url": "https://..."
}
```

**Response (200):**
```json
{ "ok": true }
```

---

### POST /api/helper-profile/services

Add a new service offering.

**Auth Required:** Yes (helper role)  
**Request:**
```json
{
  "name": "Faucet Repair",
  "description": "Professional faucet repair",
  "price": 7500,
  "price_unit": "flat",  // flat|hour|starting_at|quote
  "duration": "2 hours",
  "popular": true,
  "category": "Plumbing",
  "sort_order": 1
}
```

**Response (201):** Service object

---

### PUT /api/helper-profile/services/{serviceId}

Update an existing service.

**Auth Required:** Yes (helper role, owner)  
**Response (200):** Updated service object

---

### DELETE /api/helper-profile/services/{serviceId}

Delete a service.

**Auth Required:** Yes (helper role, owner)  
**Response (200):** `{ "ok": true }`

---

### POST /api/helper-profile/faqs

Add FAQ.

**Auth Required:** Yes (helper role)  
**Request:**
```json
{
  "question": "What is your response time?",
  "answer": "I typically respond within 15 minutes...",
  "sort_order": 1
}
```

**Response (201):** FAQ object

---

### DELETE /api/helper-profile/faqs/{faqId}

Delete FAQ.

**Auth Required:** Yes  
**Response (200):** `{ "ok": true }`

---

### POST /api/helper-profile/policies

Add policy.

**Auth Required:** Yes (helper role)  
**Request:**
```json
{
  "title": "Cancellation Policy",
  "content": "24 hour notice required...",
  "icon": "file-text",
  "sort_order": 1
}
```

**Response (201):** Policy object

---

### DELETE /api/helper-profile/policies/{policyId}

Delete policy.

**Auth Required:** Yes  
**Response (200):** `{ "ok": true }`

---

## Calendar & Appointments API

### GET /api/calendar/appointments

Get current user's appointments.

**Auth Required:** Yes  
**Query Parameters:**
```
role          : customer|helper
status        : pending|accepted|completed|cancelled
from_date     : YYYY-MM-DD
to_date       : YYYY-MM-DD
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "customer_id": "uuid",
    "customer_name": "John Doe",
    "helper_id": "uuid",
    "helper_name": "Jane Smith",
    "job_id": "uuid",
    "job_title": "Fix leaking faucet",
    "service_title": "Faucet Repair",
    "scheduled_date": "2026-06-01",
    "scheduled_start_at": "2026-06-01T10:00:00Z",
    "scheduled_end_at": "2026-06-01T11:30:00Z",
    "location": "123 Main St, Austin, TX 78701",
    "status": "accepted",
    "notes": "Please bring your tools",
    "created_at": "2026-05-27T10:00:00Z",
    "updated_at": "2026-05-27T10:00:00Z"
  }
]
```

---

### POST /api/calendar/appointments

Create new appointment.

**Auth Required:** Yes  
**Request:**
```json
{
  "helper_id": "uuid",
  "customer_id": "uuid",
  "job_id": "uuid",
  "service_title": "Faucet Repair",
  "scheduled_date": "2026-06-01",
  "scheduled_start_time": "10:00",
  "scheduled_end_time": "11:30",
  "location": "123 Main St, Austin, TX 78701",
  "notes": "Please bring tools"
}
```

**Response (201):** Appointment object

---

### GET /api/calendar/appointments/{appointmentId}

Get appointment details.

**Auth Required:** Yes  
**Response (200):** Appointment object

---

### POST /api/calendar/appointments/{appointmentId}/confirm

Confirm pending appointment.

**Auth Required:** Yes  
**Response (200):** Updated appointment object (status: accepted)

---

### POST /api/calendar/appointments/{appointmentId}/cancel

Cancel appointment.

**Auth Required:** Yes  
**Request:**
```json
{
  "reason": "Customer requested cancellation"
}
```

**Response (200):**
```json
{
  "ok": true,
  "cancellation_fee_cents": 0
}
```

---

### POST /api/calendar/appointments/{appointmentId}/reschedule-request

Request to reschedule appointment.

**Auth Required:** Yes  
**Request:**
```json
{
  "proposed_date": "2026-06-02",
  "proposed_start_time": "14:00",
  "proposed_end_time": "15:30",
  "reason": "Scheduling conflict"
}
```

**Response (201):** Reschedule request object

---

### PUT /api/calendar/appointments/{appointmentId}/reschedule-request/{requestId}

Accept or decline reschedule request.

**Auth Required:** Yes  
**Request:**
```json
{
  "status": "accepted"  // or "declined"
}
```

**Response (200):** Updated reschedule request

---

### GET /api/calendar/appointments/{appointmentId}/ical

Export appointment as iCal (.ics) format.

**Auth Required:** No  
**Response (200):** iCal file (text/calendar MIME type)

---

### POST /api/calendar/availability

Create availability block (helper only).

**Auth Required:** Yes (helper role)  
**Request:**
```json
{
  "date": "2026-06-01",
  "start_time": "09:00",
  "end_time": "17:00",
  "is_available": true,
  "notes": "Available for bookings"
}
```

**Response (201):** Availability block object

---

### GET /api/calendar/availability/helpers/{helperId}

Get helper's availability blocks.

**Auth Required:** No  
**Query Parameters:**
```
from_date  : YYYY-MM-DD
to_date    : YYYY-MM-DD
```

**Response (200):** Array of availability blocks

---

## Booking Requests API

### POST /api/bookings

Create booking request for a helper.

**Auth Required:** Yes (customer)  
**Request:**
```json
{
  "helperId": "uuid",
  "businessId": "uuid",
  "serviceName": "Faucet Repair",
  "requestedDate": "2026-06-01",
  "requestedStartTime": "10:00",
  "requestedEndTime": "11:30",
  "serviceLocation": "123 Main St, Austin, TX",
  "description": "Kitchen faucet leaking",
  "confirmationHours": 24
}
```

**Validation:**
- Either helperId or businessId required
- serviceName required
- Date cannot be in past
- Start time must be before end time
- Confirmation hours: 1-168 (default: 24)

**Response (201):**
```json
{
  "id": "uuid",
  "status": "pending",
  "customer_id": "uuid",
  "helper_id": "uuid",
  "service_name": "Faucet Repair",
  "requested_date": "2026-06-01",
  "requested_start_time": "10:00",
  "requested_end_time": "11:30",
  "expires_at": "2026-05-28T10:00:00Z",
  "created_at": "2026-05-27T10:00:00Z"
}
```

---

### GET /api/bookings

Get current user's booking requests.

**Auth Required:** Yes  
**Response (200):** Array of booking request objects

---

### GET /api/bookings/incoming

Get incoming booking requests (helper-only view).

**Auth Required:** Yes (helper role)  
**Response (200):** Array of incoming booking requests

---

### GET /api/bookings/helper/{helperId}/available-slots

Get available slots for booking a specific helper.

**Auth Required:** No  
**Query Parameters:**
```
from_date    : YYYY-MM-DD
to_date      : YYYY-MM-DD
```

**Response (200):**
```json
{
  "slots": [
    {
      "date": "2026-06-01",
      "time": "10:00",
      "available": true,
      "duration_minutes": 60
    }
  ]
}
```

---

### GET /api/bookings/{bookingId}

Get booking request details.

**Auth Required:** Yes  
**Response (200):** Booking request object

---

### POST /api/bookings/{bookingId}/accept

Accept booking request.

**Auth Required:** Yes (helper)  
**Response (200):** Updated booking request (status: accepted)

---

### POST /api/bookings/{bookingId}/decline

Decline booking request.

**Auth Required:** Yes (helper)  
**Response (200):**
```json
{
  "ok": true
}
```

---

### POST /api/bookings/{bookingId}/cancel

Cancel booking request.

**Auth Required:** Yes (customer)  
**Response (200):**
```json
{
  "ok": true,
  "cancellation_fee_cents": 0
}
```

---

### POST /api/bookings/{bookingId}/convert-to-job

Convert accepted booking to public job posting.

**Auth Required:** Yes (customer)  
**Request:**
```json
{
  "title": "Faucet Repair Service",
  "description": "Extended description for public posting",
  "budget_min": 5000,
  "budget_max": 15000
}
```

**Response (201):**
```json
{
  "job_id": "uuid",
  "booking_id": "uuid",
  "ok": true
}
```

---

## Messages API

### GET /api/messages/conversations

Get all conversations for authenticated user.

**Auth Required:** Yes  
**Query Parameters:**
```
business_id           : int (filter by business)
include_archived      : true|false (default: false)
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "job_id": "uuid",
    "customer_id": "uuid",
    "helper_id": "uuid",
    "business_id": null,
    "status": "active",
    "other_user_name": "Jane Smith",
    "other_user_id": "uuid",
    "job_title": "Fix leaking faucet",
    "last_message": "Sounds great! I'll arrive at 10am",
    "last_message_sender_id": "uuid",
    "helper_business_name": "Smith Plumbing",
    "conversation_business_name": null,
    "unread_count": 2,
    "last_message_at": "2026-05-27T14:30:00Z",
    "created_at": "2026-05-20T10:00:00Z",
    "updated_at": "2026-05-27T14:30:00Z",
    "archived_at": null
  }
]
```

---

### POST /api/messages/conversations

Create or get existing conversation.

**Auth Required:** Yes  
**Request:**
```json
{
  "helper_id": "uuid",
  "customer_id": "uuid",
  "job_id": "uuid"
}
```

**Response (200 or 201):** Conversation object

---

### GET /api/messages/conversations/{conversationId}

Get messages in a conversation.

**Auth Required:** Yes  
**Query Parameters:**
```
limit    : int (default: 50)
offset   : int (default: 0)
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "uuid",
    "sender_name": "Jane Smith",
    "content": "I can help with that",
    "attachments": [
      {
        "url": "https://...",
        "type": "image/jpeg",
        "filename": "photo.jpg"
      }
    ],
    "is_read": true,
    "created_at": "2026-05-27T10:00:00Z"
  }
]
```

---

### POST /api/messages/conversations/{conversationId}

Send message in conversation.

**Auth Required:** Yes  
**Rate Limit:** `userChatLimiter` (global) + `conversationMessageLimiter` (per-conversation)

**Request:**
```json
{
  "content": "I can help with that",
  "attachments": [
    {
      "url": "https://...",
      "type": "image/jpeg",
      "filename": "photo.jpg"
    }
  ]
}
```

**Response (201):** Message object

---

### GET /api/messages/conversations/{conversationId}/search

Search messages in a conversation.

**Auth Required:** Yes  
**Query Parameters:**
```
q        : string (search query)
limit    : int
offset   : int
```

**Response (200):** Array of matching message objects

---

### DELETE /api/messages/conversations/{conversationId}/{messageId}

Delete message.

**Auth Required:** Yes (message owner)  
**Response (200):**
```json
{ "ok": true }
```

---

### PUT /api/messages/conversations/{conversationId}/{messageId}

Edit message.

**Auth Required:** Yes (message owner)  
**Request:**
```json
{
  "content": "Updated message content"
}
```

**Response (200):** Updated message object

---

### POST /api/messages/conversations/{conversationId}/{messageId}/reactions

Add reaction to message (emoji).

**Auth Required:** Yes  
**Request:**
```json
{
  "emoji": "👍"
}
```

**Response (201):** Reaction object

---

### DELETE /api/messages/conversations/{conversationId}/{messageId}/reactions

Remove reaction from message.

**Auth Required:** Yes  
**Query Parameters:**
```
emoji    : string (emoji to remove)
```

**Response (200):**
```json
{ "ok": true }
```

---

### POST /api/messages/conversations/{conversationId}/archive

Archive a conversation.

**Auth Required:** Yes  
**Response (200):**
```json
{ "ok": true }
```

---

### POST /api/messages/conversations/{conversationId}/restore

Restore archived conversation.

**Auth Required:** Yes  
**Response (200):**
```json
{ "ok": true }
```

---

### GET /api/messages/archived

Get archived conversations.

**Auth Required:** Yes  
**Response (200):** Array of archived conversation objects

---

### POST /api/messages/conversations/{conversationId}/attachments

Upload attachment to conversation.

**Auth Required:** Yes  
**Content-Type:** `multipart/form-data`  
**Form Fields:**
- `file` (required) - max 10 MB, images + documents

**Response (201):**
```json
{
  "url": "https://...",
  "type": "image/jpeg",
  "filename": "photo.jpg",
  "size_bytes": 2048000
}
```

---

## Chat API

### POST /api/chat/message

Send message to support chat (public, no auth required).

**Rate Limit:** `chatLimiter`

**Request:**
```json
{
  "content": "I need help with my booking",
  "page_context": "/bookings"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "reply": "How can we help you?",
  "created_at": "2026-05-27T10:00:00Z"
}
```

---

### POST /api/chat/profile-message

Send message to helper/business profile (auth optional).

**Rate Limit:** `profileChatLimiter`

**Auth Required:** No (optional - authenticated users get live routing)

**Request:**
```json
{
  "helper_id": "uuid",
  "business_id": "uuid",
  "message": "Are you available next week?",
  "guest_email": "customer@example.com"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "reply": "Yes, I have availability...",
  "created_at": "2026-05-27T10:00:00Z"
}
```

**Note:** Auth optional - unauthenticated users get AI-only mode; authenticated users get live routing when helper is online.

---

### POST /api/chat/sessions/guest

Create guest inquiry for helper profile.

**Auth Required:** No  
**Request:**
```json
{
  "helper_id": "uuid",
  "guest_name": "John Doe",
  "guest_email": "john@example.com",
  "message": "Are you available for my project?",
  "message_type": "inquiry"
}
```

**Response (201):**
```json
{
  "inquiry_id": "uuid",
  "ok": true
}
```

---

### GET /api/chat/profile-context/{type}/{id}

Get AI context for profile chat (owner transparency).

**Auth Required:** Yes (owner only)  
**Path Parameters:**
```
type    : helper|business
id      : UUID
```

**Response (200):**
```json
{
  "systemPrompt": "You are a helpful assistant for Jane Smith's plumbing business...",
  "knowledgeBase": "10+ years of plumbing experience...",
  "contextVersion": "v3"
}
```

---

### POST /api/chat/transcribe

Transcribe audio to text.

**Auth Required:** Yes  
**Content-Type:** `multipart/form-data`

**Form Fields:**
- `audio` (required) - audio file (WAV, MP3, etc.)

**Response (200):**
```json
{
  "text": "Are you available next week?",
  "confidence": 0.95
}
```

---

## Notifications API

### GET /api/notifications

Get current user's notifications.

**Auth Required:** Yes  
**Query Parameters:**
```
limit    : int (default: 50)
offset   : int
unread_only : boolean
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "type": "bid_received",
    "title": "New bid on your job",
    "message": "Jane Smith bid $150 on your plumbing job",
    "data": {
      "job_id": "uuid",
      "bid_id": "uuid"
    },
    "is_read": false,
    "created_at": "2026-05-27T10:00:00Z"
  }
]
```

---

### POST /api/notifications/mark-read

Mark notification as read.

**Auth Required:** Yes  
**Request:**
```json
{
  "notification_id": "uuid"
}
```

**Response (200):**
```json
{ "ok": true }
```

---

### GET /api/notifications/preferences

Get notification preferences.

**Auth Required:** Yes  
**Response (200):**
```json
{
  "email_enabled": true,
  "push_enabled": true,
  "sms_enabled": false,
  "frequency": "real_time",  // real_time|daily|weekly
  "do_not_disturb_start": "22:00",
  "do_not_disturb_end": "08:00"
}
```

---

### PUT /api/notifications/preferences

Update notification preferences.

**Auth Required:** Yes  
**Request:**
```json
{
  "email_enabled": true,
  "push_enabled": true,
  "sms_enabled": false,
  "frequency": "daily",
  "do_not_disturb_start": "22:00",
  "do_not_disturb_end": "08:00"
}
```

**Response (200):** Updated preferences object

---

### POST /api/notifications/push-token

Register device push token.

**Auth Required:** Yes  
**Request:**
```json
{
  "token": "ios_push_token_from_apns",
  "device_type": "ios",
  "device_id": "unique_device_identifier"
}
```

**Response (201):**
```json
{ "ok": true }
```

---

## Payments API

### POST /api/payments/intent

Create Stripe PaymentIntent for escrow payment.

**Auth Required:** Yes (job owner)  
**Request:**
```json
{
  "job_id": "uuid",
  "amount": 10000,
  "currency": "USD"
}
```

**Response (201):**
```json
{
  "client_secret": "pi_xxx_secret_xxx",
  "payment_intent_id": "pi_xxx",
  "amount": 10000,
  "currency": "USD"
}
```

---

### POST /api/payments/capture

Capture escrow payment after job completion.

**Auth Required:** Yes  
**Request:**
```json
{
  "job_id": "uuid",
  "payment_intent_id": "pi_xxx"
}
```

**Response (200):**
```json
{
  "ok": true,
  "payment_intent_id": "pi_xxx",
  "status": "succeeded"
}
```

---

### GET /api/payments/me

Get current user's payments.

**Auth Required:** Yes  
**Query Parameters:**
```
limit    : int (max: 100)
offset   : int
status   : pending|succeeded|failed
```

**Response (200):**
```json
{
  "payments": [
    {
      "id": "uuid",
      "job_id": "uuid",
      "amount": 10000,
      "currency": "USD",
      "status": "succeeded",
      "created_at": "2026-05-27T10:00:00Z"
    }
  ],
  "total": 5,
  "limit": 25,
  "offset": 0
}
```

---

### GET /api/payments/job/{jobId}

Get payment details for specific job.

**Auth Required:** Yes (job owner or helper)  
**Response (200):**
```json
{
  "job_id": "uuid",
  "payment_intent_id": "pi_xxx",
  "amount": 10000,
  "status": "succeeded",
  "escrow_released_at": "2026-05-28T10:00:00Z"
}
```

---

### POST /api/payments/connect

Create Stripe Connect account for payout.

**Auth Required:** Yes (helper)  
**Request:**
```json
{
  "country": "US",
  "type": "individual"  // or "company"
}
```

**Response (201):**
```json
{
  "connect_account_id": "acct_xxx",
  "onboarding_url": "https://connect.stripe.com/...",
  "charges_enabled": false
}
```

---

### GET /api/payments/connect/status

Get Stripe Connect account status.

**Auth Required:** Yes  
**Response (200):**
```json
{
  "connect_account_id": "acct_xxx",
  "charges_enabled": true,
  "payouts_enabled": true,
  "verification_status": "verified"
}
```

---

## File Upload Endpoints

### POST /api/upload/image

Upload image to AWS S3.

**Auth Required:** Yes  
**Content-Type:** `multipart/form-data`

**Form Fields:**
- `image` (required) - JPEG, PNG, or WebP (max 5 MB)
- `purpose` (optional) - profile_photo, cover_photo, gallery, job_media, message_attachment

**Response (201):**
```json
{
  "url": "https://s3.amazonaws.com/bucket/...",
  "key": "uploads/...",
  "content_type": "image/jpeg",
  "size_bytes": 2048000
}
```

---

### POST /api/upload/document

Upload document to AWS S3.

**Auth Required:** Yes  
**Content-Type:** `multipart/form-data`

**Form Fields:**
- `document` (required) - PDF, DOC, DOCX (max 10 MB)
- `purpose` (optional) - contract, invoice, w9, background_check

**Response (201):**
```json
{
  "url": "https://s3.amazonaws.com/bucket/...",
  "key": "uploads/...",
  "content_type": "application/pdf",
  "size_bytes": 5120000
}
```

---

## Socket.IO Real-Time Events

Connect to Socket.IO for real-time updates:

```swift
let socket = SocketIOClient(
    manager: SocketManager(socketURL: URL(string: "https://api.oxsteed.com")!),
    config: [.secure(true), .reconnects(true)]
)

socket.on(clientEvent: .connect) { _, _ in
    socket.emit("authenticate", ["token": accessToken])
}
```

### Events to Listen For

**Message Events:**
```
message:new           - New message in conversation
message:read          - Message marked as read
message:deleted       - Message deleted
conversation:archived - Conversation archived
```

**Bid Events:**
```
bid:received          - New bid on your job
bid:accepted          - Your bid accepted
bid:rejected          - Your bid rejected
```

**Appointment Events:**
```
appointment:created   - New appointment
appointment:updated   - Appointment updated
appointment:cancelled - Appointment cancelled
```

**Job Events:**
```
job:created           - New job posted
job:updated           - Job updated
job:completed         - Job marked complete
job:cancelled         - Job cancelled
```

**Notification Events:**
```
notification:new      - New notification
notification:dismissed - Notification dismissed
```

---

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": "Email already exists",
  "code": 400,
  "fields": {
    "email": "Already taken"
  }
}
```

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Parse response |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Check validation errors in `fields` |
| 401 | Unauthorized | Refresh token or logout |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | State conflict (concurrent modification) |
| 422 | Validation Failed | Check `fields` for specific errors |
| 429 | Rate Limited | Wait and retry |
| 500+ | Server Error | Log request ID and contact support |

---

## Rate Limiting

### Limits per Endpoint Category

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `/api/auth` | 15 attempts | 15 min | IP |
| `/api/jobs/*/cancel` | 5 attempts | 1 hour | IP |
| `/api/chat/message` | varies | 15 min | IP |
| `/api/helpers` (browse) | 100 req | 15 min | IP |
| All other `/api/*` | 100 req | 15 min | IP |

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1622150000 (unix timestamp)
```

### Handling Rate Limits

On 429 response:
1. Read `X-RateLimit-Reset` header
2. Wait until that timestamp
3. Retry request

---

## Keychain Security

### iOS Keychain Implementation

```swift
import Security

class KeychainManager {
    static let shared = KeychainManager()
    private let service = "com.oxsteed.app"
    
    func saveAccessToken(_ token: String) {
        save(token, for: "accessToken")
    }
    
    func getAccessToken() -> String? {
        retrieve(for: "accessToken")
    }
    
    func saveRefreshToken(_ token: String) {
        save(token, for: "refreshToken")
    }
    
    func getRefreshToken() -> String? {
        retrieve(for: "refreshToken")
    }
    
    func deleteAll() {
        delete(for: "accessToken")
        delete(for: "refreshToken")
    }
    
    private func save(_ value: String, for key: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    
    private func retrieve(for key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]
        
        var result: AnyObject?
        SecItemCopyMatching(query as CFDictionary, &result)
        
        if let data = result as? Data {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }
    
    private func delete(for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

### Key Points

- **Never store tokens in UserDefaults** - they're not encrypted
- Use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` - tokens inaccessible when device locked
- Clear tokens on logout via `deleteAll()`
- Tokens survive app restart (stored in Secure Enclave)
- Automatic device-level encryption via Keychain

---

## Test Credentials

### Test Cards (Stripe)

```
4242 4242 4242 4242  - Success
4000 0000 0000 0002  - Decline
4000 0025 0000 3155  - 3DS Required
```

Any future expiry date and any 3-digit CVC work.

### Test User Accounts

Create accounts using the `/api/auth/register` endpoint with test email addresses (e.g., `test-customer-1@example.com`).

---

## Implementation Checklist

- [ ] Set up Keychain storage for tokens
- [ ] Implement JWT token refresh on 401
- [ ] Handle rate limiting (read headers, implement backoff)
- [ ] Implement Socket.IO connection with auth
- [ ] Create models for all data types
- [ ] Implement pagination for list endpoints
- [ ] Handle file uploads for images/documents
- [ ] Set up error boundary for network failures
- [ ] Implement retry logic with exponential backoff
- [ ] Add logging for debugging
- [ ] Test with Stripe test cards
- [ ] Implement app-level token clearing on logout

---

## Support & Documentation

- **API Status:** https://status.oxsteed.com
- **Developer Docs:** https://docs.oxsteed.com
- **Support Email:** dev-support@oxsteed.com
- **Production Ready:** ✅ Yes
- **Last Updated:** May 27, 2026
- **Version:** 2.0

---

## Production Deployment Notes

1. **Environment Variables:**
   - Set `APP_URL` = `https://api.oxsteed.com`
   - Ensure `JWT_SECRET` is strong (32+ chars)
   - Configure S3 bucket access

2. **SSL/TLS:**
   - All requests must use HTTPS
   - Certificate pinning recommended

3. **Security:**
   - Implement certificate pinning for iOS
   - Never log sensitive data
   - Sanitize user input before display
   - Validate all responses server-side

4. **Monitoring:**
   - Monitor 401 error rates (token expiry issues)
   - Track rate limit 429 responses
   - Monitor Stripe webhook failures

---

**This guide was generated from actual codebase analysis (May 27, 2026). All endpoints, parameters, and response structures are verified against production source code.**
