// Support Routes - Phase 1: Agent Infrastructure, Hiring, Shifts, Queue, Conversations
const express = require('express');
const router = express.Router();

const { requireAuth, optionalAuth } = require('../middleware/auth');
const supportAgentsController = require('../controllers/supportAgentsController');
const supportTicketController = require('../controllers/supportController');
const agentShiftsController = require('../controllers/agentShiftsController');
const supportConversationsController = require('../controllers/supportConversationsController');
const conversationAssignmentController = require('../controllers/conversationAssignmentController');
const queueController = require('../controllers/queueController');
const businessSupportSettingsController = require('../controllers/businessSupportSettingsController');
const agentOnboardingController = require('../controllers/agentOnboardingController');
const knowledgeBaseController = require('../controllers/knowledgeBaseController');
const cannedResponsesController = require('../controllers/cannedResponsesController');
const aiChatbotController = require('../controllers/aiChatbotController');
const conversationMessageController = require('../controllers/conversationMessageController');
const slaMetricsController = require('../controllers/slaMetricsController');
const performanceAnalyticsController = require('../controllers/performanceAnalyticsController');
const satisfactionSurveyController = require('../controllers/satisfactionSurveyController');
const escalationPoliciesController = require('../controllers/escalationPoliciesController');
const supportTeamsController = require('../controllers/supportTeamsController');
const skillBasedRoutingController = require('../controllers/skillBasedRoutingController');
const supportAgentPortalController = require('../controllers/supportAgentPortalController');
const supportQualityController = require('../controllers/supportQualityController');
const supportFollowUpReminderController = require('../controllers/supportFollowUpReminderController');
const supportEmployerService = require('../services/supportEmployerService');
const db = require('../db');
const { authenticatedLimiter, conversationMessageLimiter } = require('../middleware/rateLimiter');
const { sendValidationError } = require('../utils/apiError');
const publicSupport = require('../controllers/publicSupportController');
const SupportRoutingService = require('../services/supportRoutingService');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const DAY_NAMES = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return fallback;
}

router.post('/public/conversations', conversationMessageLimiter, publicSupport.createGuestConversation);
router.post('/public/conversations/:conversationId/verify', conversationMessageLimiter, publicSupport.verifyGuestConversation);
router.post('/public/conversations/:conversationId/resend-code', conversationMessageLimiter, publicSupport.resendGuestVerification);
router.get('/public/conversations/:conversationId', publicSupport.guestToken, publicSupport.loadGuestConversation);
router.post('/public/conversations/:conversationId/messages', conversationMessageLimiter, upload.single('file'), validateFileUpload, publicSupport.guestToken, publicSupport.addGuestMessage);
router.put('/public/conversations/:conversationId/messages/:messageId', conversationMessageLimiter, publicSupport.guestToken, publicSupport.updateGuestMessage);
router.get('/public/conversations/:conversationId/download', publicSupport.guestToken, publicSupport.downloadGuestConversation);
router.post('/public/conversations/:conversationId/review', conversationMessageLimiter, publicSupport.guestToken, publicSupport.createGuestConversationReview);
router.post('/public/conversations/:conversationId/reopen', conversationMessageLimiter, publicSupport.guestToken, publicSupport.reopenGuestConversation);

// Public/customer ticket entry point. Guests can create tickets, and signed-in
// users are linked automatically when a valid bearer token is present.
router.post('/request', authenticatedLimiter, optionalAuth, supportTicketController.submitSupportRequest);

// All routes require authentication
router.use(requireAuth);

// Authenticated customer ticket lifecycle.
router.get('/my-tickets', supportTicketController.getMyTickets);
router.get('/my-tickets/:ticketId', supportTicketController.getMyTicket);
router.post('/my-tickets/:ticketId/reply', supportTicketController.replyToMyTicket);

// ============================================
// AGENT SELF-SERVICE PORTAL (must precede /:businessId/*)
// ============================================
router.get('/agent/me', supportAgentPortalController.getMyEmployments);
router.patch('/agent/me/availability', supportAgentPortalController.patchMyAvailability);
router.get('/agent/opportunities', supportAgentPortalController.getAgentOpportunities);
router.get('/agent/applications', supportAgentPortalController.getMyApplications);
router.get('/hiring/my-businesses', businessSupportSettingsController.listMyHiringProfiles);

// ============================================
// SUPPORT EMPLOYERS (multi-tenant hiring scope)
// ============================================
router.get('/employers/me', agentOnboardingController.listMySupportEmployers);
router.post('/employers/helper', agentOnboardingController.ensureMyHelperEmployer);

// ============================================
// AGENT ONBOARDING (Hiring Flow)
// ============================================

// User applies to be an agent (body may include businessId; or use legacy path below)
router.post('/apply', agentOnboardingController.applyToBeAgent);

// User applies to be an agent (legacy: businessId in path)
router.post('/:businessId/apply', agentOnboardingController.applyToBeAgent);

// Get user's application status
router.get('/:businessId/my-application', agentOnboardingController.getMyApplicationStatus);

// Admin: Get all applications
router.get('/:businessId/applications', agentOnboardingController.getApplications);

// Admin: Get single application
router.get('/:businessId/applications/:applicationId', agentOnboardingController.getApplication);

// Admin: Review application (approve/reject)
router.put('/:businessId/applications/:applicationId/review', agentOnboardingController.reviewApplication);

// Admin: Approve and hire agent
router.post('/:businessId/applications/:applicationId/hire', agentOnboardingController.approveAndHire);

// Admin: Get application statistics
router.get('/:businessId/applications-stats', agentOnboardingController.getApplicationStats);

// ============================================
// AGENT MANAGEMENT
// ============================================

// Get all agents for a business
router.get('/:businessId/agents', supportAgentsController.listAgents);

// Get single agent
router.get('/:businessId/agents/:agentId', supportAgentsController.getAgent);

// Update agent status (active, inactive, paused, training)
router.put('/:businessId/agents/:agentId/status', supportAgentsController.updateAgentStatus);

// Set agent availability (available/offline)
router.put('/:businessId/agents/:agentId/availability', supportAgentsController.setAgentAvailability);

// Add skill to agent
router.post('/:businessId/agents/:agentId/skills', supportAgentsController.addAgentSkill);

// Get agent availability log
router.get('/:businessId/agents/:agentId/availability-log', supportAgentsController.getAvailabilityLog);

// ============================================
// AGENT SHIFTS
// ============================================

// Get agent's shifts for date range
router.get('/:businessId/agents/:agentId/shifts', agentShiftsController.getAgentShifts);

// Create scheduled shift
router.post('/:businessId/agents/:agentId/shifts', agentShiftsController.createShift);

// Clock in
router.post('/:businessId/agents/:agentId/clock-in', agentShiftsController.clockIn);

// Clock out
router.post('/:businessId/agents/:agentId/clock-out', agentShiftsController.clockOut);

// Start break
router.post('/:businessId/agents/:agentId/break-start', agentShiftsController.startBreak);

// End break
router.post('/:businessId/agents/:agentId/break-end', agentShiftsController.endBreak);

// Get shift templates (recurring schedules)
router.get('/:businessId/agents/:agentId/shift-templates', agentShiftsController.getShiftTemplate);

// Set shift template
router.post('/:businessId/agents/:agentId/shift-templates', agentShiftsController.setShiftTemplate);

// ============================================
// SUPPORT CONVERSATIONS (Tickets)
// ============================================

async function resolveSupportBusinessId(req) {
  if (req.body.businessId || req.body.business_id) return req.body.businessId || req.body.business_id;
  if (req.query.business_id || req.query.businessId) return req.query.business_id || req.query.businessId;

  const { rows } = await db.query(
    `SELECT id
     FROM businesses
     WHERE is_active = TRUE
     ORDER BY is_primary DESC, created_at ASC
     LIMIT 1`
  );
  return rows[0]?.id || null;
}

// Customers should not be able to place a ticket in an arbitrary business
// queue. Platform admins retain explicit business selection for operations.
async function resolveCustomerSupportBusinessId(req) {
  if (supportEmployerService.isPlatformAdmin(req.user.role)) {
    return resolveSupportBusinessId(req);
  }
  const { rows } = await db.query(
    `SELECT id
     FROM businesses
     WHERE is_active = TRUE
     ORDER BY is_primary DESC, created_at ASC
     LIMIT 1`
  );
  return rows[0]?.id || null;
}

async function supportBusinessFromRequest(req) {
  return resolveSupportBusinessId(req);
}

async function canManageSupportBusiness(req, businessId) {
  if (!businessId) return false;
  if (supportEmployerService.isPlatformAdmin(req.user.role)) return true;
  // Support agents can work conversations, but management surfaces require
  // an owner, manager, or representative membership.
  return supportEmployerService.userCanAdministrateBusiness(businessId, req.user.id);
}

function serializeKnowledgeArticle(row) {
  return {
    ...row,
    category: row.category || 'general',
    tags: Array.isArray(row.tags) ? row.tags : (Array.isArray(row.keywords) ? row.keywords : []),
    views: Number(row.views || row.view_count || 0),
  };
}

