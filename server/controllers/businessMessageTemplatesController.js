const pool = require('../db');

exports.listTemplates = async (req, res, next) => {
  const { businessId } = req.params;
  const { category } = req.query;
  try {
    let where = 'WHERE business_id = $1';
    const params = [businessId];
    if (category) { where += ' AND category = $2'; params.push(category); }
    const rows = await pool.query(
      `SELECT * FROM business_message_templates ${where} ORDER BY category, name`,
      params
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createTemplate = async (req, res, next) => {
  const { businessId } = req.params;
  const { name, category, subject, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
  try {
    const row = await pool.query(
      `INSERT INTO business_message_templates (business_id, name, category, subject, body)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [businessId, name, category || 'general', subject, body]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateTemplate = async (req, res, next) => {
  const { businessId, templateId } = req.params;
  const { name, category, subject, body } = req.body;
  try {
    const row = await pool.query(
      `UPDATE business_message_templates SET name=$1, category=$2, subject=$3, body=$4, updated_at=NOW()
       WHERE id=$5 AND business_id=$6 RETURNING *`,
      [name, category, subject, body, templateId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteTemplate = async (req, res, next) => {
  const { businessId, templateId } = req.params;
  try {
    await pool.query('DELETE FROM business_message_templates WHERE id=$1 AND business_id=$2', [templateId, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.incrementUsage = async (req, res, next) => {
  const { businessId, templateId } = req.params;
  try {
    await pool.query(
      'UPDATE business_message_templates SET use_count = use_count + 1 WHERE id=$1 AND business_id=$2',
      [templateId, businessId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};
