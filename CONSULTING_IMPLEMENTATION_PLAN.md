# OxSteed Consulting - Full Implementation Plan
# Non-Breaking, Phased Approach

## PHASE 1: Consultant Management System (1-2 hours)
### Goal: Enable admins to manage consultants and assign to inquiries

**New Database Tables (Migration 103):**
- `consultants` table
  - id, user_id (FK to users), role (phase_guide/strategist/advisor/specialist)
  - bio, expertise_areas (TEXT[]), availability_hours_per_week, rate_per_hour
  - specializations (JSONB), client_limit, current_clients_count
  - status (active/inactive), created_at, updated_at
  - Partial index on (status, role) for quick lookups

- `consultant_availability` table
  - id, consultant_id (FK), day_of_week (0-6), start_time, end_time
  - timezone, is_available (boolean)
  - Composite index on (consultant_id, day_of_week)

- `consulting_session_assignments` table (UPDATE consulting_sessions with FK)
  - session_id (FK), consultant_id (FK), assigned_at, status (assigned/claimed/completed)
  - notes (JSONB), response_deadline
  - Index on (consultant_id, assigned_at DESC) for consultant workload

**New API Routes (new file: server/routes/admin/consultants.js):**
- `GET /api/admin/consultants` - List consultants with filters
- `POST /api/admin/consultants` - Create consultant (assign user to consultant role)
- `PUT /api/admin/consultants/:id` - Update consultant profile
- `PATCH /api/admin/consultants/:id/availability` - Set availability
- `POST /api/admin/consulting/assign` - Assign consultant to session
- `PATCH /api/admin/consulting/:sessionId/status` - Update session status

**New Controller (server/controllers/admin/consultantManagementController.js):**
- Consultant CRUD
- Availability management
- Workload balancing (pick least busy consultant)
- Session assignment logic

**Admin UI Components:**
- `client/src/admin/pages/ConsultantManagement.jsx`
- `client/src/admin/pages/ConsultantAvailability.jsx`
- Consultant list with filter/search
- Availability calendar editor

**Why It's Safe:**
- ✅ New tables only (no schema changes to existing)
- ✅ New routes isolated in admin namespace
- ✅ No changes to existing consulting API
- ✅ Fully reversible via migration rollback

---

## PHASE 2: Scheduling & Session Management (1-2 hours)
### Goal: Allow consultants to book sessions and track availability

**New Database Tables (Migration 104):**
- `consulting_sessions_scheduled` table (extend consulting_sessions instead)
  - session_id (FK), scheduled_date, scheduled_time, duration_minutes
  - meeting_url (Zoom/Google Meet link), notes_for_session
  - reminder_sent (bool), status (pending_confirmation/confirmed/completed/no_show)
  - created_at, updated_at
  - Index on (scheduled_date, scheduled_time)

- `consulting_session_notes` table
  - id, session_id (FK), consultant_id (FK), note_type (phase_assessment/deliverable/action_items)
  - content (TEXT), is_internal (bool), created_at, updated_at
  - Partial index on (session_id, is_internal = false) for client-visible notes

**New API Routes (server/routes/consulting/scheduling.js):**
- `POST /api/consulting/:sessionId/schedule` - Schedule a session
- `GET /api/consulting/:sessionId/schedule` - Get scheduled time
- `PUT /api/consulting/:sessionId/reschedule` - Reschedule session
- `POST /api/consulting/:sessionId/notes` - Add session notes
- `GET /api/consulting/:sessionId/notes` - Get session notes (filtered for client)
- `GET /api/consultants/:id/availability-slots` - Get available time slots for consultant

**New Controller (server/controllers/consultingSchedulingController.js):**
- Schedule session with conflict detection
- Generate meeting URLs (Zoom/Google Meet API)
- Send calendar invites via email
- Session notes management (separate public/internal)

**Frontend Components:**
- `client/src/pages/ConsultingSchedulingPage.jsx` - Session scheduling UI
- `client/src/components/ConsultingCalendar.tsx` - Calendar view
- `client/src/components/ConsultantAvailabilityPicker.tsx` - Slot selection
- `client/src/pages/ConsultingSessionDetail.jsx` - Session detail + notes

