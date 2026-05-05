# Booking Flow Setup Checklist

## ✅ What's Been Built

### Backend
- [x] **Migration 176** - `booking_requests`, `booking_request_audit_log`, `booking_request_preferences` tables
- [x] **bookingController.js** - All CRUD operations and state management
- [x] **bookingRoutes.js** - API endpoints (9 total)
- [x] **Core functions**:
  - Create, get, list booking requests
  - Accept, decline, cancel operations
  - Convert booking to job posting
  - Fetch available helper slots

### Frontend
- [x] **BookingFlow.jsx** - Main orchestrator component
- [x] **BookingCalendar.jsx** - Calendar and time slot picker
- [x] **BookingConfirmation.jsx** - Review and confirmation step
- [x] **BookingRequestCard.jsx** - Status display with polling
- [x] **CSS** - Complete styling for all components (1000+ lines)
- [x] **Types** - `client/src/types/booking.ts` with all TypeScript interfaces
- [x] **i18n Keys** - Complete translation key list (60+ keys)

### Documentation
- [x] **Integration Guide** - Detailed implementation instructions
- [x] **i18n Keys File** - All translation keys in JSON format
- [x] **Setup Checklist** - This file

## 📋 Integration Tasks (In Order)

### Phase 1: Database & Backend (30 minutes)

#### Step 1.1: Apply Migration
```bash
# The migration file is ready at:
# server/migrations/176_booking_requests.sql

# Run your migration system:
npm run migrate
# or
node server/migrate.js
```

**Verify**: Check your database for `booking_requests`, `booking_request_audit_log`, `booking_request_preferences` tables.

#### Step 1.2: Register Routes
In `server/index.js`, add after other route registrations:
```javascript
// Around line 100-150, with other route registrations:
const bookingRoutes = require('./routes/bookings');
app.use('/api/bookings', bookingRoutes);
```

**Verify**: Restart server, test: `curl http://localhost:5000/api/bookings` should return 401 (auth required).

### Phase 2: Frontend Components (45 minutes)

#### Step 2.1: Verify Component Files Exist
All component files should be at:
- `client/src/components/booking/BookingFlow.jsx`
- `client/src/components/booking/BookingCalendar.jsx`
- `client/src/components/booking/BookingConfirmation.jsx`
- `client/src/components/booking/BookingRequestCard.jsx`
- `client/src/components/booking/` - All `.css` files

**Verify**: Files exist and have no syntax errors:
```bash
cd client
npm run build 2>&1 | grep booking
```

#### Step 2.2: Add Type Definitions
File should exist at: `client/src/types/booking.ts`

No changes needed unless you have TypeScript errors.

### Phase 3: Integration with Helper Profile (30 minutes)

#### Step 3.1: Update Helper Profile Page
Edit: `client/src/pages/HelperBusinessProfilePage.tsx`

**Add imports at top**:
```typescript
import BookingFlow from '../components/booking/BookingFlow';
import { useState } from 'react';
```

**Add state**:
```typescript
const [showBookingFlow, setShowBookingFlow] = useState(false);
```

**Add "Book Now" button** (place near top of profile):
```jsx
{isLoggedIn && !isOwnProfile && (
  <button
    className="profile-book-now-btn"
    onClick={() => setShowBookingFlow(true)}
  >
    <Calendar size={20} />
    {t('booking.bookNow')}
  </button>
)}
```

**Add style** in `client/src/styles/HelperBusinessProfilePage.css`:
```css
.profile-book-now-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  background-color: #f97316;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 16px;
}

.profile-book-now-btn:hover {
  background-color: #ea580c;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
}
```

**Add BookingFlow modal** (at end of component, before closing tag):
```jsx
{showBookingFlow && (
  <div className="profile-booking-modal-overlay" onClick={() => setShowBookingFlow(false)}>
    <div className="profile-booking-modal" onClick={e => e.stopPropagation()}>
      <BookingFlow
        helperId={helperId}
        helperName={helperName || 'Helper'}
        onClose={() => setShowBookingFlow(false)}
        onBookingCreated={() => {
          // Optional: show success message
          setShowBookingFlow(false);
        }}
      />
    </div>
  </div>
)}
```

**Add modal styling** in the same CSS file:
```css
.profile-booking-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.profile-booking-modal {
  max-width: 600px;
  width: 90%;
  max-height: 90vh;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

@media (max-width: 640px) {
  .profile-booking-modal-overlay {
    align-items: flex-end;
  }

  .profile-booking-modal {
    width: 100%;
    max-height: 85vh;
    border-radius: 12px 12px 0 0;
  }
}
```

**Verify**: Component renders without errors, "Book Now" button appears on helper profiles.

### Phase 4: Update Job Posting Flow (30 minutes)

#### Step 4.1: Update PostAJobPage
Edit: `client/src/pages/PostAJobPage.jsx` (or `.tsx`)

**Add import**:
```javascript
import { useLocation } from 'react-router-dom';
```

