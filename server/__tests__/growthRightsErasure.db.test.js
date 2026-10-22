'use strict';

/**
 * Privacy retention policy (Emile 2026-10-22), rights.erase() coverage:
 *
 * (b) Delivered campaign/contact history is anonymized to the internal
 *     recipient_id (user_id NULLed) instead of deleted; personal settings
 *     (offer_preferences) and eligibility evidence
 *     (growth_subject_eligibility) rows are removed. Suppression lists
 *     (marketing_suppressions) persist, and financial conversions
 *     (affiliate_conversions) are untouched.
 * (c) growth_device_links rows are deleted right after the
 *     growth_erasure_queue INSERT (the queue row already captured the keys).
 *
 * Runs against the real migrated schema in a disposable schema.
 */
const crypto = require('crypto');

process.env.GROWTH_SUBJECT_PEPPER = 'test-pepper-0123456789abcdef-test';

const schema = `growth_erase_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }));

const db = require('../db');
const { key } = require('../growth/identity');
const rights = require('../growth/rights');

const TABLES = [
  'users',
  'growth_erasure_queue',
  'growth_device_links',
  'offers',
  'growth_segments',
  'growth_segment_versions',
  'offer_campaigns',
  'offer_campaign_recipients',
  'offer_campaign_deliveries',
  'marketing_contact_log',
  'marketing_suppressions',
  'offer_preferences',
  'offer_clicks',
  'affiliate_partners',
  'affiliate_conversions',
  'growth_subject_eligibility',
];

(url ? describe : describe.skip)('growth rights.erase retention policy', () => {
  let userId;
  let subject;
  let deliveredRecipientId;
  let deliveredDeliveryId;

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) {
      await db.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
    }
    userId = crypto.randomUUID();
    await db.query(
      `INSERT INTO users(id, email, password_hash, first_name, last_name, role)
       VALUES($1, $2, 'x', 'Erase', 'Me', 'customer')`,
      [userId, `${userId}@example.test`],
    );
    subject = key('subject', userId);
    await db.query(
      `INSERT INTO growth_device_links(subject_key, device_key) VALUES($1, $2), ($1, $3)`,
      [subject, 'device-aaa', 'device-bbb'],
    );
    const { rows: [{ id: offerId }] } = await db.query(
      `INSERT INTO offers(type, title, countries, currency, value_minor, channels, expires_at)
       VALUES('promo', 'Test offer', '{US}', 'USD', 500, '{in_app}', NOW() + INTERVAL '30 days') RETURNING id`,
    );
    const { rows: [{ id: segmentId }] } = await db.query(
      `INSERT INTO growth_segments(name, created_by) VALUES('test segment', $1) RETURNING id`,
      [userId],
    );
    const { rows: [{ id: segmentVersionId }] } = await db.query(
      `INSERT INTO growth_segment_versions(segment_id, version, definition, created_by)
       VALUES($1, 1, '{}', $2) RETURNING id`,
      [segmentId, userId],
    );
    const { rows: [{ id: campaignId }] } = await db.query(
      `INSERT INTO offer_campaigns(name, offer_id, segment_version_id, channels, copy, created_by)
       VALUES('test campaign', $1, $2, '{in_app}', '{}', $3) RETURNING id`,
      [offerId, segmentVersionId, userId],
    );
    // Recipient 1: delivered history (must be anonymized, not deleted).
    ({ rows: [{ id: deliveredRecipientId }] } = await db.query(
      `INSERT INTO offer_campaign_recipients(campaign_id, user_id) VALUES($1, $2) RETURNING id`,
      [campaignId, userId],
    ));
    ({ rows: [{ id: deliveredDeliveryId }] } = await db.query(
      `INSERT INTO offer_campaign_deliveries(campaign_id, recipient_id, channel, status, sent_at)
       VALUES($1, $2, 'in_app', 'sent', NOW()) RETURNING id`,
      [campaignId, deliveredRecipientId],
    ));
    // Recipient 2: pending only (still deleted, with its pending delivery).
    // A second campaign: (campaign_id, user_id) is unique per recipient row.
    const { rows: [{ id: campaignId2 }] } = await db.query(
      `INSERT INTO offer_campaigns(name, offer_id, segment_version_id, channels, copy, created_by)
       VALUES('test campaign 2', $1, $2, '{in_app}', '{}', $3) RETURNING id`,
      [offerId, segmentVersionId, userId],
    );
    const { rows: [{ id: pendingRecipientId }] } = await db.query(
      `INSERT INTO offer_campaign_recipients(campaign_id, user_id) VALUES($1, $2) RETURNING id`,
      [campaignId2, userId],
    );
    await db.query(
      `INSERT INTO offer_campaign_deliveries(campaign_id, recipient_id, channel, status)
       VALUES($1, $2, 'in_app', 'pending')`,
      [campaignId2, pendingRecipientId],
    );
    await db.query(
      `INSERT INTO marketing_contact_log(user_id, campaign_id, source, channel)
       VALUES($1, $2, 'test', 'in_app')`,
      [userId, campaignId],
    );
    await db.query(`INSERT INTO offer_preferences(user_id) VALUES($1)`, [userId]);
    const clickId = crypto.randomUUID();
    await db.query(
      `INSERT INTO offer_clicks(click_id, delivery_id, offer_id) VALUES($1, $2, $3)`,
      [clickId, deliveredDeliveryId, offerId],
    );
    const { rows: [{ id: partnerId }] } = await db.query(
      `INSERT INTO affiliate_partners(code, name, network, countries_allowed, currencies, allowed_channels, link_domains_allowlist, disclosure)
       VALUES('test-partner', 'Test Partner', 'testnet', '{US}', '{USD}', '{in_app}', '{example.com}', '{}') RETURNING id`,
    );
    await db.query(
      `INSERT INTO affiliate_conversions(partner_id, click_id, order_ref_hash, sale_minor, commission_minor, currency, status)
       VALUES($1, $2, 'hash-abc', 10000, 500, 'USD', 'approved')`,
      [partnerId, clickId],
    );
    await db.query(
      `INSERT INTO growth_subject_eligibility(user_id, subject_key, adult_confirmed, evidence_ref)
       VALUES($1, $2, TRUE, 'evidence-doc-1')`,
      [userId, subject],
    );
    await db.query(
      `INSERT INTO marketing_suppressions(subject_key, source) VALUES($1, 'test-unsubscribe')`,
      [subject],
    );

    await rights.erase(db, userId, 'account_erasure');
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  test('(c) device links are deleted after the queue captured them', async () => {
    const { rows: links } = await db.query('SELECT * FROM growth_device_links WHERE subject_key=$1', [subject]);
    expect(links).toHaveLength(0);
    const { rows: queued } = await db.query('SELECT device_keys FROM growth_erasure_queue WHERE subject_key=$1', [subject]);
    expect(queued).toHaveLength(1);
    expect(queued[0].device_keys.sort()).toEqual(['device-aaa', 'device-bbb']);
  });

  test('(b) delivered recipients are anonymized to recipient_id, not deleted', async () => {
    const { rows } = await db.query('SELECT id, user_id FROM offer_campaign_recipients WHERE id=$1', [deliveredRecipientId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();
    // The delivered delivery survives, keyed by the anonymous recipient.
    const { rows: deliveries } = await db.query(
      'SELECT status FROM offer_campaign_deliveries WHERE id=$1', [deliveredDeliveryId],
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('sent');
  });

  test('(b) pending-only recipients are still removed', async () => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM offer_campaign_recipients WHERE user_id=$1', [userId]);
    expect(rows[0].n).toBe(0);
  });

  test('(b) contact log is anonymized, preferences and eligibility rows are gone', async () => {
    const { rows: contacts } = await db.query('SELECT user_id FROM marketing_contact_log');
    expect(contacts.length).toBeGreaterThan(0);
    for (const row of contacts) expect(row.user_id).toBeNull();
    const { rows: prefs } = await db.query('SELECT * FROM offer_preferences WHERE user_id=$1', [userId]);
    expect(prefs).toHaveLength(0);
    const { rows: elig } = await db.query('SELECT * FROM growth_subject_eligibility WHERE user_id=$1', [userId]);
    expect(elig).toHaveLength(0);
  });

  test('(b) suppression lists persist and financial conversions are untouched', async () => {
    const { rows: sup } = await db.query('SELECT * FROM marketing_suppressions WHERE subject_key=$1', [subject]);
    expect(sup).toHaveLength(1);
    const { rows: conv } = await db.query('SELECT * FROM affiliate_conversions');
    expect(conv).toHaveLength(1);
    expect(conv[0].status).toBe('approved');
  });

  test('(b) clicks survive but are no longer attributable to the user', async () => {
    const { rows: clicks } = await db.query('SELECT * FROM offer_clicks');
    expect(clicks).toHaveLength(1);
    const { rows: attributable } = await db.query(
      `SELECT oc.click_id FROM offer_clicks oc
         JOIN offer_campaign_deliveries d ON d.id = oc.delivery_id
         JOIN offer_campaign_recipients r ON r.id = d.recipient_id
        WHERE r.user_id = $1`,
      [userId],
    );
    expect(attributable).toHaveLength(0);
  });
});
