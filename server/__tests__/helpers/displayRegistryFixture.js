'use strict';
const fs = require('fs');
const path = require('path');
// Keep legacy pairing fixtures isolated while applying the actual registry
// migrations and production app-device column/check definitions they depend on.
async function applyDisplayRegistryFixture(db, schema) {
  if (!/^[a-z0-9_]+$/.test(schema)) throw new Error('Invalid test schema');
  await db.query(`CREATE TABLE ${schema}.restaurant_app_devices (LIKE public.restaurant_app_devices INCLUDING ALL)`);
  for (const filename of ['99922_restaurant_devices.sql','99984_restaurant_device_credentials.sql']) {
    await db.query(fs.readFileSync(path.join(__dirname,'../../migrations',filename),'utf8'));
  }
}
module.exports = { applyDisplayRegistryFixture };