**Add location hook**:
```javascript
const location = useLocation();
const { bookingId } = location.state || {};
```

**Add effect to pre-fill from booking**:
```javascript
useEffect(() => {
  if (bookingId) {
    // Fetch booking details to pre-fill form
    fetch(`/api/bookings/${bookingId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const booking = data.data;
          
          // Pre-fill form fields
          setFormData(prev => ({
            ...prev,
            title: booking.serviceName || prev.title,
            description: booking.description || prev.description,
            location: booking.serviceLocation || prev.location,
            // Don't auto-fill category - user should select
            // Don't auto-fill budget - user should decide
          }));
          
          // Show info banner
          setShowBookingConversionInfo(true);
        }
      })
      .catch(err => console.error('Failed to load booking', err));
  }
}, [bookingId]);
```

**Add banner** (near top of form):
```jsx
{bookingId && showBookingConversionInfo && (
  <div className="booking-conversion-banner">
    <AlertCircle size={20} />
    <div>
      <h4>Converting from Booking Request</h4>
      <p>Your booking details have been pre-filled below. Complete the form with additional required information and post to receive bids.</p>
    </div>
    <button
      onClick={() => setShowBookingConversionInfo(false)}
      className="banner-close"
    >
      ×
    </button>
  </div>
)}
```

**Add banner styling** in `client/src/styles/PostAJobPage.css`:
```css
.booking-conversion-banner {
  display: flex;
  gap: 12px;
  padding: 16px;
  background-color: rgba(59, 130, 246, 0.1);
  border-left: 3px solid #3b82f6;
  border-radius: 6px;
  margin-bottom: 20px;
  color: #1e40af;
}

.booking-conversion-banner h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 600;
}

.booking-conversion-banner p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.banner-close {
  background: none;
  border: none;
  color: #1e40af;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  flex-shrink: 0;
}

.banner-close:hover {
  opacity: 0.7;
}
```

**Verify**: 
- Navigate to a job page normally → no banner
- Trigger booking conversion → pre-filled form with info banner

### Phase 5: Translations (30 minutes)

#### Step 5.1: Add i18n Keys
Open each translation file and add the `booking` namespace:

**For `client/src/locales/en.json`**:
1. Open the file
2. Add comma after last top-level key if needed
3. Add the entire `booking` object from `BOOKING_FLOW_I18N_KEYS.json`
4. Ensure valid JSON (use JSON validator)

**For `client/src/locales/es.json`**:
- Use the English keys as reference
- Machine translate or manually translate to Spanish
- Ensure all keys match English structure

**For `client/src/locales/fr.json`**:
- Same as Spanish, but to French

**For `client/src/locales/ht.json`**:
- Same as Spanish, but to Haitian Creole

**Tool**: Use this to validate JSON:
```bash
cd client/src/locales
node -e "console.log(JSON.parse(require('fs').readFileSync('en.json')))" && echo "Valid"
```

**Verify**: App renders without i18n key errors in console.

### Phase 6: Testing (1 hour)

#### Step 6.1: Manual Testing

**Setup**:
- Create 2 test accounts: `customer@test.com`, `helper@test.com`
- Log in as helper, create a helper profile with business hours
- Make sure helper profile is public

**Test Flow**:
1. [ ] Log in as customer
2. [ ] Navigate to helper profile
3. [ ] Click "Book Now" button
4. [ ] Select service, location, description
5. [ ] Select date and time slot
6. [ ] Review booking, check agreement checkbox
7. [ ] Confirm booking
8. [ ] See "Pending" status with countdown
9. [ ] Log in as helper
10. [ ] Check for booking notification (TODO)
11. [ ] Accept or decline booking
12. [ ] Log back as customer
13. [ ] See updated status
14. [ ] If declined/expired: Click "Post as Job"
15. [ ] Verify job form is pre-filled
16. [ ] Complete job form and post
17. [ ] Verify job appears in job list

**Edge Cases**:
- [ ] Try to book yourself (should error)
- [ ] Try to book helper with no business hours
- [ ] Try to book in the past (should disable dates)
- [ ] Try to convert to job when status is "accepted" (should not show button)
- [ ] Check mobile responsive layout

#### Step 6.2: API Testing

```bash
# 1. Get auth token
TOKEN=$(curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@test.com","password":"password"}' | jq -r '.data.accessToken')

# 2. Create booking
curl -X POST http://localhost:5000/api/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "helperId": "helper-uuid",
    "serviceName": "Cleaning",
    "requestedDate": "2026-05-20",
    "requestedStartTime": "10:00",
    "requestedEndTime": "11:00",
    "serviceLocation": "123 Main St",
    "description": "Clean the house"
  }' | jq

# 3. Get available slots
curl "http://localhost:5000/api/bookings/helper/helper-uuid/available-slots?date=2026-05-20" | jq

# 4. Accept booking (as helper)
curl -X POST "http://localhost:5000/api/bookings/booking-uuid/accept" \
  -H "Authorization: Bearer $HELPER_TOKEN"