async function supportConversationStats(businessId) {
  const conditions = [];
  const params = [];
  const agentScope = businessId
    ? `(se.kind = 'platform' OR se.business_id = $1::integer)`
    : 'TRUE';
  if (businessId) {
    params.push(businessId);
    conditions.push(`business_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int AS total_conversations,
       COALESCE(SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END), 0)::int AS resolved_conversations,
       COALESCE(SUM(CASE WHEN status NOT IN ('resolved','closed') THEN 1 ELSE 0 END), 0)::int AS active_conversations,
       COALESCE(SUM(CASE WHEN priority IN ('high','urgent') THEN 1 ELSE 0 END), 0)::int AS priority_conversations,
       COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(first_response_at, updated_at) - created_at)))::numeric), 0)::int AS avg_response_time_seconds,
       COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at))/3600)::numeric, 1), 0)::float AS avg_resolution_hours,
       COALESCE(SUM(CASE
         WHEN first_response_at IS NOT NULL
          AND first_response_at - created_at <= CASE priority
            WHEN 'urgent' THEN INTERVAL '15 minutes'
            WHEN 'high' THEN INTERVAL '1 hour'
            WHEN 'low' THEN INTERVAL '24 hours'
            ELSE INTERVAL '4 hours'
          END THEN 1 ELSE 0 END), 0)::int AS sla_met_count,
       COALESCE(SUM(CASE
         WHEN (first_response_at IS NOT NULL
           AND first_response_at - created_at > CASE priority
             WHEN 'urgent' THEN INTERVAL '15 minutes'
             WHEN 'high' THEN INTERVAL '1 hour'
             WHEN 'low' THEN INTERVAL '24 hours'
             ELSE INTERVAL '4 hours'
           END)
           OR (first_response_at IS NULL
           AND NOW() - created_at > CASE priority
             WHEN 'urgent' THEN INTERVAL '15 minutes'
             WHEN 'high' THEN INTERVAL '1 hour'
             WHEN 'low' THEN INTERVAL '24 hours'
             ELSE INTERVAL '4 hours'
           END) THEN 1 ELSE 0 END), 0)::int AS sla_violation_count
       ,(SELECT COUNT(*)::int
         FROM support_agents sa
         JOIN support_employers se ON se.id = sa.employer_id
         WHERE sa.status = 'active' AND ${agentScope}) AS active_agents
     FROM support_conversations
     ${where}`,
    params
  );
  const stats = rows[0] || {};
  const total = Number(stats.total_conversations || 0);
  const resolved = Number(stats.resolved_conversations || 0);
  return {
    ...stats,
    resolution_rate: total ? Math.round((resolved / total) * 100) : 0,
  };
}

router.get('/conversations', async (req, res, next) => {
  try {
    const businessId = await resolveSupportBusinessId(req);
    const isPlatformAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const platformAgent = isPlatformAdmin
      ? null
      : await supportEmployerService.findPlatformAgent(req.user.id);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const search = String(req.query.search || '').trim().slice(0, 200);
    const channel = String(req.query.channel || '').trim().toLowerCase();
    if (channel && !['web_chat', 'email', 'sms', 'phone', 'social'].includes(channel)) {
      return sendValidationError(res, { channel: 'Invalid support channel' });
    }

    if (isPlatformAdmin || platformAgent) {
      const params = [];
      let where = req.query.business_id || req.query.businessId
        ? `WHERE sc.business_id = $${params.push(businessId)}`
        : "WHERE sc.status <> 'pending_verification'";
      if (search) {
        const searchParam = `$${params.push(`%${search}%`)}`;
        where += ` AND (
          COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''), cu.email, sc.guest_name, '') ILIKE ${searchParam}
          OR COALESCE(cu.email, sc.guest_email, '') ILIKE ${searchParam}
          OR COALESCE(sc.subject, '') ILIKE ${searchParam}
          OR COALESCE(sc.description, '') ILIKE ${searchParam}
          OR EXISTS (
            SELECT 1 FROM support_conversation_messages search_scm
            WHERE search_scm.conversation_id = sc.id
              AND search_scm.content ILIKE ${searchParam}
          )
        )`;
      }
      if (channel) {
        where += ` AND sc.channel = $${params.push(channel)}`;
      }
      const limitParam = `$${params.push(limit)}`;
      const offsetParam = `$${params.push(offset)}`;
      const { rows } = await db.query(
        `SELECT
           sc.*,
           sa.user_id AS agent_user_id,
           COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''), cu.email, sc.guest_name) AS customer_name,
           COALESCE(cu.email, sc.guest_email) AS customer_email,
           COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''), au.email) AS agent_name,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', scm.id,
                 'text', scm.content,
                 'content', scm.content,
                 'is_agent', scm.is_agent,
                 'is_from_agent', scm.is_agent,
                 'created_at', scm.created_at
               ) ORDER BY scm.created_at ASC
             ) FILTER (WHERE scm.id IS NOT NULL),
             '[]'::jsonb
           ) AS messages,
           COALESCE(
             (array_agg(scm.content ORDER BY scm.created_at DESC) FILTER (WHERE scm.id IS NOT NULL))[1],
             sc.description,
             ''
           ) AS last_message
           ,COUNT(scm.id) FILTER (
             WHERE scm.is_agent = FALSE
               AND COALESCE(scm.message_type, 'text') <> 'internal_note'
               AND scm.read_by_recipient = FALSE
           )::int AS unread_count
         FROM support_conversations sc
         LEFT JOIN users cu ON cu.id = sc.customer_id
         LEFT JOIN support_agents sa ON sa.id = sc.agent_id
         LEFT JOIN users au ON au.id = sa.user_id
         LEFT JOIN support_conversation_messages scm ON scm.conversation_id = sc.id
         ${where}
         GROUP BY sc.id, cu.id, au.id, sa.id
         ORDER BY sc.updated_at DESC, sc.created_at DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );
      return res.json({
        conversations: rows,
        pagination: { limit, offset, returned: rows.length, hasMore: rows.length === limit },
      });
    }

    if (businessId && (req.query.business_id || req.query.businessId)) {
      req.params.businessId = businessId;
      return supportConversationsController.listConversations(req, res, next);
    }

    const { rows } = await db.query(
      `SELECT
         sc.*,
         COALESCE(sc.description, '') AS last_message
       FROM support_conversations sc
       WHERE sc.customer_id = $1
       ORDER BY sc.updated_at DESC, sc.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    return res.json({ conversations: rows });
  } catch (err) {
    next(err);
  }
});

// QA review queue for completed conversations. Results are scoped to the
// caller's platform or business support access and never expose to customers.
router.get('/qa/reviews', supportQualityController.listReviews);
router.post('/qa/reviews/:conversationId', conversationMessageLimiter, supportQualityController.saveReview);

router.get('/follow-up-reminders', supportFollowUpReminderController.listReminders);
router.post('/conversations/:conversationId/follow-up-reminders', conversationMessageLimiter, supportFollowUpReminderController.createReminder);
router.patch('/follow-up-reminders/:reminderId', conversationMessageLimiter, supportFollowUpReminderController.updateReminder);

router.post('/conversations', conversationMessageLimiter, async (req, res, next) => {
  try {
    const businessId = await resolveCustomerSupportBusinessId(req);
    if (!businessId) return res.status(400).json({ error: 'No support business is available' });
    req.body = {
      ...req.body,
      businessId,
      subject: req.body.subject || `${req.body.category || 'General'} support request`,
      description: req.body.description || req.body.message || '',
    };
    return supportConversationsController.createConversation(req, res, next);
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:conversationId', supportConversationsController.getConversation);
router.get('/conversations/:conversationId/lifecycle', supportConversationsController.getConversationLifecycle);
router.get('/conversations/:conversationId/customer-360', supportConversationsController.getCustomer360);
router.get('/conversations/:conversationId/download', supportConversationsController.downloadConversation);
router.post('/conversations/:conversationId/mark-all-read', conversationMessageLimiter, supportConversationsController.markConversationRead);

router.post('/conversations/:conversationId/message', conversationMessageLimiter, upload.single('file'), validateFileUpload, (req, res, next) => {
  req.body = {
    ...req.body,
    content: req.body.content || req.body.message,
    attachmentUrl: req.body.attachmentUrl || req.body.attachments?.[0]?.url,
    attachmentName: req.body.attachmentName || req.body.attachments?.[0]?.name,
    isInternal: parseBoolean(req.body.isInternal ?? req.body.is_internal),
  };
  return supportConversationsController.addMessage(req, res, next);
});
router.put('/conversations/:conversationId/messages/:messageId', conversationMessageLimiter, supportConversationsController.updateCustomerMessage);
router.put('/conversations/:conversationId/agent-messages/:messageId', conversationMessageLimiter, supportConversationsController.updateAgentMessage);
router.post('/conversations/:conversationId/messages/:messageId/redact', conversationMessageLimiter, supportConversationsController.redactSupportMessage);
router.post('/conversations/:conversationId/review', conversationMessageLimiter, supportConversationsController.createConversationReview);
router.post('/conversations/:conversationId/reopen', conversationMessageLimiter, supportConversationsController.reopenCustomerConversation);
router.post('/conversations/:conversationId/merge', conversationMessageLimiter, supportConversationsController.mergeConversation);
router.post('/conversations/:conversationId/email', conversationMessageLimiter, supportConversationsController.sendConversationEmail);
router.post('/conversations/:conversationId/email/retry-failed', conversationMessageLimiter, supportConversationsController.retryConversationEmailDelivery);

router.put('/conversations/:conversationId/status', supportConversationsController.updateConversationStatus);
router.post('/conversations/:conversationId/claim', conversationAssignmentController.claimConversation);
router.post('/conversations/:conversationId/assign', conversationAssignmentController.assignToAgent);
router.post('/conversations/:conversationId/reassign', (req, res, next) => {
  req.body = {
    ...req.body,
    newAgentId: req.body.newAgentId || req.body.agentId || req.body.agent_id,
  };
  return conversationAssignmentController.reassignAgent(req, res, next);
});
router.post('/conversations/:conversationId/release', conversationAssignmentController.releaseConversation);

router.get('/agents/dashboard', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId;
    if (businessId) {
      const allowed = await supportEmployerService.userCanAccessBusinessConversations(
        businessId,
        req.user.id,
        req.user.role
      );
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    } else if (!supportEmployerService.isPlatformAdmin(req.user.role)) {
      return res.status(400).json({ error: 'business_id is required' });
    }
    const stats = await supportConversationStats(businessId);
    const { rows: agentRows } = await db.query(
      `SELECT
         sa.id,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
         COALESCE(sa.role, 'agent') AS role,
         sa.is_available,
         sa.status,
         COALESCE(sa.total_conversations_handled, 0) AS total_chats,
         COUNT(ca.id)::int AS active_chats
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       JOIN support_employers se ON se.id = sa.employer_id
       LEFT JOIN conversation_assignments ca
         ON ca.agent_id = sa.id AND ca.status = 'active'
       WHERE ($1::integer IS NULL OR se.kind = 'platform' OR se.business_id = $1::integer)
       GROUP BY sa.id, u.id
       ORDER BY sa.is_available DESC, sa.updated_at DESC
       LIMIT 25`,
      [businessId || null]
    );
    const availability = await SupportRoutingService.getLiveAvailability(businessId || null);
    const diagnosticsById = new Map(availability.diagnostics.map((item) => [String(item.id), item]));
    const agents = agentRows.map((agent) => ({
      ...agent,
      live_ready: diagnosticsById.get(String(agent.id))?.liveReady || false,
      availability_reason: diagnosticsById.get(String(agent.id))?.reason || (!agent.is_available ? 'manually_unavailable' : 'not_eligible'),
    }));
    const conversationParams = [businessId || null];
    const { rows: activeConversations } = await db.query(
      `SELECT
         sc.id,
         sc.business_id,
         sc.subject,
         sc.priority,
         sc.status,
         sc.created_at,
         sc.updated_at,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''), cu.email, sc.guest_name, 'Customer') AS customer_name,
         CASE
           WHEN sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL
             THEN COALESCE(cu.email, sc.guest_email)
           ELSE NULL
         END AS customer_email,
         sc.guest_verified_at,
         sc.live_wait_started_at,
         sc.live_wait_expires_at,
         sc.live_wait_ended_at,
         sc.first_response_at,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''), au.email, 'Unassigned') AS agent_name,
         COALESCE(
           (SELECT scm.content
            FROM support_conversation_messages scm
            WHERE scm.conversation_id = sc.id AND scm.message_type <> 'internal_note'
            ORDER BY scm.created_at DESC
            LIMIT 1),
           sc.description,
           ''
         ) AS last_message,
         GREATEST(0, EXTRACT(EPOCH FROM (NOW() - sc.created_at)))::int AS duration_seconds
       FROM support_conversations sc
       LEFT JOIN users cu ON cu.id = sc.customer_id
       LEFT JOIN support_agents sa ON sa.id = sc.agent_id
       LEFT JOIN users au ON au.id = sa.user_id
       WHERE sc.status NOT IN ('resolved', 'closed')
         AND ($1::integer IS NULL OR sc.business_id = $1::integer)
       ORDER BY CASE sc.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
                sc.updated_at DESC
       LIMIT 50`,
      conversationParams
    );
    const { rows: missedConversations } = await db.query(
      `SELECT
         sc.id, sc.subject, sc.status, sc.created_at, sc.updated_at,
         sc.guest_verified_at, sc.live_wait_started_at, sc.live_wait_ended_at,
         (SELECT MAX(scm.created_at) FROM support_conversation_messages scm
          WHERE scm.conversation_id = sc.id AND scm.message_type = 'outbound_email'
            AND scm.status = 'sent') AS followed_up_at,
         (SELECT COUNT(*)::int FROM support_conversation_messages scm
          WHERE scm.conversation_id = sc.id AND scm.message_type = 'outbound_email'
            AND scm.status = 'sent') AS follow_up_count,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''), cu.email, sc.guest_name, 'Customer') AS customer_name,
         CASE
           WHEN sc.customer_id IS NOT NULL OR sc.guest_verified_at IS NOT NULL
             THEN COALESCE(cu.email, sc.guest_email)
           ELSE NULL
         END AS customer_email,
         COALESCE(
           (SELECT scm.content FROM support_conversation_messages scm
            WHERE scm.conversation_id = sc.id AND scm.is_agent = FALSE
              AND scm.message_type <> 'internal_note'
            ORDER BY scm.created_at DESC LIMIT 1),
           sc.description, ''
         ) AS last_message
       FROM support_conversations sc
       LEFT JOIN users cu ON cu.id = sc.customer_id
       WHERE sc.live_wait_ended_at IS NOT NULL
         AND sc.status <> 'pending_verification'
         AND ($1::integer IS NULL OR sc.business_id = $1::integer)
       ORDER BY sc.live_wait_ended_at DESC
       LIMIT 50`,
      conversationParams
    );
    res.json({
      stats: {
        agents_online: availability.liveAvailableAgents,
        marked_available_agents: availability.markedAvailableAgents,
        available_capacity: availability.availableCapacity,
        active_conversations: stats.active_conversations || 0,
        avg_response_time_seconds: stats.avg_response_time_seconds || 0,
        resolution_rate: stats.resolution_rate || 0,
      },
      agents,
      active_conversations: activeConversations,
      missed_conversations: missedConversations,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/agents', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId;
    if (businessId) {
      const allowed = await supportEmployerService.userCanAccessBusinessConversations(
        businessId,
        req.user.id,
        req.user.role
      );
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    } else if (!supportEmployerService.isPlatformAdmin(req.user.role)) {
      return res.status(400).json({ error: 'business_id is required' });
    }
    const search = String(req.query.search || '').trim();
    const params = [businessId || null];
    let searchSql = '';
    if (search) {
      params.push(`%${search}%`);
      searchSql = `AND (u.email ILIKE $2 OR u.first_name ILIKE $2 OR u.last_name ILIKE $2)`;
    }
    const { rows } = await db.query(
      `SELECT
         sa.id,
         sa.user_id,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
         u.email,
         COALESCE(sa.role, 'agent') AS role,
         COALESCE(sa.department, 'general') AS department,
         sa.status,
         (sa.status = 'active') AS is_active,
         sa.is_available,
         COALESCE(sa.total_conversations_handled, 0) AS chats_today,
         COALESCE(sa.avg_rating, 0) AS rating,
         ARRAY[]::text[] AS skills
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       JOIN support_employers se ON se.id = sa.employer_id
       WHERE ($1::integer IS NULL OR se.kind = 'platform' OR se.business_id = $1::integer) ${searchSql}
       ORDER BY sa.updated_at DESC, sa.created_at DESC
       LIMIT 100`,
      params
    );
    res.json({ agents: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/agents/:agentId/toggle-status', async (req, res, next) => {
  try {
    const { rows: agentRows } = await db.query(
      `SELECT sa.id, sa.employer_id
       FROM support_agents sa
       WHERE sa.id = $1`,
      [req.params.agentId]
    );
    if (!agentRows.length) return res.status(404).json({ error: 'Agent not found' });
    const canManage = await supportEmployerService.userCanManageEmployer(
      agentRows[0].employer_id,
      req.user.id,
      req.user.role
    );
    if (!canManage) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await db.query(
      `UPDATE support_agents
       SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [req.params.agentId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/agents/:agentId', async (req, res, next) => {
  try {
    const { rows: agentRows } = await db.query(
      'SELECT id, employer_id FROM support_agents WHERE id = $1',
      [req.params.agentId]
    );
    if (!agentRows.length) return res.status(404).json({ error: 'Agent not found' });
    const canManage = await supportEmployerService.userCanManageEmployer(
      agentRows[0].employer_id,
      req.user.id,
      req.user.role
    );
    if (!canManage) return res.status(403).json({ error: 'Access denied' });

    await db.query('DELETE FROM support_agents WHERE id = $1', [req.params.agentId]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/metrics', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId || null;
    if (businessId) {
      const allowed = await supportEmployerService.userCanAccessBusinessConversations(businessId, req.user.id, req.user.role);
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    } else if (!supportEmployerService.isPlatformAdmin(req.user.role)) {
      return res.status(400).json({ error: 'business_id is required' });
    }
    const stats = await supportConversationStats(businessId);
    const scope = businessId ? 'sc.business_id = $1::integer' : 'TRUE';
    const agentScope = businessId
      ? `(se.kind = 'platform' OR se.business_id = $1::integer)`
      : 'TRUE';
    const [trendResult, departmentResult, categoryResult, agentResult] = await Promise.all([
      db.query(
        `SELECT day::date AS date,
                COUNT(sc.id)::int AS conversations,
                COUNT(sc.id) FILTER (WHERE sc.status IN ('resolved', 'closed'))::int AS resolved
         FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS day
         LEFT JOIN support_conversations sc
           ON sc.created_at >= day
          AND sc.created_at < day + INTERVAL '1 day'
          AND ${scope}
         GROUP BY day
         ORDER BY day ASC`,
        businessId ? [businessId] : []
      ),
      db.query(
        `SELECT COALESCE(NULLIF(BTRIM(sa.department), ''), 'general') AS name,
                COUNT(sc.id)::int AS conversations,
                COUNT(sc.id) FILTER (WHERE sc.status IN ('resolved', 'closed'))::int AS resolved,
                ROUND(AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at)))::numeric)::int AS avg_response_time_seconds
         FROM support_conversations sc
         LEFT JOIN support_agents sa ON sa.id = sc.agent_id
         WHERE sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
           AND ${scope}
         GROUP BY COALESCE(NULLIF(BTRIM(sa.department), ''), 'general')
         ORDER BY conversations DESC`,
        businessId ? [businessId] : []
      ),
      db.query(
        `SELECT COALESCE(NULLIF(BTRIM(sc.category), ''), 'general') AS name,
                COUNT(*)::int AS count
         FROM support_conversations sc
         WHERE sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
           AND ${scope}
         GROUP BY COALESCE(NULLIF(BTRIM(sc.category), ''), 'general')
         ORDER BY count DESC`,
        businessId ? [businessId] : []
      ),
      db.query(
        `SELECT sa.id,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
                COUNT(sc.id)::int AS total_conversations,
                COUNT(sc.id) FILTER (WHERE sc.status IN ('resolved', 'closed'))::int AS resolved_conversations,
                ROUND(AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at)))::numeric)::int AS avg_response_time_seconds,
                ROUND(AVG(scr.rating)::numeric, 1) AS rating
         FROM support_agents sa
         JOIN users u ON u.id = sa.user_id
         JOIN support_employers se ON se.id = sa.employer_id
         LEFT JOIN support_conversations sc
           ON sc.agent_id = sa.id
          AND sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
          AND ${scope}
         LEFT JOIN support_conversation_reviews scr ON scr.conversation_id = sc.id
         WHERE ${agentScope}
         GROUP BY sa.id, u.id
         HAVING COUNT(sc.id) > 0
         ORDER BY resolved_conversations DESC, total_conversations DESC
         LIMIT 10`,
        businessId ? [businessId] : []
      ),
    ]);
    res.json({
      stats,
      trend: trendResult.rows,
      departments: departmentResult.rows,
      categories: categoryResult.rows,
      top_agents: agentResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/sla', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId || null;
    if (businessId) {
      const allowed = await supportEmployerService.userCanAccessBusinessConversations(businessId, req.user.id, req.user.role);
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    } else if (!supportEmployerService.isPlatformAdmin(req.user.role)) {
      return res.status(400).json({ error: 'business_id is required' });
    }
    const stats = await supportConversationStats(businessId);
    const eligible = Number(stats.sla_met_count || 0) + Number(stats.sla_violation_count || 0);
    const scope = businessId ? 'sc.business_id = $1::integer' : 'TRUE';
    const [trendResult, departmentResult, violationsResult] = await Promise.all([
      db.query(
        `SELECT day::date AS date,
                COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL
                  OR NOW() - sc.created_at > CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '15 minutes'
                    WHEN 'high' THEN INTERVAL '1 hour'
                    WHEN 'low' THEN INTERVAL '24 hours'
                    ELSE INTERVAL '4 hours'
                  END)::int AS eligible,
                COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL
                  AND sc.first_response_at - sc.created_at <= CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '15 minutes'
                    WHEN 'high' THEN INTERVAL '1 hour'
                    WHEN 'low' THEN INTERVAL '24 hours'
                    ELSE INTERVAL '4 hours'
                  END)::int AS met,
                COUNT(*) FILTER (WHERE (sc.first_response_at IS NOT NULL
                  AND sc.first_response_at - sc.created_at > CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '15 minutes'
                    WHEN 'high' THEN INTERVAL '1 hour'
                    WHEN 'low' THEN INTERVAL '24 hours'
                    ELSE INTERVAL '4 hours'
                  END)
                  OR (sc.first_response_at IS NULL
                  AND NOW() - sc.created_at > CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '15 minutes'
                    WHEN 'high' THEN INTERVAL '1 hour'
                    WHEN 'low' THEN INTERVAL '24 hours'
                    ELSE INTERVAL '4 hours'
                  END))::int AS violations
         FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS day
         LEFT JOIN support_conversations sc
           ON sc.created_at >= day
          AND sc.created_at < day + INTERVAL '1 day'
          AND ${scope}
         GROUP BY day
         ORDER BY day ASC`,
        businessId ? [businessId] : []
      ),
      db.query(
        `SELECT COALESCE(NULLIF(BTRIM(sa.department), ''), 'general') AS name,
                COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL
                  OR NOW() - sc.created_at > CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '15 minutes'
                    WHEN 'high' THEN INTERVAL '1 hour'
                    WHEN 'low' THEN INTERVAL '24 hours'
                    ELSE INTERVAL '4 hours'
                  END)::int AS eligible,
                COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL
                  AND sc.first_response_at - sc.created_at <= CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '15 minutes'
                    WHEN 'high' THEN INTERVAL '1 hour'
                    WHEN 'low' THEN INTERVAL '24 hours'
                    ELSE INTERVAL '4 hours'
                  END)::int AS met,
                ROUND(AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at))) / 60)::int AS avg_first_response_minutes,
                ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(sc.resolved_at, sc.updated_at) - sc.created_at))) / 3600, 1) AS avg_resolution_hours
         FROM support_conversations sc
         LEFT JOIN support_agents sa ON sa.id = sc.agent_id
         WHERE sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
           AND ${scope}
         GROUP BY COALESCE(NULLIF(BTRIM(sa.department), ''), 'general')
         ORDER BY eligible DESC`,
        businessId ? [businessId] : []
      ),
      db.query(
        `SELECT sc.id, sc.subject AS issue_type, sc.priority, sc.status,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, sc.guest_name, 'Customer') AS customer_name,
                violation.violation_type,
                CASE WHEN violation.violation_type = 'first_response'
                  THEN ROUND(EXTRACT(EPOCH FROM (NOW() - (sc.created_at + CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '15 minutes'
                    WHEN 'high' THEN INTERVAL '1 hour'
                    WHEN 'low' THEN INTERVAL '24 hours'
                    ELSE INTERVAL '4 hours'
                  END))) / 60)::int
                  ELSE ROUND(EXTRACT(EPOCH FROM (NOW() - (sc.created_at + CASE sc.priority
                    WHEN 'urgent' THEN INTERVAL '12 hours'
                    WHEN 'high' THEN INTERVAL '24 hours'
                    WHEN 'low' THEN INTERVAL '96 hours'
                    ELSE INTERVAL '48 hours'
                  END))) / 3600, 1)
                END AS overage
         FROM support_conversations sc
         LEFT JOIN users u ON u.id = sc.customer_id
         CROSS JOIN LATERAL (VALUES
           ('first_response', sc.first_response_at IS NULL AND NOW() - sc.created_at > CASE sc.priority
             WHEN 'urgent' THEN INTERVAL '15 minutes'
             WHEN 'high' THEN INTERVAL '1 hour'
             WHEN 'low' THEN INTERVAL '24 hours'
             ELSE INTERVAL '4 hours'
           END),
           ('resolution', sc.status NOT IN ('resolved', 'closed') AND NOW() - sc.created_at > CASE sc.priority
             WHEN 'urgent' THEN INTERVAL '12 hours'
             WHEN 'high' THEN INTERVAL '24 hours'
             WHEN 'low' THEN INTERVAL '96 hours'
             ELSE INTERVAL '48 hours'
           END)
         ) AS violation(violation_type, is_violation)
         WHERE violation.is_violation
           AND ${scope}
         ORDER BY sc.updated_at DESC
         LIMIT 100`,
        businessId ? [businessId] : []
      ),
    ]);
    const departments = departmentResult.rows.map((row) => {
      const departmentEligible = Number(row.eligible || 0);
      return {
        ...row,
        compliance: departmentEligible ? Math.round((Number(row.met || 0) / departmentEligible) * 100) : null,
        violations: Math.max(0, departmentEligible - Number(row.met || 0)),
      };
    });
    res.json({
      stats: {
        overall_compliance: eligible ? Math.round((Number(stats.sla_met_count || 0) / eligible) * 100) : null,
        avg_first_response_minutes: Math.round((stats.avg_response_time_seconds || 0) / 60),
        avg_resolution_hours: stats.avg_resolution_hours || 0,
        violation_count: Number(stats.sla_violation_count || 0),
      },
      trend: trendResult.rows.map((row) => ({
        ...row,
        compliance: Number(row.eligible || 0) ? Math.round((Number(row.met || 0) / Number(row.eligible)) * 100) : null,
      })),
      departments,
      violations: violationsResult.rows.map((row) => ({
        ...row,
        minutes_over: row.violation_type === 'first_response' ? row.overage : null,
        hours_over: row.violation_type === 'resolution' ? row.overage : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/performance', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId;
    if (businessId) {
      const allowed = await supportEmployerService.userCanAccessBusinessConversations(
        businessId,
        req.user.id,
        req.user.role
      );
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    } else if (!supportEmployerService.isPlatformAdmin(req.user.role)) {
      return res.status(400).json({ error: 'business_id is required' });
    }
    const search = String(req.query.search || '').trim().slice(0, 100);
    const sortBy = String(req.query.sort_by || 'rating');
    const sortSql = {
      rating: 'rating DESC NULLS LAST',
      response_time: 'avg_response_time_seconds ASC NULLS LAST',
      resolution: 'resolved_count DESC',
      volume: 'total_chats DESC',
    }[sortBy] || 'rating DESC NULLS LAST';
    const params = [businessId || null];
    const searchSql = search ? 'AND (u.email ILIKE $2 OR u.first_name ILIKE $2 OR u.last_name ILIKE $2)' : '';
    if (search) params.push(`%${search}%`);
    const { rows } = await db.query(
      `SELECT
         sa.id,
         sa.user_id,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
         COALESCE(sa.role, 'agent') AS role,
         COALESCE(AVG(scr.rating), sa.avg_rating) AS rating,
         COUNT(sc.id)::int AS total_chats,
         ROUND(AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at)))::numeric)::int AS avg_response_time_seconds,
         COUNT(sc.id) FILTER (WHERE sc.status IN ('resolved', 'closed'))::int AS resolved_count
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       JOIN support_employers se ON se.id = sa.employer_id
       LEFT JOIN support_conversations sc
         ON sc.agent_id = sa.id
        AND ($1::integer IS NULL OR sc.business_id = $1::integer)
       LEFT JOIN support_conversation_reviews scr ON scr.conversation_id = sc.id
       WHERE ($1::integer IS NULL OR se.kind = 'platform' OR se.business_id = $1::integer)
         ${searchSql}
       GROUP BY sa.id, u.id
       ORDER BY ${sortSql}, sa.updated_at DESC
       LIMIT 100`,
      params
    );
    res.json({ agents: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/performance/:agentId', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId || null;
    const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
    const { rows } = await db.query(
      `SELECT
         sa.id,
         sa.user_id,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
         u.email,
         COALESCE(sa.role, 'agent') AS role,
         COALESCE(AVG(scr.rating), sa.avg_rating) AS rating,
         COUNT(sc.id)::int AS total_chats,
         COUNT(sc.id) FILTER (WHERE sc.status IN ('resolved', 'closed'))::int AS resolved_count,
         ROUND(AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at)))::numeric)::int AS avg_response_time_seconds,
         sa.employer_id,
         se.business_id,
         se.kind
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       JOIN support_employers se ON se.id = sa.employer_id
       LEFT JOIN support_conversations sc
         ON sc.agent_id = sa.id
        AND sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
        AND ($2::integer IS NULL OR sc.business_id = $2::integer)
       LEFT JOIN support_conversation_reviews scr ON scr.conversation_id = sc.id
       WHERE sa.id = $1`,
      [req.params.agentId, businessId || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
    if (businessId && rows[0].kind !== 'platform' && String(rows[0].business_id) !== String(businessId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const canAccess = await supportEmployerService.userCanManageEmployer(
      rows[0].employer_id,
      req.user.id,
      req.user.role
    );
    if (!canAccess && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [trendResult, conversationsResult] = await Promise.all([
      db.query(
        `SELECT sc.created_at::date AS date,
                COUNT(*)::int AS conversations,
                COUNT(*) FILTER (WHERE sc.status IN ('resolved', 'closed'))::int AS resolved,
                ROUND(AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at)))::numeric)::int AS avg_response_time_seconds
         FROM support_conversations sc
         WHERE sc.agent_id = $1
           AND sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
           AND ($2::integer IS NULL OR sc.business_id = $2::integer)
         GROUP BY sc.created_at::date
         ORDER BY date ASC`,
        [req.params.agentId, businessId || null]
      ),
      db.query(
        `SELECT sc.id, sc.subject, sc.category, sc.priority, sc.status,
                sc.created_at, sc.updated_at, sc.resolved_at,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, sc.guest_name, 'Customer') AS customer_name,
                (SELECT scm.content
                 FROM support_conversation_messages scm
                 WHERE scm.conversation_id = sc.id AND scm.message_type <> 'internal_note'
                 ORDER BY scm.created_at DESC LIMIT 1) AS last_message
         FROM support_conversations sc
         LEFT JOIN users u ON u.id = sc.customer_id
         WHERE sc.agent_id = $1
           AND sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
           AND ($2::integer IS NULL OR sc.business_id = $2::integer)
         ORDER BY sc.updated_at DESC
         LIMIT 100`,
        [req.params.agentId, businessId || null]
      ),
    ]);
    res.json({ agent: rows[0], trend: trendResult.rows, conversations: conversationsResult.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/csat/analytics', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId || null;
    if (businessId) {
      const allowed = await supportEmployerService.userCanAccessBusinessConversations(
        businessId,
        req.user.id,
        req.user.role
      );
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
    } else if (!supportEmployerService.isPlatformAdmin(req.user.role)) {
      return res.status(400).json({ error: 'business_id is required' });
    }

    const [summaryResult, trendResult, agentResult, feedbackResult] = await Promise.all([
      db.query(
        `WITH finished AS (
           SELECT id
           FROM support_conversations
           WHERE status IN ('resolved', 'closed')
             AND updated_at >= NOW() - INTERVAL '30 days'
             AND ($1 IS NULL OR business_id = $1)
         )
         SELECT
           (SELECT COUNT(*)::int FROM finished) AS surveys_sent,
           COUNT(scr.id)::int AS surveys_completed,
           COALESCE(ROUND(AVG(scr.rating)::numeric, 2), 0)::float AS avg_rating,
           ROUND(AVG(scr.nps_score)::numeric, 1)::float AS avg_nps,
           ROUND(100.0 * (
             COUNT(*) FILTER (WHERE scr.nps_score >= 9)
             - COUNT(*) FILTER (WHERE scr.nps_score <= 6)
           ) / NULLIF(COUNT(scr.nps_score), 0), 1)::float AS nps_index,
           COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE scr.rating >= 4) / NULLIF(COUNT(scr.id), 0), 1), 0)::float AS csat_score
         FROM finished f
         LEFT JOIN support_conversation_reviews scr ON scr.conversation_id = f.id
           AND scr.created_at >= NOW() - INTERVAL '30 days'`,
        [businessId]
      ),
      db.query(
        `SELECT DATE_TRUNC('day', scr.created_at)::date AS day,
                COUNT(*)::int AS responses,
                COALESCE(ROUND(AVG(scr.rating)::numeric, 2), 0)::float AS avg_rating,
                ROUND(AVG(scr.nps_score)::numeric, 1)::float AS avg_nps
         FROM support_conversation_reviews scr
         JOIN support_conversations sc ON sc.id = scr.conversation_id
         WHERE scr.created_at >= NOW() - INTERVAL '30 days'
           AND ($1 IS NULL OR sc.business_id = $1)
         GROUP BY 1 ORDER BY 1 ASC`,
        [businessId]
      ),
      db.query(
        `SELECT COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'Support team') AS agent_name,
                COUNT(scr.id)::int AS responses,
                COALESCE(ROUND(AVG(scr.rating)::numeric, 2), 0)::float AS avg_rating,
                ROUND(AVG(scr.nps_score)::numeric, 1)::float AS avg_nps,
                ROUND(100.0 * (
                  COUNT(*) FILTER (WHERE scr.nps_score >= 9)
                  - COUNT(*) FILTER (WHERE scr.nps_score <= 6)
                ) / NULLIF(COUNT(scr.nps_score), 0), 1)::float AS nps_index
         FROM support_conversation_reviews scr
         JOIN support_conversations sc ON sc.id = scr.conversation_id
         LEFT JOIN support_agents sa ON sa.id = sc.agent_id
         LEFT JOIN users u ON u.id = sa.user_id
         WHERE scr.created_at >= NOW() - INTERVAL '30 days'
           AND ($1 IS NULL OR sc.business_id = $1)
         GROUP BY 1 ORDER BY avg_rating DESC, responses DESC`,
        [businessId]
      ),
      db.query(
        `SELECT scr.id, scr.conversation_id, scr.rating, scr.nps_score, scr.comment, scr.created_at,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, sc.guest_name, 'Customer') AS customer_name
         FROM support_conversation_reviews scr
         JOIN support_conversations sc ON sc.id = scr.conversation_id
         LEFT JOIN users u ON u.id = sc.customer_id
         WHERE scr.created_at >= NOW() - INTERVAL '30 days'
           AND ($1 IS NULL OR sc.business_id = $1)
         ORDER BY scr.created_at DESC LIMIT 25`,
        [businessId]
      ),
    ]);
    const summary = summaryResult.rows[0] || {};
    const surveysSent = Number(summary.surveys_sent || 0);
    const surveysCompleted = Number(summary.surveys_completed || 0);
    return res.json({
      metrics: {
        csat_score: Number(summary.csat_score || 0),
        csat_target: 80,
        survey_response_rate: surveysSent ? Number(((surveysCompleted / surveysSent) * 100).toFixed(1)) : 0,
        surveys_sent: surveysSent,
        surveys_completed: surveysCompleted,
        avg_rating: Number(summary.avg_rating || 0),
        avg_nps: summary.avg_nps == null ? null : Number(summary.avg_nps),
        nps_index: summary.nps_index == null ? null : Number(summary.nps_index),
      },
      csat_trend: trendResult.rows,
      sentiment_distribution: [],
      agent_csat: agentResult.rows,
      recent_feedback: feedbackResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/shifts', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const { rows } = await db.query(
      `SELECT id, business_id, name, start_time, end_time, days, max_agents, is_active, created_at, updated_at
       FROM support_shift_definitions
       WHERE business_id = $1 AND is_active = true
       ORDER BY start_time, name
       LIMIT 200`,
      [businessId]
    );
    return res.json({ shifts: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/shifts', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const name = String(req.body.name || '').trim();
    const startTime = String(req.body.start_time || '').trim();
    const endTime = String(req.body.end_time || '').trim();
    const days = Array.isArray(req.body.days) ? req.body.days.map((day) => String(day).toLowerCase()).filter((day) => DAY_NAMES.has(day)) : [];
    const maxAgents = Number.parseInt(req.body.max_agents, 10);
    if (!name || name.length > 120 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || !days.length || !Number.isInteger(maxAgents) || maxAgents < 0 || maxAgents > 10000) {
      return res.status(400).json({ error: 'Invalid shift definition' });
    }
    const { rows } = await db.query(
      `INSERT INTO support_shift_definitions (business_id, name, start_time, end_time, days, max_agents, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, business_id, name, start_time, end_time, days, max_agents, is_active, created_at, updated_at`,
      [businessId, name, startTime, endTime, [...new Set(days)], maxAgents, req.user.id]
    );
    return res.status(201).json({ shift: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/shifts/:id', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT business_id FROM support_shift_definitions WHERE id = $1 AND is_active = true', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Shift not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    const name = String(req.body.name || '').trim();
    const startTime = String(req.body.start_time || '').trim();
    const endTime = String(req.body.end_time || '').trim();
    const days = Array.isArray(req.body.days) ? req.body.days.map((day) => String(day).toLowerCase()).filter((day) => DAY_NAMES.has(day)) : [];
    const maxAgents = Number.parseInt(req.body.max_agents, 10);
    if (!name || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || !days.length || !Number.isInteger(maxAgents) || maxAgents < 0 || maxAgents > 10000) {
      return res.status(400).json({ error: 'Invalid shift definition' });
    }
    const { rows } = await db.query(
      `UPDATE support_shift_definitions
       SET name = $1, start_time = $2, end_time = $3, days = $4, max_agents = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND business_id = $7 AND is_active = true
       RETURNING id, business_id, name, start_time, end_time, days, max_agents, is_active, created_at, updated_at`,
      [name, startTime, endTime, [...new Set(days)], maxAgents, req.params.id, existing.rows[0].business_id]
    );
    return res.json({ shift: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/shifts/:id', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT business_id FROM support_shift_definitions WHERE id = $1 AND is_active = true', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Shift not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    await db.query('UPDATE support_shift_definitions SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2', [req.params.id, existing.rows[0].business_id]);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/kb', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const search = String(req.query.search || '').trim().slice(0, 100);
    const category = String(req.query.category || '').trim().slice(0, 100);
    const params = [businessId];
    const filters = ['kba.business_id = $1'];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(kba.title ILIKE $${params.length} OR kba.content ILIKE $${params.length} OR COALESCE(kba.excerpt, '') ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      filters.push(`kbc.slug = $${params.length}`);
    }
    const { rows } = await db.query(
      `SELECT kba.id, kba.business_id, kba.title, kba.slug, kba.content, kba.excerpt,
              kba.keywords, kba.language, kba.is_published, kba.view_count, kba.helpful_count,
              kba.unhelpful_count, kba.created_at, kba.updated_at,
              COALESCE(kbc.category_name, 'general') AS category
       FROM knowledge_base_articles kba
       LEFT JOIN knowledge_base_categories kbc ON kbc.id = kba.category_id
       WHERE ${filters.join(' AND ')}
       ORDER BY kba.updated_at DESC
       LIMIT 200`,
      params
    );
    return res.json({ articles: rows.map(serializeKnowledgeArticle) });
  } catch (err) {
    next(err);
  }
});

router.post('/kb', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const category = String(req.body.category || 'general').trim().slice(0, 100);
    const tags = Array.isArray(req.body.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20) : [];
    if (!title || title.length > 500 || !content || content.length > 100000) {
      return res.status(400).json({ error: 'Title and content are required within the allowed limits' });
    }
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 480) || `article-${Date.now()}`;
    let categoryResult = await db.query(
      'SELECT id FROM knowledge_base_categories WHERE business_id = $1 AND (slug = $2 OR category_name = $3) LIMIT 1',
      [businessId, category.toLowerCase().replace(/[^a-z0-9]+/g, '-'), category]
    );
    if (!categoryResult.rows.length) {
      categoryResult = await db.query(
        `INSERT INTO knowledge_base_categories (business_id, category_name, slug, is_public)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [businessId, category, category.toLowerCase().replace(/[^a-z0-9]+/g, '-')]
      );
    }
    const result = await db.query(
      `INSERT INTO knowledge_base_articles
       (business_id, category_id, title, slug, content, excerpt, keywords, language, is_published, author_id, estimated_read_time_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'en', false, $8, $9)
       RETURNING *`,
      [businessId, categoryResult.rows[0].id, title, slug, content, content.slice(0, 300), tags, req.user.id, Math.max(1, Math.ceil(content.split(/\s+/).length / 200))]
    );
    const article = result.rows[0];
    await db.query(
      `INSERT INTO knowledge_base_search_index (article_id, business_id, search_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (article_id) DO UPDATE SET search_text = EXCLUDED.search_text, last_indexed = CURRENT_TIMESTAMP`,
      [article.id, businessId, `${title} ${content} ${tags.join(' ')}`]
    );
    return res.status(201).json({ article: serializeKnowledgeArticle({ ...article, category, tags }) });
  } catch (err) {
    next(err);
  }
});

