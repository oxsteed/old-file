const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const db = require('../db');

// PHASE 1: Consultant Management
exports.createConsultant = async (req, res) => {
  const { user_id, role, bio, expertise_areas, rate_per_hour, client_limit } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO consultants (user_id, role, bio, expertise_areas, rate_per_hour, client_limit)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user_id, role, bio, expertise_areas || [], rate_per_hour || 0, client_limit || 10]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error creating consultant', { error: err.message });
    res.status(500).json({ error: 'Failed to create consultant' });
  }
};

exports.getConsultants = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, u.first_name, u.last_name, u.email FROM consultants c
       LEFT JOIN users u ON c.user_id = u.id WHERE c.status = 'active' ORDER BY c.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching consultants', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch consultants' });
  }
};

exports.updateConsultant = async (req, res) => {
  const { id } = req.params;
  const { bio, expertise_areas, rate_per_hour, client_limit, status } = req.body;
  try {
    const result = await db.query(
      `UPDATE consultants SET bio=$1, expertise_areas=$2, rate_per_hour=$3, client_limit=$4, status=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [bio, expertise_areas, rate_per_hour, client_limit, status, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating consultant', { error: err.message });
    res.status(500).json({ error: 'Failed to update consultant' });
  }
};

// PHASE 1: Consultant Availability
exports.setConsultantAvailability = async (req, res) => {
  const { consultant_id, schedule } = req.body;
  try {
    await db.query('DELETE FROM consultant_availability WHERE consultant_id = $1', [consultant_id]);
    for (const slot of schedule) {
      await db.query(
        `INSERT INTO consultant_availability (consultant_id, day_of_week, start_time, end_time, timezone)
         VALUES ($1, $2, $3, $4, $5)`,
        [consultant_id, slot.day_of_week, slot.start_time, slot.end_time, slot.timezone || 'UTC']
      );
    }
    res.json({ message: 'Availability updated' });
  } catch (err) {
    logger.error('Error setting availability', { error: err.message });
    res.status(500).json({ error: 'Failed to set availability' });
  }
};

// PHASE 1: Session Assignment
exports.assignConsultant = async (req, res) => {
  const { session_id, consultant_id } = req.body;
  try {
    const result = await db.query(
      `UPDATE consulting_sessions SET consultant_id=$1, assigned_at=NOW() WHERE id=$2 RETURNING *`,
      [consultant_id, session_id]
    );
    logger.info('Consultant assigned', { session_id, consultant_id });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error assigning consultant', { error: err.message });
    res.status(500).json({ error: 'Failed to assign consultant' });
  }
};

// PHASE 2: Schedule Session
exports.scheduleSession = async (req, res) => {
  const { session_id, scheduled_date, scheduled_time, duration_minutes, meeting_type } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO consulting_sessions_scheduled (session_id, scheduled_date, scheduled_time, duration_minutes, meeting_type, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING *`,
      [session_id, scheduled_date, scheduled_time, duration_minutes || 120, meeting_type || 'zoom']
    );
    const scheduled = result.rows[0];

    // Generate meeting URL placeholder
    const meetingUrl = `https://zoom.us/j/session${session_id}`;
    await db.query('UPDATE consulting_sessions_scheduled SET meeting_url=$1 WHERE id=$2', [meetingUrl, scheduled.id]);

    // Fetch customer details and send scheduling confirmation email
    const sessionData = await db.query(
      'SELECT email, first_name FROM consulting_sessions WHERE id = $1',
      [session_id]
    );

    if (sessionData.rows.length > 0) {
      const { email, first_name } = sessionData.rows[0];
      const dateObj = new Date(`${scheduled_date}T${scheduled_time}`);
      const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const formattedTime = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      // Send confirmation email to customer
      sendEmail({
        to: email,
        subject: 'Your OxSteed Consulting Session is Scheduled',
        html: `
          <p>Hi ${first_name},</p>
          <p>Your consulting session with OxSteed has been scheduled!</p>
          <p><strong>Session Details:</strong></p>
          <ul>
            <li><strong>Date:</strong> ${formattedDate}</li>
            <li><strong>Time:</strong> ${formattedTime} (${duration_minutes || 120} minutes)</li>
            <li><strong>Type:</strong> ${meeting_type || 'zoom'}</li>
            <li><strong>Meeting Link:</strong> <a href="${meetingUrl}">${meetingUrl}</a></li>
          </ul>
          <p>Please click the link above or copy and paste it into your browser 5 minutes before the scheduled time.</p>
          <p>If you need to reschedule or have any questions, please contact our team.</p>
          <p>Best regards,<br>The OxSteed Consulting Team</p>
        `,
      }).catch(err => logger.warn('Failed to send scheduling confirmation email', { error: err.message, session_id, email }));
    }

    logger.info('Session scheduled', { session_id, scheduled_date });
    res.json({ ...scheduled, meeting_url: meetingUrl });
  } catch (err) {
    logger.error('Error scheduling session', { error: err.message });
    res.status(500).json({ error: 'Failed to schedule session' });
  }
};