# 5. Convert to job (as customer)
curl -X POST "http://localhost:5000/api/bookings/booking-uuid/convert-to-job" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Phase 7: Notifications (TODO - Optional for MVP)

#### Step 7.1: Integrate Email Notifications
In `server/controllers/bookingController.js`, update these functions:
- `notifyHelperOfBooking()` - Send email when customer creates booking
- `notifyCustomerOfBookingResponse()` - Send email when helper accepts/declines
- `notifyHelperOfBookingCancellation()` - Send email when customer cancels

Use your email service (Resend, SendGrid, etc.):
```javascript
async function notifyHelperOfBooking(helperId, booking) {
  // TODO: Get helper email from DB
  const helper = await pool.query('SELECT email, first_name FROM users WHERE id = $1', [helperId]);
  
  // TODO: Send email via your service
  await emailService.send({
    to: helper.rows[0].email,
    subject: `New booking request from ${booking.customer_name}`,
    template: 'booking-request',
    data: { booking, helperName: helper.rows[0].first_name }
  });
}
```

#### Step 7.2: Integrate Socket.IO Notifications
For real-time updates without polling:
```javascript
// In bookingController.js after accepting/declining:
io.to(`user:${booking.customer_id}`).emit('booking_updated', {
  bookingId: booking.id,
  status: booking.status
});
```

### Phase 8: Production Features (Optional)

#### Step 8.1: Background Job for Auto-Expiry
Create `server/jobs/bookingExpiryJob.js`:
```javascript
const schedule = require('node-cron');
const pool = require('../db');

// Run every hour
schedule.schedule('0 * * * *', async () => {
  try {
    const result = await pool.query(
      `UPDATE booking_requests
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP`
    );
    console.log(`Expired ${result.rowCount} bookings`);
  } catch (err) {
    console.error('Error running booking expiry job:', err);
  }
});

module.exports = { start: () => {} }; // Already scheduled on import
```

Register in `server/index.js`:
```javascript
require('./jobs/bookingExpiryJob');
```

#### Step 8.2: Helper Booking Preferences UI
Allow helpers to set preferences at `/helper/settings/booking-preferences`:
- Auto-accept bookings
- Require approval for new customers
- Minimum notice hours

## 🚀 Deployment Checklist

Before deploying to production:

- [ ] All migrations applied successfully
- [ ] Routes registered in server
- [ ] Components compile without errors
- [ ] i18n keys added for all 4 languages
- [ ] Helper profile page shows "Book Now" button
- [ ] Job posting page pre-fills from booking
- [ ] All manual tests pass
- [ ] API tests pass
- [ ] Database indexes created
- [ ] Audit logging working
- [ ] Error handling tested
- [ ] Mobile responsive layout works
- [ ] Dark mode CSS variables correct
- [ ] Email notifications ready (if implemented)

## 📞 Support & Debugging

### Common Issues

**Issue**: "Cannot POST /api/bookings" (404)
- **Fix**: Routes not registered in server/index.js. Check that `app.use('/api/bookings', bookingRoutes)` is added.

**Issue**: Migration fails with "table already exists"
- **Fix**: Check if table was created with different migration. Run: `SELECT * FROM booking_requests LIMIT 0;` to verify.

**Issue**: Components not rendering
- **Fix**: Check browser console for errors. Verify component files exist and have correct imports.

**Issue**: i18n keys show as raw keys like "booking.bookNow"
- **Fix**: Keys not added to locale files. Ensure all keys are in all 4 languages and JSON is valid.

**Issue**: Available slots always empty
- **Fix**: Check `helper_profiles.business_hours` JSON format. Should be like:
  ```json
  {
    "monday": { "start": "09:00", "end": "17:00" },
    "tuesday": { "start": "09:00", "end": "17:00" },
    ...
    "sunday": { "closed": true }
  }
  ```

## 📊 Monitoring

Add these metrics to your monitoring dashboard:

```sql
-- Total booking requests created
SELECT COUNT(*) FROM booking_requests;

-- Acceptance rate
SELECT 
  status,
  COUNT(*) as count
FROM booking_requests
GROUP BY status;

-- Conversion to jobs
SELECT COUNT(*) as converted_to_jobs
FROM booking_requests
WHERE converted_to_job_id IS NOT NULL;

-- Average time to response
SELECT
  AVG(EXTRACT(EPOCH FROM (accepted_at - created_at))) / 3600 as avg_hours_to_accept
FROM booking_requests
WHERE accepted_at IS NOT NULL;
```

## ✨ Next Steps

1. **Follow Phase 1-5** in order (Core + Translation)
2. **Run Phase 6 tests** thoroughly
3. **Deploy to production**
4. **Monitor metrics** from the SQL queries above
5. **Implement Phase 7** (Notifications) as needed
6. **Add Phase 8 features** based on user feedback

Good luck! 🎉
