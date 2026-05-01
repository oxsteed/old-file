# OxSteed Error Handling Improvement Guide

**Last Updated:** 2026-04-30  
**Status:** Implementation in Progress  
**Priority:** CRITICAL for Production

---

## Problem Statement

Your error handling was showing generic messages like **"Error onboarding agent"** instead of revealing the actual underlying error. This makes debugging impossible for users and developers alike.

### Example: Agent Onboarding
```javascript
// BEFORE: Generic error, no details
} catch (err) {
  console.error('Failed to onboard agent:', err);
  alert('Error onboarding agent');  // User sees nothing useful
}
```

**Why this fails:**
1. Real error details logged only to browser console (user doesn't see)
2. Alert shows generic message (no help understanding what went wrong)
3. Developers can't debug without access to user's browser console
4. Backend endpoint didn't even exist (but frontend had no way to know)

---

## Solution: Multi-Layer Error Handling

### Layer 1: Frontend Error Capture (Detailed)

**File:** `client/src/admin/pages/SupportAgentOnboarding.jsx`

```javascript
const [error, setError] = useState(null);

const handleSubmit = async () => {
  setLoading(true);
  setError(null);  // Clear previous errors

  try {
    // Validate before submission
    if (!formData.first_name || !formData.last_name) {
      setError('First name and last name are required');
      return;
    }

    // Make request
    const response = await adminApi.post(`/api/support/agents/onboard`, {
      ...formData,
      business_id: businessId,
    });

    // Success handling
    alert('Agent onboarded successfully!');
    resetForm();
    
  } catch (err) {
    // Extract actual error message from response
    let errorMessage = 'Error onboarding agent';

    if (err.response?.data?.message) {
      errorMessage = err.response.data.message;  // From backend
    } else if (err.response?.status === 404) {
      errorMessage = 'Server endpoint not found. Please contact support.';
    } else if (err.response?.status === 400) {
      errorMessage = 'Invalid data. Please check the form.';
    } else if (err.response?.status === 401) {
      errorMessage = 'You are not authorized for this action.';
    } else if (err.response?.status === 500) {
      errorMessage = 'Server error. Try again later.';
    } else if (err.message === 'Network Error') {
      errorMessage = 'Network error. Check your connection.';
    }

    // Log full error for developer debugging
    console.error('Full error details:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });

    // Show to user
    setError(errorMessage);
  }
};
```

### Layer 2: Frontend Error Display (User-Friendly)

```jsx
{error && (
  <div className="mb-6 p-4 bg-red-900/20 border border-red-700 rounded-lg flex items-start gap-3">
    <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
    <div>
      <p className="text-red-300 font-medium">Error</p>
      <p className="text-red-200 text-sm mt-1">{error}</p>
      <p className="text-red-400 text-xs mt-2">
        Check browser console (F12) for more details if this persists.
      </p>
    </div>
  </div>
)}
```

**Key improvements:**
- ✅ Shows error on page (not in alert)
- ✅ User-friendly messaging (not technical jargon)
- ✅ Suggests debugging step (console check)
- ✅ Full details logged to console for developers

---

### Layer 3: Backend Validation & Error Responses

**File:** `server/controllers/agentOnboardingController.js`

```javascript
async function onboardAgent(req, res, next) {
  try {
    const {
      business_id,
      first_name,
      last_name,
      email,
      timezone,
      availability_start,
      availability_end,
      skills = [],
      languages = [],
      experience_level = 'junior'
    } = req.body;

    // Step 1: Validate all fields
    const validationErrors = {};
    if (!business_id) validationErrors.business_id = 'Business ID is required';
    if (!first_name) validationErrors.first_name = 'First name is required';
    if (!last_name) validationErrors.last_name = 'Last name is required';
    if (!email) validationErrors.email = 'Email is required';
    if (!timezone) validationErrors.timezone = 'Timezone is required';
    if (!availability_start) validationErrors.availability_start = 'Start time required';
    if (!availability_end) validationErrors.availability_end = 'End time required';
    if (!Array.isArray(skills) || skills.length === 0) {
      validationErrors.skills = 'At least one skill must be selected';
    }

    if (Object.keys(validationErrors).length > 0) {
      return sendValidationError(res, validationErrors);
    }

    // Step 2: Check permissions
    const businessAccess = await query(
      'SELECT id FROM businesses WHERE id = $1 AND (owner_id = $2 OR admin_user_ids @> $3)',
      [business_id, req.user.id, JSON.stringify([req.user.id])]
    );

    if (!businessAccess.rows.length) {
      return sendError(res, 403, 'You do not have access to this business');
    }

    // Step 3: Check for duplicates
    const existingAgent = await query(
      `SELECT sa.id FROM support_agents sa
       JOIN users u ON sa.user_id = u.id
       WHERE sa.business_id = $1 AND u.email = $2`,
      [business_id, email]
    );

    if (existingAgent.rows.length) {
      return sendError(res, 400, 'An agent with this email already exists');
    }

    // Step 4: Execute (with error handling)
    const agentResult = await query(
      `INSERT INTO support_agents (...) VALUES (...) RETURNING *`,
      [/* params */]
    );

    // Success
    logger.info('Agent onboarded successfully', {
      agentId: agentResult.rows[0].id,
      userId,
      businessId: business_id,
      email,
      adminId: req.user.id
    });

    res.json({
      success: true,
      data: {
        agent: agentResult.rows[0],
        message: 'Agent onboarded successfully'
      }
    });

  } catch (err) {
    // Log full error with context
    logger.error('onboardAgent error', {
      error: err.message,
      code: err.code,      // PostgreSQL error code
      detail: err.detail,  // PostgreSQL error detail
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // Handle specific database errors
    if (err.code === '23505') {  // Unique constraint
      return sendError(res, 400, 'This email is already registered');
    }
    if (err.code === '23503') {  // Foreign key
      return sendError(res, 400, 'Invalid business ID or reference');
    }

    // Generic error
    sendError(res, 500, 'Failed to onboard agent. Please try again.');
  }
}
```

**Key improvements:**
- ✅ Validates all fields before processing
- ✅ Specific error messages for each issue
- ✅ Checks permissions explicitly
- ✅ Handles database errors with meaningful messages
- ✅ Logs full error details for debugging
- ✅ Returns 400 (bad request) for validation, 403 (forbidden) for permissions, 500 for server errors

---

## Error Handling Patterns

### Pattern 1: Validation Errors (400 Bad Request)

```javascript
// ❌ Bad
if (!email) {
  return res.status(400).json({ error: 'Email required' });
}

// ✅ Good
const validationErrors = {};
if (!email) validationErrors.email = 'Email is required';
if (!password) validationErrors.password = 'Password is required';

if (Object.keys(validationErrors).length > 0) {
  return sendValidationError(res, validationErrors);
}
```

**Response format:**
```json
{
  "success": false,
  "errors": {
    "email": "Email is required",
    "password": "Must be at least 8 characters"
  }
}
```

### Pattern 2: Permission Errors (403 Forbidden)

```javascript
// Check if user owns resource
const owned = await query(
  'SELECT id FROM resources WHERE id = $1 AND owner_id = $2',
  [resourceId, req.user.id]
);

if (!owned.rows.length) {
  return sendError(res, 403, 'You do not have access to this resource');
}
```

### Pattern 3: Not Found Errors (404)

```javascript
const result = await query('SELECT * FROM items WHERE id = $1', [itemId]);

if (!result.rows.length) {
  return sendError(res, 404, 'Item not found');
}
```

### Pattern 4: Conflict Errors (409)

```javascript
// Check if already exists
const existing = await query(
  'SELECT id FROM users WHERE email = $1',
  [email]
);

if (existing.rows.length) {
  return sendError(res, 409, 'Email is already registered');
}
```

### Pattern 5: Server Errors with Context (500)

```javascript
try {
  // operation
} catch (err) {
  logger.error('Operation failed', {
    error: err.message,
    code: err.code,
    detail: err.detail,
    context: { userId, resourceId }  // Add relevant context
  });

  sendError(res, 500, 'Operation failed. Please try again.');
}
```

---

## Frontend Error Handling Checklist

### Every API Call Should:

- [ ] Show loading state while request is pending
- [ ] Display error message on failure (not just console)
- [ ] Include error details in console for debugging
- [ ] Extract error from `err.response?.data?.message`
- [ ] Handle specific status codes (404, 403, 500, etc.)
- [ ] Show recovery suggestions to user ("Check your connection", "Try again", etc.)
- [ ] Log full error object: `console.error({ status, data, message, fullError })`

### Example Template:

```javascript
const handleAction = async () => {
  setLoading(true);
  setError(null);

  try {
    // Validation
    if (!requiredField) {
      setError('Required field missing');
      setLoading(false);
      return;
    }

    // Request
    const response = await api.post('/endpoint', data);

    // Success
    setError(null);
    // Handle success...

  } catch (err) {
    // Extract message
    let errorMessage = 'Operation failed';
    if (err.response?.data?.message) {
      errorMessage = err.response.data.message;
    } else if (err.response?.status === 404) {
      errorMessage = 'Not found. Refresh and try again.';
    } else if (err.response?.status === 403) {
      errorMessage = 'You do not have permission.';
    } else if (err.message === 'Network Error') {
      errorMessage = 'Network error. Check your connection.';
    }

    // Log for debugging
    console.error('API Error:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });

    setError(errorMessage);

  } finally {
    setLoading(false);
  }
};
```

---

## Backend Error Handling Checklist

### Every Controller Function Should:

- [ ] Validate all required inputs at start
- [ ] Return specific HTTP status codes (400, 403, 404, 409, 500)
- [ ] Use `sendValidationError()` for field-level errors
- [ ] Use `sendError()` for other errors with status code
- [ ] Log errors with full context using `logger.error()`
- [ ] Handle known database error codes (23505, 23503, etc.)
- [ ] Not expose sensitive error details in production
- [ ] Include operation name in error logs

### Example Structure:

```javascript
async function doSomething(req, res, next) {
  try {
    // 1. Validate
    const validationErrors = {};
    if (!req.body.name) validationErrors.name = 'Name required';
    if (Object.keys(validationErrors).length > 0) {
      return sendValidationError(res, validationErrors);
    }

    // 2. Check permissions
    const owned = await query(
      'SELECT id FROM resources WHERE id = $1 AND owner_id = $2',
      [req.body.resourceId, req.user.id]
    );
    if (!owned.rows.length) {
      return sendError(res, 403, 'Access denied');
    }

    // 3. Check for conflicts
    const exists = await query(
      'SELECT id FROM items WHERE unique_field = $1',
      [req.body.unique_field]
    );
    if (exists.rows.length) {
      return sendError(res, 409, 'Item already exists');
    }

    // 4. Execute
    const result = await query('INSERT ... RETURNING *', [params]);

    // 5. Log success
    logger.info('Operation successful', {
      resourceId: result.rows[0].id,
      userId: req.user.id
    });

    // 6. Return result
    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    // 7. Log error with context
    logger.error('doSomething error', {
      error: err.message,
      code: err.code,
      userId: req.user.id,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // 8. Handle known error codes
    if (err.code === '23505') {
      return sendError(res, 409, 'Unique constraint violation');
    }

    // 9. Generic error
    sendError(res, 500, 'Operation failed');
  }
}
```

---

## Error Codes Reference

### HTTP Status Codes to Use

| Code | Meaning | Example |
|------|---------|---------|
| 400 | Bad Request | Missing required field, invalid email format |
| 401 | Unauthorized | JWT expired, not logged in |
| 403 | Forbidden | User doesn't have permission to access resource |
| 404 | Not Found | Item doesn't exist |
| 409 | Conflict | Email already registered, duplicate entry |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Database connection failed, unhandled exception |
| 503 | Service Unavailable | Database is down, service temporarily offline |

### PostgreSQL Error Codes to Handle

| Code | Meaning | HTTP Response |
|------|---------|---------------|
| 23505 | Unique constraint violation | 409 Conflict |
| 23503 | Foreign key violation | 400 Bad Request |
| 22001 | String data too long | 400 Bad Request |
| 22P02 | Invalid text representation | 400 Bad Request |

---

## Monitoring & Debugging

### Check Browser Console (F12)

Your improved error logs should appear in the browser console:
```javascript
// ✅ Good logging
console.error('Full error details:', {
  status: 404,
  data: { message: 'Agent not found' },
  message: 'Not Found'
});
```

### Check Server Logs

Enable structured logging:
```bash
LOG_LEVEL=debug npm start
```

Look for:
```
logger.error('onboardAgent error', {
  error: 'Duplicate key value',
  code: '23505',
  userId: 'user_123'
});
```

### Use Request ID for Tracing

Every error is tagged with a request ID:
```javascript
// In error log
logger.error('Operation failed', {
  requestId: 'req_abc123',
  error: err.message
});
```

Filter logs by request ID to see the full flow.

---

## Migration Checklist

### Phase 1: Critical Components (THIS WEEK)

- [x] Fix `SupportAgentOnboarding.jsx` error handling
- [x] Create missing `/api/support/agents/onboard` endpoint
- [x] Improve error display with user-friendly messages
- [ ] Test with real failures (invalid email, missing field, etc.)

### Phase 2: Expand Pattern (NEXT WEEK)

- [ ] Apply pattern to 5 more high-usage components
- [ ] Update corresponding backend controllers
- [ ] Test each implementation
- [ ] Document in team wiki

### Phase 3: Complete Coverage (MONTH 1)

- [ ] Apply pattern to all 240+ components
- [ ] Ensure all controllers use standardized errors
- [ ] Set up error tracking (Sentry/Datadog)
- [ ] Monitor error patterns in production

---

## Testing Your Error Handling

### Test Validation Errors
```javascript
// Submit form without required field
// Expected: "First name is required" message on page
```

### Test 404 Errors
```javascript
// Try to onboard with invalid business_id
// Expected: "Not found" message
```

### Test Permission Errors
```javascript
// Try to onboard as non-admin user
// Expected: "You do not have permission" message
```

### Test Network Errors
```javascript
// Disconnect network, submit form
// Expected: "Network error" message with retry option
```

---

## Resources

- **Error Utilities:** `server/utils/apiError.js` (sendError, sendValidationError, sendSuccess)
- **Error Handler:** `server/middleware/errorHandler.js` (catches unhandled errors)
- **Logger:** `server/utils/logger.js` (structured logging)
- **Frontend Logger:** `client/src/utils/frontendLogger.js` (client-side logging)
- **Error Classifier:** `client/src/utils/errorClassifier.js` (maps HTTP errors to types)

---

## Questions?

- **"What if the backend endpoint changes?"** → Error will be 404, user sees "Endpoint not found"
- **"What if the network times out?"** → Handled as Network Error
- **"What if the database is down?"** → Returns 500, logs full error details
- **"How do I add a new error type?"** → Add case to catch block, add HTTP status code, log with context

---

**Next Steps:**
1. Test the agent onboarding page with these improvements
2. Try to trigger errors (invalid email, missing field, no permission)
3. Verify error messages appear and are helpful
4. Check browser console for full details
5. Report any remaining issues

