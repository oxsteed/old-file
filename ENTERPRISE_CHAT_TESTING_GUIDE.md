# Enterprise Chat System — Live Testing Guide
**Generated:** 2026-04-29 | **Status:** READY FOR DEPLOYMENT TESTING

---

## EXECUTIVE SUMMARY

The enterprise support/chat system is **80% deployed**:
- ✅ **Backend:** 100% complete (supportController.js, supportChatController.js)
- ✅ **Database:** All 132+ migrations applied
- ⚠️ **Frontend:** Components built but NOT YET integrated into AdminApp.jsx
- ⚠️ **Routes:** API endpoints exist but page routes not registered

### What You Can Test NOW (Without Frontend Integration)
1. ✅ Support ticket API endpoints (`/api/support/*`)
2. ✅ Live chat initiation (`/api/support-chat/initiate`)
3. ✅ Database records verification
4. ⚠️ Admin dashboard UI (needs route integration — see below)

---

## PART 1: DATABASE VERIFICATION (Run Against Live DB)

You have direct database access, so verify the data layer is ready:

### 1.1 Check Support Tables Exist
```sql
-- Run this to verify all 7 support tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%support%'
ORDER BY table_name;

-- Expected output:
-- support_agents
-- support_tickets
-- support_messages
-- support_knowledge_base
-- support_templates
-- support_chat_sessions
-- support_audit_log
```

### 1.2 Verify Support Agent Setup
```sql
-- Check if any support agents exist
SELECT id, user_id, status, shift_start, shift_end, skills_json, is_online
FROM support_agents
LIMIT 10;

-- If empty, create a test agent:
INSERT INTO support_agents (user_id, status, shift_start, shift_end, skills_json, is_online)
VALUES (
  (SELECT id FROM users WHERE role = 'admin' LIMIT 1),
  'available',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '8 hours',
  '["billing", "technical", "account"]'::jsonb,
  true
)
ON CONFLICT (user_id) DO UPDATE SET is_online = true;
```

### 1.3 Check Sample Support Tickets
```sql
-- View all support tickets (first 20)
SELECT 
  id, user_id, subject, status, priority, 
  created_at, assigned_to, 
  (SELECT COUNT(*) FROM support_messages WHERE ticket_id = support_tickets.id) as message_count
FROM support_tickets
ORDER BY created_at DESC
LIMIT 20;
```

### 1.4 Verify Knowledge Base
```sql
-- Check if KB articles exist
SELECT id, title, category, views_count, helpful_count
FROM support_knowledge_base
ORDER BY views_count DESC
LIMIT 10;

-- If empty, seed a test article:
INSERT INTO support_knowledge_base (title, content, category, author_id)
VALUES (
  'How to Reset Your Password',
  'Click on "Forgot Password" on the login page...',
  'account',
  (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
);
```

### 1.5 Check Response Templates
```sql
-- Verify templates exist
SELECT id, title, category, shortcut_key, created_at
FROM support_templates
ORDER BY created_at DESC
LIMIT 10;
```

### 1.6 Count Metrics Over Time
```sql
-- Dashboard metrics: tickets by status
SELECT status, COUNT(*) as count
FROM support_tickets
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY status;

-- Metrics by priority
SELECT priority, COUNT(*) as count, 
  ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600)::numeric, 1) as avg_hours_open
FROM support_tickets
WHERE status != 'resolved'
GROUP BY priority
ORDER BY priority;
```

---

## PART 2: API ENDPOINT TESTING (Use Postman/curl)

### Setup: Get Your Access Token
First, obtain a valid JWT access token for testing:

```bash
# Register or login to get token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "your_password"
  }'

# Response includes: { user, accessToken, refreshToken }
# Save accessToken for next requests
TOKEN="your_access_token_here"
```

### 2.1 Public Support Endpoints (No Auth Required)

#### Create a Support Ticket (Public)
```bash
curl -X POST http://localhost:5000/api/support/request \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "subject": "Cannot login to account",
    "message": "I forgot my password and need to reset it.",
    "category": "account",
    "priority": "normal",
    "sender_language": "en"
  }'

# Expected response (201):
# {
#   "ticketId": "550e8400-e29b-41d4-a716-446655440000",
#   "message": "Support request submitted. You'll hear from us within 24 hours."
# }
```

### 2.2 Authenticated User Endpoints

#### Get My Tickets
```bash
curl -X GET http://localhost:5000/api/support/my-tickets \
  -H "Authorization: Bearer $TOKEN"

# Response: [ { id, subject, status, created_at, priority, ... }, ... ]
```

