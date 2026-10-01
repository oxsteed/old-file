'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { applyChargeRefund } = require('../services/paymentRefundStateService');
const { logAdminAction } = require('../services/auditService');

// Explicit opt-in; this target is a network-isolated, disposable container.
// Never accept a production container or a connection URL from the environment.
const integration = process.env.RUN_STRIPE_REFUND_POSTGRES === '1' ? test : test.skip;
const container = 'oxsteed-stripe-verification-20260930';

function sqlLiteral(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
function bind(sql, values) {
  return sql.replace(/\$(\d+)/g, (_, index) => sqlLiteral(values[Number(index) - 1]));
}
function postgres(sql) {
  return execFileSync('docker', ['--context', 'colima', 'exec', '-i', container,
    'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
  { input: sql, encoding: 'utf8', timeout: 15000 });
}

integration('real PostgreSQL preserves partial refunds and ignores lower delayed totals', async () => {
  const statements = [];
  const client = { query: async (sql, params) => { statements.push(bind(sql, params)); return { rows: [], rowCount: 1 }; } };
  const charge = { id: 'ch_fixture', payment_intent: 'pi_fixture', amount: 1000, currency: 'usd' };
  for (const amount_refunded of [400, 200, 400]) await applyChargeRefund(client, { ...charge, amount_refunded });
  const output = postgres(`
    BEGIN;
    CREATE TEMP TABLE payments (
      id BIGINT PRIMARY KEY, amount NUMERIC(12,2), currency TEXT,
      refunded_amount NUMERIC(12,2), refund_amount NUMERIC(12,2),
      status TEXT, payment_hold_status TEXT, refunded_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ, stripe_charge_id TEXT, stripe_payment_intent_id TEXT
    );
    INSERT INTO payments VALUES (7,10,'usd',0,0,'captured','released',NULL,NOW(),'ch_fixture','pi_fixture');
    ${statements.join(';')};
    SELECT 'partial:' || status || ':' || refunded_amount || ':' || payment_hold_status FROM payments;
    ROLLBACK;
  `);
  expect(output).toContain('partial:captured:4.00:released');
});

integration('real PostgreSQL accepts the current audit schema and numeric payment target', async () => {
  let statement;
  await logAdminAction({ adminId: '11111111-1111-4111-8111-111111111111', action: 'partial_refund_payment',
    targetType: 'payment', targetId: 7, after: { amount_cents: 400 },
    client: { query: async (sql, params) => { statement = bind(sql, params); return { rows: [] }; } } });
  const output = postgres(`
    BEGIN;
    CREATE TEMP TABLE admin_audit_log (
      admin_id UUID NOT NULL, action TEXT NOT NULL, target_type TEXT,
      target_id UUID, target_key TEXT, description TEXT, ip_address INET,
      user_agent TEXT, before_state JSONB, after_state JSONB
    );
    ${statement};
    SELECT 'audit:' || target_type || ':' || target_key || ':' || (after_state->>'amount_cents') FROM admin_audit_log;
    ROLLBACK;
  `);
  expect(output).toContain('audit:payment:7:400');
});

integration('Pro price mapping migration is repeatable and preserves custom mappings', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/615_stripe_pro_catalog_mapping.sql'), 'utf8');
  const output = postgres(`
    BEGIN;
    CREATE TEMP TABLE plans (slug TEXT, amount_cents INT, currency TEXT, interval TEXT,
      stripe_price_id TEXT, stripe_product_id TEXT, updated_at TIMESTAMPTZ);
    INSERT INTO plans VALUES
      ('pro',1499,'usd','month','REPLACE_WITH_REAL_STRIPE_PRICE_ID_MONTHLY',NULL,NOW()),
      ('pro-yearly',7999,'usd','year','REPLACE_WITH_REAL_STRIPE_PRICE_ID_YEARLY',NULL,NOW()),
      ('pro',1499,'usd','month','price_custom',NULL,NOW());
    ${migration}
    ${migration}
    SELECT 'mapping:' || slug || ':' || stripe_price_id FROM plans ORDER BY stripe_price_id;
    ROLLBACK;
  `);
  expect(output).toContain('mapping:pro:price_1THyAiGo54BMlgSyPzPoIOk6');
  expect(output).toContain('mapping:pro-yearly:price_1THyCDGo54BMlgSyzrRM6Swt');
  expect(output).toContain('mapping:pro:price_custom');
});

integration('Broker price mapping preserves custom contracts and is repeatable', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/616_stripe_broker_catalog_mapping.sql'), 'utf8');
  const output = postgres(`BEGIN;
    CREATE TEMP TABLE plans (slug TEXT, amount_cents INT, currency TEXT, interval TEXT,
      stripe_price_id TEXT, stripe_product_id TEXT, updated_at TIMESTAMPTZ);
    INSERT INTO plans VALUES
      ('broker',3900,'usd','month','price_1THs8GGo54BMlgSyGjMDOWo7',NULL,NOW()),
      ('broker',3900,'usd','month','price_custom',NULL,NOW()),
      ('broker',2900,'usd','month','price_1THs8GGo54BMlgSyGjMDOWo7',NULL,NOW());
    ${migration}
    ${migration}
    SELECT 'mapping:' || amount_cents || ':' || stripe_price_id FROM plans ORDER BY amount_cents;
    ROLLBACK;`);
  expect(output).toContain('mapping:3900:price_1ULXZLGo54BMlgSyEbdvgz2f');
  expect(output).toContain('mapping:3900:price_custom');
  expect(output).toContain('mapping:2900:price_1THs8GGo54BMlgSyGjMDOWo7');
});
