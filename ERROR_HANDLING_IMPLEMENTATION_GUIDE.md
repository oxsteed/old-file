# Error Handling Implementation Guide

Quick reference for developers on how to use the new error handling framework.

---

## Quick Start

### Backend: Throwing Errors

```javascript
const { AppError } = require('../middleware/errorHandler');

// ✅ CORRECT: Use AppError for all application errors
try {
  // Validation error
  if (!email || !email.includes('@')) {
    throw new AppError('Invalid email format', 400, 'invalid_format', {
      email: 'Please enter a valid email address'
    });
  }

  // Auth error
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'no_token');
  }

  // Not found
  const job = await getJob(id);
  if (!job) {
    throw new AppError('Job not found', 404, 'not_found');
  }

  // Conflict
  const existing = await getByEmail(email);
  if (existing) {
    throw new AppError('Email already registered', 409, 'already_exists', {
      email: 'This email is already in use'
    });
  }

  // Server error
  throw new AppError('Database connection failed', 500, 'db_error');
} catch (err) {
  // Let error handler middleware catch it
  // DON'T catch and return manually
  next(err);
}

// ❌ WRONG: Manual error responses
res.status(400).json({ error: 'Invalid email' });  // No code, no context

// ❌ WRONG: Swallowing errors
try {
  await api.call();
} catch (err) {
  // Silent failure!
}
```

### Frontend: Handling Errors

```javascript
import { classifyError, isValidationError, isAuthError } from './utils/errorClassifier';
import logger from './utils/frontendLogger';

// ✅ CORRECT: Classify error and handle by type
try {
  const job = await createJob(formData);
  logger.info('Job created', { jobId: job.id });
} catch (err) {
  const classified = classifyError(err);

  if (isValidationError(classified)) {
    // Show field-level errors
    setErrors(classified.fields);
  } else if (isAuthError(classified)) {
    // Redirect to login
    logger.warn('Auth error', { code: classified.code });
    navigate('/login');
  } else if (classified.type === 'network') {
    // Offer retry
    setError('Network error. Retry?');
    showRetryButton();
  } else {
    // Generic error
    setError(classified.message);
  }

  logger.error('Job creation failed', {
    code: classified.code,
    fields: classified.fields,
    originalError: err
  });
}

// ❌ WRONG: Generic error message
try {
  await createJob(data);
} catch (err) {
  setError('Failed to create job');  // User has no idea what went wrong
}

// ❌ WRONG: Ignoring validation errors
const msg = err?.response?.data?.error;  // Gets code, loses fields!
```

---

## File-by-File Patterns

### Backend Controllers

```javascript
// server/controllers/jobController.js
const { AppError } = require('../middleware/errorHandler');

exports.createJob = async (req, res, next) => {
  try {
    const { title, description, budget } = req.body;

    // Validation
    const fields = {};
    if (!title || title.trim().length < 10)
      fields.title = 'Title must be at least 10 characters';
    if (!description || description.trim().length < 50)
      fields.description = 'Description must be at least 50 characters';
    if (budget && budget < 50)
      fields.budget = 'Budget must be at least $50';

    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Create job
    const job = await jobService.createJob({
      ...req.body,
      creator_id: req.user.id
    });

    res.status(201).json({ data: job });
  } catch (err) {
    next(err);  // Pass to error handler middleware
  }
};
```

### React Pages

```javascript
// client/src/pages/PostJobPage.jsx
import { classifyError } from '../utils/errorClassifier';
import logger from '../utils/frontendLogger';

function PostJobPage() {
  const [errors, setErrors] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const job = await createJob(formData);
      logger.info('Job posted', { jobId: job.id });
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      const classified = classifyError(err);

      if (classified.fields) {
        // Validation errors: show in form
        setErrors(classified.fields);
      } else if (classified.type === 'auth') {
        // Auth error: redirect
        navigate('/login');
      } else {
        // Other errors: show toast
        setErrors({ submit: classified.message });
      }

      logger.error('Job creation failed', {
        code: classified.code,
        statusCode: classified.statusCode,
        fields: classified.fields,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Title field with error */}
      <input
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      {errors.title && <span className="error">{errors.title}</span>}

      {/* Submit error */}
      {errors.submit && <div className="error-toast">{errors.submit}</div>}
    </form>
  );
}
```

### Custom Hooks

```javascript
// client/src/hooks/useJob.js
import { useCallback } from 'react';
import { classifyError } from '../utils/errorClassifier';
import logger from '../utils/frontendLogger';
import api from '../api/axios';

export function useCreateJob() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const createJob = useCallback(async (jobData) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/jobs', jobData);
      logger.info('Job created', { jobId: data.id });
      return data;
    } catch (err) {
      const classified = classifyError(err);
      setError(classified);

      logger.error('Job creation failed', {
        code: classified.code,
        type: classified.type,
        fields: classified.fields,
      });

      throw classified;  // Let caller handle
    } finally {
      setLoading(false);
    }
  }, []);

  return { createJob, loading, error };
}
```

