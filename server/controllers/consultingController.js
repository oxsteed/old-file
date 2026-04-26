const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');

const AREAS_OF_HELP = [
  'legal_setup',
  'pricing_strategy',
  'branding',
  'financial_systems',
  'marketing',
  'team_building',
  'operational_systems',
  'scaling',
  'acquisition_preparation',
  'exit_strategy',
];

const SERVICE_TIERS = ['foundation', 'implementation', 'transformation', 'initial'];

exports.submitConsultingRequest = async (req, res) => {
  const { email, first_name, last_name, business_name, phone, current_phase, service_tier, areas_of_help, description, preferred_date, preferred_time_slot } = req.body;

  try {
    // Validation
    if (!email || !first_name || !last_name) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    if (typeof first_name !== 'string' || first_name.trim().length > 100) {
      return res.status(400).json({ error: 'First name must be 100 characters or fewer' });
    }
    if (typeof last_name !== 'string' || last_name.trim().length > 100) {
      return res.status(400).json({ error: 'Last name must be 100 characters or fewer' });
    }
    if (business_name && typeof business_name === 'string' && business_name.trim().length > 200) {
      return res.status(400).json({ error: 'Business name must be 200 characters or fewer' });
    }
    if (phone && typeof phone === 'string' && phone.trim().length > 30) {
      return res.status(400).json({ error: 'Phone number must be 30 characters or fewer' });
    }
    if (description && typeof description === 'string' && description.trim().length > 5000) {
      return res.status(400).json({ error: 'Description must be 5000 characters or fewer' });
    }
    if (current_phase !== undefined && current_phase !== null) {
      const phase = parseInt(current_phase, 10);
      if (isNaN(phase) || phase < 1 || phase > 30) {
        return res.status(400).json({ error: 'Current phase must be a number between 1 and 30' });
      }
    }

    if (service_tier && !SERVICE_TIERS.includes(service_tier)) {
      return res.status(400).json({ error: 'Invalid service tier' });
    }

    if (areas_of_help && Array.isArray(areas_of_help)) {
      if (areas_of_help.length > AREAS_OF_HELP.length) {
        return res.status(400).json({ error: 'Too many areas of help selected' });
      }
      for (const area of areas_of_help) {
        if (!AREAS_OF_HELP.includes(area)) {
          return res.status(400).json({ error: `Invalid area of help: ${area}` });
        }
      }
    }

    const db = require('../db');
    const client = await db.connect();

    try {
      const result = await client.query(
        `INSERT INTO consulting_sessions
         (user_id, email, first_name, last_name, business_name, phone, current_phase, service_tier, areas_of_help, description, preferred_date, preferred_time_slot, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
         RETURNING id, created_at`,
        [
          req.user?.id || null,
          email.toLowerCase().trim(),
          first_name.trim(),
          last_name.trim(),
          business_name?.trim() || null,
          phone?.trim() || null,
          current_phase || null,
          service_tier || 'initial',
          areas_of_help || [],
          description?.trim() || null,
          preferred_date || null,
          preferred_time_slot || 'flexible',
        ]
      );

      const sessionId = result.rows[0].id;

      // Send confirmation email
      try {
        await sendEmail({
          to: email,
          subject: 'OxSteed Consulting Intake Form Submitted',
          html: `
            <h2>Thank you for your interest in OxSteed Business Ascension Consulting!</h2>
            <p>We have received your intake form submission. A consulting specialist will review your request and contact you within 24 business hours to schedule your initial $100 consultation session.</p>
            <p><strong>Session Details:</strong></p>
            <ul>
              <li>Duration: Up to 2 hours</li>
              <li>Cost: $100</li>
              <li>Format: Virtual (video call)</li>
            </ul>
            <p>Reference ID: <code>${sessionId}</code></p>
            <p>Best regards,<br>The OxSteed Team</p>
          `,
        });
      } catch (e) {
        logger.warn('Failed to send consulting confirmation email', { email, sessionId, error: e.message });
      }

      logger.info('Consulting session submitted', { sessionId, email, service_tier });

      return res.status(201).json({
        id: sessionId,
        message: 'Consulting request submitted successfully',
        next_steps: 'A specialist will contact you within 24 hours',
      });
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error submitting consulting request', { error: err.message, email });
    return res.status(500).json({ error: 'Failed to submit consulting request' });
  }
};

exports.getUserConsultingSessions = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = require('../db');
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT id, email, first_name, last_name, business_name, service_tier, status, scheduled_at, created_at
         FROM consulting_sessions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [req.user.id]
      );

      return res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error fetching consulting sessions', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to fetch consulting sessions' });
  }
};

exports.getConsultingSession = async (req, res) => {
  try {
    const { id } = req.params;

    const db = require('../db');
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT *
         FROM consulting_sessions
         WHERE id = $1`,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Consulting session not found' });
      }

      const session = result.rows[0];

      // Authorization: user can only see their own, or admin can see any
      if (req.user?.id !== session.user_id && req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      return res.json(session);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error fetching consulting session', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to fetch consulting session' });
  }
};

exports.getAreasOfHelp = async (req, res) => {
  return res.json(AREAS_OF_HELP);
};

exports.getServiceTiers = async (req, res) => {
  return res.json(SERVICE_TIERS);
};
