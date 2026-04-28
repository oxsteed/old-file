# API Versioning Integration Guide

## Current State
Routes mounted as:
```
/api/auth
/api/jobs
/api/payments
... etc
```

## Integration Strategy (Non-Breaking)

### Option A: Soft Versioning (Recommended - Immediate Implementation)

Keep all routes at `/api/...` but add version header/query tracking:

```javascript
// server/middleware/apiVersion.js
const trackApiVersion = (req, res, next) => {
  const version = req.query.v || req.headers['api-version'] || 'v1';
  req.apiVersion = version;
  logger.info('API request', { version, path: req.path, method: req.method });
  next();
};

// server/index.js
app.use('/api/', trackApiVersion);
```

**Client Usage:**
```bash
curl /api/jobs?v=v1
curl -H "API-Version: v2" /api/jobs
```

**Advantage:** No URL restructuring, can track versions in logs

---

### Option B: Parallel Versioning (Long-term)

After soft versioning is working, migrate to explicit URLs:

```javascript
// Phase 1: Both work (redirect or proxy)
/api/v1/jobs          → route to jobs.js
/api/v2/jobs          → route to jobsV2.js  
/api/jobs?v=v1        → route based on query param

// Phase 2: Announce v1 deprecation
/api/v1/jobs          → warnings in response
/api/jobs             → defaults to v2

// Phase 3: v1 sunset
/api/v1/jobs          → 410 Gone
/api/jobs             → v2 only
```

---

## Immediate Action Items

### 1. Add soft versioning (this week)
```javascript
// server/middleware/apiVersion.js
module.exports = (req, res, next) => {
  req.apiVersion = req.query.v || req.headers['api-version'] || 'v1';
  next();
};
```

Wire into index.js before all route handlers.

### 2. Log version usage
Monitor which clients use v1 vs v2 via structured logging.

### 3. Document breaking changes
When planning v2 changes, document them in `API_VERSIONING.md`

---

## Breaking Changes Checklist

Before shipping v2, check:

- [ ] Response field renames documented
- [ ] New required parameters documented
- [ ] Status code changes documented
- [ ] Migration examples provided
- [ ] Deprecation timeline announced
- [ ] Client libraries updated
- [ ] Tests updated for both v1 and v2

---

## Example: Payment Capture Versioning

**v1 Response:**
```json
{
  "message": "Payment captured",
  "payment_id": "pay-123"
}
```

**v2 Response (camelCase, more detail):**
```json
{
  "success": true,
  "paymentId": "pay-123",
  "capturedAt": "2026-04-18T14:30:00Z",
  "status": "captured"
}
```

**Implementation:**
```javascript
// server/controllers/paymentController.js
exports.capturePayment = async (req, res) => {
  // ... payment capture logic ...
  
  if (req.apiVersion === 'v2') {
    return res.json({
      success: true,
      paymentId: result.id,
      capturedAt: result.captured_at,
      status: result.status,
    });
  }
  
  // v1 response (default)
  res.json({
    message: 'Payment captured',
    payment_id: result.id,
  });
};
```

---

## Next Steps

1. **Implement soft versioning** (header + query param detection)
2. **Update CLAUDE.md** with version tracking approach
3. **Plan first breaking changes** (document in separate file)
4. **Create v2 response format spec** when ready for explicit versioning
