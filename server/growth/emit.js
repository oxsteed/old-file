"use strict";
const crypto = require("crypto");
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
      event_id: crypto.randomUUID(),
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
module.exports = { emitDomainEvent };
