const pool = require('../db');
const {
  serializeServicePackage,
  listPublicServicePackages,
} = require('../models/mainAppContractsModel');

exports.listPublicPackages = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    // :businessId accepts either the numeric business id or its vanity profile_slug
    // (same convention as GET /api/businesses/:id/public).
    let businessId = req.params.businessId;
    if (!/^\d+$/.test(String(businessId))) {
      const slugRow = await pool.query(
        'SELECT id FROM businesses WHERE profile_slug = $1',
        [String(businessId).toLowerCase()]
      );
      if (!slugRow.rows[0]) return res.status(404).json({ error: 'Business not found' });
      businessId = slugRow.rows[0].id;
    }
    const rows = await listPublicServicePackages({
      businessId,
      serviceId: req.query.service_id || req.query.serviceId || null,
      limit,
    });
    res.json({
      contract: {
        version: 'business-service-packages-public-v1',
        generatedAt: new Date().toISOString(),
        dataSource: 'business_service_packages',
      },
      packages: rows.map(serializeServicePackage),
    });
  } catch (err) { next(err); }
};

exports.listPackages = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const rows = await pool.query(
      'SELECT * FROM business_service_packages WHERE business_id=$1 AND is_active=TRUE ORDER BY sort_order, name',
      [businessId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createPackage = async (req, res, next) => {
  const { businessId } = req.params;
  const { name, description, services, total_sessions, price_cents, validity_days, sort_order } = req.body;
  if (!name || !price_cents) return res.status(400).json({ error: 'name and price_cents are required' });
  try {
    const row = await pool.query(
      `INSERT INTO business_service_packages (business_id, name, description, services, total_sessions, price_cents, validity_days, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [businessId, name, description, JSON.stringify(services || []), total_sessions || 1, price_cents, validity_days, sort_order || 0]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updatePackage = async (req, res, next) => {
  const { businessId, packageId } = req.params;
  const { name, description, services, total_sessions, price_cents, validity_days, is_active, sort_order } = req.body;
  try {
    const row = await pool.query(
      `UPDATE business_service_packages SET name=$1, description=$2, services=$3, total_sessions=$4,
       price_cents=$5, validity_days=$6, is_active=COALESCE($7,is_active), sort_order=$8, updated_at=NOW()
       WHERE id=$9 AND business_id=$10 RETURNING *`,
      [name, description, JSON.stringify(services || []), total_sessions, price_cents, validity_days, is_active, sort_order || 0, packageId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deletePackage = async (req, res, next) => {
  const { businessId, packageId } = req.params;
  try {
    await pool.query(
      'UPDATE business_service_packages SET is_active=FALSE WHERE id=$1 AND business_id=$2',
      [packageId, businessId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};

// Client packages
exports.listClientPackages = async (req, res, next) => {
  const { businessId } = req.params;
  const { customer_id } = req.query;
  try {
    let where = 'WHERE cp.business_id = $1';
    const params = [businessId];
    if (customer_id) { where += ' AND cp.customer_id = $2'; params.push(customer_id); }
    const rows = await pool.query(
      `SELECT cp.*, p.name AS package_name,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS customer_name
       FROM business_client_packages cp
       JOIN business_service_packages p ON cp.package_id = p.id
       LEFT JOIN users u ON cp.customer_id = u.id
       ${where} ORDER BY cp.purchased_at DESC`,
      params
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.issueClientPackage = async (req, res, next) => {
  const { businessId } = req.params;
  const { customer_id, package_id, paid_cents } = req.body;
  if (!customer_id || !package_id) return res.status(400).json({ error: 'customer_id and package_id are required' });
  const paidCents = paid_cents === undefined || paid_cents === null || paid_cents === ''
    ? null
    : Number(paid_cents);
  if (paidCents !== null && (!Number.isInteger(paidCents) || paidCents < 0 || paidCents > 100000000)) {
    return res.status(400).json({ error: 'paid_cents must be a whole number between 0 and 100000000' });
  }
  try {
    const pkg = await pool.query('SELECT * FROM business_service_packages WHERE id=$1 AND business_id=$2', [package_id, businessId]);
    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found' });
    const p = pkg.rows[0];
    const expires_at = p.validity_days ? new Date(Date.now() + p.validity_days * 86400000) : null;
    const row = await pool.query(
      `INSERT INTO business_client_packages (business_id, customer_id, package_id, sessions_remaining, expires_at, paid_cents)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [businessId, customer_id, package_id, p.total_sessions, expires_at, paidCents === null ? p.price_cents : paidCents]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.redeemSession = async (req, res, next) => {
  const { businessId, clientPackageId } = req.params;
  try {
    const row = await pool.query(
      `UPDATE business_client_packages
       SET sessions_remaining = sessions_remaining - 1,
           sessions_used = sessions_used + 1,
           updated_at=NOW(),
           status = CASE WHEN sessions_remaining - 1 <= 0 THEN 'exhausted' ELSE status END
       WHERE id=$1 AND business_id=$2 AND sessions_remaining > 0 AND status='active'
       RETURNING *`,
      [clientPackageId, businessId]
    );
    if (!row.rows.length) return res.status(400).json({ error: 'No sessions remaining or package not active' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};
