# Comprehensive Error Handling Strategy — OxSteed

**Status:** ✅ STRATEGY DOCUMENT  
**Last Updated:** 2026-04-30  
**Scope:** Frontend + Backend error handling, logging, and user feedback

---

## Executive Summary

Error handling is currently **inconsistent and incomplete** across the codebase:

- **Frontend:** 206 `setError` calls with varying patterns; 163 `console.*` statements (should use structured logger)
- **Backend:** Basic error utilities exist but many controllers don't use them consistently; empty catch blocks
- **Logging:** Backend has structured logging (logger.js), but frontend uses `console` directly
- **User Feedback:** Generic error messages prevent debugging; field-level errors often hidden

**Goal:** Create unified, testable error handling that:
1. ✅ Prevents silent failures
2. ✅ Provides actionable user feedback
3. ✅ Logs sufficient context for debugging
4. ✅ Handles edge cases (network, auth, validation, server)

---

## Current State Analysis

### Frontend Errors

**Issues Identified:**

| Issue | Count | Impact | Example |
|-------|-------|--------|---------|
| Bare `setError()` with generic message | 80+ | User confusion | "Failed to post job" (no context) |
| `console.log/error/warn` instead of structured logging | 163 | Hard to aggregate/search logs | `console.error('error:', err)` |
| Missing error context in catch blocks | 50+ | Impossible to debug | `catch (err) { setError('Failed') }` |
| Swallowed errors (no catch block) | 30+ | Silent failures | `api.delete(...).catch(() => {})` |
| Race condition in error states | 15+ | UI corruption | Multiple setError calls collide |
| No distinction between error types | 100+ | Poor UX | Auth error treated like network error |

**Example Problem (Current):**
```javascript
// Bad: No context, generic message
try {
  await createJob(formData);
} catch (err) {
  setError('Failed to post job');
}

// Result: User sees "Failed to post job" for:
// - Missing token
// - Invalid budget amount
// - File too large
// - Network timeout
// - Server error
```

### Backend Errors

**Issues Identified:**

| Issue | Count | Impact | Example |
|-------|-------|--------|---------|
| Inconsistent error response shapes | 20+ | Frontend parsing breaks | Some return `{error}`, some `{message}` |
| Missing HTTP status codes | 15+ | Client can't differentiate | Returns 500 for 400 validation |
| No request context in logs | 40+ | Can't debug production issues | Logs lack user_id, request_id |
| Silent failures in async tasks | 10+ | Data corruption | `.catch(() => {})` in background jobs |
| No structured error codes | 30+ | Can't retry intelligently | Only error strings, no codes |
| Missing validation error details | 25+ | User confusion | Returns `{error: 'validation_failed'}` without field info |

**Example Problem (Current):**
```javascript
// Backend validation
if (!title || title.length < 10) {
  return res.status(400).json({ 
    error: 'validation_failed', 
    fields: { title: 'Too short' } 
  });
}

// Frontend only reads error, ignores fields
const msg = err?.response?.data?.error;  // Gets 'validation_failed'
// Fields are lost! User doesn't know which field failed
```

---

## New Error Handling Framework

### 1. Frontend Error Handling Architecture

#### A. Error Classification Layer

```typescript
// client/src/utils/errorClassifier.ts
type ErrorType = 
  | 'auth'           // JWT expired, no token
  | 'validation'     // Form validation, field errors
  | 'not_found'      // 404, resource missing
  | 'conflict'       // 409, already exists
  | 'network'        // Connection timeout, offline
  | 'server'         // 5xx errors
  | 'unknown';       // Unexpected error

interface ClassifiedError {
  type: ErrorType;
  statusCode: number;
  message: string;       // User-facing message
  code?: string;         // Machine-readable code
  fields?: Record<string, string>;  // Validation errors
  retryable: boolean;
  shouldRedirect?: string;
}

function classifyError(err: any): ClassifiedError {
  // Check error type and return structured classification
  // Handle:
  // - 401 → type: 'auth'
  // - 400 with fields → type: 'validation'
  // - 404 → type: 'not_found'
  // - Network errors → type: 'network'
  // - 5xx → type: 'server'
}
```