---

## Common Patterns by Scenario

### Pattern 1: Form Validation

**Backend:**
```javascript
const fields = {};
if (!title) fields.title = 'Title is required';
if (title.length < 10) fields.title = 'Title must be at least 10 characters';
if (!budget) fields.budget = 'Budget is required';
if (budget < 50) fields.budget = 'Minimum budget is $50';

if (Object.keys(fields).length) {
  throw new AppError('Validation failed', 400, 'validation_failed', fields);
}
```

**Frontend:**
```javascript
try {
  await api.post('/jobs', data);
} catch (err) {
  const classified = classifyError(err);
  if (classified.fields) {
    setErrors(classified.fields);  // Spread errors into form
  }
}
```

### Pattern 2: Authentication Required

**Backend:**
```javascript
if (!req.user) {
  throw new AppError('Authentication required', 401, 'no_token');
}
```

**Frontend:**
```javascript
try {
  await api.post('/protected-endpoint', data);
} catch (err) {
  const classified = classifyError(err);
  if (classified.type === 'auth') {
    navigate('/login');
  }
}
```

### Pattern 3: Resource Not Found

**Backend:**
```javascript
const job = await getJob(id);
if (!job) {
  throw new AppError('Job not found', 404, 'not_found');
}
```

**Frontend:**
```javascript
try {
  const job = await fetchJob(id);
} catch (err) {
  const classified = classifyError(err);
  if (classified.type === 'not_found') {
    navigate('/jobs');  // Go back to list
  }
}
```

### Pattern 4: Retry on Network Error

**Frontend:**
```javascript
import { isNetworkError } from './utils/errorClassifier';

try {
  await api.post('/jobs', data);
} catch (err) {
  const classified = classifyError(err);
  if (isNetworkError(classified)) {
    showRetryButton();  // User can retry
  } else {
    throw classified;
  }
}
```

### Pattern 5: Log Context for Debugging

**Frontend:**
```javascript
try {
  await api.post('/jobs', data);
} catch (err) {
  const classified = classifyError(err);
  logger.error('Job creation failed', {
    code: classified.code,
    statusCode: classified.statusCode,
    type: classified.type,
    fields: classified.fields,
    userAgent: navigator.userAgent,
    url: window.location.href,
  });
}
```

---

## Checklist: Converting Existing Code

When updating existing error handling:

- [ ] Replace manual `res.status().json()` with `throw new AppError()`
- [ ] Replace `setError('generic message')` with field-level validation
- [ ] Replace `console.error()` with `logger.error()`
- [ ] Replace bare `catch () {}` with proper error handling
- [ ] Add error codes to all error responses
- [ ] Add validation fields to 400 responses
- [ ] Test error scenarios (validation, auth, network, server)
- [ ] Verify error messages are user-friendly
- [ ] Log sufficient context for debugging
- [ ] Update documentation for new error codes

---

## Testing Error Handling

```javascript
// __tests__/errorHandling.test.js
describe('Error Handling', () => {
  test('validation errors include field details', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ title: 'Short' });  // Too short

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.title).toBeDefined();
  });

  test('auth errors redirect to login', async () => {
    const classified = classifyError(
      new Error('401 Unauthorized', { response: { status: 401 } })
    );

    expect(classified.type).toBe('auth');
    expect(classified.shouldRedirect).toBe('/login');
  });

  test('network errors are retryable', async () => {
    const classified = classifyError(new Error('Network timeout'));
    expect(classified.retryable).toBe(true);
  });
});
```

---

## Migration Path

### Phase 1: Foundation (Current)
✅ Create error utilities and documentation
✅ Update error middleware
✅ Create error classifier and logger

### Phase 2: High-Priority Paths
- [ ] Auth endpoints (login, register, token refresh)
- [ ] Job creation and posting
- [ ] Payment operations (Stripe integration)
- [ ] Chat and messaging

### Phase 3: Full Migration
- [ ] All API endpoints (87 controllers)
- [ ] All React pages (238 pages)
- [ ] All custom hooks (40+ hooks)

### Phase 4: Monitoring
- [ ] Wire logger to Sentry/Datadog
- [ ] Set up error aggregation dashboard
- [ ] Create error trend reports

---

## FAQ

**Q: When should I throw AppError vs other error types?**
A: Use AppError for all application-level errors that should be sent to clients. Let system errors (db crashes, etc.) propagate to the error handler.

**Q: Should I log before throwing or after catching?**
A: Log after catching. The error handler will log it too, so you avoid duplicate logs.

**Q: How do I add a new error code?**
A: (1) Add to ERROR_CODES_REFERENCE.md, (2) Use in code with AppError(message, status, code), (3) Update classifyError if needed, (4) Test the scenario.

**Q: Can I use AppError in services?**
A: Yes! Services should throw AppError for application errors. Controllers pass them to error handler.

**Q: How do I test error handling?**
A: Mock axios, trigger error conditions, verify error classification and user feedback.

