'use strict';

/**
 * Producer for the support-desk daily tables that the business support
 * analytics endpoints read (agent_daily_performance, team_daily_performance,
 * business_daily_metrics). Before decision 4 nothing wrote them, so those
 * endpoints always returned empty history. The nightly snapshot worker now
 * fills one closed UTC day at a time, idempotently (upsert per natural key),
 * using the governed SLA target fragments from the metrics registry.
 *
 * Definitions (per conversation created on the day, merged excluded):
 *  - handled: conversations assigned to the agent / team / business
 *  - resolved: resolved_at set
 *  - first response / resolution averages: seconds from created_at
 *  - SLA met/violated: registry first-response and resolution targets;
 *    violated = breached flag, late response, or still none once the target
 *    has passed at rollup time (targets still ahead count as neither)
 *  - CSAT: mean review rating (1-5) per conversation, then averaged
 *  - compliance columns are fractions 0..1 (their DECIMAL(3,2) type)
 * Queue length and wait-time columns have no recorded source and stay NULL.
 */

const registry = require('./metricsRegistry');

function conversationCte() {
  const fr = registry.slaFirstResponseTargetSql('sc', 'sla_tgt');
  const rs = registry.slaResolutionTargetSql('sc', 'sla_tgt');
  return `day_conv AS (
    SELECT sc.id, sc.business_id, sc.agent_id, sc.created_at, sc.first_response_at, sc.resolved_at,
           sc.escalated_at, COALESCE(sc.agent_message_count, 0) AS agent_messages,
           (SELECT AVG(r.rating) FROM support_conversation_reviews r
             WHERE r.conversation_id = sc.id AND r.rating BETWEEN 1 AND 5) AS csat,
           CASE WHEN sc.first_response_at IS NOT NULL AND sc.first_response_at <= (${fr}) THEN 1 ELSE 0 END AS fr_met,
           CASE WHEN sc.sla_first_response_breached IS TRUE
                  OR (sc.first_response_at IS NOT NULL AND sc.first_response_at > (${fr}))
                  OR (sc.first_response_at IS NULL AND (${fr}) < NOW()) THEN 1 ELSE 0 END AS fr_violated,
           CASE WHEN sc.resolved_at IS NOT NULL AND sc.resolved_at <= (${rs}) THEN 1 ELSE 0 END AS rs_met,
           CASE WHEN sc.sla_resolution_breached IS TRUE
                  OR (sc.resolved_at IS NOT NULL AND sc.resolved_at > (${rs}))
                  OR (sc.resolved_at IS NULL AND (${rs}) < NOW()) THEN 1 ELSE 0 END AS rs_violated
      FROM support_conversations sc
      ${registry.slaTargetsJoinSql('sc', 'sla_tgt')}
     WHERE sc.created_at >= $1::DATE AND sc.created_at < $1::DATE + 1
       AND COALESCE(sc.status, '') <> 'merged' AND sc.merged_into_conversation_id IS NULL
  )`;
}

const AVG_FR = `ROUND(AVG(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at))) FILTER (WHERE c.first_response_at >= c.created_at))::INT`;
const AVG_RS = `ROUND(AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at))) FILTER (WHERE c.resolved_at >= c.created_at))::INT`;
const CSAT = 'ROUND(AVG(c.csat), 2)';
const FRAC = (met, violated) => `ROUND(SUM(${met})::NUMERIC / NULLIF(SUM(${met}) + SUM(${violated}), 0), 2)`;

