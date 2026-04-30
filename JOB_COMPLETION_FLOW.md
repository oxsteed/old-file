# Job Completion End-to-End Flow

**Error:** `401 Unauthorized - No token provided`  
**Root Cause:** Missing or invalid JWT token in request header

---

## The Complete Job Status Flow

```
Published (pending bids)
    ↓
Assigned (helper selected)
    ↓
In Progress (helper started work)
    ↓
Completed (customer/helper marks complete)
    ↓
Closed (reviews enabled)
```

---

## API Endpoints Required (In Order)

### 1. Mark Job as In Progress
**Endpoint:** `POST /api/jobs/:id/start`  
**Who Can Call:** Assigned helper  
**Requires:** Authorization header with token  
**Payload:** `{}`

```javascript
// Frontend code
const response = await api.post(`/api/jobs/${jobId}/start`);
```

**Server Handler:** `jobController.startJob()` (line 527)

---

### 2. Complete the Job (CURRENT FAILURE POINT)
**Endpoint:** `POST /api/jobs/:id/complete`  
**Who Can Call:** Customer OR assigned helper  
**Requires:** Authorization header with token  
**Payload:** `{}`

```javascript
// Frontend code
const response = await api.post(`/api/jobs/${jobId}/complete`);
```

**Server Handler:** `jobController.completeJob()` (line 580)

**What It Does:**
1. Verifies job exists and is `in_progress` status
2. If customer marking complete AND Tier 3 escrow: **captures authorized funds from Stripe**
3. Sets job status → `completed`
4. Sets `completed_at` timestamp
5. Returns updated job object

**Permission Check (Line 588):**
```sql
WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
AND status = 'in_progress'
```
✅ Customer can complete (client_id matches)  
✅ Helper can complete (assigned_helper_id matches)  
❌ Only if job is currently `in_progress`

**Error Cases:**
- ❌ Job not found: `404 Job not found or cannot be completed`
- ❌ Job not in progress: `404 Job not found or cannot be completed`
- ❌ Open dispute: `409 Cannot complete job while a payment dispute is open`
- ❌ Token missing: `401 No token provided` ← **THIS IS YOUR ISSUE**
- ❌ Token invalid/expired: `401 Token verification failed`

---

### 3. Close the Job (Enables Reviews)
**Endpoint:** `POST /api/jobs/:id/close`  
**Who Can Call:** Customer OR assigned helper  
**Requires:** Authorization header with token  
**Payload:** `{}`

```javascript
// Frontend code
const response = await api.post(`/api/jobs/${jobId}/close`);
```

**Server Handler:** `jobController.closeJob()` (line 651)

**What It Does:**
1. Verifies job exists and is `completed` status
2. Checks no open disputes exist
3. Checks no pending payments exist (for Tier 3)
4. Sets job status → `closed`
5. Returns updated job object

---

## Why You're Getting "No token provided"

The `authenticate` middleware (line 55-136 in `server/middleware/auth.js`) checks for the Authorization header:

```javascript
const header = req.headers.authorization;
if (!header || !header.startsWith('Bearer ')) {
  return res.status(401).json({ error: 'No token provided' });
}
```

**You're missing this header:** `Authorization: Bearer <access_token>`

---

## How to Fix - Frontend (Client-Side)

### If Using Axios (Recommended)
The `client/src/api/axios.js` should automatically add the token:

