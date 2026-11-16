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

describe('progressive access business support queue boundary (WP-036)', () => {
  test('assigned-agent actions re-check active employer standing', () => {
    const source = read('services/supportEmployerService.js');
    expect(source).toMatch(/userIsActiveAssignedAgent/);
    expect(source).toMatch(/findAgentForConversationBusiness\(businessId, userId\)/);

    const controller = read('controllers/supportConversationsController.js');
    expect(controller).toMatch(/userIsActiveAssignedAgent\(\s*conversation\.business_id/);
  });

  test('attachment uploads require action authorization, not queue visibility alone', () => {
    const source = read('controllers/conversationMessageController.js');
    expect(source).toMatch(/loadAuthorizedConversation\(req, conversationId, \{ requireAction: true \}\)/);
    expect(source).toMatch(/userCanAdministrateBusiness\(businessId, req\.user\.id\)/);
    expect(source).toMatch(/userIsActiveAssignedAgent\(businessId, req\.user\.id, conversation\.agent_id\)/);
  });

  test('ticket joins and socket replies require active employer-scoped assignment', () => {
    const source = read('services/websocketService.js');
    expect(source).toMatch(/sa\.status = 'active'/);
    expect(source).toMatch(/se\.kind = 'platform'/);
    expect(source).toMatch(/assigned_agent_user_id === socket\.userId/);
    expect(source).toMatch(/assigned_agent_business_id/);
  });

  test('resource-scoped conversation handlers bind the URL business to the case', () => {
    const source = read('controllers/supportConversationsController.js');
    expect(source).toMatch(/\$2::integer IS NULL OR sc\.business_id = \$2::integer/);
    expect(source).toMatch(/req\.params\.businessId \|\| null/);
  });
});
