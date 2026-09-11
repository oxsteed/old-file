/**
 * Support Routing Service
 * Implements 3-layer routing: AI → Skill → Availability
 */

const pool = require('../db');
const logger = require('../utils/logger');
const WebSocketService = require('./websocketService');
const supportTriageAI = require('./supportTriageAI');
const { TERMINAL_CONVERSATION_STATUS_SQL } = require('./supportConversationTerminal');

function routableAgents(agents) {
  // A database availability flag alone must never promise a live reply. The
  // agent must be connected to this realtime process as well.
  if (!WebSocketService.isInitialized() || !WebSocketService.getActiveAgentCount()) return [];
  return agents.filter((agent) => WebSocketService.isAgentOnline(agent.id));
}

class SupportRoutingService {
  /**
   * Layer 1: AI Pre-filtering
   * Analyzes customer message and returns AI response with confidence score
   */
  static async analyzeWithAI(messageText, category) {
    try {
      const result = await supportTriageAI.analyze({ message: messageText, category });
      return {
        ...result,
        shouldEscalate: result.confidence < 0.70,
        suggestedResponse: null,
      };
    } catch (err) {
      logger.warn('Support triage AI unavailable; continuing with human routing', {
        error: err.message,
      });
      return {
        ...supportTriageAI.fallback(category, 'provider_error'),
        shouldEscalate: true,
        suggestedResponse: null,
      };
    }
  }

  /**
   * Layer 2: Skill-based Routing
   * Finds agents with matching skills and availability
   */
  static async findAgentsBySkill(requiredSkills, businessId) {
    try {
      const query = `
        SELECT
          a.id,
          u.first_name,
          u.last_name,
          u.email,
          a.status = 'active' AS is_active,
          a.is_available,
          a.max_concurrent_chats,
          (
            SELECT COUNT(*) FROM support_conversations
            WHERE agent_id = a.id
            AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
          )::int AS current_chats
        FROM support_agents a
        JOIN users u ON u.id = a.user_id
        JOIN support_employers e ON e.id = a.employer_id
        WHERE (a.business_id = $1 OR e.business_id = $1 OR e.kind = 'platform')
        AND a.status = 'active'
        AND a.is_available = true
        AND u.is_active = true
        AND u.is_available_for_support = true
        AND u.support_available_at > NOW() - INTERVAL '2 minutes'
        AND (
          cardinality($2::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM agent_skills askill
            WHERE askill.agent_id = a.id
              AND askill.skill_name = ANY($2::text[])
          )
        )
        ORDER BY current_chats ASC, a.created_at ASC
      `;

      const result = await pool.query(query, [businessId, requiredSkills]);
      return result.rows;
    } catch (err) {
      logger.error('Skill-based routing failed', { error: err.message });
      return [];
    }
  }

  /**
   * Layer 3: Availability Routing
   * Checks agent online status and capacity
   */
  static filterByAvailability(agents) {
    try {
      return agents.filter(agent => {
        const isOnline = agent.is_active === true && agent.is_available === true;
        const maxChats = Number(agent.max_concurrent_chats || 3);
        const hasCapacity = Number(agent.current_chats || 0) < maxChats;
        return isOnline && hasCapacity;
      });
    } catch (err) {
      logger.error('Availability filtering failed', { error: err.message });
      return [];
    }
  }

  /** Return the single availability view used by status and live routing. */
  static async getLiveAvailability(businessId = null) {
    const databaseEligible = await this.findAgentsBySkill([], businessId);
    const connectedEligible = databaseEligible.filter((agent) => WebSocketService.isAgentOnline(agent.id));
    const liveAgents = routableAgents(this.filterByAvailability(databaseEligible));
    const onlineAgents = connectedEligible.length;
    const availableCapacity = liveAgents.reduce((total, agent) => (
      total + Math.max(0, Number(agent.max_concurrent_chats || 3) - Number(agent.current_chats || 0))
    ), 0);

    return {
      liveAgents,
      liveAvailableAgents: liveAgents.length,
      onlineAgents,
      availableCapacity,
      markedAvailableAgents: databaseEligible.length,
      diagnostics: databaseEligible.map((agent) => {
        const maxChats = Number(agent.max_concurrent_chats || 3);
        const currentChats = Number(agent.current_chats || 0);
        const connected = WebSocketService.isAgentOnline(agent.id);
        return {
          id: agent.id,
          name: [agent.first_name, agent.last_name].filter(Boolean).join(' ').trim() || agent.email,
          markedAvailable: true,
          liveReady: connected && currentChats < maxChats,
          reason: !connected ? 'websocket_disconnected' : currentChats >= maxChats ? 'at_capacity' : 'ready',
          currentChats,
          maxConcurrentChats: maxChats,
        };
      }),
    };
  }

