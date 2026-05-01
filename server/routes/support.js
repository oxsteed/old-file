// Support Routes - Phase 1: Agent Infrastructure, Hiring, Shifts, Queue, Conversations
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const supportAgentsController = require('../controllers/supportAgentsController');
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

// All routes require authentication
router.use(requireAuth);

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