router.patch('/kb/:id', async (req, res, next) => {
  try {
    const existingResult = await db.query(
      `SELECT kba.*, COALESCE(kbc.category_name, 'general') AS category
       FROM knowledge_base_articles kba
       LEFT JOIN knowledge_base_categories kbc ON kbc.id = kba.category_id
       WHERE kba.id = $1`,
      [req.params.id]
    );
    if (!existingResult.rows.length) return res.status(404).json({ error: 'Article not found' });
    const existing = existingResult.rows[0];
    if (!(await canManageSupportBusiness(req, existing.business_id))) return res.status(403).json({ error: 'Access denied' });
    const title = req.body.title == null ? existing.title : String(req.body.title).trim();
    const content = req.body.content == null ? existing.content : String(req.body.content).trim();
    const tags = Array.isArray(req.body.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20) : existing.keywords || [];
    if (!title || title.length > 500 || !content || content.length > 100000) return res.status(400).json({ error: 'Invalid article content' });
    const result = await db.query(
      `UPDATE knowledge_base_articles
       SET title = $1, content = $2, excerpt = $3, keywords = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND business_id = $6
       RETURNING *`,
      [title, content, content.slice(0, 300), tags, req.params.id, existing.business_id]
    );
    await db.query(
      `UPDATE knowledge_base_search_index SET search_text = $1, last_indexed = CURRENT_TIMESTAMP WHERE article_id = $2`,
      [`${title} ${content} ${tags.join(' ')}`, req.params.id]
    );
    return res.json({ article: serializeKnowledgeArticle({ ...result.rows[0], category: existing.category, tags }) });
  } catch (err) {
    next(err);
  }
});

