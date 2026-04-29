// Agent Shifts Controller
// Manages shift scheduling, clock in/out, breaks, and shift tracking

const { query, withTransaction } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

// Get agent's shifts for a date range
async function getAgentShifts(req, res) {
  try {
    const { agentId } = req.params;
    const { startDate, endDate, limit = 30 } = req.query;

    if (!startDate || !endDate) {
      return sendValidationError(res, {
        startDate: 'Required',
        endDate: 'Required'
      });
    }

    const result = await query(
      `SELECT * FROM agent_shifts
       WHERE agent_id = $1
       AND shift_date BETWEEN $2 AND $3
       ORDER BY shift_date DESC
       LIMIT $4`,
      [agentId, startDate, endDate, parseInt(limit)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getAgentShifts error', { error: err.message });
    sendError(res, 500, 'Failed to get shifts');
  }
}

// Create a scheduled shift
async function createShift(req, res) {
  try {
    const { agentId } = req.params;
    const { businessId, shiftDate, scheduledStart, scheduledEnd } = req.body;

    if (!businessId || !shiftDate || !scheduledStart || !scheduledEnd) {
      return sendValidationError(res, {
        businessId: 'Required',
        shiftDate: 'Required',
        scheduledStart: 'Required',
        scheduledEnd: 'Required'
      });
    }

    // Verify agent belongs to business
    const agent = await query(
      'SELECT * FROM support_agents WHERE id = $1 AND business_id = $2',
      [agentId, businessId]
    );
    if (!agent.rows.length) return sendError(res, 404, 'Agent not found');

    // Verify access
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [businessId, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    // Create shift
    const result = await query(
      `INSERT INTO agent_shifts
       (agent_id, business_id, shift_date, scheduled_start, scheduled_end, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')
       RETURNING *`,
      [agentId, businessId, shiftDate, scheduledStart, scheduledEnd]
    );

    logger.info('Shift created', { agentId, shiftDate });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createShift error', { error: err.message });
    sendError(res, 500, 'Failed to create shift');
  }
}

// Agent clocks in
async function clockIn(req, res) {
  try {
    const { agentId } = req.params;

    // Get or create today's shift
    const today = new Date().toISOString().split('T')[0];

    let shift = await query(
      'SELECT * FROM agent_shifts WHERE agent_id = $1 AND shift_date = $2',
      [agentId, today]
    );

    if (!shift.rows.length) {
      // Create shift if doesn't exist
      shift = await query(
        `INSERT INTO agent_shifts
         (agent_id, business_id, shift_date, status, actual_clock_in)
         SELECT id, business_id, $2, 'clocked_in', CURRENT_TIMESTAMP
         FROM support_agents WHERE id = $1
         RETURNING *`,
        [agentId, today]
      );
    } else if (shift.rows[0].actual_clock_in) {
      return sendError(res, 400, 'Agent already clocked in');
    } else {
      // Update existing shift
      shift = await query(
        `UPDATE agent_shifts
         SET actual_clock_in = CURRENT_TIMESTAMP, status = 'clocked_in'
         WHERE id = $1
         RETURNING *`,
        [shift.rows[0].id]
      );
    }

    // Mark agent as available
    await query(
      'UPDATE support_agents SET is_available = true WHERE id = $1',
      [agentId]
    );

    // Log availability
    await query(
      `INSERT INTO agent_availability_log (agent_id, status, reason)
       VALUES ($1, 'available', 'Clocked in')`,
      [agentId]
    );

    logger.info('Agent clocked in', { agentId });

    res.json({ success: true, data: shift.rows[0] });
  } catch (err) {
    logger.error('clockIn error', { error: err.message });
    sendError(res, 500, 'Failed to clock in');
  }
}

// Agent clocks out
async function clockOut(req, res) {
  try {
    const { agentId } = req.params;

    const today = new Date().toISOString().split('T')[0];

    const shift = await query(
      'SELECT * FROM agent_shifts WHERE agent_id = $1 AND shift_date = $2',
      [agentId, today]
    );

    if (!shift.rows.length || !shift.rows[0].actual_clock_in) {
      return sendError(res, 400, 'No active shift found');
    }

    // Calculate worked time (minus breaks)
    const clockIn = new Date(shift.rows[0].actual_clock_in);
    const clockOut = new Date();
    const breakMinutes = shift.rows[0].total_break_minutes || 0;
    const workedMinutes = Math.round((clockOut - clockIn) / 60000) - breakMinutes;

    // Update shift
    const result = await query(
      `UPDATE agent_shifts
       SET actual_clock_out = CURRENT_TIMESTAMP,
           status = 'clocked_out',
           total_worked_minutes = $2
       WHERE id = $1
       RETURNING *`,
      [shift.rows[0].id, Math.max(0, workedMinutes)]
    );

    // Mark agent as offline
    await query(
      'UPDATE support_agents SET is_available = false WHERE id = $1',
      [agentId]
    );

    // Log availability
    await query(
      `INSERT INTO agent_availability_log (agent_id, status, reason)
       VALUES ($1, 'offline', 'Clocked out')`,
      [agentId]
    );

    logger.info('Agent clocked out', { agentId, workedMinutes });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('clockOut error', { error: err.message });
    sendError(res, 500, 'Failed to clock out');
  }
}

// Start break
async function startBreak(req, res) {
  try {
    const { agentId } = req.params;
    const { reason } = req.body;

    const today = new Date().toISOString().split('T')[0];

    const shift = await query(
      'SELECT * FROM agent_shifts WHERE agent_id = $1 AND shift_date = $2',
      [agentId, today]
    );

    if (!shift.rows.length || !shift.rows[0].actual_clock_in) {
      return sendError(res, 400, 'No active shift');
    }

    if (shift.rows[0].break_start) {
      return sendError(res, 400, 'Already on break');
    }

    // Start break
    const result = await query(
      `UPDATE agent_shifts
       SET break_start = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [shift.rows[0].id]
    );

    // Log status change
    await query(
      `INSERT INTO agent_availability_log (agent_id, status, reason)
       VALUES ($1, 'break', $2)`,
      [agentId, reason || 'Break']
    );

    logger.info('Agent started break', { agentId });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('startBreak error', { error: err.message });
    sendError(res, 500, 'Failed to start break');
  }
}

// End break
async function endBreak(req, res) {
  try {
    const { agentId } = req.params;

    const today = new Date().toISOString().split('T')[0];

    const shift = await query(
      'SELECT * FROM agent_shifts WHERE agent_id = $1 AND shift_date = $2',
      [agentId, today]
    );

    if (!shift.rows.length || !shift.rows[0].break_start) {
      return sendError(res, 400, 'No active break');
    }

    // Calculate break duration
    const breakStart = new Date(shift.rows[0].break_start);
    const breakEnd = new Date();
    const breakMinutes = Math.round((breakEnd - breakStart) / 60000);
    const totalBreakMinutes = (shift.rows[0].total_break_minutes || 0) + breakMinutes;

    // End break
    const result = await query(
      `UPDATE agent_shifts
       SET break_end = CURRENT_TIMESTAMP,
           total_break_minutes = $2
       WHERE id = $1
       RETURNING *`,
      [shift.rows[0].id, totalBreakMinutes]
    );

    // Log status change
    await query(
      `INSERT INTO agent_availability_log (agent_id, status, reason)
       VALUES ($1, 'available', 'Break ended')`,
      [agentId]
    );

    logger.info('Agent ended break', { agentId, breakMinutes });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('endBreak error', { error: err.message });
    sendError(res, 500, 'Failed to end break');
  }
}

// Get shift template for recurring schedules
async function getShiftTemplate(req, res) {
  try {
    const { agentId } = req.params;

    const result = await query(
      'SELECT * FROM shift_templates WHERE agent_id = $1 ORDER BY day_of_week',
      [agentId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getShiftTemplate error', { error: err.message });
    sendError(res, 500, 'Failed to get shift template');
  }
}

// Set shift template (recurring schedule)
async function setShiftTemplate(req, res) {
  try {
    const { agentId } = req.params;
    const { businessId, dayOfWeek, startTime, endTime } = req.body;

    if (dayOfWeek === undefined || !startTime || !endTime) {
      return sendValidationError(res, {
        dayOfWeek: 'Required',
        startTime: 'Required',
        endTime: 'Required'
      });
    }

    if (dayOfWeek < 0 || dayOfWeek > 6) {
      return sendValidationError(res, { dayOfWeek: 'Must be 0-6' });
    }

    // Verify agent
    const agent = await query(
      'SELECT id FROM support_agents WHERE id = $1 AND business_id = $2',
      [agentId, businessId]
    );
    if (!agent.rows.length) return sendError(res, 404, 'Agent not found');

    const result = await query(
      `INSERT INTO shift_templates
       (business_id, agent_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, day_of_week) DO UPDATE SET
        start_time = $4, end_time = $5
       RETURNING *`,
      [businessId, agentId, dayOfWeek, startTime, endTime]
    );

    logger.info('Shift template updated', { agentId, dayOfWeek });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('setShiftTemplate error', { error: err.message });
    sendError(res, 500, 'Failed to set shift template');
  }
}

module.exports = {
  getAgentShifts,
  createShift,
  clockIn,
  clockOut,
  startBreak,
  endBreak,
  getShiftTemplate,
  setShiftTemplate
};