// PHASE 2: Add Session Notes
exports.addSessionNote = async (req, res) => {
  const { session_id, note_type, content, is_internal } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO consulting_session_notes (session_id, note_type, content, is_internal, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [session_id, note_type, content, is_internal || false, req.user?.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error adding session note', { error: err.message });
    res.status(500).json({ error: 'Failed to add note' });
  }
};

// PHASE 3: Update Session Phase
exports.updateSessionPhase = async (req, res) => {
  const { session_id, current_phase, progress_pct } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO consulting_session_phases (session_id, current_phase, progress_pct)
       VALUES ($1, $2, $3) ON CONFLICT (session_id) DO UPDATE SET current_phase=$2, progress_pct=$3, updated_at=NOW()
       RETURNING *`,
      [session_id, current_phase, progress_pct || 0]
    );
    logger.info('Session phase updated', { session_id, current_phase });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating session phase', { error: err.message });
    res.status(500).json({ error: 'Failed to update phase' });
  }
};

// PHASE 3: Add Deliverable
exports.addDeliverable = async (req, res) => {
  const { session_id, name, description, deliverable_type, due_date } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO consulting_deliverables (session_id, name, description, deliverable_type, due_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [session_id, name, description, deliverable_type, due_date]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error adding deliverable', { error: err.message });
    res.status(500).json({ error: 'Failed to add deliverable' });
  }
};

// PHASE 3: Add Action Item
exports.addActionItem = async (req, res) => {
  const { session_id, title, description, assigned_to_type, due_date, priority } = req.body;

  // Validate assigned_to_type
  const validAssignedTypes = ['client', 'consultant'];
  if (assigned_to_type && !validAssignedTypes.includes(assigned_to_type.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid assignment type' });
  }

  try {
    const result = await db.query(
      `INSERT INTO consulting_action_items (session_id, title, description, assigned_to_type, due_date, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [session_id, title, description, assigned_to_type?.toLowerCase() || 'client', due_date, priority?.toLowerCase() || 'medium']
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error adding action item', { error: err.message });
    res.status(500).json({ error: 'Failed to add action item' });
  }
};

// PHASE 4: Get/Create Packages
exports.getPackages = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM consulting_packages WHERE is_active=true ORDER BY price_cents');
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching packages', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
};

exports.purchasePackage = async (req, res) => {
  const { package_id } = req.body;
  try {
    const pkgResult = await db.query('SELECT * FROM consulting_packages WHERE id=$1', [package_id]);
    if (!pkgResult.rows.length) return res.status(404).json({ error: 'Package not found' });

    const pkg = pkgResult.rows[0];
    const result = await db.query(
      `INSERT INTO consulting_purchases (user_id, package_id, total_cost_cents, sessions_remaining, status)
       VALUES ($1, $2, $3, $4, 'completed') RETURNING *`,
      [req.user.id, package_id, pkg.price_cents, pkg.session_count]
    );

    logger.info('Package purchased', { user_id: req.user.id, package_id });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error purchasing package', { error: err.message });
    res.status(500).json({ error: 'Failed to purchase package' });
  }
};

// PHASE 5: Client Portal
exports.getPortalDashboard = async (req, res) => {
  try {
    const sessions = await db.query(
      `SELECT cs.*, csp.current_phase, csp.progress_pct, css.scheduled_date, css.scheduled_time
       FROM consulting_sessions cs
       LEFT JOIN consulting_session_phases csp ON cs.id = csp.session_id
       LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
       WHERE cs.user_id = $1 ORDER BY cs.created_at DESC`,
      [req.user.id]
    );

    const purchases = await db.query(
      `SELECT cp.*, pkg.name, pkg.tier FROM consulting_purchases cp
       JOIN consulting_packages pkg ON cp.package_id = pkg.id
       WHERE cp.user_id = $1 AND cp.status = 'completed'`,
      [req.user.id]
    );

    res.json({ sessions: sessions.rows, purchases: purchases.rows });
  } catch (err) {
    logger.error('Error fetching portal dashboard', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
};

// PHASE 6: Record Feedback
exports.submitSessionFeedback = async (req, res) => {
  const { session_id, nps_score, feedback_text, session_quality_rating } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO consulting_session_feedback (session_id, user_id, nps_score, feedback_text, session_quality_rating)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [session_id, req.user.id, nps_score, feedback_text, session_quality_rating]
    );
    logger.info('Session feedback submitted', { session_id, nps_score });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error submitting feedback', { error: err.message });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

// PHASE 7: Referral Program
exports.createReferralLink = async (req, res) => {
  const { referred_email } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO consulting_referrals (referrer_id, status) VALUES ($1, 'pending')
       RETURNING id, created_at`,
      [req.user.id]
    );
    const referralLink = `${process.env.CLIENT_URL || 'http://localhost:3000'}/consulting?ref=${result.rows[0].id}`;
    res.json({ referral_link: referralLink, referral_id: result.rows[0].id });
  } catch (err) {
    logger.error('Error creating referral', { error: err.message });
    res.status(500).json({ error: 'Failed to create referral' });
  }
};

// PHASE 7: Get Analytics
exports.getAnalytics = async (req, res) => {
  try {
    const metrics = await db.query(
      `SELECT metric_type, AVG(current_value) as avg_value, COUNT(*) as count
       FROM consulting_metrics GROUP BY metric_type`
    );

    const feedback = await db.query(
      `SELECT AVG(nps_score) as avg_nps, AVG(session_quality_rating) as avg_quality, COUNT(*) as responses
       FROM consulting_session_feedback`
    );

    res.json({ metrics: metrics.rows, feedback: feedback.rows[0] });
  } catch (err) {
    logger.error('Error fetching analytics', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};
