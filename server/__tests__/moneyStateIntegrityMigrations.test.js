'use strict';

const fs = require('fs');
const path = require('path');

function readMigration(name) {
  return fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
}

const payout = readMigration('601_payout_transaction_state_integrity.sql');
const booking = readMigration('602_booking_request_state_integrity.sql');
const marketplace = readMigration('603_marketplace_order_state_integrity.sql');
const deliveryPayment = readMigration('604_delivery_payment_state_integrity.sql');
const purchaseOrder = readMigration('605_purchase_order_state_integrity.sql');

describe('money and lifecycle state integrity migrations (601-605)', () => {
  test('each migration installs an idempotent BEFORE UPDATE trigger', () => {
    expect(payout).toContain('CREATE OR REPLACE FUNCTION enforce_payout_transaction_state_integrity()');
    expect(payout).toContain('DROP TRIGGER IF EXISTS payout_transaction_state_integrity_guard ON payout_transactions;');
    expect(payout).toContain('BEFORE UPDATE OF transaction_status');

    expect(booking).toContain('CREATE OR REPLACE FUNCTION enforce_booking_request_state_integrity()');
    expect(booking).toContain('DROP TRIGGER IF EXISTS booking_request_state_integrity_guard ON booking_requests;');
    expect(booking).toContain('BEFORE UPDATE OF status');

    expect(marketplace).toContain('CREATE OR REPLACE FUNCTION enforce_marketplace_order_state_integrity()');
    expect(marketplace).toContain('DROP TRIGGER IF EXISTS marketplace_order_state_integrity_guard ON marketplace_orders;');

    expect(deliveryPayment).toContain('CREATE OR REPLACE FUNCTION enforce_delivery_payment_state_integrity()');
    expect(deliveryPayment).toContain('DROP TRIGGER IF EXISTS delivery_payment_state_integrity_guard ON delivery_payments;');

    expect(purchaseOrder).toContain('CREATE OR REPLACE FUNCTION enforce_purchase_order_state_integrity()');
    expect(purchaseOrder).toContain('DROP TRIGGER IF EXISTS purchase_order_state_integrity_guard ON purchase_orders;');
  });

  test('payout transactions block double-payout and unconfirmed completion', () => {
    expect(payout).toContain("old_status = 'completed' AND new_status <> 'refunded'");
    expect(payout).toContain("old_status = 'failed' AND new_status NOT IN ('initiated', 'processing')");
    expect(payout).toContain("old_status = 'processing' AND new_status NOT IN ('completed', 'failed')");
    expect(payout).toContain("old_status = 'initiated' AND new_status NOT IN ('processing', 'failed')");
    expect(payout).toContain("old_status = 'refunded'");
  });

  test('booking requests cannot be resurrected from terminal states', () => {
    expect(booking).toContain("IN ('declined', 'cancelled', 'accepted_cancelled')");
    expect(booking).toContain("old_status = 'accepted' AND new_status <> 'accepted_cancelled'");
    expect(booking).toContain("old_status = 'expired' AND new_status <> 'cancelled'");
    expect(booking).toContain("old_status = 'counter_proposed'");
    expect(booking).toContain("old_status = 'pending'");
  });

  test('marketplace orders cannot reopen fulfilled orders or erase payment evidence', () => {
    expect(marketplace).toContain("IN ('cancelled', 'refunded')");
    expect(marketplace).toContain("old_status = 'completed' AND new_status <> 'refunded'");
    expect(marketplace).toContain("old_status = 'processing'");
    expect(marketplace).toContain("old_status = 'paid'");
    expect(marketplace).toContain("old_status = 'pending' AND new_status NOT IN ('paid', 'cancelled')");
  });

  test('delivery payments protect captured money and allow explicit retry', () => {
    expect(deliveryPayment).toContain("IN ('refunded', 'cancelled')");
    expect(deliveryPayment).toContain("old_status = 'paid' AND new_status <> 'refunded'");
    expect(deliveryPayment).toContain("old_status = 'failed' AND new_status <> 'pending'");
    expect(deliveryPayment).toContain("old_status = 'pending'");
  });

  test('purchase orders encode the full code-side transition graph', () => {
    expect(purchaseOrder).toContain("WHEN 'draft'                THEN ARRAY['quoted', 'cancelled']");
    expect(purchaseOrder).toContain("WHEN 'customs_review'      THEN ARRAY['cleared', 'in_transit']");
    expect(purchaseOrder).toContain("WHEN 'fulfilled'           THEN ARRAY['closed']");
    expect(purchaseOrder).toContain("WHEN 'closed'              THEN ARRAY[]::TEXT[]");
    expect(purchaseOrder).toContain("WHEN 'cancelled'           THEN ARRAY[]::TEXT[]");
    expect(purchaseOrder).toContain('Invalid purchase order transition');
  });

  test('guards only fire on real changes and leave INSERTs alone', () => {
    for (const sql of [payout, booking, marketplace, deliveryPayment, purchaseOrder]) {
      expect(sql).toContain('IF old_status IS DISTINCT FROM new_status THEN');
      expect(sql).not.toContain('BEFORE INSERT');
      expect(sql).toContain("USING ERRCODE = '23514'");
    }
  });
});