```javascript
// This should be in client/src/api/axios.js
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

**Verify:**
1. Token exists in localStorage: `localStorage.getItem('accessToken')`
2. Axios interceptor is configured
3. You're using the `api` instance from axios.js, not raw `fetch()`

### If Using Fetch
```javascript
// ❌ WRONG - No token
const response = await fetch(`/api/jobs/${jobId}/complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
});

// ✅ CORRECT - Token included
const token = localStorage.getItem('accessToken');
const response = await fetch(`/api/jobs/${jobId}/complete`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
});
```

### If Using Direct HTTP Client
```bash
# ❌ WRONG
curl -X POST http://localhost:5000/api/jobs/123/complete

# ✅ CORRECT
curl -X POST http://localhost:5000/api/jobs/123/complete \
  -H "Authorization: Bearer $TOKEN"
```

---

## Debugging Steps

### Step 1: Verify Token Exists
In browser console:
```javascript
const token = localStorage.getItem('accessToken');
console.log(token ? 'Token found: ' + token.substring(0, 20) + '...' : 'NO TOKEN');
```

If `NO TOKEN` → User is logged out; need to log back in first.

### Step 2: Verify Request Includes Token
In Network tab (DevTools):
1. Click on the POST request to `/api/jobs/:id/complete`
2. Look for `Request Headers` section
3. Should see: `Authorization: Bearer eyJ...`

If missing → Axios interceptor not configured or not being used.

### Step 3: Test Token Validity
```javascript
// Get the token
const token = localStorage.getItem('accessToken');

// Try to decode it (JWT is base64 encoded)
const parts = token.split('.');
const payload = JSON.parse(atob(parts[1]));
console.log('Token payload:', payload);
console.log('Token expires at:', new Date(payload.exp * 1000).toISOString());
```

If expiration date is in the past → Token expired; need to refresh or log back in.

### Step 4: Verify Axios Is Being Used
Check the component calling the endpoint:
```javascript
// ✅ CORRECT - Uses api instance
import api from '../api/axios';
const response = await api.post(`/api/jobs/${jobId}/complete`);

// ❌ WRONG - Uses fetch directly
const response = await fetch(`/api/jobs/${jobId}/complete`, {
  method: 'POST',
});
```

---

## Complete Request Flow (When Working)

```
1. User clicks "Complete Job" button on frontend
   ↓
2. Frontend calls: api.post(`/api/jobs/${jobId}/complete`)
   ↓
3. Axios request interceptor adds token:
   POST /api/jobs/123/complete
   Authorization: Bearer eyJ0eXAi...
   ↓
4. Server receives request
   ↓
5. authenticate middleware verifies token:
   - Checks Authorization header exists ✅
   - Splits Bearer token ✅
   - Verifies JWT signature ✅
   - Checks token not revoked ✅
   - Loads user from database ✅
   - Attaches req.user with full user object ✅
   ↓
6. jobController.completeJob() executes:
   - Verifies permission: (client_id = req.user.id OR assigned_helper_id = req.user.id) ✅
   - Checks job status = 'in_progress' ✅
   - If Tier 3 + customer: captures payment ✅
   - Updates job status → 'completed' ✅
   ↓
7. Returns: { message: 'Job completed', job: {...} }
```

---

## Common Issues & Solutions

| Symptom | Cause | Solution |
|---------|-------|----------|
| `401 No token provided` | Token not in Authorization header | Check localStorage for token; verify Axios interceptor |
| `401 Token verification failed` | Token is invalid/expired | Log out and back in to refresh token |
| `401 MFA token cannot be used for API access` | Wrong token type | This happens if you use 2FA verification token for API calls |
| `404 Job not found` | Job ID wrong or job isn't `in_progress` | Verify job ID; check job status first via GET /api/jobs/:id |
| `409 Cannot complete while dispute open` | Open payment dispute exists | Resolve dispute before completing |

---

## Server Validation Details

**Authorization Check (Line 588 in jobController.js):**
```sql
WHERE id = $1 
  AND (client_id = $2 OR assigned_helper_id = $2)
  AND status = 'in_progress'
```

This means:
- ✅ `req.user.id` must be the customer (client_id) OR helper (assigned_helper_id)
- ✅ Job status must be exactly `'in_progress'`
- ❌ Job must not be 'pending', 'completed', 'closed', or 'cancelled'

**Payment Capture (Lines 602-620):**
```javascript
if (job.client_id === req.user.id && isTier3EscrowJob(job)) {
  // Capture authorized funds from Stripe
  // This is automatic when customer completes Tier 3 jobs
}
```

Only the **customer** (not helper) can trigger payment capture.

---

## Tier 3 Escrow Payment Flow

For Tier 3 jobs, payment capture happens **automatically** when the customer marks complete:

```
1. Customer creates Tier 3 job
   ↓
2. Helper accepts bid
   ↓
3. Customer pays → Payment status = 'authorized' (funds held, not captured)
   ↓
4. Helper completes work → POST /api/jobs/:id/start
   ↓
5. Customer marks complete → POST /api/jobs/:id/complete
   ↓
6. Server automatically captures funds → stripe.paymentIntents.capture()
   ↓
7. Payment status → 'captured'
   ↓
8. Helper can now see funds in account and withdraw
```

**Important:** If payment capture fails (Stripe error), the entire job completion transaction rolls back.

---

## Action Items

- [ ] Verify token exists: `localStorage.getItem('accessToken')`
- [ ] Check Network tab for Authorization header on complete request
- [ ] Ensure using `api.post()` (from axios.js), not raw `fetch()`
- [ ] Log out and back in to refresh token if expired
- [ ] Test with: `curl -X POST http://localhost:5000/api/jobs/123/complete -H "Authorization: Bearer $TOKEN"`
- [ ] If still failing, provide: job ID, user ID, request headers, token payload