#### Get Single Ticket Details
```bash
TICKET_ID="550e8400-e29b-41d4-a716-446655440000"
curl -X GET http://localhost:5000/api/support/my-tickets/$TICKET_ID \
  -H "Authorization: Bearer $TOKEN"

# Response: {
#   id, subject, status, priority, created_at, messages: [ ... ]
# }
```

#### Reply to My Ticket
```bash
curl -X POST http://localhost:5000/api/support/my-tickets/$TICKET_ID/reply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I have more information about the issue..."
  }'
```

### 2.3 Admin Endpoints (Requires admin role)

#### List All Tickets (Admin)
```bash
curl -X GET 'http://localhost:5000/api/support/admin/tickets?status=open&priority=high&limit=20' \
  -H "Authorization: Bearer $TOKEN"

# Query params:
# ?status=open|in_progress|resolved
# ?priority=low|normal|high|urgent
# ?assigned_to=USER_ID
# ?category=billing|technical|account|general|other
# ?limit=50&offset=0
```

#### Get Ticket as Admin
```bash
curl -X GET http://localhost:5000/api/support/admin/tickets/$TICKET_ID \
  -H "Authorization: Bearer $TOKEN"
```

#### Claim Ticket (Assign to Me)
```bash
curl -X POST http://localhost:5000/api/support/admin/tickets/$TICKET_ID/claim \
  -H "Authorization: Bearer $TOKEN"

# Response: { success: true, message: "Ticket assigned to you" }
```

#### Update Ticket Status
```bash
curl -X PUT http://localhost:5000/api/support/admin/tickets/$TICKET_ID/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress"
  }'

# Valid statuses: open | in_progress | resolved | closed | on_hold
```

#### Update Priority
```bash
curl -X PUT http://localhost:5000/api/support/admin/tickets/$TICKET_ID/priority \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "high"
  }'
```

#### Admin Reply to Ticket
```bash
curl -X POST http://localhost:5000/api/support/admin/tickets/$TICKET_ID/reply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "We're looking into this issue for you.",
    "is_internal": false
  }'
```

#### Get Support Statistics (Dashboard)
```bash
curl -X GET http://localhost:5000/api/support/admin/stats \
  -H "Authorization: Bearer $TOKEN"

# Response: {
#   total_tickets: 150,
#   open_tickets: 42,
#   avg_response_time_minutes: 35,
#   resolved_this_month: 89,
#   avg_resolution_time_hours: 24.5,
#   tickets_by_status: { open: 42, in_progress: 15, ... },
#   tickets_by_priority: { low: 20, normal: 45, high: 30, urgent: 5 }
# }
```

### 2.4 Live Chat Endpoints

#### Initiate Live Chat (Guest or User)
```bash
curl -X POST http://localhost:5000/api/support-chat/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": "Hi, I need help with billing",
    "visitorName": "Jane Smith",
    "visitorEmail": "jane@example.com"
  }'

# If admins online: returns { success: true, chatId, adminName, ... }
# If no admins: returns { success: true, ticketId, escalated: true, ... }
```

#### Send Chat Message
```bash
CHAT_ID="chat_123"
curl -X POST http://localhost:5000/api/support-chat/$CHAT_ID/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Can you help me with my order?"
  }'
```

#### Get Chat History
```bash
curl -X GET http://localhost:5000/api/support-chat/$CHAT_ID \
  -H "Authorization: Bearer $TOKEN"

# Response: {
#   id, status, messages: [ { sender, text, timestamp, ... } ],
#   agent: { name, avatar_url, status }
# }
```

### 2.5 Knowledge Base Endpoints

#### List KB Articles (Public)
```bash
curl -X GET 'http://localhost:5000/api/support/kb?category=account&search=password'

# Query params:
# ?category=account|billing|technical|general
# ?search=keyword
# ?limit=20&offset=0
```

#### Get KB Article
```bash
curl -X GET http://localhost:5000/api/support/kb/ARTICLE_ID
```

#### Mark KB Article as Helpful
```bash
curl -X POST http://localhost:5000/api/support/kb/ARTICLE_ID/helpful \
  -H "Authorization: Bearer $TOKEN"
```

### 2.6 Response Templates

#### List Templates (Admin)
```bash
curl -X GET http://localhost:5000/api/support/admin/templates \
  -H "Authorization: Bearer $TOKEN"
```

#### Get Template Content
```bash
curl -X GET http://localhost:5000/api/support/admin/templates/TEMPLATE_ID \
  -H "Authorization: Bearer $TOKEN"

# Response: { title, content, shortcut_key, category, ... }
```