#### B. Structured Frontend Logging

```typescript
// client/src/utils/frontendLogger.ts
class FrontendLogger {
  error(message: string, context: any) {
    const entry = {
      ts: new Date().toISOString(),
      level: 'ERROR',
      msg: message,
      ...context,
    };
    // In dev: console.log
    // In prod: send to Sentry/Datadog
  }
  
  warn(message: string, context: any) { /* similar */ }
  info(message: string, context: any) { /* similar */ }
}
```

#### C. Error Handling Pattern (React Hooks)

```typescript
// Before (Bad)
try {
  await createJob(data);
} catch (err) {
  setError('Failed to create job');
}

// After (Good)
try {
  await createJob(data);
  showSuccess('Job created successfully');
} catch (err) {
  const classified = classifyError(err);
  logger.error('Job creation failed', { 
    code: classified.code, 
    fields: classified.fields,
    originalError: err 
  });
  
  if (classified.type === 'validation') {
    setErrors(classified.fields);  // Show field-level errors
  } else if (classified.type === 'auth') {
    setError('Your session expired. Redirecting to login...');
    setTimeout(() => navigate('/login'), 2000);
  } else if (classified.type === 'network') {
    setError('Network error. Please check your connection.');
  } else {
    setError(classified.message);  // User-friendly message
  }
}
```

#### D. API Hook Pattern

```typescript
// client/src/hooks/useAPI.ts
function useAPI<T>(
  apiCall: () => Promise<T>,
  options?: {
    onError?: (classified: ClassifiedError) => void;
    shouldRetry?: (err: ClassifiedError) => boolean;
    retryCount?: number;
  }
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [loading, setLoading] = useState(false);
  
  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall();
      setData(result);
      return result;
    } catch (err) {
      const classified = classifyError(err);
      setError(classified);
      logger.error('API call failed', { 
        classified,
        originalError: err 
      });
      options?.onError?.(classified);
      throw classified;
    } finally {
      setLoading(false);
    }
  }, [apiCall, options]);
  
  return { data, error, loading, execute };
}

// Usage
const { execute: createJob, error } = useAPI(() => api.post('/jobs', data), {
  onError: (err) => {
    if (err.type === 'validation') {
      setErrors(err.fields);
    }
  }
});
```

#### E. Error Boundary Pattern

```typescript
// client/src/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: any) {
    const classified = classifyError(error);
    logger.error('React error boundary caught error', {
      classified,
      componentStack: info.componentStack,
    });
    
    this.setState({ error: classified });
    
    // Don't redirect on render errors
    // Only redirect on navigation errors
  }
}
```

---

### 2. Backend Error Handling Architecture

#### A. Enhanced Error Response Shape

```typescript
// server/utils/apiError.js (Enhanced)

interface ErrorResponse {
  error: string;           // Human-readable message
  code?: string;           // Machine-readable code (snake_case)
  status: number;          // HTTP status code (for debugging)
  fields?: Record<string, string>;  // Validation errors
  timestamp: string;       // ISO timestamp
  requestId?: string;      // For tracing
}

// Examples:
// Auth error:
{ error: 'Session expired', code: 'auth_expired', status: 401 }

// Validation error:
{ 
  error: 'Validation failed', 
  code: 'validation_failed',
  status: 400,
  fields: { title: 'Must be at least 10 chars', budget: 'Must be > 0' }
}

// Server error:
{ 
  error: 'Database connection failed', 
  code: 'db_error',
  status: 500,
  requestId: 'req_xyz123'
}
```

#### B. Structured Error Handling Middleware

```javascript
// server/middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  const requestId = req.id;  // Assigned by request middleware
  
  logger.error('Unhandled error in request', {
    requestId,
    userId: req.user?.id,
    method: req.method,
    path: req.path,
    statusCode: err.status || 500,
    code: err.code,
    message: err.message,
    stack: IS_DEV ? err.stack : undefined,
  });
  
  // Return consistent error response
  const status = err.status || 500;
  const code = err.code || 'internal_error';
  
  res.status(status).json({
    error: err.message || 'Internal server error',
    code,
    timestamp: new Date().toISOString(),
    requestId,
  });
}

app.use(errorHandler);
```