router.delete('/kb/:id', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT business_id FROM knowledge_base_articles WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Article not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    await db.query('DELETE FROM knowledge_base_articles WHERE id = $1 AND business_id = $2', [req.params.id, existing.rows[0].business_id]);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Published help articles for support operators. This is intentionally
// separate from the admin knowledge-base feed so drafts never enter replies.
router.get('/kb/available', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!businessId) return res.status(400).json({ error: 'business_id is required' });
    const allowed = await supportEmployerService.userCanAccessBusinessConversations(
      businessId,
      req.user.id,
      req.user.role
    );
    if (!allowed) return res.status(403).json({ error: 'Access denied' });
    const search = String(req.query.search || '').trim().slice(0, 100);
    const params = [businessId];
    let searchSql = '';
    if (search) {
      params.push(`%${search}%`);
      searchSql = `AND (kba.title ILIKE $2 OR kba.content ILIKE $2 OR COALESCE(kba.excerpt, '') ILIKE $2)`;
    }
    const { rows } = await db.query(
      `SELECT kba.id, kba.business_id, kba.title, kba.slug, kba.content, kba.excerpt,
              kba.keywords, kba.language, kba.is_published, kba.view_count,
              kba.updated_at, COALESCE(kbc.category_name, 'general') AS category
       FROM knowledge_base_articles kba
       LEFT JOIN knowledge_base_categories kbc ON kbc.id = kba.category_id
       WHERE kba.business_id = $1 AND kba.is_published = true ${searchSql}
       ORDER BY kba.updated_at DESC
       LIMIT 50`,
      params
    );
    return res.json({ articles: rows.map(serializeKnowledgeArticle) });
  } catch (err) {
    next(err);
  }
});

