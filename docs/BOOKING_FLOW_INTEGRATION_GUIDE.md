# Booking Flow Integration Guide

## Overview

This guide documents the implementation of the "Book Now" feature on helper profiles. This is a calendar-aware booking flow that allows customers to book specific helpers for specific times, with an automatic fallback to job posting if the booking is declined or expires.

## Architecture

### Database Schema (Migration 176)

The booking system uses three tables:

1. **`booking_requests`** - Main booking request records
   - `id` (UUID): Primary key
   - `customer_id`, `helper_id`: User references
   - `service_name`, `requested_date`, `requested_start_time`, `requested_end_time`: Booking details
   - `service_location`, `description`: Additional context
   - `status`: pending | accepted | declined | expired | cancelled
   - `expires_at`: Auto-expiry timestamp (24 hours from creation)
   - `converted_to_job_id`: Link to job created from failed booking
   - Timestamps: `created_at`, `updated_at`, `accepted_at`, `declined_at`

2. **`booking_request_audit_log`** - Audit trail for all booking actions
   - Tracks status changes with actor information
   - Supports compliance and debugging

3. **`booking_request_preferences`** - Optional helper preferences
   - `auto_accept_enabled`: Future feature for auto-accepting bookings
   - `require_approval_for_new_customers`: Approve first-time bookers
   - `min_notice_hours`: Minimum hours notice required

### Backend Implementation

#### Controller: `server/controllers/bookingController.js`

**Key Functions:**

1. **`createBookingRequest()`** - POST `/api/bookings`
   - Validates customer, helper, and booking details
   - Checks helper exists and is active
   - Creates booking with 24h expiry
   - Notifies helper (TODO: implement notification service integration)
   - Returns transformed booking object

2. **`acceptBookingRequest()`** - POST `/api/bookings/:bookingId/accept`
   - Helper accepts a pending booking
   - Updates status to 'accepted'
   - Logs audit entry
   - Notifies customer

3. **`declineBookingRequest()`** - POST `/api/bookings/:bookingId/decline`
   - Helper declines with optional reason
   - Updates status to 'declined'
   - Notifies customer with reason
   - Enables conversion to job posting

4. **`cancelBookingRequest()`** - POST `/api/bookings/:bookingId/cancel`
   - Customer cancels pending booking
   - Updates status to 'cancelled'
   - Notifies helper

5. **`convertBookingToJob()`** - POST `/api/bookings/:bookingId/convert-to-job`
   - **Critical Feature**: Converts failed booking to job posting
   - Creates job with pre-filled data:
     - `title`: service_name
     - `description`: booking description
     - `location_*`: service location
     - `status`: 'draft' (customer can still edit)
   - Returns `{ jobId, job, message }`
   - Links booking to job via `converted_to_job_id`

6. **`getHelperAvailableSlots()`** - GET `/api/bookings/helper/:helperId/available-slots?date=YYYY-MM-DD`
   - Fetches helper's business hours from `helper_profiles.business_hours` JSON
   - Queries existing appointments for that date
   - Calculates 1-hour slots, filtering out booked times
   - Returns array of available `{ startTime, endTime, available }`

### Frontend Components

#### 1. **BookingFlow.jsx** - Main orchestrator
```jsx
<BookingFlow
  helperId={helperId}
  helperName={helperName}
  onClose={() => { /* close modal */ }}
  onBookingCreated={(booking) => { /* handle */ }}
/>
```

**States:**
- `'calendar'`: Date/time selection (BookingCalendar)
- `'confirmation'`: Review and confirm (BookingConfirmation)
- `'status'`: Booking status display (BookingRequestCard)

**Flow:**
1. Calendar → Select date/time/service/location
2. Confirmation → Review and agree to terms
3. Status → Show pending/accepted/declined state
4. Optional: Convert to job if booking fails

#### 2. **BookingCalendar.jsx** - Date/time picker
- Displays 30-day calendar
- Shows available time slots via API
- Requires service name and location before proceeding
- Handles timezone (currently assumes local)

#### 3. **BookingConfirmation.jsx** - Review step
- Shows booking summary with icons
- Displays booking details (date, time, location, service)
- Requires explicit checkbox agreement
- Calls `createBookingRequest` API on confirm

#### 4. **BookingRequestCard.jsx** - Status display
- Shows current booking status with color-coded icon
- For `pending`: Shows countdown to expiry, refresh button
- For `accepted`: Shows next steps
- For `declined`: Offers "Post as Job" conversion
- For `expired`: Offers "Post as Job" conversion
- Polls status every 10 seconds while pending

### Routes

All routes require JWT auth (except GET public endpoints):

```javascript
POST /api/bookings                           - Create booking
GET /api/bookings                            - Get my bookings (customer)
GET /api/bookings/incoming                   - Get incoming (helper)
GET /api/bookings/:bookingId                 - Get specific booking
POST /api/bookings/:bookingId/accept         - Helper accepts
POST /api/bookings/:bookingId/decline        - Helper declines
POST /api/bookings/:bookingId/cancel         - Customer cancels
POST /api/bookings/:bookingId/convert-to-job - Convert to job
GET /api/bookings/helper/:helperId/available-slots?date=YYYY-MM-DD - Available slots
```

