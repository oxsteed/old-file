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
const supportEmployerService = require('../services/supportEmployerService');
const db = require('../db');
const { randomUUID } = require('crypto');
const { authenticatedLimiter, conversationMessageLimiter } = require('../middleware/rateLimiter');
const publicSupport = require('../controllers/publicSupportController');
const SupportRoutingService = require('../services/supportRoutingService');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');

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

const supportAdminStore = {
  shifts: new Map(),
  kb: new Map(),
  templates: new Map(),
  escalationRules: new Map(),
  teamMembers: new Map(),
  settings: new Map(),
};

function withId(payload) {
  const now = new Date().toISOString();
  return {
    id: payload.id || randomUUID(),
    created_at: payload.created_at || now,
    updated_at: now,
    ...payload,
  };
}

function valuesFor(store, businessId) {
  return Array.from(store.values()).filter((item) => !businessId || item.business_id === businessId);
}

function saveTo(store, payload) {
  const row = withId(payload);
  store.set(row.id, row);
  return row;
}

function updateIn(store, id, payload) {
  const existing = store.get(id);
  if (!existing) return null;
  const row = withId({ ...existing, ...payload, id });
  store.set(id, row);
  return row;
}

async function supportConversationStats(businessId) {
  const conditions = [];
  const params = [];
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

    if (isPlatformAdmin || platformAgent) {
      const params = [];
      const where = req.query.business_id || req.query.businessId
        ? `WHERE sc.business_id = $${params.push(businessId)}`
        : "WHERE sc.status <> 'pending_verification'";
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
         FROM support_conversations sc
         LEFT JOIN users cu ON cu.id = sc.customer_id
         LEFT JOIN support_agents sa ON sa.id = sc.agent_id
         LEFT JOIN users au ON au.id = sa.user_id
         LEFT JOIN support_conversation_messages scm ON scm.conversation_id = sc.id
         ${where}
         GROUP BY sc.id, cu.id, au.id, sa.id
         ORDER BY sc.updated_at DESC, sc.created_at DESC
         LIMIT 100`,
        params
      );
      return res.json({ conversations: rows });
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

router.post('/conversations', conversationMessageLimiter, async (req, res, next) => {
  try {
    const businessId = await resolveSupportBusinessId(req);
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
router.get('/conversations/:conversationId/download', supportConversationsController.downloadConversation);

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
router.post('/conversations/:conversationId/review', conversationMessageLimiter, supportConversationsController.createConversationReview);
router.post('/conversations/:conversationId/reopen', conversationMessageLimiter, supportConversationsController.reopenCustomerConversation);
router.post('/conversations/:conversationId/email', conversationMessageLimiter, supportConversationsController.sendConversationEmail);

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
    res.json({
      stats,
      trend: [],
      departments: [],
      categories: [],
      top_agents: [],
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
    res.json({
      stats: {
        overall_compliance: eligible ? Math.round((Number(stats.sla_met_count || 0) / eligible) * 100) : null,
        avg_first_response_minutes: Math.round((stats.avg_response_time_seconds || 0) / 60),
        avg_resolution_hours: stats.avg_resolution_hours || 0,
        violation_count: Number(stats.sla_violation_count || 0),
      },
      trend: [],
      departments: [],
      violations: [],
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
    const { rows } = await db.query(
      `SELECT
         sa.id,
         sa.user_id,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
         COALESCE(sa.role, 'agent') AS role,
         COALESCE(sa.avg_rating, 0) AS rating,
         COALESCE(sa.total_conversations_handled, 0) AS total_chats,
         0 AS avg_response_time_seconds,
         COALESCE(sa.total_resolved_count, 0) AS resolved_count
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       WHERE ($1::integer IS NULL OR sa.business_id = $1::integer)
       ORDER BY sa.avg_rating DESC NULLS LAST, sa.updated_at DESC
       LIMIT 100`,
      [businessId || null]
    );
    res.json({ agents: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/performance/:agentId', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT
         sa.id,
         sa.user_id,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name,
         u.email,
         COALESCE(sa.role, 'agent') AS role,
         COALESCE(sa.avg_rating, 0) AS rating,
         COALESCE(sa.total_conversations_handled, 0) AS total_chats,
         COALESCE(sa.total_resolved_count, 0) AS resolved_count,
         sa.employer_id
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       WHERE sa.id = $1`,
      [req.params.agentId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
    const canAccess = await supportEmployerService.userCanManageEmployer(
      rows[0].employer_id,
      req.user.id,
      req.user.role
    );
    if (!canAccess && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ agent: rows[0], trend: [], conversations: [] });
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
           COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE scr.rating >= 4) / NULLIF(COUNT(scr.id), 0), 1), 0)::float AS csat_score
         FROM finished f
         LEFT JOIN support_conversation_reviews scr ON scr.conversation_id = f.id
           AND scr.created_at >= NOW() - INTERVAL '30 days'`,
        [businessId]
      ),
      db.query(
        `SELECT DATE_TRUNC('day', scr.created_at)::date AS day,
                COUNT(*)::int AS responses,
                COALESCE(ROUND(AVG(scr.rating)::numeric, 2), 0)::float AS avg_rating
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
                COALESCE(ROUND(AVG(scr.rating)::numeric, 2), 0)::float AS avg_rating
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
        `SELECT scr.id, scr.conversation_id, scr.rating, scr.comment, scr.created_at,
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

router.get('/shifts', (req, res) => {
  res.json({ shifts: valuesFor(supportAdminStore.shifts, req.query.business_id || req.query.businessId) });
});

router.post('/shifts', (req, res) => {
  res.status(201).json({ shift: saveTo(supportAdminStore.shifts, req.body) });
});

router.patch('/shifts/:id', (req, res) => {
  const shift = updateIn(supportAdminStore.shifts, req.params.id, req.body);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  res.json({ shift });
});

router.delete('/shifts/:id', (req, res) => {
  supportAdminStore.shifts.delete(req.params.id);
  res.json({ success: true });
});

router.get('/kb', (req, res) => {
  res.json({ articles: valuesFor(supportAdminStore.kb, req.query.business_id || req.query.businessId) });
});

router.post('/kb', (req, res) => {
  res.status(201).json({ article: saveTo(supportAdminStore.kb, { views: 0, helpful_count: 0, ...req.body }) });
});

router.patch('/kb/:id', (req, res) => {
  const article = updateIn(supportAdminStore.kb, req.params.id, req.body);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  res.json({ article });
});

router.delete('/kb/:id', (req, res) => {
  supportAdminStore.kb.delete(req.params.id);
  res.json({ success: true });
});

router.get('/templates', (req, res) => {
  res.json({ templates: valuesFor(supportAdminStore.templates, req.query.business_id || req.query.businessId) });
});

router.post('/templates', (req, res) => {
  res.status(201).json({ template: saveTo(supportAdminStore.templates, { use_count: 0, ...req.body }) });
});

router.patch('/templates/:id', (req, res) => {
  const template = updateIn(supportAdminStore.templates, req.params.id, req.body);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json({ template });
});

router.delete('/templates/:id', (req, res) => {
  supportAdminStore.templates.delete(req.params.id);
  res.json({ success: true });
});

router.get('/escalation/rules', (req, res) => {
  const rules = valuesFor(supportAdminStore.escalationRules, req.query.business_id || req.query.businessId);
  res.json({
    rules,
    stats: {
      total_rules: rules.length,
      active_rules: rules.filter((rule) => rule.is_active !== false).length,
      escalations_today: 0,
    },
  });
});

router.post('/escalation/rules', (req, res) => {
  res.status(201).json({ rule: saveTo(supportAdminStore.escalationRules, { is_active: true, ...req.body }) });
});

router.put('/escalation/rules/:id', (req, res) => {
  const rule = updateIn(supportAdminStore.escalationRules, req.params.id, req.body);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json({ rule });
});

router.patch('/escalation/rules/:id/toggle', (req, res) => {
  const existing = supportAdminStore.escalationRules.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });
  const rule = updateIn(supportAdminStore.escalationRules, req.params.id, { is_active: existing.is_active === false });
  res.json({ rule });
});

router.delete('/escalation/rules/:id', (req, res) => {
  supportAdminStore.escalationRules.delete(req.params.id);
  res.json({ success: true });
});

router.get('/team/hierarchy', (req, res) => {
  const members = valuesFor(supportAdminStore.teamMembers, req.query.business_id || req.query.businessId);
  res.json({
    departments: [{ id: 'support', name: 'Support', members }],
    stats: { members: members.length, departments: 1 },
    available_roles: ['agent', 'supervisor', 'manager', 'director'],
    available_skills: ['billing', 'technical', 'account', 'safety'],
  });
});

router.post('/team/members', (req, res) => {
  res.status(201).json({ member: saveTo(supportAdminStore.teamMembers, req.body) });
});

router.put('/team/members/:id', (req, res) => {
  const member = updateIn(supportAdminStore.teamMembers, req.params.id, req.body);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  res.json({ member });
});

router.delete('/team/members/:id', (req, res) => {
  supportAdminStore.teamMembers.delete(req.params.id);
  res.json({ success: true });
});

router.get('/settings', (req, res) => {
  const businessId = req.query.business_id || req.query.businessId || 'default';
  res.json(supportAdminStore.settings.get(businessId) || {
    general: { business_id: businessId, support_enabled: true },
    routing: {},
    notifications: {},
    sla: {},
  });
});

router.post('/settings/:section', (req, res) => {
  const businessId = req.body.business_id || 'default';
  const existing = supportAdminStore.settings.get(businessId) || {};
  const updated = { ...existing, [req.params.section]: req.body };
  supportAdminStore.settings.set(businessId, updated);
  res.json(updated);
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
router.post('/:businessId/conversations', supportConversationsController.createConversation);

// List conversations (with filters)
router.get('/:businessId/conversations', supportConversationsController.listConversations);

// Get single conversation
router.get('/:businessId/conversations/:conversationId', supportConversationsController.getConversation);

// Update conversation status
router.put('/:businessId/conversations/:conversationId/status', supportConversationsController.updateConversationStatus);

// Add message to conversation
router.post('/:businessId/conversations/:conversationId/messages', supportConversationsController.addMessage);

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

router.post('/:businessId/ai/message', aiChatbotController.sendMessage);
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