#### C. Consistent Error Throwing Pattern

```javascript
// server/utils/appError.js
class AppError extends Error {
  constructor(message, status = 500, code = 'internal_error', fields = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// Usage:
// Validation error
if (!title || title.length < 10) {
  throw new AppError(
    'Validation failed',
    400,
    'validation_failed',
    { title: 'Must be at least 10 characters' }
  );
}

// Auth error
if (!token) {
  throw new AppError('Token required', 401, 'no_token');
}

// Not found
if (!job) {
  throw new AppError('Job not found', 404, 'not_found');
}
```

#### D. Controller Pattern with Error Handling

```javascript
// Before (Bad)
exports.createJob = async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    
    const job = await jobService.create(req.body);
    res.json(job);
  } catch (err) {
    console.error('Error:', err);  // Bad: no context
    res.status(500).json({ error: 'Failed to create job' });
  }
};

// After (Good)
exports.createJob = async (req, res, next) => {
  try {
    const { title, description, location, budget } = req.body;
    
    // Validation
    const fields = {};
    if (!title || title.trim().length < 10) 
      fields.title = 'Title must be at least 10 characters';
    if (!description || description.trim().length < 50) 
      fields.description = 'Description must be at least 50 characters';
    if (!location) 
      fields.location = 'Location is required';
    if (budget && budget < 50) 
      fields.budget = 'Budget must be at least $50';
    
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }
    
    // Create job
    const job = await jobService.create({
      ...req.body,
      creator_id: req.user.id,
    });
    
    logger.info('Job created', { job_id: job.id, user_id: req.user.id });
    res.status(201).json({ data: job });
  } catch (err) {
    next(err);  // Pass to error middleware
  }
};
```

#### E. Service Layer Pattern

```javascript
// server/services/jobService.js
async function createJob(data) {
  try {
    // Validate
    if (!data.title) throw new AppError('Title required', 400, 'missing_title');
    
    // Check for conflicts
    const existing = await db.query('SELECT id FROM jobs WHERE id = $1', [data.id]);
    if (existing.rows.length) {
      throw new AppError('Job already exists', 409, 'conflict', { id: 'Already exists' });
    }
    
    // Create
    const result = await db.query('INSERT INTO jobs (...) VALUES (...)', [...]);
    return result.rows[0];
  } catch (err) {
    // Don't catch here - let controller/middleware handle
    throw err;
  }
}
```

---

### 3. Special Cases

#### A. Async/Background Jobs

```javascript
// Bad: Silent failure
exports.sendEmail = async (email) => {
  emailService.send(email).catch(() => {});  // ERROR SWALLOWED!
};

// Good: Logged and retried
exports.sendEmail = async (email) => {
  try {
    await emailService.send(email);
  } catch (err) {
    logger.error('Email send failed', {
      email: email.to,
      error: err.message,
      willRetry: true,
    });
    // Retry logic or add to queue
    await emailQueue.add(email, { attempts: 3 });
  }
};
```

#### B. Socket.IO Errors

```javascript
// Good: Handle auth errors on connect
io.on('connection', (socket) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      logger.warn('Socket connection without token', { socketId: socket.id });
      socket.emit('auth_error', { code: 'no_token' });
      socket.disconnect();
      return;
    }
    
    const user = verifyToken(token);
    socket.userId = user.id;
  } catch (err) {
    logger.error('Socket auth failed', { 
      socketId: socket.id,
      error: err.message 
    });
    socket.emit('auth_error', { code: 'auth_failed' });
    socket.disconnect();
  }
});
```

#### C. Payment Operations (High Stakes)

