/**
 * Support Routing Service
 * Implements 3-layer routing: AI → Skill → Availability
 */

const pool = require('../db');
const logger = require('../utils/logger');

class SupportRoutingService {
  /**
   * Layer 1: AI Pre-filtering
   * Analyzes customer message and returns AI response with confidence score
   */
  static async analyzeWithAI(messageText, category) {
    try {
      // TODO: Integrate with OpenRouter/Claude for confidence scoring
      // For now, return mock confidence based on category
      const categoryConfidence = {
        'billing': 0.85,
        'technical': 0.65,
        'account': 0.90,
        'general': 0.75,
        'shipping': 0.88,
      };

      const confidence = categoryConfidence[category] || 0.60;
      const shouldEscalate = confidence < 0.70; // Threshold for escalation

      return {
        confidence,
        shouldEscalate,
        category,
        suggestedResponse: null, // Would contain AI response
      };
    } catch (err) {
      logger.error('AI analysis failed', { error: err.message });
      return { confidence: 0, shouldEscalate: true, category };
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
          a.first_name,
          a.last_name,
          a.email,
          a.skills,
          a.is_active,
          (
            SELECT COUNT(*) FROM support_conversations
            WHERE assigned_agent_id = a.id
            AND status NOT IN ('resolved', 'closed')
          ) as current_chats,
          (
            SELECT max_agents FROM support_shifts
            WHERE id = a.current_shift_id
          ) as shift_capacity
        FROM support_agents a
        WHERE a.business_id = $1
        AND a.is_active = true
        AND (
          a.skills @> $2::jsonb
          OR $2::text = '[]'
        )
        ORDER BY current_chats ASC, a.created_at ASC
      `;

      const skillsJson = requiredSkills.length > 0
        ? JSON.stringify(requiredSkills)
        : '[]';

      const result = await pool.query(query, [businessId, skillsJson]);
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
  static async filterByAvailability(agents) {
    try {
      return agents.filter(agent => {
        const isOnline = agent.is_active === true;
        const hasCapacity = !agent.current_chats || agent.current_chats < 8; // Max 8 chats/agent
        return isOnline && hasCapacity;
      });
    } catch (err) {
      logger.error('Availability filtering failed', { error: err.message });
      return [];
    }
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

      // Layer 1: AI Analysis
      const aiAnalysis = await this.analyzeWithAI(message, category);

      if (!aiAnalysis.shouldEscalate) {
        return {
          routedTo: 'ai',
          confidence: aiAnalysis.confidence,
          agentId: null,
        };
      }

      // Layer 2: Skill-based search
      const skillsForCategory = this.getSkillsForCategory(category);
      const skillMatchedAgents = await this.findAgentsBySkill(
        skillsForCategory,
        businessId
      );

      if (skillMatchedAgents.length === 0) {
        // Fallback: find any available agent
        const anyAgent = await this.findAgentsBySkill([], businessId);
        const available = this.filterByAvailability(anyAgent);

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
      const availableAgents = this.filterByAvailability(skillMatchedAgents);

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
        SET assigned_agent_id = $1, status = 'assigned', updated_at = NOW()
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
          COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) as active_chats,
          COUNT(*) FILTER (WHERE status = 'waiting_customer') as waiting,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as past_hour
        FROM support_conversations
        WHERE assigned_agent_id = $1
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
