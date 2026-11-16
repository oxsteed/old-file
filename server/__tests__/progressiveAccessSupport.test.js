'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access support handoff boundary (WP-035)', () => {
  test('customer routing validates an access request against the authenticated applicant', () => {
    const source = read('controllers/supportRoutingController.js');
    expect(source).toMatch(/FROM access_requests[\s\S]*AND applicant_id = \$2/);
    expect(source).toMatch(/status IN \('draft', 'submitted', 'in_review', 'needs_information'\)/);
    expect(source).toMatch(/access_request_id/);
  });

  test('support detail resolves only the request linked to the authorized conversation customer', () => {
    const source = read('controllers/supportConversationsController.js');
    expect(source).toMatch(/conversation\.access_request_id/);
    expect(source).toMatch(/FROM access_requests[\s\S]*WHERE id = \$1 AND applicant_id = \$2/);
    expect(source).toMatch(/conversation\.access_request = accessRows\[0\]/);
  });

  test('support socket authorization remains conversation/customer bound', () => {
    const source = read('services/websocketService.js');
    expect(source).toMatch(/\$2 = sc\.customer_id/);
    expect(source).toMatch(/socket\.join\(`ticket:\$\{ticketId\}`\)/);
  });
});
