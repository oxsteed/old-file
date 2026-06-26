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
const db = require('../db');
const { randomUUID } = require('crypto');

// Public/customer ticket entry point. Guests can create tickets, and signed-in
// users are linked automatically when a valid bearer token is present.
router.post('/request', optionalAuth, supportTicketController.submitSupportRequest);

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
       COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at))/3600)::numeric, 1), 0)::float AS avg_resolution_hours
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
    if (businessId && req.query.business_id) {
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

router.post('/conversations', async (req, res, next) => {
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

router.post('/conversations/:conversationId/message', (req, res, next) => {
  req.body = {
    ...req.body,
    content: req.body.content || req.body.message,
    attachmentUrl: req.body.attachmentUrl || req.body.attachments?.[0]?.url,
    attachmentName: req.body.attachmentName || req.body.attachments?.[0]?.name,
  };
  return supportConversationsController.addMessage(req, res, next);
});

router.get('/agents/dashboard', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId;
    const stats = await supportConversationStats(businessId);
    const { rows: agents } = await db.query(
      `SELECT
         sa.id,
         COALESCE(u.name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), u.email) AS name,
         COALESCE(sa.role, 'agent') AS role,
         sa.is_available,
         sa.status,
         COALESCE(sa.total_conversations_handled, 0) AS total_chats
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       WHERE ($1::uuid IS NULL OR sa.business_id = $1::uuid)
       ORDER BY sa.is_available DESC, sa.updated_at DESC
       LIMIT 25`,
      [businessId || null]
    ).catch(() => ({ rows: [] }));
    res.json({
      stats: {
        agents_online: agents.filter((agent) => agent.is_available).length,
        active_conversations: stats.active_conversations || 0,
        avg_response_time_seconds: stats.avg_response_time_seconds || 0,
        resolution_rate: stats.resolution_rate || 0,
      },
      agents: agents.map((agent) => ({
        ...agent,
        active_chats: 0,
      })),
      active_conversations: [],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/agents', async (req, res, next) => {
  try {
    const businessId = req.query.business_id || req.query.businessId;
    const search = String(req.query.search || '').trim();
    const params = [businessId || null];
    let searchSql = '';
    if (search) {
      params.push(`%${search}%`);
      searchSql = `AND (u.email ILIKE $2 OR u.name ILIKE $2 OR u.first_name ILIKE $2 OR u.last_name ILIKE $2)`;
    }
    const { rows } = await db.query(
      `SELECT
         sa.id,
         sa.user_id,
         COALESCE(u.name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), u.email) AS name,
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
       WHERE ($1::uuid IS NULL OR sa.business_id = $1::uuid) ${searchSql}
       ORDER BY sa.updated_at DESC, sa.created_at DESC
       LIMIT 100`,
      params
    ).catch(() => ({ rows: [] }));
    res.json({ agents: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/agents/:agentId/toggle-status', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE support_agents
       SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [req.params.agentId]
    ).catch(() => ({ rows: [] }));
    if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/agents/:agentId', async (req, res, next) => {
  try {
    await db.query('DELETE FROM support_agents WHERE id = $1', [req.params.agentId]).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/metrics', async (req, res, next) => {
  try {
    const stats = await supportConversationStats(req.query.business_id || req.query.businessId);
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
    const stats = await supportConversationStats(req.query.business_id || req.query.businessId);
    res.json({
      stats: {
        overall_compliance: stats.priority_conversations ? 90 : 100,
        avg_first_response_minutes: Math.round((stats.avg_response_time_seconds || 0) / 60),
        avg_resolution_hours: stats.avg_resolution_hours || 0,
        violation_count: 0,
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
    const { rows } = await db.query(
      `SELECT
         sa.id,
         COALESCE(u.name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), u.email) AS name,
         COALESCE(sa.role, 'agent') AS role,
         COALESCE(sa.avg_rating, 0) AS rating,
         COALESCE(sa.total_conversations_handled, 0) AS total_chats,
         0 AS avg_response_time_seconds,
         COALESCE(sa.total_resolved_count, 0) AS resolved_count
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       WHERE ($1::uuid IS NULL OR sa.business_id = $1::uuid)
       ORDER BY sa.avg_rating DESC NULLS LAST, sa.updated_at DESC
       LIMIT 100`,
      [businessId || null]
    ).catch(() => ({ rows: [] }));
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
         COALESCE(u.name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), u.email) AS name,
         u.email,
         COALESCE(sa.role, 'agent') AS role,
         COALESCE(sa.avg_rating, 0) AS rating,
         COALESCE(sa.total_conversations_handled, 0) AS total_chats,
         COALESCE(sa.total_resolved_count, 0) AS resolved_count
       FROM support_agents sa
       JOIN users u ON u.id = sa.user_id
       WHERE sa.id = $1`,
      [req.params.agentId]
    ).catch(() => ({ rows: [] }));
    if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent: rows[0], trend: [], conversations: [] });
  } catch (err) {
    next(err);
  }
});

router.get('/csat/analytics', (req, res) => {
  res.json({
    metrics: {
      csat_score: 0,
      csat_target: 80,
      survey_response_rate: 0,
      surveys_sent: 0,
      surveys_completed: 0,
      avg_rating: 0,
    },
    csat_trend: [],
    sentiment_distribution: [],
    agent_csat: [],
    recent_feedback: [],
  });
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

router.get('/audit/logs', (req, res) => {
  res.json({
    logs: [],
    stats: {
      total_entries: 0,
      users_active: 0,
      actions_today: 0,
      last_entry: null,
    },
  });
});

router.get('/audit/export', (req, res) => {
  res.type('text/csv').send('timestamp,actor,action,resource\n');
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
