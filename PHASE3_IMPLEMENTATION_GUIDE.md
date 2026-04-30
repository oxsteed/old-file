# Phase 3 Implementation Guide: Error Handling for Remaining Controllers & Frontend

**Status:** In Progress (1/65 controllers complete)  
**Last Updated:** 2026-04-30  

---

## Quick Reference: Update Pattern

### For Backend Controllers

```javascript
// 1. ADD IMPORT AT TOP
const { AppError } = require('../middleware/errorHandler');

// 2. ADD next PARAMETER TO EVERY ASYNC FUNCTION
exports.endpoint = async (req, res, next) => {  // <-- ADD next
  try {
    // Validation with field errors
    const fields = {};
    if (!data) fields.fieldName = 'Error message';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Authorization checks
    if (condition) {
      throw new AppError('Not authorized', 403, 'forbidden');
    }

    // Not found checks
    const record = await db.query(...);
    if (!record.rows[0]) {
      throw new AppError('Resource not found', 404, 'not_found');
    }

    // Business logic
    res.json(result);
  } catch (error) {
    next(error);  // <-- ALWAYS PASS TO ERROR HANDLER
  }
};
```

### For Frontend Pages (React)

```javascript
// 1. IMPORT AT TOP
import { classifyError } from '../utils/errorClassifier';
import logger from '../utils/frontendLogger';

// 2. IN CATCH BLOCK
try {
  const result = await api.post('/endpoint', data);
  logger.info('Success', { action: 'create', id: result.id });
} catch (err) {
  const classified = classifyError(err);
  
  // Validation: show field errors
  if (classified.type === 'validation') {
    setErrors(classified.fields);  // {fieldName: 'Error message', ...}
  }
  
  // Auth: redirect to login
  else if (classified.type === 'auth') {
    navigate('/login');
  }
  
  // Not found: go back
  else if (classified.type === 'not_found') {
    navigate(-1);
  }
  
  // Other: show generic error
  else {
    setError(classified.message);
  }
  
  logger.error('Operation failed', {
    code: classified.code,
    type: classified.type,
    fields: classified.fields
  });
}
```

---

## Controllers to Update (Priority Order)

### Tier 1: Critical User Paths (20 controllers)

1. **reviewController.js** - Reviews (core marketplace)
2. **disputeController.js** - Disputes (high-value, complex)
3. **verificationController.js** - Identity verification
4. **marketplaceController.js** - Marketplace listings
5. **helperController.js / helpersController.js** - Helper profiles
6. **notificationController.js** - Notifications
7. **businessController.js** - Business management
8. **shoppingCartsController.js** - Shopping carts
9. **chatController.js** - Messaging (if separate from messageController)
10. **subscriptionController.js** - Subscriptions
11. **referralController.js** - Referral program
12. **appointmentController.js** - Appointments
13. **calendarNotificationController.js** - Calendar notifications
14. **toolBookingsController.js** - Tool bookings
15. **paymentMethodController.js** - Payment methods
16. **availabilityController.js** - Availability
17. **settingsPrivacyController.js** - Privacy settings
18. **termsController.js** - Terms/Policies
19. **twoFactorController.js** - 2FA
20. **userReportController.js** - Reporting

### Tier 2: Admin & Analytics (15 controllers)

- adminController.js, superAdminController.js
- adminMessageController.js, adminOrdersController.js
- adminProductsController.js, adminConsultingController.js
- performanceAnalyticsController.js, toolAnalyticsController.js
- consultingAnalyticsController.js, auditController.js
- slaMetricsController.js, smsNotificationController.js
- webPushController.js, skillBasedRoutingController.js

### Tier 3: Consulting & Specialized (20+ controllers)

- consultingActionItemsController.js
- allPhasesConsultingController.js
- consultantSchedulingController.js
- plannedNeedsController.js
- businessMembersController.js
- businessSkillsController.js
- etc.

---

## Error Codes Reference

### Common Error Codes to Use