## Integration Points

### 1. Add Routes to Server

In `server/index.js`:
```javascript
const bookingRoutes = require('./routes/bookings');
app.use('/api/bookings', bookingRoutes);
```

### 2. Update Helper Profile Page

In `client/src/pages/HelperBusinessProfilePage.tsx`:

```jsx
import BookingFlow from '../components/booking/BookingFlow';

// In component:
const [showBookingFlow, setShowBookingFlow] = useState(false);

// Add "Book Now" button:
<button onClick={() => setShowBookingFlow(true)}>
  {t('helperProfile.bookNow')}
</button>

// Add modal:
{showBookingFlow && (
  <BookingFlow
    helperId={helperId}
    helperName={helperName}
    onClose={() => setShowBookingFlow(false)}
    onBookingCreated={handleBookingCreated}
  />
)}
```

### 3. Update PostAJobPage to Handle Booking Fallback

In `client/src/pages/PostAJobPage.jsx`:

```jsx
// Get booking data from location state
const location = useLocation();
const { bookingId } = location.state || {};

// Pre-fill form from booking if present:
useEffect(() => {
  if (bookingId) {
    // Fetch booking details
    fetch(`/api/bookings/${bookingId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const booking = data.data;
          // Pre-fill form fields:
          setFormData(prev => ({
            ...prev,
            title: booking.serviceName,
            description: booking.description,
            service_area_name: booking.serviceLocation,
            // Calculate time range for estimated_hours or duration fields
            // customer still needs to fill: budget, category, photos, etc.
          }));
        }
      });
  }
}, [bookingId]);
```

### 4. Add i18n Keys

Add to `client/src/locales/en.json`:

```json
{
  "booking": {
    "bookNow": "Book Now",
    "selectService": "Select Service",
    "selectDateTime": "Select Date & Time",
    "serviceName": "Service Name",
    "serviceLocation": "Service Location",
    "description": "Additional Notes",
    "descriptionPlaceholder": "Tell the helper what you need...",
    "availableSlots": "Available Slots",
    "noAvailableSlots": "No available slots for this date. Choose another date or post a job.",
    "confirmBooking": "Confirm Booking",
    "confirmationTitle": "Review Your Booking",
    "date": "Date",
    "time": "Time",
    "location": "Location",
    "service": "Service",
    "additionalNotes": "Additional Notes",
    "additionalDetails": "Show Additional Details",
    "importantToKnow": "Important to Know",
    "infoWaitingForResponse": "The helper has {{days}} day(s) to respond",
    "infoHelperCanDecline": "The helper may decline if they're unavailable",
    "infoCanConvertToJob": "If declined or expired, you can post this as a job for bids",
    "agreeToTerms": "I understand that the helper can accept or decline this booking request",
    "requestStatus": "Booking Request Status",
    "statusPending": "Awaiting Response",
    "statusPendingDesc": "Your booking request is waiting for the helper's response. You'll be notified once they accept or decline.",
    "statusAccepted": "Booking Accepted",
    "statusAcceptedDesc": "Great! The helper accepted your booking request. Next steps are coming soon.",
    "statusDeclined": "Request Declined",
    "statusDeclinedDesc": "The helper declined your booking request. You can post this as a job for bids from other helpers.",
    "statusExpired": "Request Expired",
    "statusExpiredDesc": "Your booking request has expired. You can post this as a job for bids from other helpers.",
    "statusCancelled": "Cancelled",
    "statusCancelledDesc": "You cancelled this booking request.",
    "expiresIn": "Expires in",
    "contactHelper": "Contact Helper",
    "refreshStatus": "Refresh Status",
    "postAsJob": "Post As Job",
    "nextSteps": "Next Steps",
    "nextStepsTitle": "What Happens Next",
    "nextStepOne": "The helper will confirm the appointment details",
    "nextStepTwo": "Payment will be secured before the service",
    "nextStepThree": "You'll get updates on the job status"
  }
}
```

Repeat for `es.json`, `fr.json`, `ht.json`.

### 5. Add Helper Profile Button

In `HelperBusinessProfilePage.tsx`, add a prominent "Book Now" button:

```jsx
<button
  className="profile-book-now-btn"
  onClick={() => setShowBookingFlow(true)}
>
  <Calendar size={20} />
  {t('booking.bookNow')}
</button>
```

Style with OxSteed orange (`#f97316`) for high visibility.

## Data Flow Diagram

```
Customer Views Helper Profile
         ↓
  [Book Now Button]
         ↓
  BookingFlow (Calendar Step)
    - Fetch available slots: GET /api/bookings/helper/:id/available-slots
    - Select date, time, service, location
         ↓
  BookingFlow (Confirmation Step)
    - Review booking summary
    - Agree to terms
         ↓
  POST /api/bookings (create booking request)
         ↓
  BookingFlow (Status Step)
    - Poll status every 10 seconds
    - Show: Pending → [24h countdown]
         ↓
  Helper Views Notification
    - GET /api/bookings/incoming
    - Sees pending booking
    - POST /api/bookings/:id/accept OR decline
         ↓
  Status Updates:
    - ✅ Accepted: Show next steps
    - ❌ Declined: Offer "Post as Job"
    - ⏰ Expired (24h timeout): Offer "Post as Job"
         ↓
  Customer Converts to Job
    - POST /api/bookings/:id/convert-to-job
    - Returns: { jobId, job }
    - Navigates to PostAJobPage with pre-filled data
         ↓
  Customer Completes Job Form
    - Service, date/time, location pre-filled
    - Still needs: budget, category, photos, etc.
    - POST /api/jobs (standard flow)
```

