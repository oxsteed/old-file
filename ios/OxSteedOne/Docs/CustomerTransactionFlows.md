# OxSteed One - Customer-Facing Transaction Flows

This document defines the customer-side transactional workflows for:
1. Customer Job Posting
2. Customer Service Booking
3. Customer Tool Rental

It is the implementation source-of-truth for native iOS UX and API wiring in `ios/OxSteedOne`.

---

## 1. Customer Job Posting Flow

### Entry Points
- Home tab: `Post a Job` CTA
- Jobs directory: `Post Your Own Job`
- Direct route equivalent: `/post-job` (authenticated customers only)

### Flow Sequence
1. Job discovery / intent entry
2. Job details form
3. Photo upload (optional)
4. Review & publish
5. Published confirmation
6. Receive/manage bids (Home)
7. Bid comparison (job detail)
8. Message helpers (optional)
9. Accept bid + appointment creation

### Required Data
- `title` (10-100)
- `description` (50-2000)
- `category`
- `location_*` fields
- `urgency`
- budget range or amount

### Optional Data
- verification requirements
- min rating
- preferred helper
- skills required
- estimated hours
- photos

### Primary APIs
- `GET /api/jobs/categories`
- `POST /api/jobs/draft`
- `GET /api/jobs/location-suggestions?q=...`
- `POST /api/jobs/{jobId}/photos`
- `POST /api/jobs`
- `PUT /api/jobs/{jobId}`
- `GET /api/jobs/{jobId}/bids`
- `POST /api/jobs/{jobId}/bids/{bidId}/accept`
- `POST /api/messages`

### Status Transitions
- Job: `draft -> published -> matched -> in_progress -> completed|cancelled`
- Bid: `pending -> accepted|rejected|withdrawn`
- Appointment source: `job_bid`

---

## 2. Customer Service Booking Flow

### Entry Points
- Home tab: `Book a Service`
- Helpers directory
- Direct route equivalent: `/book/:helperId`

### Flow Sequence
1. Service discovery / helper search
2. Browse helpers list
3. Helper profile + availability
4. Select slot + booking details
5. Confirm booking + payment authorization
6. Booking confirmation
7. Pre-appointment communication / reminders
8. Post-appointment review + completion

### Required Data
- `helper_id`
- `start_time`
- `duration_minutes`
- `service_type`
- `location` mode
- payment method/authorization

### Optional Data
- notes
- reschedule request data

### Primary APIs
- `GET /api/helpers?...`
- `GET /api/helpers/{helperId}/profile`
- `GET /api/helpers/{helperId}/availability`
- `GET /api/helpers/{helperId}/services`
- `POST /api/appointments`
- `GET /api/appointments/{appointmentId}`
- `POST /api/appointments/{appointmentId}/reschedule`
- `POST /api/appointments/{appointmentId}/cancel`
- `POST /api/reviews`
- `POST /api/appointments/{appointmentId}/complete`

### Status Transitions
- Appointment: `scheduled -> confirmed -> in_progress -> completed|cancelled|no_show`

---

## 3. Customer Tool Rental Flow

### Entry Points
- Home tab: `Rent a Tool`
- Tool directory
- Direct route equivalent: `/rentals/{toolId}`

### Flow Sequence
1. Tool discovery/search
2. Browse listing cards
3. Tool details + terms + availability
4. Select dates + logistics
5. Payment authorization + reserve
6. Reservation confirmation
7. Pre-pickup communication
8. Pickup confirmation
9. Active rental period tracking
10. Return confirmation
11. Damage assessment/dispute path
12. Deposit refund + completion + review

### Required Data
- `tool_id`
- rental start/end dates
- pickup/return methods
- terms acceptance
- payment authorization

### Optional Data
- special requests
- damage notes/photos
- dispute attachments

### Primary APIs
- `GET /api/tool-rentals/browse?...`
- `GET /api/tool-rentals/{toolId}`
- `GET /api/tool-rentals/{toolId}/availability`
- `POST /api/tool-rentals/{toolId}/verify-dates`
- `POST /api/tool-rentals/{toolId}/reserve`
- `GET /api/tool-rentals/my-rentals`
- `POST /api/tool-rentals/{rentalId}/pickup-confirmed`
- `POST /api/tool-rentals/{rentalId}/report-issue`
- `POST /api/tool-rentals/{rentalId}/return-confirmed`
- `POST /api/tool-rentals/{rentalId}/damage-assessment/dispute`
- `POST /api/reviews`

### Status Transitions
- Rental: `confirmed -> in_progress -> returned -> completed|disputed|cancelled`
- Damage assessment: `pending -> verified|disputed -> resolved`

---

## Cross-Flow Shared Systems

1. Payments + escrow/authorization rules
2. Real-time notifications (Socket.IO)
3. Unified messaging threads (`/api/messages`)
4. Unified reviews (`/api/reviews`)
5. Unified dispute mediation lifecycle
6. Home tab operational cards:
   - Pending Quotes
   - Upcoming Appointments
   - Active Rentals
   - Recent Transactions

---

## iOS Implementation Mapping (OxSteedOne)

Current native scaffolds already wired:
- Home customer flow cards and local state:
  - `ios/OxSteedOne/Sources/Views/TodayView.swift`
  - `ios/OxSteedOne/Sources/Stores/OneStore.swift`
  - `ios/OxSteedOne/Sources/Models/OneModels.swift`
  - `ios/OxSteedOne/Sources/Services/OneSessionVault.swift`

Next execution targets:
1. Replace text-photo placeholders with native camera/photos picker + thumbnails.
2. Replace seeded bid/helper/tool mock generation with typed backend API fetch/mutation.
3. Add per-flow detail screens (Job Detail, Helper Profile, Tool Detail) with sort/filter state.
4. Add transaction-state timeline components and dispute decision UIs.
5. Integrate push/local notification triggers per flow milestones.

---

## Delivery Plan

### Phase 1: Infrastructure
- Shared transaction model + payment/messaging/notification/review/dispute services.

### Phase 2: Job Posting
- Full post-job form + publish + bids + accept -> appointment.

### Phase 3: Service Booking
- Helper discovery/profile/availability + booking + reminders + post-review.

### Phase 4: Tool Rental
- Discovery/detail/calendar + reservation + pickup/return + damage/dispute/refund.

### Phase 5: Integration
- Unified Home surfaces + transaction history + cross-flow mediation dashboard.
