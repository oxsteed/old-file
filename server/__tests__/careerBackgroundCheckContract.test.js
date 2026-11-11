'use strict';

const checks = require('../services/careers/backgroundChecks');

const app = {
  id: 41,
  employer_type: 'business',
  business_id: 7,
  background_check_required: true,
  background_check_package: 'tasker_standard',
  opening_country: 'US',
  user_id: 'worker-1',
  stage: 'offer',
};
const settings = { background_checks_enabled: true, permissible_purpose_certified_at: new Date().toISOString(), checkr_account_ref: 'encrypted-ref' };
const actor = { id: 'manager-1' };

test('does not persist an invited check when Checkr omits the candidate handoff URL', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM career_offers')) return { rows: [{ id: 9 }] };
      if (sql.includes('FROM career_background_checks')) return { rows: [] };
      throw new Error(`unexpected persistence query: ${sql}`);
    },
  };

  await expect(checks.requestCheck(db, {
    app,
    actor,
    settings,
    inviteImpl: async () => ({ candidateId: 'cand-1', invitationId: 'invite-1', invitationUrl: null }),
  })).rejects.toMatchObject({ status: 503, code: 'background_check_invitation_unavailable' });
  expect(queries).toHaveLength(2);
});

test('background-check invitations require HTTPS URLs', () => {
  expect(checks.requireInvitation({ candidateId: 'cand-1', invitationId: 'invite-1', invitationUrl: 'https://candidate.checkr.com/invite/1' })).toEqual({
    candidateId: 'cand-1', invitationId: 'invite-1', invitationUrl: 'https://candidate.checkr.com/invite/1',
  });
  expect(() => checks.requireInvitation({ candidateId: 'cand-1', invitationId: 'invite-1', invitationUrl: 'http://candidate.checkr.com/invite/1' })).toThrow();
  expect(() => checks.requireInvitation({ candidateId: 'cand-1', invitationUrl: 'https://candidate.checkr.com/invite/1' })).toThrow();
  expect(() => checks.requireInvitation({ invitationId: 'invite-1', invitationUrl: 'https://candidate.checkr.com/invite/1' })).toThrow();
});