## Timeout & Auto-Expiry

**Helper Perspective:**
- Booking stays "pending" for 24 hours
- Helper can respond at any time during this window
- If no response, status auto-changes to "expired" (TODO: implement background job)

**Customer Perspective:**
- Can cancel anytime while "pending"
- After 24h: Status becomes "expired"
- Can convert to job immediately upon expiry

**Background Job (TODO):**
```javascript
// server/jobs/bookingExpiryJob.js
// Runs every hour, finds expired bookings, updates status
const expiredBookings = await pool.query(
  `UPDATE booking_requests
   SET status = 'expired'
   WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP`
);
```

Register in `server/index.js`:
```javascript
const bookingExpiryJob = require('./jobs/bookingExpiryJob');
bookingExpiryJob.start();
```

## Notifications (TODO)

Currently logged but not sent. Integrate with your notification service:

```javascript
// In bookingController.js:
async function notifyHelperOfBooking(helperId, booking) {
  // Send email/socket/push notification
  await notificationService.send({
    userId: helperId,
    type: 'booking_request',
    title: `New booking request from ${booking.customer_name}`,
    data: { bookingId: booking.id }
  });
}

async function notifyCustomerOfBookingResponse(customerId, booking, response) {
  await notificationService.send({
    userId: customerId,
    type: 'booking_response',
    title: response === 'accepted' ? 'Booking accepted!' : 'Booking declined',
    data: { bookingId: booking.id }
  });
}
```

## Testing Checklist

- [ ] Create booking request as customer
- [ ] Verify email/notification sent to helper
- [ ] Helper can view incoming bookings
- [ ] Helper accepts booking
- [ ] Customer sees "accepted" status
- [ ] Helper declines booking with reason
- [ ] Customer sees reason and can convert to job
- [ ] Convert to job creates draft job with pre-filled fields
- [ ] Customer can complete job form and post
- [ ] Booking expires after 24h (manual DB update for testing)
- [ ] Auto-expiry background job runs and updates status
- [ ] Customer can manually cancel pending booking
- [ ] All notifications are sent correctly
- [ ] i18n keys render correctly in all 4 languages
- [ ] Mobile responsive layout works

## Known Limitations & Future Work

1. **Timezone Handling**: Currently uses browser timezone. Should use helper's timezone.
2. **Business Hours**: Stored as JSON in helper_profiles. Needs validation and proper querying.
3. **Notifications**: Placeholders only. Need Resend/email integration.
4. **Auto-Expiry Job**: Not yet implemented. Currently manual or via polling.
5. **Helper Preferences**: `booking_request_preferences` table created but not used yet.
6. **Auto-Accept**: Can be added for helpers who want automatic acceptance.
7. **Pricing**: Not calculated during booking. Could show estimated cost.

## API Example Calls

### Create Booking Request
```bash
curl -X POST http://localhost:5000/api/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "helperId": "uuid-here",
    "serviceName": "Plumbing Fix",
    "requestedDate": "2026-05-15",
    "requestedStartTime": "09:00",
    "requestedEndTime": "10:00",
    "serviceLocation": "123 Main St, Austin, TX",
    "description": "Fix leaky faucet in kitchen"
  }'
```

### Get Available Slots
```bash
curl http://localhost:5000/api/bookings/helper/helper-uuid/available-slots?date=2026-05-15
```

### Accept Booking
```bash
curl -X POST http://localhost:5000/api/bookings/booking-uuid/accept \
  -H "Authorization: Bearer {token}"
```

### Decline Booking
```bash
curl -X POST http://localhost:5000/api/bookings/booking-uuid/decline \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "reason": "I'm fully booked that day"
  }'
```

### Convert to Job
```bash
curl -X POST http://localhost:5000/api/bookings/booking-uuid/convert-to-job \
  -H "Authorization: Bearer {token}"
```

## Files Created

- `server/migrations/176_booking_requests.sql`
- `server/controllers/bookingController.js`
- `server/routes/bookings.js`
- `client/src/components/booking/BookingFlow.jsx`
- `client/src/components/booking/BookingFlow.css`
- `client/src/components/booking/BookingCalendar.jsx`
- `client/src/components/booking/BookingCalendar.css`
- `client/src/components/booking/BookingConfirmation.jsx`
- `client/src/components/booking/BookingConfirmation.css`
- `client/src/components/booking/BookingRequestCard.jsx`
- `client/src/components/booking/BookingRequestCard.css`
- `client/src/types/booking.ts`
- `docs/BOOKING_FLOW_INTEGRATION_GUIDE.md` (this file)