  /**
   * Full routing pipeline
   * Returns best-matched agent or null if no one available
   */
  static async routeTicket(ticketData) {
    try {
      const {
        customerId,
        businessId,
        category,
        message,
        priority,
      } = ticketData;

      // AI can provide context, but an available human always wins for live support.
      const aiAnalysis = await this.analyzeWithAI(message, category);

      // Layer 2: Skill-based search
      const explicitSkills = this.getSkillsForCategory(category);
      const skillsForCategory = explicitSkills.length > 0
        ? explicitSkills
        : (Array.isArray(aiAnalysis.suggestedSkills) ? aiAnalysis.suggestedSkills : []);
      const skillMatchedAgents = await this.findAgentsBySkill(
        skillsForCategory,
        businessId
      );

      if (skillMatchedAgents.length === 0) {
        // Fallback: find any available agent
        const anyAgent = await this.findAgentsBySkill([], businessId);
        const available = routableAgents(this.filterByAvailability(anyAgent));

        if (available.length === 0) {
          return {
            routedTo: 'queue',
            confidence: aiAnalysis.confidence,
            agentId: null,
          };
        }

        return {
          routedTo: 'agent',
          confidence: aiAnalysis.confidence,
          agentId: available[0].id,
          agent: available[0],
        };
      }

      // Layer 3: Availability filtering
      const availableAgents = routableAgents(this.filterByAvailability(skillMatchedAgents));

      if (availableAgents.length === 0) {
        return {
          routedTo: 'queue',
          confidence: aiAnalysis.confidence,
          agentId: null,
        };
      }

      // Return best-matched agent (lowest current chat count)
      const bestAgent = availableAgents[0];
      return {
        routedTo: 'agent',
        confidence: aiAnalysis.confidence,
        agentId: bestAgent.id,
        agent: bestAgent,
      };
    } catch (err) {
      logger.error('Ticket routing failed', { error: err.message });
      return {
        routedTo: 'queue',
        agentId: null,
        error: err.message,
      };
    }
  }

  /**
   * Map ticket category to required agent skills
   */
  static getSkillsForCategory(category) {
    const categorySkillMap = {
      'billing': ['billing'],
      'technical': ['technical'],
      'account': ['account'],
      'shipping': ['shipping'],
      'general': ['general'],
      'escalations': ['escalations'],
    };

    return categorySkillMap[category] || [];
  }

  /**
   * Assign ticket to agent
   */
  static async assignTicketToAgent(ticketId, agentId) {
    try {
      const query = `
        UPDATE support_conversations
        SET agent_id = $1, status = 'in_progress', assigned_at = NOW(), updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;

      const result = await pool.query(query, [agentId, ticketId]);
      logger.info('Ticket assigned to agent', { ticketId, agentId });
      return result.rows[0];
    } catch (err) {
      logger.error('Ticket assignment failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Get agent's current workload
   */
  static async getAgentWorkload(agentId) {
    try {
      const query = `
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})) as active_chats,
          COUNT(*) FILTER (WHERE status = 'waiting_for_customer') as waiting,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as past_hour
        FROM support_conversations
        WHERE agent_id = $1
      `;

      const result = await pool.query(query, [agentId]);
      return result.rows[0] || { active_chats: 0, waiting: 0, past_hour: 0 };
    } catch (err) {
      logger.error('Workload query failed', { error: err.message });
      return { active_chats: 0, waiting: 0, past_hour: 0 };
    }
  }
}

module.exports = SupportRoutingService;