---

## PART 3: FRONTEND INTEGRATION STATUS

### Currently NOT Integrated (Frontend Components Exist but Unreachable)

The following 15 pages have been built but are **not yet routed** in AdminApp.jsx:

1. **Phase 1 (Agent Infrastructure)**
   - [ ] `/admin/support/agent-dashboard` → SupportAgentDashboard.jsx
   - [ ] `/admin/support/agent-onboarding` → SupportAgentOnboarding.jsx
   - [ ] `/admin/support/shifts` → SupportShiftsManager.jsx
   - [ ] `/admin/support/agents` → SupportAgentManagement.jsx

2. **Phase 2 (Agent Experience)**
   - [ ] `/admin/support/chat` → SupportAgentChat.jsx
   - [ ] `/admin/support/kb` → SupportKnowledgeBase.jsx
   - [ ] `/admin/support/templates` → SupportTemplates.jsx

3. **Phase 3 (Metrics & Analytics)**
   - [ ] `/admin/support/metrics` → SupportMetricsDashboard.jsx
   - [ ] `/admin/support/sla` → SupportSLADashboard.jsx
   - [ ] `/admin/support/performance` → SupportPerformanceAnalytics.jsx
   - [ ] `/admin/support/csat` → SupportCSATAnalytics.jsx

4. **Phase 4 (Advanced Features)**
   - [ ] `/admin/support/escalations` → SupportEscalationManager.jsx
   - [ ] `/admin/support/team-hierarchy` → SupportTeamHierarchy.jsx
   - [ ] `/admin/support/settings` → SupportSettingsPage.jsx
   - [ ] `/admin/support/audit` → SupportAuditLog.jsx

### How to Fix: Add Routes to AdminApp.jsx

Edit `client/src/admin/AdminApp.jsx`:

```jsx
// Add imports at top (after existing imports)
import SupportAgentDashboard from './pages/SupportAgentDashboard';
import SupportAgentOnboarding from './pages/SupportAgentOnboarding';
import SupportShiftsManager from './pages/SupportShiftsManager';
import SupportAgentManagement from './pages/SupportAgentManagement';
import SupportAgentChat from './pages/SupportAgentChat';
import SupportKnowledgeBase from './pages/SupportKnowledgeBase';
import SupportTemplates from './pages/SupportTemplates';
import SupportMetricsDashboard from './pages/SupportMetricsDashboard';
import SupportSLADashboard from './pages/SupportSLADashboard';
import SupportPerformanceAnalytics from './pages/SupportPerformanceAnalytics';
import SupportCSATAnalytics from './pages/SupportCSATAnalytics';
import SupportEscalationManager from './pages/SupportEscalationManager';
import SupportTeamHierarchy from './pages/SupportTeamHierarchy';
import SupportSettingsPage from './pages/SupportSettingsPage';
import SupportAuditLog from './pages/SupportAuditLog';

// Add routes inside the <Route path="/admin" element={...}> section:
<Route path="support/agent-dashboard"  element={<SupportAgentDashboard />} />
<Route path="support/agent-onboarding" element={<SupportAgentOnboarding />} />
<Route path="support/shifts"           element={<SupportShiftsManager />} />
<Route path="support/agents"           element={<SupportAgentManagement />} />
<Route path="support/chat"             element={<SupportAgentChat />} />
<Route path="support/kb"               element={<SupportKnowledgeBase />} />
<Route path="support/templates"        element={<SupportTemplates />} />
<Route path="support/metrics"          element={<SupportMetricsDashboard />} />
<Route path="support/sla"              element={<SupportSLADashboard />} />
<Route path="support/performance"      element={<SupportPerformanceAnalytics />} />
<Route path="support/csat"             element={<SupportCSATAnalytics />} />
<Route path="support/escalations"      element={<SupportEscalationManager />} />
<Route path="support/team-hierarchy"   element={<SupportTeamHierarchy />} />
<Route path="support/settings"         element={<SupportSettingsPage />} />
<Route path="support/audit"            element={<SupportAuditLog />} />
```

Then redeploy.

---

## PART 4: COMPLETE TESTING CHECKLIST

### Phase 1: Database & API (No UI Needed)
- [ ] Run SQL queries from Part 1 — verify tables exist and are populated
- [ ] Test public support endpoint: POST `/api/support/request`
- [ ] Test user tickets: GET `/api/support/my-tickets`
- [ ] Test admin endpoints: GET `/api/support/admin/tickets`
- [ ] Test live chat: POST `/api/support-chat/initiate`
- [ ] Verify Socket.IO connection for real-time updates

