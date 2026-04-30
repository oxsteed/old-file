# Error Codes Reference — OxSteed

Complete reference of all error codes used throughout the application.

---

## Authentication Errors (401, 403)

| Code | Status | Meaning | User Message | Action |
|------|--------|---------|--------------|--------|
| `no_token` | 401 | Token missing from localStorage | "Your session has expired. Please log in again." | Redirect to /login |
| `auth_expired` | 401 | Token exists but server rejects it | "Your session has expired. Redirecting to login..." | Clear localStorage, redirect to /login |
| `invalid_token` | 401 | JWT signature invalid or corrupted | "Invalid authentication token." | Redirect to /login |
| `token_expired` | 401 | JWT exp claim in the past | "Your token has expired. Please log in again." | Redirect to /login |
| `forbidden` | 403 | User authenticated but not authorized | "You do not have permission to perform this action." | Show error, no redirect |
| `requires_verification` | 401 | User must verify email/identity | "Please verify your identity to continue." | Redirect to /verify |

---

## Validation Errors (400)

| Code | Status | Meaning | Example Fields | User Message |
|------|--------|---------|-----------------|--------------|
| `validation_failed` | 400 | One or more fields invalid | `{title: "Too short", budget: "Must be > 0"}` | "Please check the form and try again." |
| `missing_field` | 400 | Required field not provided | `{email: "Email is required"}` | "Please fill in all required fields." |
| `invalid_format` | 400 | Field format incorrect | `{email: "Invalid email format"}` | Show field-specific error |
| `value_too_long` | 400 | Field exceeds max length | `{title: "Max 200 characters"}` | Show field-specific error |
| `value_too_short` | 400 | Field below min length | `{title: "Min 10 characters"}` | Show field-specific error |
| `invalid_enum` | 400 | Field value not in allowed set | `{status: "Invalid status"}` | Show allowed values |

---

## Resource Errors (404, 409)

| Code | Status | Meaning | User Message | Action |
|------|--------|---------|--------------|--------|
| `not_found` | 404 | Resource does not exist | "The resource you are looking for does not exist." | Show error, go back |
| `job_not_found` | 404 | Specific job missing | "This job no longer exists." | Redirect to /jobs |
| `user_not_found` | 404 | User account missing | "User not found." | Show error |
| `conflict` | 409 | Resource already exists | "This resource already exists." | Show error, no retry |
| `already_exists` | 409 | Specific resource conflict | "This email is already registered." | Show field error |
| `duplicate_entry` | 409 | Uniqueness constraint violated | `{email: "Already in use"}` | Show field error |

---

## Business Logic Errors (400, 422)

| Code | Status | Meaning | Example | User Message |
|------|--------|---------|---------|--------------|
| `insufficient_balance` | 400 | User has insufficient funds | Posting paid job without credits | "You don't have enough credits for this action." |
| `subscription_expired` | 400 | User subscription inactive | Accessing Pro feature | "Your subscription has expired. Please renew." |
| `tier_required` | 400 | User tier too low | Free user posting Tier 3 job | "This feature requires a paid subscription." |
| `job_in_progress` | 400 | Cannot modify job status | Edit while in_progress | "Cannot modify job while in progress." |
| `bid_already_exists` | 409 | User already bid on job | Double-bid attempt | "You have already bid on this job." |
| `status_transition_invalid` | 400 | Invalid status change | Move from completed → in_progress | "Invalid action for this job status." |
| `dispute_open` | 400 | Payment dispute blocks action | Try to release escrow | "Cannot complete job while dispute is open." |
| `payment_failed` | 400 | Payment processing error | Stripe charge failed | "Payment failed. Please check your card and try again." |

---

## File & Upload Errors (400, 413)

| Code | Status | Meaning | User Message | Action |
|------|--------|---------|--------------|--------|
| `file_too_large` | 413 | File exceeds size limit | "File size exceeds 10MB limit." | Show error, try another file |
| `invalid_file_type` | 400 | Unsupported file format | "File type not supported. Use JPG, PNG, or PDF." | Show error, try another file |
| `too_many_files` | 400 | Exceeded file count limit | "Maximum 5 files allowed." | Show error, remove files |
| `file_upload_failed` | 500 | Upload to S3 or storage failed | "Failed to upload file. Please try again." | Retry available |
| `file_processing_failed` | 500 | File processing error | "Failed to process file. Please try again." | Retry available |

---

## Network & Availability Errors

| Code | Status | Meaning | User Message | Action |
|------|--------|---------|--------------|--------|
| `network_error` | 0 | Network unreachable | "Network error. Please check your connection." | Retry with backoff |
| `timeout` | 0 | Request timeout | "Request timeout. Please try again." | Retry with backoff |
| `no_response` | 0 | No server response | "Unable to reach the server." | Retry with backoff |
| `rate_limited` | 429 | Rate limit exceeded | "Too many requests. Please wait a moment." | Retry with exponential backoff |
| `service_unavailable` | 503 | Server temporarily down | "Service temporarily unavailable. Please try again later." | Retry after delay |

