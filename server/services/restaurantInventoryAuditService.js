'use strict';

function normalizeText(value, max) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

async function logInventoryAudit(client, entry) {
  if (!entry || !entry.restaurantId || !entry.eventType || !entry.entityType) return null;

  const { rows: [event] } = await client.query(
    `INSERT INTO restaurant_inventory_audit_events
       (restaurant_id, business_id, event_type, entity_type, entity_id,
        actor_user_id, client_operation_id, metadata, location_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,
       COALESCE($9::bigint, restaurant_inventory_audit_location($1,$4,$5)))
     RETURNING *`,
    [
      entry.restaurantId,
      entry.businessId || null,
      normalizeText(entry.eventType, 80),
      normalizeText(entry.entityType, 60),
      entry.entityId || null,
      entry.actorUserId || null,
      entry.clientOperationId || null,
      JSON.stringify(entry.metadata || {}),
      entry.locationId ?? entry.metadata?.locationId ?? null,
    ]
  );
  return event || null;
}

module.exports = { logInventoryAudit };