// Read-only template feed for support operators. Unlike the admin CRUD route,
// this allows an assigned support agent to use only active templates for the
// business they are authorized to work, without granting management access.
router.get('/templates/available', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!businessId) return res.status(400).json({ error: 'business_id is required' });
    const allowed = await supportEmployerService.userCanAccessBusinessConversations(
      businessId,
      req.user.id,
      req.user.role
    );
    if (!allowed) return res.status(403).json({ error: 'Access denied' });
    const params = [businessId];
    let searchSql = '';
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim().slice(0, 100)}%`);
      searchSql = `AND (title ILIKE $2 OR content ILIKE $2 OR COALESCE(shortcut, '') ILIKE $2)`;
    }
    const { rows } = await db.query(
      `SELECT id, business_id, category, title, title AS name, content, shortcut, language,
              usage_count, usage_count AS use_count, is_active, created_at, updated_at
       FROM canned_responses
       WHERE business_id = $1 AND is_active = true ${searchSql}
       ORDER BY category NULLS LAST, title
       LIMIT 200`,
      params
    );
    return res.json({ templates: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/templates', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const params = [businessId];
    let searchSql = '';
    const activeSql = parseBoolean(req.query.active, false) ? ' AND is_active = true' : '';
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim().slice(0, 100)}%`);
      searchSql = `AND (title ILIKE $2 OR content ILIKE $2 OR COALESCE(shortcut, '') ILIKE $2)`;
    }
    const { rows } = await db.query(
      `SELECT id, business_id, category, title, title AS name, content, shortcut, language,
              usage_count, usage_count AS use_count, is_active, created_at, updated_at
       FROM canned_responses
       WHERE business_id = $1 ${activeSql} ${searchSql}
       ORDER BY category NULLS LAST, title
       LIMIT 200`,
      params
    );
    return res.json({ templates: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/templates', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const title = String(req.body.name || req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    if (!title || title.length > 255 || !content || content.length > 10000) return res.status(400).json({ error: 'Template name and content are required within the allowed limits' });
    const { rows } = await db.query(
      `INSERT INTO canned_responses (business_id, category, title, content, shortcut, language, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, 'en', true, $6)
       RETURNING id, business_id, category, title, title AS name, content, shortcut, language, usage_count, usage_count AS use_count, is_active, created_at, updated_at`,
      [businessId, req.body.category || 'general', title, content, req.body.shortcut || null, req.user.id]
    );
    return res.status(201).json({ template: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/templates/:id', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT business_id FROM canned_responses WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Template not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    const title = String(req.body.name || req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    if (!title || !content) return res.status(400).json({ error: 'Template name and content are required' });
    const { rows } = await db.query(
      `UPDATE canned_responses
       SET title = $1, content = $2, category = COALESCE($3, category), shortcut = COALESCE($4, shortcut), updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND business_id = $6
       RETURNING id, business_id, category, title, title AS name, content, shortcut, language, usage_count, usage_count AS use_count, is_active, created_at, updated_at`,
      [title, content, req.body.category || null, req.body.shortcut || null, req.params.id, existing.rows[0].business_id]
    );
    return res.json({ template: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/templates/:id', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT business_id FROM canned_responses WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Template not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    await db.query('UPDATE canned_responses SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2', [req.params.id, existing.rows[0].business_id]);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

function serializeLegacyEscalationRule(row) {
  const condition = row.condition || {};
  const action = row.action || {};
  return {
    ...row,
    priority: condition.priority || 'medium',
    trigger_condition: condition.trigger_condition || row.description || '',
    escalate_to: action.escalate_to || '',
    escalate_after_minutes: Number(action.escalate_after_minutes || 15),
    notify_managers: action.notify_managers !== false,
  };
}

function escalationPriorityValue(value) {
  return { critical: 100, high: 75, medium: 50, low: 25 }[value] || 50;
}

router.get('/escalation/rules', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const [rulesResult, statsResult] = await Promise.all([
      db.query(
        `SELECT id, business_id, rule_name, description, priority, condition, action, is_active, created_at, updated_at
         FROM routing_rules
         WHERE business_id = $1
         ORDER BY priority DESC, created_at DESC
         LIMIT 200`,
        [businessId]
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS escalations_today
         FROM queue_events
         WHERE business_id = $1 AND event_type = 'escalated'`,
        [businessId]
      ),
    ]);
    const rules = rulesResult.rows.map(serializeLegacyEscalationRule);
    return res.json({
      rules,
      stats: {
        total_rules: rules.length,
        active_rules: rules.filter((rule) => rule.is_active !== false).length,
        escalations_today: Number(statsResult.rows[0]?.escalations_today || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/escalation/rules', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const ruleName = String(req.body.rule_name || '').trim();
    const triggerCondition = String(req.body.trigger_condition || '').trim();
    const priority = String(req.body.priority || 'medium').toLowerCase();
    const escalateTo = String(req.body.escalate_to || '').trim();
    const minutes = Number.parseInt(req.body.escalate_after_minutes, 10);
    if (!ruleName || ruleName.length > 100 || !triggerCondition || triggerCondition.length > 500 || !['critical', 'high', 'medium', 'low'].includes(priority) || !escalateTo || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      return res.status(400).json({ error: 'Invalid escalation rule' });
    }
    const { rows } = await db.query(
      `INSERT INTO routing_rules (business_id, rule_name, rule_type, description, priority, condition, action, is_active, created_by)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, $8)
       RETURNING id, business_id, rule_name, description, priority, condition, action, is_active, created_at, updated_at`,
      [
        businessId,
        ruleName,
        triggerCondition,
        escalationPriorityValue(priority),
        JSON.stringify({ trigger_condition: triggerCondition, priority }),
        JSON.stringify({ escalate_to: escalateTo, escalate_after_minutes: minutes, notify_managers: req.body.notify_managers !== false }),
        req.body.is_active !== false,
        req.user.id,
      ]
    );
    return res.status(201).json({ rule: serializeLegacyEscalationRule(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.put('/escalation/rules/:id', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT * FROM routing_rules WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Rule not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    const current = serializeLegacyEscalationRule(existing.rows[0]);
    const priority = String(req.body.priority || current.priority).toLowerCase();
    const triggerCondition = String(req.body.trigger_condition || current.trigger_condition).trim();
    const escalateTo = String(req.body.escalate_to || current.escalate_to).trim();
    const minutes = Number.parseInt(req.body.escalate_after_minutes ?? current.escalate_after_minutes, 10);
    if (!['critical', 'high', 'medium', 'low'].includes(priority) || !triggerCondition || !escalateTo || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080) return res.status(400).json({ error: 'Invalid escalation rule' });
    const { rows } = await db.query(
      `UPDATE routing_rules
       SET rule_name = $1, description = $2, priority = $3, condition = $4, action = $5,
           is_active = COALESCE($6, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 AND business_id = $8
       RETURNING id, business_id, rule_name, description, priority, condition, action, is_active, created_at, updated_at`,
      [
        String(req.body.rule_name || current.rule_name).trim(),
        triggerCondition,
        escalationPriorityValue(priority),
        JSON.stringify({ trigger_condition: triggerCondition, priority }),
        JSON.stringify({ escalate_to: escalateTo, escalate_after_minutes: minutes, notify_managers: req.body.notify_managers !== false }),
        req.body.is_active === undefined ? null : req.body.is_active,
        req.params.id,
        existing.rows[0].business_id,
      ]
    );
    return res.json({ rule: serializeLegacyEscalationRule(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/escalation/rules/:id/toggle', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT * FROM routing_rules WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Rule not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    const { rows } = await db.query(
      `UPDATE routing_rules SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING id, business_id, rule_name, description, priority, condition, action, is_active, created_at, updated_at`,
      [req.params.id]
    );
    return res.json({ rule: serializeLegacyEscalationRule(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/escalation/rules/:id', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT business_id FROM routing_rules WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Rule not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    await db.query('DELETE FROM routing_rules WHERE id = $1 AND business_id = $2', [req.params.id, existing.rows[0].business_id]);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

async function teamMembersForBusiness(businessId) {
  const { rows: teams } = await db.query(
    `SELECT id, business_id, team_name AS name, team_type, description, is_active
     FROM support_teams
     WHERE business_id = $1 AND is_active = true
     ORDER BY team_name`,
    [businessId]
  );
  const departments = [];
  for (const team of teams) {
    const [membersResult, skillsResult] = await Promise.all([
      db.query(
        `SELECT tm.id, tm.agent_id, tm.role,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
                u.email, sa.department, sa.status,
                COALESCE(ARRAY_AGG(DISTINCT ts.skill_name) FILTER (WHERE ts.skill_name IS NOT NULL), ARRAY[]::text[]) AS skills
         FROM team_members tm
         JOIN support_agents sa ON sa.id = tm.agent_id
         JOIN users u ON u.id = sa.user_id
         LEFT JOIN team_skills ts ON ts.team_id = tm.team_id
         WHERE tm.team_id = $1 AND tm.is_active = true
         GROUP BY tm.id, tm.agent_id, tm.role, u.id, sa.id`,
        [team.id]
      ),
      db.query('SELECT skill_name FROM team_skills WHERE team_id = $1 ORDER BY skill_name', [team.id]),
    ]);
    departments.push({
      ...team,
      members: membersResult.rows,
      skills: skillsResult.rows.map((row) => row.skill_name),
    });
  }
  return departments;
}

router.get('/team/hierarchy', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const departments = await teamMembersForBusiness(businessId);
    const members = departments.reduce((total, department) => total + department.members.length, 0);
    const configuredSkills = [...new Set(departments.flatMap((department) => department.skills))];
    return res.json({
      departments,
      stats: { members, departments: departments.length },
      available_roles: ['agent', 'supervisor', 'manager', 'director'],
      available_skills: configuredSkills,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/team/members', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || 'agent').trim().toLowerCase();
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !['agent', 'supervisor', 'manager', 'director'].includes(role)) return res.status(400).json({ error: 'A valid support-agent email and role are required' });
    const agentResult = await db.query(
      `SELECT sa.id
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       JOIN support_employers se ON se.id = sa.employer_id
       WHERE LOWER(u.email) = $1 AND (se.kind = 'platform' OR se.business_id = $2)
       LIMIT 1`,
      [email, businessId]
    );
    if (!agentResult.rows.length) return res.status(404).json({ error: 'The user must be onboarded as a support agent before joining a team' });
    let teamResult = await db.query('SELECT id FROM support_teams WHERE business_id = $1 AND is_active = true ORDER BY created_at LIMIT 1', [businessId]);
    if (!teamResult.rows.length) {
      teamResult = await db.query(
        `INSERT INTO support_teams (business_id, team_name, team_type, is_active)
         VALUES ($1, 'Support', 'tier1', true) RETURNING id`,
        [businessId]
      );
    }
    const { rows } = await db.query(
      `INSERT INTO team_members (team_id, agent_id, role, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (team_id, agent_id) DO UPDATE SET role = EXCLUDED.role, is_active = true, left_at = NULL
       RETURNING id, team_id, agent_id, role, is_active`,
      [teamResult.rows[0].id, agentResult.rows[0].id, role]
    );
    return res.status(201).json({ member: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/team/members/:id', async (req, res, next) => {
  try {
    const existing = await db.query(
      `SELECT tm.*, st.business_id
       FROM team_members tm JOIN support_teams st ON st.id = tm.team_id
       WHERE tm.id = $1`,
      [req.params.id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Member not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    const role = String(req.body.role || existing.rows[0].role || 'agent').trim().toLowerCase();
    if (!['agent', 'supervisor', 'manager', 'director'].includes(role)) return res.status(400).json({ error: 'Invalid team role' });
    const { rows } = await db.query(
      `UPDATE team_members tm
       SET role = $1
       FROM support_teams st
       WHERE tm.id = $2 AND st.id = tm.team_id AND st.business_id = $3
       RETURNING tm.id, tm.team_id, tm.agent_id, tm.role, tm.is_active`,
      [role, req.params.id, existing.rows[0].business_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    return res.json({ member: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/team/members/:id', async (req, res, next) => {
  try {
    const existing = await db.query(
      `SELECT tm.id, st.business_id FROM team_members tm JOIN support_teams st ON st.id = tm.team_id WHERE tm.id = $1`,
      [req.params.id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Member not found' });
    if (!(await canManageSupportBusiness(req, existing.rows[0].business_id))) return res.status(403).json({ error: 'Access denied' });
    await db.query(
      `UPDATE team_members tm
       SET is_active = false, left_at = CURRENT_TIMESTAMP
       FROM support_teams st
       WHERE tm.id = $1 AND st.id = tm.team_id AND st.business_id = $2`,
      [req.params.id, existing.rows[0].business_id]
    );
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const DEFAULT_SUPPORT_SETTINGS = {
  general: { support_enabled: true, timezone: 'UTC', language: 'en' },
  routing: {},
  notifications: {},
  integrations: {},
  automation: {},
  working_hours: {},
  sla: {},
};

router.get('/settings', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const { rows } = await db.query('SELECT settings FROM support_admin_settings WHERE business_id = $1', [businessId]);
    const stored = rows[0]?.settings || {};
    return res.json({
      ...DEFAULT_SUPPORT_SETTINGS,
      ...stored,
      general: { ...DEFAULT_SUPPORT_SETTINGS.general, ...(stored.general || {}), business_id: businessId },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/:section', async (req, res, next) => {
  try {
    const businessId = await supportBusinessFromRequest(req);
    if (!(await canManageSupportBusiness(req, businessId))) return res.status(403).json({ error: 'Access denied' });
    const allowedSections = new Set(['general', 'notifications', 'integrations', 'automation', 'working_hours']);
    if (!allowedSections.has(req.params.section)) return res.status(400).json({ error: 'Invalid settings section' });
    const section = { ...req.body };
    delete section.business_id;
    delete section.businessId;
    const serialized = JSON.stringify(section);
    if (serialized.length > 20000) return res.status(400).json({ error: 'Settings payload is too large' });
    const { rows } = await db.query(
      `INSERT INTO support_admin_settings (business_id, settings, updated_by)
       VALUES ($1, jsonb_build_object($2, $3::jsonb), $4)
       ON CONFLICT (business_id) DO UPDATE
       SET settings = support_admin_settings.settings || jsonb_build_object($2, $3::jsonb),
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP
       RETURNING settings`,
      [businessId, req.params.section, serialized, req.user.id]
    );
    return res.json({
      ...DEFAULT_SUPPORT_SETTINGS,
      ...(rows[0]?.settings || {}),
      general: { ...DEFAULT_SUPPORT_SETTINGS.general, ...(rows[0]?.settings?.general || {}), business_id: businessId },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/audit/logs', async (req, res, next) => {
  if (!supportEmployerService.isPlatformAdmin(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const values = [];
    const conditions = [];
    if (req.query.action) {
      values.push(`%${String(req.query.action).slice(0, 100)}%`);
      conditions.push(`a.action ILIKE $${values.length}`);
    }
    if (req.query.target_type) {
      values.push(String(req.query.target_type).slice(0, 50));
      conditions.push(`a.target_type = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const dataValues = [...values, limit, offset];
    const [rowsResult, countResult, statsResult] = await Promise.all([
      db.query(
        `SELECT a.id, a.admin_id, a.action, a.target_type, a.target_id,
                COALESCE(a.description, a.notes) AS description,
                a.ip_address, a.user_agent, a.before_state, a.after_state, a.created_at,
                COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'System') AS admin_name
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.admin_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        dataValues
      ),
      db.query(`SELECT COUNT(*)::int AS total FROM admin_audit_log a ${where}`, values),
      db.query(
        `SELECT COUNT(*)::int AS total_entries,
                COUNT(DISTINCT admin_id)::int AS users_active,
                COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS actions_today,
                MAX(created_at) AS last_entry
         FROM admin_audit_log`
      ),
    ]);
    return res.json({
      logs: rowsResult.rows,
      stats: statsResult.rows[0] || { total_entries: 0, users_active: 0, actions_today: 0, last_entry: null },
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/audit/export', async (req, res, next) => {
  if (!supportEmployerService.isPlatformAdmin(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const limit = Math.min(10_000, Math.max(1, Number.parseInt(req.query.limit, 10) || 10_000));
    const values = [limit];
    const conditions = [];
    if (req.query.action) {
      values.unshift(`%${String(req.query.action).slice(0, 100)}%`);
      conditions.push('a.action ILIKE $1');
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = conditions.length + 1;
    const { rows } = await db.query(
      `SELECT a.created_at, COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'System') AS admin_name,
              a.action, a.target_type, a.target_id, COALESCE(a.description, a.notes) AS description
       FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_id
       ${where} ORDER BY a.created_at DESC LIMIT $${limitParam}`,
      values
    );
    const csvCell = (value) => {
      const text = String(value ?? '').replace(/^[=+\-@]/, "'$&");
      return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['timestamp', 'actor', 'action', 'resource_type', 'resource_id', 'description'].map(csvCell).join(','),
      ...rows.map((row) => [row.created_at, row.admin_name, row.action, row.target_type, row.target_id, row.description].map(csvCell).join(',')),
    ];
    return res.type('text/csv').set('Content-Disposition', 'attachment; filename="oxsteed-support-audit.csv"').send(`${lines.join('\n')}\n`);
  } catch (err) {
    next(err);
  }
});

// Create new conversation
router.post('/:businessId/conversations', conversationMessageLimiter, supportConversationsController.createConversation);

// List conversations (with filters)
router.get('/:businessId/conversations', supportConversationsController.listConversations);

// Get single conversation
router.get('/:businessId/conversations/:conversationId', supportConversationsController.getConversation);

// Update conversation status
router.put('/:businessId/conversations/:conversationId/status', supportConversationsController.updateConversationStatus);

// Add message to conversation
router.post('/:businessId/conversations/:conversationId/messages', conversationMessageLimiter, upload.single('file'), validateFileUpload, supportConversationsController.addMessage);

// Get conversation stats
router.get('/:businessId/conversation-stats', supportConversationsController.getConversationStats);

// ============================================
// CONVERSATION ASSIGNMENT
// ============================================

// Agent claims a conversation
router.post('/:businessId/conversations/:conversationId/claim', conversationAssignmentController.claimConversation);

// Admin assigns to specific agent
router.post('/:businessId/conversations/:conversationId/assign', conversationAssignmentController.assignToAgent);

// Reassign to different agent
router.post('/:businessId/conversations/:conversationId/reassign', conversationAssignmentController.reassignAgent);

// Release conversation (agent stops working)
router.post('/:businessId/conversations/:conversationId/release', conversationAssignmentController.releaseConversation);

// Get agent's active assignments
router.get('/:businessId/agents/:agentId/assignments', conversationAssignmentController.getAgentAssignments);

// ============================================
// SUPPORT QUEUE
// ============================================

// Get queue status
router.get('/:businessId/queue/status', queueController.getQueueStatus);

// Get next available agent
router.get('/:businessId/queue/next-agent', queueController.getNextAvailableAgent);

// Route next conversation from queue
router.post('/:businessId/queue/route-next', queueController.routeNextConversation);

// Remove from queue
router.post('/:businessId/queue/remove/:conversationId', queueController.removeFromQueue);

// Get queue analytics
router.get('/:businessId/queue/analytics', queueController.getQueueAnalytics);

// ============================================
// SUPPORT SETTINGS
// ============================================

// Get support settings for business
router.get('/:businessId/settings', businessSupportSettingsController.getSupportSettings);
router.get('/:businessId/settings/hiring', businessSupportSettingsController.getHiringProfile);
router.put('/:businessId/settings/hiring', businessSupportSettingsController.upsertHiringProfile);

// Set SLA target
router.post('/:businessId/settings/sla', businessSupportSettingsController.setSLATarget);

// Create break type
router.post('/:businessId/settings/break-types', businessSupportSettingsController.createBreakType);

// Create routing rule
router.post('/:businessId/settings/routing-rules', businessSupportSettingsController.createRoutingRule);

// Update routing rule
router.put('/:businessId/settings/routing-rules/:ruleId', businessSupportSettingsController.updateRoutingRule);

// Delete routing rule
router.delete('/:businessId/settings/routing-rules/:ruleId', businessSupportSettingsController.deleteRoutingRule);

// Get support statistics
router.get('/:businessId/statistics', businessSupportSettingsController.getSupportStatistics);

// ============================================
// KNOWLEDGE BASE (Phase 2)
// ============================================

router.post('/:businessId/kb/categories', knowledgeBaseController.createCategory);
router.get('/:businessId/kb/categories', knowledgeBaseController.listCategories);
router.post('/:businessId/kb/articles', knowledgeBaseController.createArticle);
router.put('/:businessId/kb/articles/:articleId', knowledgeBaseController.updateArticle);
router.post('/:businessId/kb/articles/:articleId/publish', knowledgeBaseController.publishArticle);
router.get('/:businessId/kb/articles/:articleId', knowledgeBaseController.getArticle);
router.get('/:businessId/kb/search', knowledgeBaseController.searchArticles);
router.post('/:businessId/kb/articles/:articleId/feedback', knowledgeBaseController.recordFeedback);
router.get('/:businessId/kb/categories/:categoryId/articles', knowledgeBaseController.getArticlesByCategory);

// ============================================
// CANNED RESPONSES (Phase 2)
// ============================================

router.post('/:businessId/responses', cannedResponsesController.createResponse);
router.get('/:businessId/responses', cannedResponsesController.listResponses);
router.put('/:businessId/responses/:responseId', cannedResponsesController.updateResponse);
router.delete('/:businessId/responses/:responseId', cannedResponsesController.deleteResponse);
router.get('/:businessId/responses/expand', cannedResponsesController.expandShortcut);
router.get('/:businessId/response-categories', cannedResponsesController.getCategories);

// ============================================
// AI CHATBOT (Phase 2)
// ============================================

router.post('/:businessId/ai/message', conversationMessageLimiter, aiChatbotController.sendMessage);
router.post('/:businessId/ai/drafts/:draftId/apply', conversationMessageLimiter, aiChatbotController.applyDraft);
router.post('/:businessId/ai/drafts/:draftId/discard', conversationMessageLimiter, aiChatbotController.discardDraft);
router.post('/:businessId/ai/check-handoff', aiChatbotController.checkNeedsHandoff);
router.get('/:businessId/ai/suggest-articles/:conversationId', aiChatbotController.suggestKBArticles);
router.get('/:businessId/ai/suggest-responses', aiChatbotController.suggestResponses);

// ============================================
// CONVERSATION MESSAGES (Phase 2)
// ============================================

router.get('/:businessId/conversations/:conversationId/messages', conversationMessageController.getMessages);
router.put('/:businessId/messages/:messageId/read', conversationMessageController.markAsRead);
router.delete('/:businessId/messages/:messageId', conversationMessageController.deleteMessage);
router.put('/:businessId/messages/:messageId', conversationMessageController.editMessage);
router.post('/:businessId/conversations/:conversationId/attachment', conversationMessageController.addAttachment);
router.get('/:businessId/conversations/:conversationId/unread-count', conversationMessageController.getUnreadCount);
router.post('/:businessId/conversations/:conversationId/mark-all-read', conversationMessageController.markAllAsRead);
router.post('/:businessId/conversations/:conversationId/typing', conversationMessageController.sendTypingIndicator);

// ============================================
// SLA METRICS (Phase 3)
// ============================================

router.get('/:businessId/sla/dashboard', slaMetricsController.getSLADashboard);
router.get('/:businessId/sla/breaches', slaMetricsController.getSLABreaches);
router.get('/:businessId/sla/by-priority', slaMetricsController.getSLAByPriority);
router.get('/:businessId/sla/upcoming-breaches', slaMetricsController.getUpcomingBreaches);
router.post('/:businessId/sla/update/:conversationId', slaMetricsController.updateSLAStatus);
router.get('/:businessId/sla/trends', slaMetricsController.getSLATrends);

// ============================================
// PERFORMANCE ANALYTICS (Phase 3)
// ============================================

router.get('/:businessId/analytics/leaderboard', performanceAnalyticsController.getAgentLeaderboard);
router.get('/:businessId/analytics/agents/:agentId', performanceAnalyticsController.getAgentMetrics);
router.get('/:businessId/analytics/teams', performanceAnalyticsController.getTeamPerformance);
router.get('/:businessId/analytics/business', performanceAnalyticsController.getBusinessMetrics);
router.get('/:businessId/analytics/conversations', performanceAnalyticsController.getConversationMetrics);
router.get('/:businessId/analytics/utilization', performanceAnalyticsController.getAgentUtilization);

// ============================================
// SATISFACTION SURVEYS (Phase 3)
// ============================================

router.post('/:businessId/surveys/:conversationId', satisfactionSurveyController.createSurvey);
router.get('/:businessId/surveys', satisfactionSurveyController.getSurveys);
router.get('/:businessId/surveys/summary', satisfactionSurveyController.getSurveySummary);
router.get('/:businessId/surveys/agent-ratings', satisfactionSurveyController.getAgentRatings);
router.get('/:businessId/surveys/negative-feedback', satisfactionSurveyController.getNegativeFeedback);
router.get('/:businessId/surveys/trends', satisfactionSurveyController.getSurveyTrends);
router.post('/:businessId/surveys/:surveyId/follow-up', satisfactionSurveyController.sendFollowUp);

// ============================================
// ESCALATION POLICIES (Phase 4)
// ============================================

router.post('/:businessId/escalation-policies', escalationPoliciesController.createPolicy);
router.get('/:businessId/escalation-policies', escalationPoliciesController.listPolicies);
router.put('/:businessId/escalation-policies/:policyId', escalationPoliciesController.updatePolicy);
router.delete('/:businessId/escalation-policies/:policyId', escalationPoliciesController.deletePolicy);
router.post('/:businessId/escalation-policies/:policyId/steps', escalationPoliciesController.addStep);
router.post('/:businessId/escalations/trigger/:conversationId', escalationPoliciesController.triggerEscalation);
router.get('/:businessId/escalations/:conversationId', escalationPoliciesController.getEscalationHistory);

// ============================================
// SUPPORT TEAMS (Phase 4)
// ============================================

router.post('/:businessId/teams', supportTeamsController.createTeam);
router.get('/:businessId/teams', supportTeamsController.listTeams);
router.put('/:businessId/teams/:teamId', supportTeamsController.updateTeam);
router.post('/:businessId/teams/:teamId/members', supportTeamsController.addMember);
router.delete('/:businessId/teams/members/:memberId', supportTeamsController.removeMember);
router.post('/:businessId/teams/:teamId/skills', supportTeamsController.addSkill);
router.get('/:businessId/teams/:teamId/metrics', supportTeamsController.getTeamMetrics);

// ============================================
// SKILL-BASED ROUTING (Phase 4)
// ============================================

router.post('/:businessId/routing/find-agent', skillBasedRoutingController.findAgentBySkills);
router.post('/:businessId/routing/find-team', skillBasedRoutingController.findTeamBySkills);
router.post('/:businessId/routing/by-skills/:conversationId', skillBasedRoutingController.routeBySkills);
router.get('/:businessId/routing/skill-matrix', skillBasedRoutingController.getAgentSkillMatrix);
router.get('/:businessId/routing/coverage', skillBasedRoutingController.getCoverageBySkill);

module.exports = router;
