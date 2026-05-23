'use strict';
const pool = require('../db');
const { logLogisticsAction } = require('./logisticsAuditService');

async function listSuppliers({ country, category, trustRating, isActive = true, isApproved = null, limit = 50, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (isActive !== null) { conditions.push(`s.is_active = $${params.push(isActive)}`); }
  if (isApproved === true) { conditions.push(`s.approved_at IS NOT NULL`); }
  if (isApproved === false) { conditions.push(`s.approved_at IS NULL`); }
  if (country)      { conditions.push(`s.country = $${params.push(country)}`); }
  if (trustRating)  { conditions.push(`s.internal_trust_rating >= $${params.push(trustRating)}`); }
  if (category)     { conditions.push(`$${params.push(category)} = ANY(s.approved_categories)`); }

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM supplier_profiles s WHERE ${conditions.join(' AND ')}`,
    params
  );
  const rows = await pool.query(
    `SELECT s.*,
            (SELECT COUNT(*) FROM supplier_products sp WHERE sp.supplier_id = s.id AND sp.is_active) AS product_count
     FROM supplier_profiles s
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.internal_trust_rating DESC, s.company_name
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return { suppliers: rows.rows, total: parseInt(countRes.rows[0].count) };
}

async function getSupplier(id) {
  const result = await pool.query(
    `SELECT s.*,
            COALESCE(json_agg(DISTINCT sp.*) FILTER (WHERE sp.id IS NOT NULL), '[]') AS products
     FROM supplier_profiles s
     LEFT JOIN supplier_products sp ON sp.supplier_id = s.id AND sp.is_active
     WHERE s.id = $1
     GROUP BY s.id`,
    [id]
  );
  return result.rows[0] || null;
}

async function createSupplier(data, createdBy) {
  const {
    code, company_name, legal_name, country, city, address, website,
    contact_name, contact_email, contact_phone, approved_categories,
    moq_profile, lead_time_profile, freight_terms, quality_score,
    communication_score, on_time_rate, internal_trust_rating,
    payment_terms, bank_details_on_file, notes,
  } = data;

  const result = await pool.query(
    `INSERT INTO supplier_profiles
       (code,company_name,legal_name,country,city,address,website,
        contact_name,contact_email,contact_phone,approved_categories,
        moq_profile,lead_time_profile,freight_terms,quality_score,
        communication_score,on_time_rate,internal_trust_rating,
        payment_terms,bank_details_on_file,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *`,
    [
      code,company_name,legal_name,country,city,address,website,
      contact_name,contact_email,contact_phone,approved_categories||[],
      JSON.stringify(moq_profile||{}),JSON.stringify(lead_time_profile||{}),
      freight_terms||[],quality_score||0,communication_score||0,
      on_time_rate||0,internal_trust_rating||3,payment_terms,
      bank_details_on_file||false,notes,createdBy,
    ]
  );
  const supplier = result.rows[0];
  logLogisticsAction('supplier', supplier.id, 'created', { actorUserId: createdBy });
  return supplier;
}

async function updateSupplier(id, data, actorUserId) {
  const allowed = [
    'company_name','legal_name','city','address','website','contact_name','contact_email',
    'contact_phone','approved_categories','moq_profile','lead_time_profile','freight_terms',
    'quality_score','communication_score','on_time_rate','internal_trust_rating',
    'payment_terms','bank_details_on_file','compliance_notes','dispute_notes','notes',
    'is_active','kyb_verified',
  ];
  const sets = [];
  const params = [];
  const before = await pool.query('SELECT * FROM supplier_profiles WHERE id = $1', [id]);
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k)) {
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (!sets.length) throw new Error('No valid fields to update');
  params.push(id);
  const result = await pool.query(
    `UPDATE supplier_profiles SET ${sets.join(',')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  logLogisticsAction('supplier', id, 'updated', {
    actorUserId,
    beforeState: before.rows[0],
    afterState: result.rows[0],
  });
  return result.rows[0];
}

async function approveSupplier(id, approvedBy) {
  const result = await pool.query(
    `UPDATE supplier_profiles
     SET approved_by = $1, approved_at = NOW(), is_active = TRUE
     WHERE id = $2 RETURNING *`,
    [approvedBy, id]
  );
  logLogisticsAction('supplier', id, 'approved', { actorUserId: approvedBy });
  return result.rows[0];
}

// ─── Supplier Products ─────────────────────────────────────────

async function listSupplierProducts(supplierId, { category, isApproved, limit = 100, offset = 0 } = {}) {
  const conditions = ['sp.supplier_id = $1'];
  const params = [supplierId];
  if (isApproved != null) { conditions.push(`sp.is_approved = $${params.push(isApproved)}`); }
  if (category)           { conditions.push(`sp.category = $${params.push(category)}`); }

  const result = await pool.query(
    `SELECT sp.*, s.company_name AS supplier_name
     FROM supplier_products sp
     JOIN supplier_profiles s ON s.id = sp.supplier_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sp.title
     LIMIT $${params.push(Math.min(limit,500))} OFFSET $${params.push(offset)}`,
    params
  );
  return result.rows;
}

async function getSupplierProduct(id) {
  const result = await pool.query(
    `SELECT sp.*, s.company_name AS supplier_name, s.country AS supplier_country,
            s.quality_score, s.communication_score, s.internal_trust_rating
     FROM supplier_products sp
     JOIN supplier_profiles s ON s.id = sp.supplier_id
     WHERE sp.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function createSupplierProduct(data, createdBy) {
  const {
    supplier_id, internal_sku, supplier_sku, title, category, subcategory,
    description, specs, unit_of_measure, units_per_carton, cartons_per_pallet,
    pallets_per_container, container_type, estimated_weight_kg, freight_class,
    moq, moq_unit, estimated_production_days, price_tiers, sample_price_usd,
    private_label_available, custom_manufacturing, restricted_markets,
    compliance_flags, image_urls, sample_urls,
  } = data;

  const result = await pool.query(
    `INSERT INTO supplier_products
       (supplier_id,internal_sku,supplier_sku,title,category,subcategory,
        description,specs,unit_of_measure,units_per_carton,cartons_per_pallet,
        pallets_per_container,container_type,estimated_weight_kg,freight_class,
        moq,moq_unit,estimated_production_days,price_tiers,sample_price_usd,
        private_label_available,custom_manufacturing,restricted_markets,
        compliance_flags,image_urls,sample_urls,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     RETURNING *`,
    [
      supplier_id,internal_sku,supplier_sku,title,category,subcategory,
      description,JSON.stringify(specs||{}),unit_of_measure||'unit',
      units_per_carton||1,cartons_per_pallet,pallets_per_container,
      container_type,estimated_weight_kg,freight_class,moq||1,moq_unit||'unit',
      estimated_production_days||0,JSON.stringify(price_tiers||[]),
      sample_price_usd,private_label_available||false,custom_manufacturing||false,
      restricted_markets||[],compliance_flags||[],image_urls||[],sample_urls||[],
      createdBy,
    ]
  );
  return result.rows[0];
}

async function approveSupplierProduct(id, approvedBy) {
  const result = await pool.query(
    `UPDATE supplier_products SET is_approved = TRUE, approved_by = $1, approved_at = NOW()
     WHERE id = $2 RETURNING *`,
    [approvedBy, id]
  );
  logLogisticsAction('supplier_product', id, 'approved', { actorUserId: approvedBy });
  return result.rows[0];
}

module.exports = {
  listSuppliers, getSupplier, createSupplier, updateSupplier, approveSupplier,
  listSupplierProducts, getSupplierProduct, createSupplierProduct, approveSupplierProduct,
};