### Phase 2: Frontend Pages (After Routes Integrated)
- [ ] Load `/admin/support/agent-dashboard` — see agent status, shift info
- [ ] Load `/admin/support/metrics` — see ticket stats, trends
- [ ] Load `/admin/support/chat` — agent chat interface
- [ ] Create test ticket and assign to agent
- [ ] Send chat message and verify real-time delivery
- [ ] Check all dark mode styling renders correctly

### Phase 3: End-to-End Workflows
- [ ] Guest submits support ticket → Admin claims → Agent chats → Customer replies → Resolved
- [ ] Create live chat session (with admin online)
- [ ] Verify email notifications are sent
- [ ] Test SLA compliance metrics display
- [ ] Test CSV export of tickets/analytics

### Phase 4: Performance & Scale
- [ ] Load test: 100 concurrent users browsing tickets
- [ ] Load test: 20 support agents online simultaneously
- [ ] Verify Socket.IO scaling (if >1 server instance)
- [ ] Check database query performance (show slow queries >100ms)

### Phase 5: Error Handling
- [ ] Try invalid ticket ID → 404 response
- [ ] Try accessing admin routes as regular user → 403 response
- [ ] Submit support form with invalid email → validation error
- [ ] Test network disconnection during chat → auto-reconnect

---

## PART 5: DEBUGGING COMMANDS

### Check Backend Server Health
```bash
# Is the server running?
curl -X GET http://localhost:5000/api/health

# Expected response: { status: "ok", timestamp: "..." }
```

### Check Database Connection
```bash
# From server logs
docker logs your_oxsteed_container | grep "database\|connection\|pool"

# Or query directly
psql $DATABASE_URL -c "SELECT version();"
```

### Verify Socket.IO is Working
```bash
# Check if Socket.IO server is active
curl -X GET http://localhost:5000/socket.io/?EIO=4&transport=polling

# Response should be 200 with socket.io data
```

### Monitor Real-Time Events
```bash
# From browser console (when chat is open):
console.log('Socket connected:', socket.connected);
socket.on('chat:new_message', (data) => console.log('New message:', data));
socket.on('support:status_changed', (data) => console.log('Status changed:', data));
```

### Check Database Migrations Applied
```bash
-- List all applied migrations
SELECT * FROM _migrations ORDER BY id;

-- Expected: All 139+ migrations shown
-- If missing, see CLAUDE.md for migration fixing guide
```

---

## PART 6: COMMON ISSUES & FIXES

| Issue | Symptom | Fix |
|-------|---------|-----|
| **Routes not found** | 404 on `/admin/support/*` | Add routes to AdminApp.jsx (see Part 3) |
| **No admin online** | Chat escalates to ticket | Create test agent in DB, set is_online = true |
| **Messages not real-time** | Chat messages delayed 5+ sec | Verify Socket.IO connected; check REDIS_URL |
| **KB articles empty** | No results in knowledge base | Seed KB articles via SQL (Part 1.4) |
| **Ticket stats wrong** | Dashboard shows 0 tickets | Check SQL migration 125+ were applied |
| **Emails not sending** | No confirmation emails | Verify RESEND_API_KEY or SMTP env vars |

---

## PART 7: SUCCESS CRITERIA

✅ **Deployment is READY FOR PRODUCTION if:**

1. ✅ Database: All support tables created, no migration errors
2. ✅ API: All `/api/support/*` endpoints respond correctly
3. ✅ Auth: Only admin/super_admin can access admin endpoints
4. ✅ Real-time: Socket.IO chat works with <100ms latency
5. ✅ Frontend: All 15 pages load without JavaScript errors
6. ✅ Performance: Can handle 100+ concurrent support tickets
7. ✅ Notifications: Support staff notified of new/updated tickets

---

## NEXT STEPS

1. **Today:** Run database checks (Part 1) + API tests (Part 2)
2. **Tomorrow:** Integrate frontend routes (Part 3) + redeploy
3. **This week:** Run end-to-end workflows (Part 4) + load testing
4. **Before launch:** Fix any issues from Part 6

---

## SUPPORT

If tests fail, check:
1. **CLAUDE.md** — Full project documentation
2. **Server logs** — `docker logs your_container`
3. **Browser console** — JavaScript errors
4. **Network tab** — API response codes & headers
5. **Database** — Verify migrations applied: `SELECT * FROM _migrations`

---

**Last Updated:** 2026-04-29
**Author:** Claude (AI Contributor)
**Version:** 1.0
