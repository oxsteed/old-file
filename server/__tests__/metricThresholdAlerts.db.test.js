'use strict';

/**
 * Item 9 — metric threshold alerts (analytics platform, Phase 2).
 *
 * - validateRuleInput: bad metric/operator/threshold/cooldown rejected (unit).
 * - Server notification copy resolves in all 5 languages (unit).
 * - Evaluator: fires when the threshold is crossed; fires at most once per
 *   cooldown_minutes; the delivery_key dedupes a same-window retry.
 * - admin_notification_prefs respected: notify_metric_alerts=false means no
 *   delivery; email_notifications=false suppresses the email channel only.
 * - NULL metric values (e.g. take-rate on zero GMV) never fire and never
 *   crash the evaluator.
 *
 * The alert tables come from the REAL migrations (706 + 890) applied to the
 * isolated schema; only the domain tables (users/disputes/notifications/…)
 * are hand-built minimal fixtures.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `mta_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../middleware/adminAuth', () => ({ hasGlobalGrant: jest.fn(async () => true) }));
jest.mock('../services/smsNotificationService',()=>({isTwilioConfigured:()=>true,sendConfiguredSMS:jest.fn(async()=>({success:true}))}));
jest.mock('../utils/email', () => {
  const actual = jest.requireActual('../utils/email');
  return { ...actual, sendEmail: jest.fn(async () => ({ success: true })) };
});

const db = require('../db');
const { tNotif } = require('../utils/i18n');
const { formatAlertBody } = require('../utils/metricAlertNotificationCopy');
const {
  validateRuleInput,
  compareValues,
  ALERTABLE_METRICS,
} = require('../analytics/metricAlerts');
const { evaluateMetricThresholdAlerts } = require('../jobs/metricThresholdAlerts');

const describeDb = url ? describe : describe.skip;

// ── Unit: rule validation (no DB) ───────────────────────────────────────────
describe('metric alert rule validation', () => {
  test('rejects unknown and non-alertable metrics', () => {
    expect(() => validateRuleInput({ metric_name: 'nope', operator: '>', threshold: 1 }))
      .toThrow(/Invalid metric/);
    expect(() => validateRuleInput({ metric_name: 'restaurant_repeat_order_rate', operator: '>', threshold: 1 }))
      .toThrow(/Invalid metric/);
  });

  test('rejects bad operator, threshold, cooldown, and empty channels', () => {
    const base = { metric_name: 'open_disputes', threshold: 5, cooldown_minutes: 60 };
    expect(() => validateRuleInput({ ...base, operator: '>=' })).toThrow(/Invalid operator/);
    expect(() => validateRuleInput({ ...base, operator: '>', threshold: NaN })).toThrow(/Invalid threshold/);
    expect(() => validateRuleInput({ ...base, operator: '>', cooldown_minutes: 2 })).toThrow(/Invalid cooldown/);
    expect(() => validateRuleInput({
      ...base, operator: '>',
      channel_in_app: false, channel_email: false, channel_sms: false,
    })).toThrow(/At least one delivery channel/);
  });

  test('accepts a valid rule and keeps only declared params', () => {
    const rule = validateRuleInput({
      metric_name: 'platform_revenue_cents',
      operator: '<',
      threshold: 500000,
      params: { period: '7d', days: 99, junk: 1 },
      cooldown_minutes: 120,
      channel_sms: true,
    });
    expect(rule).toMatchObject({
      metric_name: 'platform_revenue_cents',
      operator: '<',
      threshold: 500000,
      cooldown_minutes: 120,
      channel_in_app: true,
      channel_sms: true,
    });
    expect(rule.params).toEqual({ period: '7d', currencyCode: 'USD' });
    expect(validateRuleInput({ metric_name: 'open_disputes', operator: '>', threshold: 1 }).params)
      .toEqual({});
  });

  test('compareValues handles the three operators and non-finite values', () => {
    expect(compareValues('>', 6, 5)).toBe(true);
    expect(compareValues('>', 5, 5)).toBe(false);
    expect(compareValues('<', 4, 5)).toBe(true);
    expect(compareValues('==', 5, 5)).toBe(true);
    expect(compareValues('>', null, 5)).toBe(false);
    expect(compareValues('>', NaN, 5)).toBe(false);
    expect(compareValues('??', 6, 5)).toBe(false);
  });
});

// ── Unit: server-side notification copy (no DB) ──────────────────────────────
describe('metric alert notification copy', () => {
  test.each(['en', 'es', 'fr', 'ht', 'ar'])('title resolves in %s', (lang) => {
    const text = tNotif('metric_threshold_alert', lang);
    expect(text.title).toBeTruthy();
    expect(text.title).not.toContain('{');
  });

  test('formatAlertBody substitutes every placeholder', () => {
    const body = formatAlertBody('en', {
      metric: 'open_disputes', operator: '>', threshold: '5', value: '7',
    });
    expect(body).not.toContain('{');
    expect(body).toContain('Open disputes');
    expect(body).toContain('>');
  });
});

// ── DB: evaluator ───────────────────────────────────────────────────────────
describeDb('metric threshold alert evaluator', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role TEXT NOT NULL DEFAULT 'customer',
      totp_enabled BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_banned BOOLEAN NOT NULL DEFAULT false,
      is_suspended BOOLEAN NOT NULL DEFAULT false,
      email TEXT, first_name TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      phone TEXT)`);
    await db.query(`CREATE TABLE ${schema}.disputes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'open')`);
    // Real migrations for the alert tables (also exercises 890's ALTER).
    for (const file of ['706_admin_self_settings.sql', '890_metric_threshold_alerts.sql', '893_analytics_alert_observations.sql','897_metric_observation_definitions.sql','898_metric_alert_delivery_safety.sql','903_metric_alert_observation_scope.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
      await db.query(sql);
    }
    await db.query(`CREATE TABLE ${schema}.notification_preferences (user_id UUID PRIMARY KEY)`);
    await db.query(`CREATE TABLE ${schema}.notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      action_url TEXT,
      delivery_key VARCHAR(255),
      is_promotional BOOLEAN NOT NULL DEFAULT false,
      is_push_sent BOOLEAN NOT NULL DEFAULT false,
      is_email_sent BOOLEAN NOT NULL DEFAULT false,
      is_read BOOLEAN NOT NULL DEFAULT false,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.query(`CREATE UNIQUE INDEX uq_notifications_delivery_key
      ON ${schema}.notifications (delivery_key) WHERE delivery_key IS NOT NULL`);
    // Minimal tables for the NULL take-rate case.
    await db.query(`CREATE TABLE ${schema}.platform_ledger (
      id SERIAL PRIMARY KEY, source_type VARCHAR(50) NOT NULL,
      job_id UUID, currency TEXT DEFAULT 'USD', amount_cents INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'published',
      budget_max NUMERIC(10,2), budget_min NUMERIC(10,2), deleted_at TIMESTAMPTZ,
      final_price_cents BIGINT, currency_code TEXT DEFAULT 'USD')`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.users, ${schema}.disputes, ${schema}.notifications,
      ${schema}.admin_notification_prefs, ${schema}.admin_api_keys, ${schema}.metric_alert_rules,
      ${schema}.platform_ledger, ${schema}.jobs, ${schema}.metric_alert_observations, ${schema}.metric_alert_sms_claims, ${schema}.metric_alert_fires`);
  });

  async function makeAdmin(overrides = {}) {
    const { rows: [admin] } = await db.query(
      `INSERT INTO ${schema}.users (role, totp_enabled, email, first_name, preferred_language)
       VALUES ('admin', true, 'ops@example.com', 'Ops', 'en') RETURNING id`,
    );
    return admin.id;
  }

  async function makeRule(adminId, overrides = {}) {
    const { rows: [rule] } = await db.query(
      `INSERT INTO ${schema}.metric_alert_rules
         (admin_id, metric_name, operator, threshold, cooldown_minutes,
          channel_in_app, channel_email, channel_sms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        adminId,
        overrides.metric_name || 'open_disputes',
        overrides.operator || '>',
        overrides.threshold != null ? overrides.threshold : 5,
        overrides.cooldown_minutes != null ? overrides.cooldown_minutes : 60,
        overrides.channel_in_app !== false,
        overrides.channel_email === true,
        overrides.channel_sms === true,
      ]
    );
    return rule;
  }

  async function notificationCount() {
    const { rows } = await db.query(`SELECT COUNT(*)::INT AS n FROM ${schema}.notifications`);
    return rows[0].n;
  }

  test('fires when the threshold is crossed, at most once per cooldown', async () => {
    const adminId = await makeAdmin();
    await db.query(`INSERT INTO ${schema}.disputes (status)
      SELECT 'open' FROM generate_series(1, 6)`);
    await makeRule(adminId, { threshold: 5, cooldown_minutes: 60 });

    const first = await evaluateMetricThresholdAlerts();
    expect(first.sent).toBe(1);
    expect(await notificationCount()).toBe(1);

    const second = await evaluateMetricThresholdAlerts();
    expect(second.sent).toBe(0);
    expect(await notificationCount()).toBe(1);

    const { rows: [rule] } = await db.query(
      `SELECT last_fired_at, last_value FROM ${schema}.metric_alert_rules`);
    expect(rule.last_fired_at).toBeTruthy();
    expect(Number(rule.last_value)).toBe(6);
  });

  test('a fire claimed by a crashed worker is never repeated in a later bucket', async () => {
    const adminId = await makeAdmin();
    await db.query(`INSERT INTO ${schema}.disputes (status)
      SELECT 'open' FROM generate_series(1, 6)`);
    const rule = await makeRule(adminId, { threshold: 5, cooldown_minutes: 5 });
    // Simulate a worker that committed its claim, contacted a provider and
    // then died before any bookkeeping: the claim alone holds the cooldown.
    await db.query(`UPDATE ${schema}.metric_alert_rules SET last_fired_at = NOW() - interval '4 minutes'`);
    await db.query(`INSERT INTO ${schema}.metric_alert_fires(rule_id, rule_updated_at, claimed_at)
      VALUES ($1, $2, NOW() - interval '4 minutes')`, [rule.id, rule.updated_at]);
    expect((await evaluateMetricThresholdAlerts()).sent).toBe(0);
    expect(await notificationCount()).toBe(0);
    // Once the cooldown has fully elapsed, the next crossing is a new fire.
    await db.query(`UPDATE ${schema}.metric_alert_rules SET last_fired_at = NOW() - interval '6 minutes'`);
    expect((await evaluateMetricThresholdAlerts()).sent).toBe(1);
    const { rows: fires } = await db.query(`SELECT status FROM ${schema}.metric_alert_fires ORDER BY id`);
    expect(fires.map(f => f.status)).toEqual(['claimed', 'delivered']);
  });

  test('a fire that reaches no channel releases its cooldown', async () => {
    const adminId = await makeAdmin();
    await db.query(`INSERT INTO ${schema}.disputes (status)
      SELECT 'open' FROM generate_series(1, 6)`);
    // SMS-only, but the admin has not opted into SMS: nothing can deliver.
    await makeRule(adminId, { threshold: 5, channel_in_app: false, channel_sms: true });
    expect((await evaluateMetricThresholdAlerts()).sent).toBe(0);
    const { rows: [rule] } = await db.query(`SELECT last_fired_at FROM ${schema}.metric_alert_rules`);
    expect(rule.last_fired_at).toBeNull();
    const { rows: [fire] } = await db.query(`SELECT status FROM ${schema}.metric_alert_fires`);
    expect(fire.status).toBe('not_delivered');
  });

  test('a definitive SMS rejection is recorded as failed and an interrupted send is swept to uncertain', async () => {
    const adminId = await makeAdmin();
    await db.query("UPDATE users SET phone='+15555550123' WHERE id=$1", [adminId]);
    await db.query('INSERT INTO admin_notification_prefs(admin_id,sms_notifications) VALUES($1,true)', [adminId]);
    await db.query("INSERT INTO disputes(status) SELECT 'open' FROM generate_series(1,6)");
    const rule = await makeRule(adminId, { channel_in_app: false, channel_sms: true });
    const sms = require('../services/smsNotificationService'); sms.sendConfiguredSMS.mockClear();
    sms.sendConfiguredSMS.mockResolvedValueOnce({ success: false });
    await evaluateMetricThresholdAlerts();
    const { rows: [claim] } = await db.query('SELECT status FROM metric_alert_sms_claims');
    expect(claim.status).toBe('failed');
    // A stale 'sending' claim (a worker died mid-send) blocks a parallel SMS
    // and is swept to 'uncertain' on the next pass, never resent.
    await db.query(`INSERT INTO metric_alert_sms_claims(delivery_key,rule_id,status,updated_at)
      VALUES('synthetic-stale',$1,'sending',NOW()-interval '11 minutes')`, [rule.id]);
    await evaluateMetricThresholdAlerts();
    const { rows: [stale] } = await db.query("SELECT status FROM metric_alert_sms_claims WHERE delivery_key='synthetic-stale'");
    expect(stale.status).toBe('uncertain');
  });

  test('history retention prunes old settled rows and keeps in-flight claims', async () => {
    const { pruneMetricAlertHistory } = require('../jobs/metricThresholdAlerts');
    const adminId = await makeAdmin();
    const rule = await makeRule(adminId);
    await db.query(`INSERT INTO metric_alert_observations(rule_id,observed_at,value) VALUES
      ($1,NOW()-interval '40 days',1),($1,NOW(),2)`, [rule.id]);
    await db.query(`INSERT INTO metric_alert_fires(rule_id,rule_updated_at,claimed_at,status,resolved_at) VALUES
      ($1,NOW(),NOW()-interval '40 days','delivered',NOW()-interval '40 days'),($1,NOW(),NOW()-interval '40 days','claimed',NULL)`, [rule.id]);
    await db.query(`INSERT INTO metric_alert_sms_claims(delivery_key,rule_id,status,created_at) VALUES
      ('old-sent',$1,'sent',NOW()-interval '40 days'),('old-sending',$1,'sending',NOW()-interval '40 days')`, [rule.id]);
    expect(await pruneMetricAlertHistory(30)).toMatchObject({ observations: 1, fires: 1, smsClaims: 1 });
    const { rows: [left] } = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM metric_alert_observations) AS o,
      (SELECT COUNT(*)::int FROM metric_alert_fires) AS f,
      (SELECT string_agg(delivery_key, ',') FROM metric_alert_sms_claims) AS c`);
    expect(left).toEqual({ o: 1, f: 1, c: 'old-sending' });
  });

  test('does not fire when the threshold is not crossed', async () => {
    const adminId = await makeAdmin();
    await db.query(`INSERT INTO ${schema}.disputes (status) VALUES ('open')`);
    await makeRule(adminId, { threshold: 100 });

    const result = await evaluateMetricThresholdAlerts();
    expect(result.sent).toBe(0);
    expect(await notificationCount()).toBe(0);
  });

  test('concurrent workers deliver once and record durable observations', async () => {
    const adminId = await makeAdmin();
    await db.query("INSERT INTO disputes(status) SELECT 'open' FROM generate_series(1,6)");
    await makeRule(adminId);
    await Promise.all([evaluateMetricThresholdAlerts(),evaluateMetricThresholdAlerts()]);
    expect(await notificationCount()).toBe(1);
    const { rows: [observation] } = await db.query('SELECT value,crossed FROM metric_alert_observations LIMIT 1');
    expect(Number(observation.value)).toBe(6);
    expect(observation.crossed).toBe(true);
  });

  test('the original disputes preference suppresses dispute threshold delivery', async () => {
    const adminId = await makeAdmin();
    await db.query("INSERT INTO disputes(status) SELECT 'open' FROM generate_series(1,6)");
    await db.query('INSERT INTO admin_notification_prefs(admin_id,notify_disputes) VALUES($1,false)', [adminId]);
    await makeRule(adminId);
    expect((await evaluateMetricThresholdAlerts()).skippedByPrefs).toBe(1);
    expect(await notificationCount()).toBe(0);
  });

  test('SMS uncertainty is durable, retries do not resend, and only the owner can read history',async()=>{
    const adminId=await makeAdmin();
    await db.query("UPDATE users SET phone='+15555550123' WHERE id=$1",[adminId]);
    await db.query('INSERT INTO admin_notification_prefs(admin_id,sms_notifications) VALUES($1,true)',[adminId]);
    await db.query("INSERT INTO disputes(status) SELECT 'open' FROM generate_series(1,6)");
    const rule=await makeRule(adminId,{channel_in_app:false,channel_sms:true});
    const sms=require('../services/smsNotificationService');sms.sendConfiguredSMS.mockClear();
    sms.sendConfiguredSMS.mockRejectedValueOnce(new Error('synthetic uncertain timeout'));
    await evaluateMetricThresholdAlerts();await evaluateMetricThresholdAlerts();
    expect(sms.sendConfiguredSMS).toHaveBeenCalledTimes(1);
    const history=require('../controllers/adminSelfSettingsController').getMetricAlertHistory;
    const res={set:jest.fn(),json:jest.fn()},next=jest.fn();
    await history({params:{ruleId:rule.id},query:{},user:{id:adminId,role:'admin'}},res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].sms[0].status).toBe('uncertain');
    expect(res.json.mock.calls[0][0].rows[0]).toMatchObject({metric_name:'open_disputes',value:'6'});
    const outsider=await makeAdmin();
    await history({params:{ruleId:rule.id},query:{},user:{id:outsider,role:'admin'}},res,next);
    expect(next.mock.calls[0][0]).toMatchObject({status:404});
  });

  test('NULL metric value never fires and never crashes the evaluator', async () => {
    const adminId = await makeAdmin();
    // No completed jobs -> budget GMV is 0 -> take-rate is NULL.
    await makeRule(adminId, { metric_name: 'investor_take_rate_pct', operator: '>', threshold: 1 });

    const result = await evaluateMetricThresholdAlerts();
    expect(result.sent).toBe(0);
    expect(result.evaluated).toBe(1);
    expect(await notificationCount()).toBe(0);
  });

  test('notify_metric_alerts=false suppresses all delivery', async () => {
    const adminId = await makeAdmin();
    await db.query(`INSERT INTO ${schema}.disputes (status)
      SELECT 'open' FROM generate_series(1, 6)`);
    await db.query(
      `INSERT INTO ${schema}.admin_notification_prefs (admin_id, notify_metric_alerts)
       VALUES ($1, false)`, [adminId]);
    await makeRule(adminId, { threshold: 5 });

    const result = await evaluateMetricThresholdAlerts();
    expect(result.sent).toBe(0);
    expect(result.skippedByPrefs).toBe(1);
    expect(await notificationCount()).toBe(0);
    const { rows: [rule] } = await db.query(
      `SELECT last_fired_at FROM ${schema}.metric_alert_rules`);
    expect(rule.last_fired_at).toBeNull();
  });

  test('email_notifications=false suppresses email but keeps in-app', async () => {
    const adminId = await makeAdmin();
    await db.query(`INSERT INTO ${schema}.disputes (status)
      SELECT 'open' FROM generate_series(1, 6)`);
    await db.query(
      `INSERT INTO ${schema}.admin_notification_prefs
         (admin_id, notify_metric_alerts, email_notifications)
       VALUES ($1, true, false)`, [adminId]);
    await makeRule(adminId, { threshold: 5, channel_email: true });

    const result = await evaluateMetricThresholdAlerts();
    expect(result.sent).toBe(1);
    const { rows: [notif] } = await db.query(
      `SELECT is_email_sent, title, body FROM ${schema}.notifications`);
    expect(notif.is_email_sent).toBe(false);
    expect(notif.title).toBe('Metric threshold alert');
    expect(notif.body).toContain('Open disputes');
  });

  test('email channel delivers when prefs allow', async () => {
    const adminId = await makeAdmin();
    await db.query(`INSERT INTO ${schema}.disputes (status)
      SELECT 'open' FROM generate_series(1, 6)`);
    // No prefs row: defaults are opt-out (allowed).
    await makeRule(adminId, { threshold: 5, channel_email: true });

    const result = await evaluateMetricThresholdAlerts();
    expect(result.sent).toBe(1);
    const { rows: [notif] } = await db.query(
      `SELECT is_email_sent FROM ${schema}.notifications`);
    expect(notif.is_email_sent).toBe(true);
  });

  test('all non-restaurant registry metrics are alertable', () => {
    const { METRICS } = require('../analytics/metricsRegistry');
    expect(Object.keys(ALERTABLE_METRICS).sort()).toEqual(Object.keys(METRICS).filter(name => !name.startsWith('restaurant_')).sort());
  });
});
