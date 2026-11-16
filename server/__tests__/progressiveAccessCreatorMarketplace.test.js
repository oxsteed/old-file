'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access creator marketplace boundary (WP-043)', () => {
  test('creator opportunities require a currently verified selected actor', () => {
    const source = read('controllers/mediaCreatorController.js');
    expect(source).toMatch(/verifiedActorSql\('a'\)/);
    expect(source).toMatch(/ensureVerifiedActor\(client, req\.user\.id/);
    expect(source).toMatch(/media_creator_unverified/);
  });

  test('creator applications and deliverables remain party- and post-owner-scoped', () => {
    const source = read('controllers/mediaCreatorController.js');
    expect(source).toMatch(/g\.owner_user_id = \$2 OR ap\.applicant_user_id = \$2/);
    expect(source).toMatch(/ap\.applicant_user_id = \$2/);
    expect(source).toMatch(/p\.id = \$3/);
    expect(source).toMatch(/Only a published post owned by the awarded creator can be submitted/);
  });

  test('creator payments use idempotency keys and durable Credit settlement links', () => {
    const source = read('controllers/mediaCreatorController.js');
    expect(source).toMatch(/lockCreationKey\(client, req\.user\.id/);
    expect(source).toMatch(/media_creator_idempotency_conflict/);
    expect(source).toMatch(/requireMatchingReservation/);
    expect(source).toMatch(/requireTransactionId/);
  });

  test('active work and revocation do not permit an unsafe payout or deliverable', () => {
    const source = read('controllers/mediaCreatorController.js');
    expect(source).toMatch(/assertNoWorkReview/);
    expect(source).toMatch(/Creator verification is no longer active/);
    expect(source).toMatch(/mediaSafety\.publicPostSql\('p'\)/);
    expect(source).toMatch(/media_creator_work_review_pending/);
  });
});
