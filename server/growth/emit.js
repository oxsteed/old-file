"use strict";
const { v7: uuidv7 } = require("uuid");
const gate = require("./gate");
const { validateEvent } = require("./events/validate");
async function emitDomainEvent(client, name, props, { userId, req } = {}) {
  if (process.env.GROWTH_TRACKING_HARD_OFF !== "false") return false;
  if (!client || typeof client.release !== "function")
    throw new Error("growth_domain_event_requires_transaction_client");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    require("./identity").consentLock(
      require("./identity").key("subject", userId),
    ),
  ]);
  const permission = await gate.allow({
    userId,
    req,
    db: client,
    lockPolicy: true,
  });
  if (!permission.allowed) return false;
  if (
    permission.context.gpc &&
    permission.context.jurisdiction.saleShare &&
    permission.context.consents.sale_share_optout !== true
  )
    await require("./consents").record(client, {
      userId,
      purpose: "sale_share_optout",
      granted: true,
      source: "gpc",
      jurisdiction: permission.context.jurisdiction.code,
      version: permission.context.rollout.policy_version,
    });
  const event = validateEvent(
    {
      event_id: uuidv7(),
      name,
      schema_ver: 1,
      occurred_at: new Date().toISOString(),
      props,
    },
    { domain: true },
  );
  if (!event) throw new Error("invalid_growth_domain_event");
  await client.query(
    `INSERT INTO activity_outbox(event_id,user_id,event_name,props,occurred_at,trusted_signals) VALUES($1,$2,$3,$4,$5,$6)`,
    [
      event.event_id,
      userId,
      name,
      event.props,
      event.occurred_at,
      permission.context.trustedSignals,
    ],
  );
  return true;
}
// Builds the allowlisted job.* props from a jobs row, omitting any value
// that would fail schema validation (emitDomainEvent throws on invalid
// props, which would roll back the business transaction). job_type comes
// from job_type_label: the job_type column's tier values contain digits
// and fail the schema pattern, while the label values always match.
function jobEventProps(row) {
  if (!row || row.id == null) return {};
  const props = { job_id: String(row.id) };
  if (Number.isInteger(row.category_id) && row.category_id >= 1)
    props.category_id = row.category_id;
  if (
    typeof row.job_type_label === "string" &&
    /^[a-z_]{1,50}$/.test(row.job_type_label)
  )
    props.job_type = row.job_type_label;
  if (
    typeof row.currency_code === "string" &&
    /^[A-Z]{3}$/.test(row.currency_code)
  )
    props.currency = row.currency_code;
  return props;
}
// Builds the allowlisted props for the booking/appointment/direct family
// (service_id only): category ids in those systems are UUIDs or text
// labels, never the integer the schema requires, so they are never
// emitted. service_id is omitted when absent or over the schema's
// 36-char cap (an over-long value would fail validation and roll back
// the business transaction).
function serviceEventProps(source) {
  const props = {};
  const serviceId = source?.service_id ?? source?.serviceId;
  if (serviceId != null && String(serviceId).length <= 36)
    props.service_id = String(serviceId);
  return props;
}
// Builds the allowlisted food.* props from a food_orders row. The schema
// enum has no 'kiosk' fulfilment, so kiosk orders omit the prop rather
// than failing validation (which would roll back the business write).
const FOOD_FULFILMENT = new Set(["delivery", "pickup", "dine_in"]);
function foodEventProps(order, { itemCount } = {}) {
  if (!order || order.restaurant_id == null) return {};
  const props = { restaurant_id: String(order.restaurant_id) };
  if (FOOD_FULFILMENT.has(order.fulfillment_type))
    props.fulfilment = order.fulfillment_type;
  if (Number.isInteger(itemCount) && itemCount >= 0 && itemCount <= 10000)
    props.item_count = itemCount;
  return props;
}
// Builds the allowlisted commerce props (entity_id / amount_minor /
// currency) from a source row. entity_id must match the schema pattern
// (numeric id or uuid); amount_minor must be a non-negative integer
// (BIGINT columns arrive as strings, so coerce first). Callers pass only
// non-Credit amounts: Credit amounts must never be emitted.
function commerceEventProps(source) {
  const props = {};
  const entityId = source?.entity_id ?? source?.id;
  if (
    entityId != null &&
    /^(?:[0-9]{1,18}|[a-f0-9-]{36})$/i.test(String(entityId))
  )
    props.entity_id = String(entityId);
  const amount = source?.amount_minor ?? source?.discount_cents;
  if (amount != null && Number.isInteger(Number(amount)) && Number(amount) >= 0)
    props.amount_minor = Number(amount);
  const currency = source?.currency ?? source?.currency_code;
  if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency))
    props.currency = currency;
  return props;
}
module.exports = {
  emitDomainEvent,
  jobEventProps,
  serviceEventProps,
  foodEventProps,
  commerceEventProps,
};
