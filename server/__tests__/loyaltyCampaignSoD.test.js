'use strict';

/**
 * Loyalty campaign separation of duties (auth-audit finding 41).
 *
 * approveCampaign used the same gate as createCampaign and wrote
 * approved_by = actorUserId with no created_by <> actorUserId guard, so one
 * admin could create and approve a campaign that queues customer messages.
 * The approver must now differ from the creator (NULL created_by rows,
 * which predate creator tracking, stay approvable).
 */

const { resetMocks } = require('./setup');
const campaignService = require('../services/restaurantLoyaltyCampaignService');

function fakeClient(selectRow, updateRow) {
  return {
    query: jest.fn(async (sql) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: selectRow ? [selectRow] : [] };
      return { rows: updateRow ? [updateRow] : [] };
    }),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 41: approveCampaign separation of duties', () => {
  test('the creator cannot approve their own campaign', async () => {
    const client = fakeClient(
      { id: 5, status: 'draft', created_by: 'admin-1' },
      { id: 5, status: 'approved' }
    );
    await expect(
      campaignService.approveCampaign(client, { restaurantId: 42, campaignId: 5, actorUserId: 'admin-1' })
    ).rejects.toMatchObject({ code: 'loyalty_campaign_self_approval', status: 403 });
    // The approval UPDATE never ran.
    expect(client.query.mock.calls.filter(([sql]) => /^\s*UPDATE/i.test(sql))).toHaveLength(0);
  });

  test('a different admin can approve', async () => {
    const approved = { id: 5, status: 'approved', approved_by: 'admin-2' };
    const client = fakeClient({ id: 5, status: 'draft', created_by: 'admin-1' }, approved);
    const result = await campaignService.approveCampaign(client, {
      restaurantId: 42, campaignId: 5, actorUserId: 'admin-2',
    });
    expect(result.status).toBe('approved');
    expect(client.query.mock.calls.filter(([sql]) => /^\s*UPDATE/i.test(sql))).toHaveLength(1);
  });

  test('NULL created_by (pre-SoD rows) stays approvable', async () => {
    const approved = { id: 6, status: 'approved', approved_by: 'admin-1' };
    const client = fakeClient({ id: 6, status: 'draft', created_by: null }, approved);
    const result = await campaignService.approveCampaign(client, {
      restaurantId: 42, campaignId: 6, actorUserId: 'admin-1',
    });
    expect(result.status).toBe('approved');
  });

  test('non-draft campaigns still 409', async () => {
    const client = fakeClient({ id: 5, status: 'approved', created_by: 'admin-1' }, null);
    await expect(
      campaignService.approveCampaign(client, { restaurantId: 42, campaignId: 5, actorUserId: 'admin-2' })
    ).rejects.toMatchObject({ code: 'loyalty_campaign_not_draft' });
  });

  test('missing campaigns 404', async () => {
    const client = fakeClient(null, null);
    await expect(
      campaignService.approveCampaign(client, { restaurantId: 42, campaignId: 999, actorUserId: 'admin-2' })
    ).rejects.toMatchObject({ code: 'loyalty_campaign_not_found' });
  });
});