---

## Server Errors (5xx)

| Code | Status | Meaning | User Message | Action |
|------|--------|---------|--------------|--------|
| `internal_error` | 500 | Unhandled server exception | "Internal server error. Our team has been notified." | Retry available, log error |
| `db_error` | 500 | Database connection or query error | "Internal server error. Please try again later." | Retry available |
| `external_service_error` | 500 | Third-party service failed (Stripe, Twilio, etc.) | "Service error. Please try again later." | Retry available |
| `stripe_error` | 500 | Stripe API error | "Payment processing failed. Please try again." | Retry available |
| `email_send_failed` | 500 | Email delivery failed | "Failed to send email. We'll try again." | Automatic retry (no user action) |
| `sms_send_failed` | 500 | SMS delivery failed | "Failed to send SMS. We'll try again." | Automatic retry (no user action) |

---

## Frontend-Only Errors

| Code | Type | Meaning | User Message |
|------|------|---------|--------------|
| `unknown` | unknown | Error structure unrecognized | "An unexpected error occurred. Please try again." |
| `json_parse_error` | unknown | Response JSON invalid | "Invalid response from server. Please try again." |
| `state_error` | unknown | Invalid component state | "Application error. Please refresh the page." |

---

## Error Code Patterns

### By HTTP Status

**4xx Client Errors:**
- `4XX_*` — Client-side issue (validation, auth, not found)
- Examples: `validation_failed`, `no_token`, `not_found`

**5xx Server Errors:**
- `*_error` — Server-side issue (database, external service)
- Examples: `db_error`, `stripe_error`, `internal_error`

### By Domain

**Auth:** `auth_*`, `no_token`, `forbidden`, `requires_verification`

**Jobs:** `job_*`, `invalid_status`, `status_transition_invalid`

**Payments:** `payment_*`, `insufficient_balance`, `stripe_error`

**Files:** `file_*`, `upload_*`

**Notifications:** `email_*`, `sms_*`

---

## Usage in Code

### Backend (Throwing Errors)

```javascript
// Single field validation
if (!email) {
  throw new AppError(
    'Email is required',
    400,
    'missing_field',
    { email: 'Email is required' }
  );
}

// Multiple field validation
const fields = {};
if (!title) fields.title = 'Title is required';
if (!description) fields.description = 'Description is required';
if (Object.keys(fields).length) {
  throw new AppError('Validation failed', 400, 'validation_failed', fields);
}

// Business logic error
if (job.status !== 'in_progress') {
  throw new AppError(
    'Cannot complete job - invalid status',
    400,
    'status_transition_invalid'
  );
}

// Auth error
if (!token) {
  throw new AppError('Token required', 401, 'no_token');
}
```

### Frontend (Handling Errors)

```javascript
import { classifyError } from './utils/errorClassifier';

try {
  await api.post('/jobs', data);
} catch (err) {
  const classified = classifyError(err);

  if (classified.type === 'validation') {
    // Show field errors
    setErrors(classified.fields);
  } else if (classified.type === 'auth') {
    // Redirect to login
    navigate('/login');
  } else if (classified.type === 'network') {
    // Allow retry
    showRetryButton();
  } else {
    // Show generic error
    toast.error(classified.message);
  }

  logger.error('Job creation failed', {
    code: classified.code,
    fields: classified.fields,
  });
}
```

---

## Common Error Scenarios

### Scenario: User Posts Job with Invalid Title

**Backend:**
```javascript
throw new AppError(
  'Validation failed',
  400,
  'validation_failed',
  { title: 'Title must be at least 10 characters' }
);
```

**Response:**
```json
{
  "error": "Validation failed",
  "code": "validation_failed",
  "status": 400,
  "timestamp": "2026-04-30T12:00:00Z",
  "requestId": "req_123",
  "fields": {
    "title": "Title must be at least 10 characters"
  }
}
```

**Frontend:**
```javascript
const classified = classifyError(err);
// classified.type === 'validation'
// classified.fields === { title: 'Title must be at least 10 characters' }
setErrors(classified.fields);  // Show field error in form
```

### Scenario: User Session Expires

**Backend:**
```javascript
throw new AppError(
  'Your session has expired. Please log in again.',
  401,
  'auth_expired'
);
```

**Frontend:**
```javascript
const classified = classifyError(err);
// classified.type === 'auth'
// classified.shouldRedirect === '/login'
navigate('/login');
toast.info(classified.message);
```

### Scenario: Network Timeout

**Frontend:**
```javascript
const classified = classifyError(err);
// classified.type === 'network'
// classified.retryable === true
// classified.message === 'Request timeout. Please try again.'
showRetryButton();
```

---

## Adding New Error Codes

When adding a new error code:

1. **Add to this document** — Document the code, status, meaning, and user message
2. **Use in backend** — Throw with `AppError`
3. **Handle in frontend** — Use `classifyError()` and handle the type
4. **Test scenarios** — Create test case for the error condition
5. **Document in runbook** — If it requires operations action