**Why It's Safe:**
- ✅ New tables/routes (additive)
- ✅ No changes to auth/payment
- ✅ Uses existing email infrastructure
- ✅ Consultant availability not linked to user availability (separate table)

---

## PHASE 3: Session Delivery & Progress Tracking (1.5 hours)
### Goal: Track session outcomes and client progress through 30-phase framework

**New Database Tables (Migration 105):**
- `consulting_session_phases` table
  - session_id (FK), current_phase (1-30), phase_name, description
  - milestone_1/2/3 (optional sub-milestones), completed_at, progress_pct
  - phase_notes (JSONB with key learnings)
  - Index on (session_id, current_phase)

- `consulting_deliverables` table
  - id, session_id (FK), name, description, due_date, status
  - deliverable_type (sop/contract/financial_tracker/marketing_plan/etc)
  - file_url (S3 link), completed_date, notes
  - Index on (session_id, status)

- `consulting_action_items` table
  - id, session_id (FK), title, description, assigned_to (consultant or client)
  - due_date, status (pending/in_progress/completed), priority
  - client_visible (bool), created_at
  - Index on (session_id, status)

**New API Routes (server/routes/consulting/progress.js):**
- `GET /api/consulting/:sessionId/progress` - Client progress view
- `PATCH /api/consulting/:sessionId/phase` - Update phase (consultant-only)
- `POST /api/consulting/:sessionId/deliverables` - Create deliverable
- `GET /api/consulting/:sessionId/deliverables` - List deliverables
- `POST /api/consulting/:sessionId/action-items` - Create action item
- `PATCH /api/consulting/:sessionId/action-items/:itemId` - Update action item

**New Controller (server/controllers/consultingProgressController.js):**
- Phase progression logic
- Milestone tracking
- Deliverable upload/storage
- Action item management
- Client-vs-internal filtering

**Frontend Components:**
- `client/src/pages/ConsultingProgressDashboard.jsx` - Client phase view
- `client/src/components/PhaseVisualizer.tsx` - Interactive phase map (1-30)
- `client/src/components/DeliverablesList.tsx` - Deliverables & templates
- `client/src/components/ActionItemsList.tsx` - Checklist of next steps

**Why It's Safe:**
- ✅ New tables only (no existing schema changes)
- ✅ New isolated routes
- ✅ Uses existing S3 storage infrastructure
- ✅ Client filtering is logic-only (no auth changes)

---

## PHASE 4: Pricing & Payment Management (1.5 hours)
### Goal: Manage consulting packages and handle payments (no changes to existing Stripe)

**New Database Tables (Migration 106):**
- `consulting_packages` table
  - id, tier (initial/foundation/implementation/transformation)
  - name, description, price_cents, duration_hours, session_count
  - includes_features (JSONB: deliverables, templates, support_hours, etc)
  - is_active (bool), created_at, updated_at
  - Index on (tier, is_active)

- `consulting_purchases` table
  - id, user_id (FK), package_id (FK), purchase_date, payment_intent_id (Stripe)
  - status (pending/completed/refunded), total_cost_cents
  - sessions_used (int), sessions_remaining (int)
  - expires_at (null for lifetime), notes
  - Index on (user_id, status)

- `consulting_invoices` table
  - id, purchase_id (FK), invoice_number, amount_cents, issued_date, due_date
  - status (draft/sent/paid/overdue), file_url (S3)
  - Index on (user_id, issued_date)

**New API Routes (server/routes/consulting/payments.js):**
- `GET /api/consulting/packages` - List available packages
- `POST /api/consulting/purchase` - Create payment intent for package
- `GET /api/consulting/my-purchases` - Get user's consulting packages (authenticated)
- `GET /api/admin/consulting/invoices` - List invoices (admin)
- `POST /api/admin/consulting/generate-invoice` - Generate invoice (admin)

**New Controller (server/controllers/consultingPaymentController.js):**
- Package listing
- Payment intent creation (reuses existing Stripe integration)
- Invoice generation (via HTML template → PDF)
- Purchase tracking
- Session credit tracking

