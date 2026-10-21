'use strict';

const service = require('../services/restaurantLoyaltyCampaignService');

describe('restaurant loyalty campaign service', () => {
  test('normalizes approval-gated campaign inputs and requires email subjects', () => {
    expect(service.normalizeCampaignInput({ name: 'Weekend', channel: 'in_app', body: 'Come back soon' }))
      .toEqual({ name: 'Weekend', channel: 'in_app', subject: null, body: 'Come back soon' });
    expect(() => service.normalizeCampaignInput({ name: 'Email', channel: 'email', body: 'Body' }))
      .toThrow(/subject/i);
    expect(() => service.normalizeCampaignInput({ name: 'Bad', channel: 'sms', body: 'Body' }))
      .toThrow(/channel/i);
  });

  test('creates only against an active restaurant segment', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, restaurant_id: 2, segment_id: 4, name: 'Weekend', channel: 'in_app', body: 'Come back', status: 'draft' }] }) };
    const campaign = await service.createCampaign(client, {
      restaurantId: 2, segmentId: 4, actorUserId: 'user-1',
      input: { name: 'Weekend', channel: 'in_app', body: 'Come back' },
    });
    expect(campaign).toMatchObject({ id: 7, status: 'draft', channel: 'in_app' });
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});