```
Validation:
- validation_failed (400) - Field-level errors in fields object
- missing_field (400) - Single required field missing
- invalid_format (400) - Format validation failed

Authorization:
- forbidden (403) - User not authorized
- no_auth (401) - No authentication provided
- insufficient_permission (403) - User lacks required permission

Resources:
- not_found (404) - Resource doesn't exist
- already_exists (409) - Resource already exists
- invalid_state (400) - Resource in invalid state for operation
- conflict (409) - Operation conflicts with existing data

Business Logic:
- status_mismatch (400) - Current status doesn't allow operation
- insufficient_balance (400) - Not enough funds/quota
- limit_exceeded (429) - Rate limit or quota exceeded
- operation_not_allowed (403) - Business rule violation

Server:
- database_error (500) - Database operation failed
- external_service_error (502) - Third-party service error
- processing_error (500) - Unexpected server error
```

---

## Testing Checklist for Each Controller Update

For each controller, verify:

- [ ] AppError import added
- [ ] All exported functions have `next` parameter
- [ ] All manual `res.status().json()` replaced with `throw new AppError()`
- [ ] All catch blocks use `next(error)`
- [ ] Validation errors include field-level details
- [ ] 404 errors use correct error code
- [ ] Authorization checks use 403 forbidden
- [ ] Status validation errors use correct code
- [ ] Concurrency errors handled (e.g., race conditions)

---

## Frontend Pages to Update (Sample List)

Priority pages (50+ total):

1. **Auth Pages:**
   - LoginPage.jsx
   - RegisterPage.jsx
   - ResetPasswordPage.jsx

2. **Job Pages:**
   - PostJobPage.jsx (DONE in Phase 0)
   - JobDetailPage.jsx
   - BidPage.jsx
   - MyJobsPage.jsx

3. **Marketplace Pages:**
   - MarketplaceListingPage.jsx
   - ProductDetailPage.jsx
   - CheckoutPage.jsx (DONE in Phase 1)
   - OrderHistoryPage.jsx (DONE in Phase 1)

4. **Profile Pages:**
   - HelperProfilePage.jsx
   - CustomerProfilePage.jsx
   - SettingsPage.jsx

5. **Support/Chat Pages:**
   - ChatPage.jsx
   - SupportTicketsPage.jsx
   - ReviewPage.jsx

---

## Common Pitfalls to Avoid

1. **Don't forget `next` parameter** — If you forget, errors won't reach the error handler
2. **Don't mix patterns** — Use AppError everywhere, don't mix with manual responses
3. **Field errors in validation only** — Only 400 errors should include `fields` object
4. **Don't catch and swallow errors** — Always pass to next(err)
5. **Don't change error codes** — Use standardized codes from the reference above
6. **Don't log after throwing** — Error handler will log it; avoid duplicate logs

---

## Efficiency Tips

1. **Use find-and-replace** — Many patterns can be batch-updated with regex
2. **Template controller updates** — Copy a completed controller as template
3. **Test one function at a time** — Update single function, test, then move to next
4. **Batch similar errors** — Update all 404 errors, then all 403 errors, etc.
5. **Frontend automation** — Consider script to batch-update common patterns

---

## Progress Tracking

As you complete controllers, update this table:

| Controller | Status | Functions | Date |
|-----------|--------|-----------|------|
| authController.js | ✅ DONE | 3 | 2026-04-30 |
| jobController.js | ✅ DONE | 8 | 2026-04-30 |
| paymentController.js | ✅ DONE | 3 | 2026-04-30 |
| bidController.js | ✅ DONE | 6 | 2026-04-30 |
| reviewController.js | ⏳ TODO | 4 | — |
| disputeController.js | ⏳ TODO | 5 | — |
| verificationController.js | ⏳ TODO | 3 | — |
| ... | ... | ... | ... |

---

## Next Session: Start Here

1. Pick next controller from Tier 1 (reviewController.js is good next)
2. Read this guide
3. Apply pattern systematically
4. Test and verify
5. Update progress table above
6. Move to next controller

Each controller typically takes 15-30 minutes to update depending on complexity.