```javascript
// Good: Transaction safety + clear error handling
exports.capturePayment = async (paymentIntentId) => {
  try {
    logger.info('Capturing payment', { paymentIntentId });
    
    // Step 1: Get payment intent
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'requires_capture') {
      throw new AppError(
        `Cannot capture payment in ${pi.status} state`,
        400,
        'invalid_payment_state'
      );
    }
    
    // Step 2: Capture
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    
    // Step 3: Update database
    await db.query('UPDATE payments SET status = $1 WHERE stripe_id = $2', 
      ['captured', paymentIntentId]);
    
    logger.info('Payment captured successfully', { paymentIntentId });
    return captured;
  } catch (err) {
    logger.error('Payment capture failed', {
      paymentIntentId,
      error: err.message,
      code: err.code,
      action: 'requires manual review',
    });
    throw err;  // Let controller handle
  }
};
```

---

## Implementation Roadmap

### Phase 1: Core Utilities (Foundation)
- [ ] Create `AppError` class (server/utils/appError.js)
- [ ] Create `errorClassifier` (client/src/utils/errorClassifier.ts)
- [ ] Create `frontendLogger` (client/src/utils/frontendLogger.ts)
- [ ] Update `apiError.js` with enhanced shape
- [ ] Create `errorHandler` middleware

### Phase 2: Critical Paths (High Impact)
- [ ] Fix auth error handling (login, register, token refresh)
- [ ] Fix job creation error handling
- [ ] Fix payment error handling (Stripe operations)
- [ ] Fix chat/messaging error handling

### Phase 3: API Error Responses
- [ ] Update all validation errors to include `fields`
- [ ] Update all error responses to include `code`
- [ ] Add request IDs for tracing
- [ ] Add timestamps to all error responses

### Phase 4: Frontend Integration
- [ ] Create `useAPI` custom hook
- [ ] Update error boundaries
- [ ] Migrate 80+ `setError` calls to classified errors
- [ ] Replace 163 `console.*` calls with structured logger

### Phase 5: Logging & Observability
- [ ] Add structured logging to async jobs
- [ ] Add context (userId, requestId) to all logs
- [ ] Wire frontend logger to Sentry/Datadog
- [ ] Set up error aggregation dashboard

### Phase 6: Testing & Documentation
- [ ] Test error scenarios (auth, validation, network, server)
- [ ] Document error codes and their meanings
- [ ] Create error handling runbook
- [ ] Add error tests to Jest suite

---

## Benefits

### For Developers
- ✅ Easy to debug (clear context in logs)
- ✅ Consistent patterns (predictable error handling)
- ✅ Type safety (TypeScript interfaces)
- ✅ Reusable (error classifier works everywhere)

### For Users
- ✅ Specific feedback ("Title too short" vs "Failed to post")
- ✅ Clear auth messages ("Session expired")
- ✅ Auto-retry for network errors
- ✅ Guided recovery (redirects, suggestions)

### For Operations
- ✅ Searchable logs (structured JSON with codes)
- ✅ Request tracing (requestId correlation)
- ✅ Error aggregation (counts errors by type/code)
- ✅ Alert on patterns (e.g., spike in 401s)

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|---|
| Error type classification rate | 95%+ | Errors with `code` field / total errors |
| Validation error field inclusion | 100% | Errors with `fields` / validation errors |
| Structured logging adoption | 90%+ | Logs with context / total logs |
| Error logs with user_id | 95%+ | Logs with userId / total user-initiated errors |
| Actionable user messages | 90%+ | Users reporting "unclear error" / total errors |
| Average time to debug | -50% | Mean resolution time before/after |

---

## Files to Create/Modify

**NEW:**
- `server/utils/appError.js` — AppError class
- `server/middleware/errorHandler.js` — Global error handler
- `client/src/utils/errorClassifier.ts` — Error classification
- `client/src/utils/frontendLogger.ts` — Structured logging
- `client/src/hooks/useAPI.ts` — API hook with error handling
- `ERROR_HANDLING.md` — Error codes reference

**MODIFY:**
- `server/utils/apiError.js` — Enhanced response shape
- All controllers — Use AppError and consistent responses
- All API pages — Use errorClassifier and proper error display
- All hooks — Use useAPI pattern

---

## References

- Exception Handling Best Practices: https://cheatsheetseries.owasp.org/
- Structured Logging: https://www.kartar.net/2015/12/structured-logging/
- Error Handling in React: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary

