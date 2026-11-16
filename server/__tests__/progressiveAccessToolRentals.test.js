'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access tool-rental boundary (WP-037)', () => {
  test('tool-owner enforcement has an explicit off/shadow/enforce rollout flag', () => {
    const flags = read('services/access/flags.js');
    const middleware = read('middleware/requireAccess.js');
    expect(flags).toMatch(/ACCESS_TOOL_OWNER_ENFORCEMENT/);
    expect(flags).toMatch(/toolOwnerEnforcement/);
    expect(middleware).toMatch(/tool_owner\.list_equipment/);
    expect(middleware).toMatch(/req\.toolOwnerAccessPending/);
  });

  test('pending applicants may save private drafts but cannot publish', () => {
    const source = read('routes/toolRentals.js');
    expect(source).toMatch(/toolOwnerCapabilityGate/);
    expect(source).toMatch(/if \(req\.toolOwnerAccessPending\) payload\.is_available = false/);
    expect(source).toMatch(/publication_blocked: Boolean\(req\.toolOwnerAccessPending\)/);
    expect(source).toMatch(/capability: 'tool_owner\.list_equipment'/);
  });

  test('rent search and booking remain independent from listing publication access', () => {
    const source = read('routes/toolRentals.js');
    expect(source).toMatch(/router\.get\('\/browse', browseTools\)/);
    expect(source).toMatch(/router\.post\('\/bookings', authenticate, toolBookingsController\.createBooking\)/);
    expect(source).not.toMatch(/toolOwnerCapabilityGate,?\s*toolBookingsController\.createBooking/);
  });
});