/** Recompute all three rollups for one closed UTC day. Returns row counts. */
async function rollupSupportDay(client, day) {
  const params = [day];
  const agents = await client.query(`WITH ${conversationCte()}
    INSERT INTO agent_daily_performance AS t (agent_id, business_id, performance_date, conversations_handled,
      conversations_resolved, avg_first_response_seconds, avg_resolution_seconds, avg_csat_score,
      sla_first_response_met_count, sla_first_response_violated_count, sla_resolution_met_count,
      sla_resolution_violated_count, conversations_escalated, messages_sent)
    SELECT c.agent_id, se.business_id, $1::DATE, COUNT(*)::INT, COUNT(*) FILTER (WHERE c.resolved_at IS NOT NULL)::INT,
      ${AVG_FR}, ${AVG_RS}, ${CSAT}, SUM(c.fr_met)::INT, SUM(c.fr_violated)::INT, SUM(c.rs_met)::INT, SUM(c.rs_violated)::INT,
      COUNT(*) FILTER (WHERE c.escalated_at IS NOT NULL)::INT, SUM(c.agent_messages)::INT
      FROM day_conv c
      JOIN support_agents sa ON sa.id = c.agent_id
      JOIN support_employers se ON se.id = sa.employer_id AND se.kind = 'business' AND se.business_id = c.business_id
     GROUP BY c.agent_id, se.business_id
    ON CONFLICT (agent_id, performance_date) DO UPDATE SET business_id = EXCLUDED.business_id,
      conversations_handled = EXCLUDED.conversations_handled, conversations_resolved = EXCLUDED.conversations_resolved,
      avg_first_response_seconds = EXCLUDED.avg_first_response_seconds, avg_resolution_seconds = EXCLUDED.avg_resolution_seconds,
      avg_csat_score = EXCLUDED.avg_csat_score, sla_first_response_met_count = EXCLUDED.sla_first_response_met_count,
      sla_first_response_violated_count = EXCLUDED.sla_first_response_violated_count,
      sla_resolution_met_count = EXCLUDED.sla_resolution_met_count,
      sla_resolution_violated_count = EXCLUDED.sla_resolution_violated_count,
      conversations_escalated = EXCLUDED.conversations_escalated, messages_sent = EXCLUDED.messages_sent`, params);
  const teams = await client.query(`WITH ${conversationCte()}
    INSERT INTO team_daily_performance (team_id, business_id, performance_date, conversations_handled,
      conversations_resolved, avg_resolution_time_seconds, avg_csat_score, escalations_received, sla_compliance_percent)
    SELECT st.id, st.business_id, $1::DATE, COUNT(DISTINCT c.id)::INT,
      COUNT(DISTINCT c.id) FILTER (WHERE c.resolved_at IS NOT NULL)::INT, ${AVG_RS}, ${CSAT},
      COUNT(DISTINCT c.id) FILTER (WHERE c.escalated_at IS NOT NULL)::INT, ${FRAC('c.fr_met', 'c.fr_violated')}
      FROM day_conv c
      JOIN team_members tm ON tm.agent_id = c.agent_id AND tm.joined_at < $1::DATE + 1
       AND (tm.left_at IS NULL OR tm.left_at >= $1::DATE)
      JOIN support_teams st ON st.id = tm.team_id AND st.business_id = c.business_id
     GROUP BY st.id, st.business_id
    ON CONFLICT (team_id, performance_date) DO UPDATE SET conversations_handled = EXCLUDED.conversations_handled,
      conversations_resolved = EXCLUDED.conversations_resolved, avg_resolution_time_seconds = EXCLUDED.avg_resolution_time_seconds,
      avg_csat_score = EXCLUDED.avg_csat_score, escalations_received = EXCLUDED.escalations_received,
      sla_compliance_percent = EXCLUDED.sla_compliance_percent`, params);
  const businesses = await client.query(`WITH ${conversationCte()}
    INSERT INTO business_daily_metrics (business_id, metric_date, "date", total_conversations_created,
      total_conversations_resolved, avg_first_response_seconds, avg_resolution_seconds, avg_csat_score,
      total_agents_active, sla_first_response_compliance, sla_resolution_compliance)
    SELECT c.business_id, $1::DATE, $1::DATE, COUNT(*)::INT, COUNT(*) FILTER (WHERE c.resolved_at IS NOT NULL)::INT,
      ${AVG_FR}, ${AVG_RS}, ${CSAT}, COUNT(DISTINCT c.agent_id)::INT,
      ${FRAC('c.fr_met', 'c.fr_violated')}, ${FRAC('c.rs_met', 'c.rs_violated')}
      FROM day_conv c JOIN businesses b ON b.id = c.business_id
     GROUP BY c.business_id
    ON CONFLICT (business_id, metric_date) DO UPDATE SET "date" = EXCLUDED."date",
      total_conversations_created = EXCLUDED.total_conversations_created,
      total_conversations_resolved = EXCLUDED.total_conversations_resolved,
      avg_first_response_seconds = EXCLUDED.avg_first_response_seconds, avg_resolution_seconds = EXCLUDED.avg_resolution_seconds,
      avg_csat_score = EXCLUDED.avg_csat_score, total_agents_active = EXCLUDED.total_agents_active,
      sla_first_response_compliance = EXCLUDED.sla_first_response_compliance,
      sla_resolution_compliance = EXCLUDED.sla_resolution_compliance`, params);
  return { agents: agents.rowCount, teams: teams.rowCount, businesses: businesses.rowCount };
}

module.exports = { rollupSupportDay };
