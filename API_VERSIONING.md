# API Versioning Strategy

## Overview

OxSteed uses semantic API versioning to support breaking changes while maintaining backward compatibility.

- **v1**: Current stable API (default, no breaking changes planned)
- **v2**: New features, breaking changes accepted
- **Fallback**: v2 routes fall back to v1 if endpoint not found



## Client Usage

### Explicit Version
```bash
# Use v1 explicitly
curl https://oxsteed.com/api/v1/jobs

# Use v2 (new features)
curl https://oxsteed.com/api/v2/jobs

# Header-based version (alternative)
curl -H "API-Version: v1" https://oxsteed.com/api/jobs
```

### Version Endpoint
Always include version in request URL: `/api/v{1|2}/{resource}`

Error response if version missing:
```json
{
  "error": "API version required",
  "hint": "Use /api/v1 or /api/v2, or set API-Version header"
}
```

## Server Implementation

### Current State (v1 only)
All routes currently mounted at `/api/...` without versioning.

### Migration Path to Versioning

**Step 1: Add versioning to main server**
```javascript
// server/index.js
const { createVersionedRouter, versionLog } = require('./routes/apiVersion');

const apiRouter = createVersionedRouter();

// Wire all current routes to both v1 and v2
apiRouter.use('/v1', versionLog, authRoutes);
apiRouter.use('/v1', versionLog, jobRoutes);
// ... repeat for all routes

apiRouter.use('/v2', versionLog, authRoutes); // same as v1 initially
apiRouter.use('/v2', versionLog, jobRoutes);
// ... repeat for all routes

app.use('/api', apiRouter);
```

**Step 2: Introduce breaking changes in v2 only**
```javascript
// Create v2-specific routes when needed
const jobRoutesV2 = require('./routes/jobsV2');
apiRouter.use('/v2', versionLog, jobRoutesV2);

// v1 stays on old route implementation
apiRouter.use('/v1', versionLog, jobRoutes);
```

**Step 3: Deprecation policy**
- Announce deprecation 6 months before removing v1
- Include `Deprecation` header in v1 responses (optional enhancement)
- Log v1 usage for monitoring (already in `versionLog`)

## Response Format

### With Version Enveloping (Optional)
```json
{
  "apiVersion": "v1",
  "timestamp": "2026-04-18T14:30:00Z",
  "data": {
    "id": "job-123",
    "title": "Paint the house"
  }
}
```

**Note:** Current responses don't have enveloping. Consider adding via `versionedResponse` middleware if clients need version info.

## Breaking Changes in v2

### Examples of v2 changes:
- Change response field names (`client_id` → `customerId`)
- Add required query parameters
- Change HTTP status codes for certain scenarios
- Modify nested object structures
- Change pagination format

### Examples of non-breaking (can stay in v1):
- Add new fields to response
- Add optional parameters
- Add new endpoints
- Change behavior in non-critical paths

## Testing Versioning

```bash
# Test v1 endpoint
curl http://localhost:5000/api/v1/jobs

# Test v2 endpoint (should work same as v1 initially)
curl http://localhost:5000/api/v2/jobs

# Test missing version (should error)
curl http://localhost:5000/api/jobs
```

## Monitoring

Version usage is logged in `server/routes/apiVersion.js`:
```
logger.info('API request', {
  version: 'v1',  // or 'v2'
  method: 'GET',
  path: '/jobs',
  userId: 'user-123',
})
```

Can be queried to understand client upgrade patterns and plan v1 deprecation.

## Migration Timeline

1. **Phase 1 (Now):** Add versioning infrastructure, no breaking changes yet
2. **Phase 2 (Month 1-3):** Identify breaking changes for v2, announce early
3. **Phase 3 (Month 4-6):** Deploy v2 with breaking changes, clients can migrate
4. **Phase 4 (Month 7-12):** Gradual v1 sunset, monitor traffic decline
5. **Phase 5 (Month 12+):** Deprecate v1, remove from docs
