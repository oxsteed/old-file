'use strict';

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../migrations/594_local_delivery_state_integrity.sql'),
  'utf8',
);

describe('local delivery database state integrity migration', () => {
  test('installs an idempotent trigger on every ownership and lifecycle mutation', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enforce_local_delivery_state_integrity()');
    expect(migration).toContain('DROP TRIGGER IF EXISTS delivery_state_integrity_guard ON delivery_jobs;');
    expect(migration).toContain('BEFORE UPDATE OF status, dispatch_state, fulfillment_source');
    expect(migration).toContain('helper_user_id, internal_driver_user_id, vehicle_id');
  });

  test('protects terminal states, proof-gated completion, and source ownership', () => {
    expect(migration).toContain("old_status IN ('delivered', 'returned', 'cancelled')");
    expect(migration).toContain('Delivery completion requires verified proof and completion time');
    expect(migration).toContain('Return completion requires verified proof and return time');
    expect(migration).toContain('Delivery cannot have both marketplace and internal owners');
    expect(migration).toContain('Marketplace-posted delivery cannot retain an assignment');
    expect(migration).toContain('Internal-assigned delivery requires an internal driver and vehicle');
  });

  test('keeps recovery transitions explicit instead of allowing arbitrary status jumps', () => {
    expect(migration).toContain("old_status = 'posted' AND new_status IN ('assigned', 'cancelled')");
    expect(migration).toContain("old_status = 'assigned' AND new_status IN ('picked_up', 'cancelled', 'failed')");
    expect(migration).toContain("old_status = 'picked_up' AND new_status IN ('in_transit', 'failed')");
    expect(migration).toContain("old_status = 'in_transit' AND new_status IN ('delivered', 'failed')");
    expect(migration).toContain("old_status = 'failed' AND new_status IN ('assigned', 'picked_up', 'in_transit', 'returned')");
    expect(migration).toContain('Invalid delivery status transition');
  });
});