**No Stripe Logic Changes:**
- ✅ Uses existing `stripe.paymentIntents.create()` 
- ✅ Hooks into existing webhook handler
- ✅ Payment status tracked in `consulting_purchases`, not modifying `payments` table

**Frontend Components:**
- `client/src/pages/ConsultingPackages.jsx` - Package browser & purchase
- `client/src/pages/ConsultingInvoices.jsx` - User invoice history

**Why It's Safe:**
- ✅ New tables (no existing payment schema changes)
- ✅ Reuses existing Stripe integration
- ✅ Separate purchase tracking (doesn't interfere with job payments)
- ✅ Invoice generation is isolated feature

---

## PHASE 5: Client Portal & Dashboard (1.5 hours)
### Goal: Dedicated consulting client view with progress & resources

**New Database Tables (Migration 107):**
- `consulting_resources` table
  - id, package_id (FK), resource_type (template/guide/tool/checklist)
  - name, description, file_url (S3), category
  - is_public (bool), created_at
  - Index on (package_id, resource_type)

- `consulting_client_preferences` table
  - user_id (FK, unique), preferred_contact_method, timezone, communication_frequency
  - newsletter_opt_in, reminder_preferences (JSONB)

**New Routes (server/routes/consulting/portal.js):**
- `GET /api/consulting/portal/dashboard` - Client dashboard data
- `GET /api/consulting/portal/resources` - Available templates/guides
- `GET /api/consulting/portal/sessions` - Upcoming sessions
- `GET /api/consulting/portal/progress-summary` - Phase & milestones
- `POST /api/consulting/portal/preferences` - Save preferences

**New Controller (server/controllers/consultingPortalController.js):**
- Aggregate session, phase, deliverable, action-item data
- Resource library filtered by package
- Progress calculation (phase %, milestones completed, etc)
- Preference management

**Frontend Pages:**
- `client/src/pages/ConsultingPortal/Dashboard.jsx` - Main portal
- `client/src/pages/ConsultingPortal/PhaseMap.jsx` - Interactive 30-phase visualization
- `client/src/pages/ConsultingPortal/Resources.jsx` - Template/guide library
- `client/src/pages/ConsultingPortal/UpcomingSessions.jsx` - Calendar
- `client/src/pages/ConsultingPortal/Progress.jsx` - Milestones & KPIs

**Router Updates:**
- Add `/consulting/portal/*` routes (authenticated, requires active package)

**Why It's Safe:**
- ✅ New tables (additive)
- ✅ New route namespace (no conflicts)
- ✅ No existing auth changes (reuses authenticate middleware)
- ✅ Simple data aggregation queries

---

## PHASE 6: Analytics & KPI Tracking (1 hour)
### Goal: Track success metrics (phase advancement, revenue, satisfaction)

**New Database Tables (Migration 108):**
- `consulting_metrics` table
  - id, consulting_purchase_id (FK), metric_type (phase_advancement/revenue_growth/satisfaction/goal_completion)
  - baseline_value, current_value, target_value, measurement_date
  - notes (JSONB), created_at
  - Index on (consulting_purchase_id, metric_type, measurement_date)

- `consulting_session_feedback` table
  - id, session_id (FK), user_id (FK), nps_score (0-10)
  - feedback_text, session_quality_rating (1-5)
  - would_recommend (bool), created_at
  - Composite index on (session_id, user_id)

**New Routes (server/routes/admin/consultingAnalytics.js):**
- `GET /api/admin/consulting/metrics` - KPI dashboard
- `GET /api/admin/consulting/success-rate` - % of clients advancing phases
- `GET /api/admin/consulting/revenue-report` - Revenue by tier/month
- `GET /api/admin/consulting/nps` - Net Promoter Score
- `GET /api/admin/consulting/consultant-performance` - Per-consultant stats

**New Controller (server/controllers/admin/consultingAnalyticsController.js):**
- Query builder for KPI reports
- Success metrics calculation (per oxsteed_consulting.md)
- Performance dashboards

**Admin UI:**
- `client/src/admin/pages/ConsultingAnalytics.jsx` - Metrics dashboard
- Charts: phase advancement, revenue trends, consultant utilization, NPS

**Why It's Safe:**
- ✅ New tables (no schema changes to existing)
- ✅ New admin routes (isolated)
- ✅ Read-only analytics (no data modification logic)

---

## PHASE 7: Marketing & Onboarding Workflow (1 hour)
### Goal: Automatic prompts & referral tracking

**New Database Tables (Migration 109):**
- `consulting_referrals` table
  - id, referrer_id (FK), referred_user_id (FK), status (pending/completed)
  - referral_credit_amount_cents, credited_at, created_at
  - Index on (referrer_id, status)

- `consulting_prompts` table
  - id, user_id (FK), prompt_type (skill_monetizer/early_operator/growth_builder/etc)
  - activity_threshold_metric (jobs_completed, earnings, etc), triggered_at
  - dismissed_at, converted_at (when they purchase)
  - Index on (user_id, converted_at)

**New Routes (server/routes/consulting/marketing.js):**
- `GET /api/consulting/my-referral-status` - User referral credits
- `POST /api/consulting/invite-referral` - Send referral link
- `GET /api/consulting/prompts` - Get active prompts for user (internal banner)

**New Controller (server/controllers/consultingMarketingController.js):**
- Referral tracking & credit calculation
- Prompt eligibility checking (based on activity)
- Email invite generation

**Cron Job (server/jobs/consultingPrompts.js):**
- Daily: Check helper/customer milestones
- Trigger prompt if they've completed X jobs, earned Y dollars, etc
- Create `consulting_prompts` row (shows banner on dashboard)

**Frontend Components:**
- `client/src/components/ConsultingPrompt.tsx` - Banner/dismissible prompt
- Display in Dashboard.jsx when active

**Why It's Safe:**
- ✅ New tables (additive)
- ✅ Cron job is isolated (no changes to existing jobs)
- ✅ Prompts are UI-only (no auth changes)
- ✅ Referral tracking doesn't affect payments

---

## Summary: What Can Be Built Non-Breaking

| Phase | What Gets Built | Risk Level | Time | Dependencies |
|-------|-----------------|-----------|------|--------------|
| 1 | Consultant management & assignment | ✅ LOW | 1-2h | Migration 103 |
| 2 | Scheduling & session booking | ✅ LOW | 1-2h | Migration 104, Phase 1 |
| 3 | Session delivery & progress | ✅ LOW | 1.5h | Migration 105, Phase 2 |
| 4 | Pricing & payments | ✅ LOW | 1.5h | Migration 106, existing Stripe |
| 5 | Client portal & dashboard | ✅ LOW | 1.5h | Migration 107, Phases 1-4 |
| 6 | Analytics & KPIs | ✅ LOW | 1h | Migration 108, Phase 5 |
| 7 | Marketing & onboarding | ✅ LOW | 1h | Migration 109, existing jobs |

**Total Estimate: 7.5-8.5 hours**

**Each phase:**
- ✅ Uses only NEW tables (0 modifications to existing schema)
- ✅ Creates isolated API endpoints
- ✅ Adds standalone React components
- ✅ Zero changes to auth, jobs, payments, or existing business logic
- ✅ Fully reversible via migrations
- ✅ Can be deployed independently
- ✅ Won't break existing tests

---

## Implementation Safety Checklist

Before each phase:
- [ ] Create migration file only (no existing table changes)
- [ ] Create new route file (don't modify existing routes)
- [ ] Create new controller file (isolated logic)
- [ ] Create new components (standalone, no prop changes to existing components)
- [ ] Add i18n keys (additive to existing locales)
- [ ] No changes to existing middleware
- [ ] No changes to existing service layer
- [ ] No modifications to `package.json` beyond what's already needed

After each phase:
- [ ] Verify migration syntax: `node -c server/migrations/###_*.sql`
- [ ] Test new routes in isolation
- [ ] Verify no existing routes are affected
- [ ] Check JSON locales are valid: `node -e "JSON.parse(require('fs').readFileSync(...))"`
- [ ] Commit with clear migration message

---

## What This Approach Enables

✅ Deployment can succeed at ANY phase (migrations are applied in order)
✅ Can roll back any phase without affecting others
✅ Existing code is 100% untouched
✅ Easy to test each phase independently
✅ Can pause/resume development without breaking anything
✅ Non-blocking for other team members working on different features

