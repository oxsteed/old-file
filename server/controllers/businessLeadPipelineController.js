const pool = require('../db');

exports.listLeads = async (req, res, next) => {
  const { businessId } = req.params;
  const { status, limit = 50, offset = 0 } = req.query;
  try {
    let where = 'WHERE business_id = $1';
    const params = [businessId];
    if (status) { where += ' AND status = $2'; params.push(status); }
    const rows = await pool.query(
      `SELECT * FROM business_leads ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const total = await pool.query(`SELECT COUNT(*) FROM business_leads ${where}`, params);
    const summary = await pool.query(
      `SELECT status, COUNT(*) FROM business_leads WHERE business_id=$1 GROUP BY status`,
      [businessId]
    );
    res.json({ leads: rows.rows, total: parseInt(total.rows[0].count), summary: summary.rows });
  } catch (err) { next(err); }
};

exports.getLead = async (req, res, next) => {
  const { businessId } = req.params;
  const id = req.params.leadId || req.params.id;
  try {
    const row = await pool.query('SELECT * FROM business_leads WHERE id=$1 AND business_id=$2', [id, businessId]);
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    const quotes = await pool.query('SELECT * FROM lead_quotes WHERE lead_id=$1 ORDER BY created_at DESC', [id]);
    res.json({ ...row.rows[0], quotes: quotes.rows });
  } catch (err) { next(err); }
};

exports.createLead = async (req, res, next) => {
  const { businessId } = req.params;
  const { name, email, phone, service_interest, budget_cents, notes, source } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const row = await pool.query(
      `INSERT INTO business_leads (business_id, name, email, phone, service_interest, budget_cents, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [businessId, name, email, phone, service_interest, budget_cents, notes, source || 'manual']
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateLead = async (req, res, next) => {
  const { businessId } = req.params;
  const id = req.params.leadId || req.params.id;
  const { name, email, phone, service_interest, budget_cents, notes, status } = req.body;
  try {
    const row = await pool.query(
      `UPDATE business_leads SET name=$1, email=$2, phone=$3, service_interest=$4,
       budget_cents=$5, notes=$6, status=COALESCE($7,status), updated_at=NOW()
       WHERE id=$8 AND business_id=$9 RETURNING *`,
      [name, email, phone, service_interest, budget_cents, notes, status, id, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.addNote = async (req, res, next) => {
  const { businessId } = req.params;
  const id = req.params.leadId || req.params.id;
  const { note } = req.body;
  if (!note) return res.status(400).json({ error: 'note is required' });
  try {
    const row = await pool.query(
      `UPDATE business_leads
       SET notes = CASE WHEN notes IS NULL OR notes = '' THEN $1
                        ELSE notes || E'\n---\n' || $1 END,
           updated_at = NOW()
       WHERE id=$2 AND business_id=$3
       RETURNING *`,
      [note, id, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteLead = async (req, res, next) => {
  const { businessId } = req.params;
  const id = req.params.leadId || req.params.id;
  try {
    await pool.query('DELETE FROM business_leads WHERE id=$1 AND business_id=$2', [id, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.createLeadQuote = async (req, res, next) => {
  const { businessId } = req.params;
  const id = req.params.leadId || req.params.id;
  const { description, amount_cents, valid_until } = req.body;
  if (!amount_cents) return res.status(400).json({ error: 'amount_cents is required' });
  try {
    const row = await pool.query(
      `INSERT INTO lead_quotes (lead_id, description, amount_cents, valid_until) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, description, amount_cents, valid_until]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};
