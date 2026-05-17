const pool = require('../db');

async function checkAccess(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT role FROM business_members WHERE business_id=$1 AND user_id=$2 AND status='active'
     UNION
     SELECT 'owner' AS role FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

exports.list = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { category } = req.query;

    const conditions = ['business_id = $1'];
    const params = [businessId];
    let p = 2;

    if (category) { conditions.push(`category = $${p++}`); params.push(category); }

    const { rows } = await pool.query(
      `SELECT * FROM business_message_templates WHERE ${conditions.join(' AND ')} ORDER BY category, name`,
      params
    );
    res.json({ templates: rows });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.id;
    const { name, category, subject, body, variables } = req.body;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    if (!category) return res.status(400).json({ error: 'category required' });
    if (!body?.trim()) return res.status(400).json({ error: 'body required' });

    const { rows } = await pool.query(
      `INSERT INTO business_message_templates (business_id, name, category, subject, body, variables, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [businessId, name.trim(), category, subject || null, body.trim(),
       JSON.stringify(variables || []), userId]
    );
    res.status(201).json({ template: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    const userId = req.user.id;
    const { name, category, subject, body, variables } = req.body;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      `UPDATE business_message_templates SET
         name = COALESCE($1, name),
         category = COALESCE($2, category),
         subject = COALESCE($3, subject),
         body = COALESCE($4, body),
         variables = COALESCE($5, variables),
         updated_at = now()
       WHERE id=$6 AND business_id=$7 RETURNING *`,
      [name?.trim() || null, category || null, subject || null, body?.trim() || null,
       variables ? JSON.stringify(variables) : null, id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    const userId = req.user.id;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'DELETE FROM business_message_templates WHERE id=$1 AND business_id=$2 RETURNING id',
      [id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.use = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;

    const { rows } = await pool.query(
      `UPDATE business_message_templates SET use_count = use_count + 1
       WHERE id=$1 AND business_id=$2 RETURNING body, subject, name, variables`,
      [id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    next(err);
  }
};
