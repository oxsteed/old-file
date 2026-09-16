#!/usr/bin/env node
'use strict';

/* Exercises the real Stripe webhook route with disposable test-mode payloads. */
const crypto = require('crypto');
const { Pool } = require('pg');

const databaseUrl = String(process.env.DATABASE_URL || '');
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
})();
const projectName = String(process.env.CREDIT_TEST_PROJECT || '');
const apiUrl = String(process.env.CREDIT_TEST_API_URL || 'http://127.0.0.1:5000');
const webhookSecret = 'whsec_test_isolated';

function requireIsolatedProviderHarness() {
  if (process.env.NODE_ENV !== 'test'
    || databaseName !== 'oxsteed_db'
    || !/^oxsteed-credit-test-[a-z0-9-]+$/.test(projectName)
    || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(apiUrl)
    || process.env.CREDIT_TEST_PROVIDER_MODE !== 'true') {
    throw new Error('Refusing to run provider delivery verification outside the disposable Credit harness.');
  }
}

async function postWebhook(stripe, event, secret = webhookSecret) {
  const rawPayload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: rawPayload, secret });
  const response = await fetch(`${apiUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: rawPayload,
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  requireIsolatedProviderHarness();
  const stripe = require('stripe')('sk_test_isolated');
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2 });
  const objectId = `pi_provider_sandbox_${crypto.randomUUID()}`;
  const newestEventId = `evt_provider_new_${crypto.randomUUID()}`;
  const olderEventId = `evt_provider_old_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const newest = {
    id: newestEventId,
    created,
    type: 'payment_intent.provider_sandbox_probe',
    data: { object: { id: objectId } },
  };
  const older = {
    id: olderEventId,
    created: created - 60,
    type: 'payment_intent.provider_sandbox_probe',
    data: { object: { id: objectId } },
  };

  try {
    const first = await postWebhook(stripe, newest);
    if (first.status !== 200 || first.body.duplicate === true) throw new Error(`valid delivery failed: ${JSON.stringify(first)}`);

    const duplicate = await postWebhook(stripe, newest);
    if (duplicate.status !== 200 || duplicate.body.duplicate !== true) throw new Error(`duplicate replay was not suppressed: ${JSON.stringify(duplicate)}`);

    const stale = await postWebhook(stripe, older);
    if (stale.status !== 200 || stale.body.duplicate !== true || stale.body.stale !== true) {
      throw new Error(`stale delivery was not suppressed: ${JSON.stringify(stale)}`);
    }

    const invalid = await postWebhook(stripe, {
      ...newest,
      id: `evt_provider_invalid_${crypto.randomUUID()}`,
    }, 'whsec_wrong_isolated');
    if (invalid.status !== 400 || invalid.body.code !== 'invalid_webhook_signature') {
      throw new Error(`invalid signature was not rejected: ${JSON.stringify(invalid)}`);
    }

    const { rows: receipts } = await pool.query(
      `SELECT event_id, status, attempts
         FROM webhook_event_receipts
        WHERE provider = 'stripe' AND event_id = ANY($1::text[])
        ORDER BY event_id`,
      [[newestEventId, olderEventId]]
    );
    const { rows: watermarks } = await pool.query(
      `SELECT event_id, event_created
         FROM webhook_event_watermarks
        WHERE provider = 'stripe' AND object_id = $1`,
      [objectId]
    );
    const receiptStatuses = new Map(receipts.map((row) => [row.event_id, row]));
    if (receipts.length !== 2
      || receiptStatuses.get(newestEventId)?.status !== 'processed'
      || receiptStatuses.get(olderEventId)?.status !== 'processed'
      || Number(receiptStatuses.get(newestEventId)?.attempts) !== 1
      || watermarks.length !== 1
      || watermarks[0].event_id !== newestEventId
      || Number(watermarks[0].event_created) !== created) {
      throw new Error(`provider receipt state is invalid: ${JSON.stringify({ receipts, watermarks })}`);
    }

    console.log(JSON.stringify({
      ok: true,
      provider: 'stripe-test-mode-sdk',
      validDelivery: true,
      duplicateSuppressed: true,
      staleDeliverySuppressed: true,
      invalidSignatureRejected: true,
      receiptCount: receipts.length,
      watermarkEventId: newestEventId,
    }, null, 2));
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Stripe webhook delivery verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { requireIsolatedProviderHarness, postWebhook };
