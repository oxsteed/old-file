'use strict';

const { withBusinessCapabilities } = require('./businessCategories');

async function loadBusinessSetupReadiness(db, businessId) {
  const { rows: [row] } = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*)::int
               FROM business_services bs
              WHERE bs.business_id = b.id AND bs.is_active = TRUE AND bs.deleted_at IS NULL) AS service_count,
            (SELECT fr.id
               FROM food_restaurants fr
              WHERE fr.business_id = b.id
              LIMIT 1) AS restaurant_id,
            (SELECT fr.status
               FROM food_restaurants fr
              WHERE fr.business_id = b.id
              LIMIT 1) AS restaurant_status,
            (SELECT COUNT(*)::int
               FROM food_menu_items fmi
               JOIN food_restaurants fr ON fr.id = fmi.restaurant_id
              WHERE fr.business_id = b.id AND fmi.is_available = TRUE) AS menu_item_count
       FROM businesses b
      WHERE b.id = $1`,
    [businessId]
  );
  if (!row) return null;

  const kind = row.business_kind || (row.business_mode === 'food' ? 'restaurant' : 'service');
  const checks = [
    { id: 'name', label: 'Business name', complete: !!row.business_name?.trim() },
    { id: 'category', label: 'Business category', complete: !!(row.industry_category || row.business_type) },
    { id: 'location', label: 'City or service location', complete: !!row.address_city?.trim() },
  ];
  if (kind === 'restaurant') {
    checks.push(
      { id: 'restaurant_profile', label: 'Restaurant profile', complete: !!row.restaurant_id },
      { id: 'menu', label: 'At least one available menu item', complete: Number(row.menu_item_count || 0) > 0 },
    );
  } else {
    checks.push(
      { id: 'description', label: 'Customer-facing description', complete: !!row.description?.trim() },
      { id: 'service', label: 'At least one active service', complete: Number(row.service_count || 0) > 0 },
    );
  }

  return {
    business: withBusinessCapabilities(row),
    checks,
    readyToPublish: checks.every((check) => check.complete),
  };
}


function isBusinessPublished(business) {
  return business?.setup_status === 'active' && business.is_active !== false && business.is_listed !== false;
}

module.exports = { loadBusinessSetupReadiness, isBusinessPublished };
