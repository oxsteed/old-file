'use strict';
jest.unmock('../utils/email');
process.env.RESEND_API_KEY = 're_synthetic_gift_fixture';
const { sendEmail, getEmailDeliveryStatus } = require('../utils/email');
describe('gift-card provider protocol', () => {
  const id = '30000000-0000-4000-8000-000000000003';
  const saved = global.fetch;
  afterEach(() => {
    global.fetch = saved;
  });
  test('shared transport forwards stable provider request identity', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id }),
    }));
    expect(
      await sendEmail({
        to: 'fixture@example.invalid',
        subject: 'Gift',
        text: 'synthetic',
        html: '<p>synthetic</p>',
        idempotencyKey: 'restaurant-gift/fixture',
      }),
    ).toEqual({ success: true, id });
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(global.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(
      'restaurant-gift/fixture',
    );
  });
  test('provider status retrieval excludes message bodies and recipient data', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id,
        last_event: 'delivered',
        html: 'PRIVATE',
        text: 'PRIVATE',
        to: ['private@example.invalid'],
      }),
    }));
    expect(await getEmailDeliveryStatus(id)).toEqual({
      success: true,
      event: 'delivered',
    });
    expect(global.fetch.mock.calls[0][0]).toBe(
      `https://api.resend.com/emails/${id}`,
    );
  });
  test('invalid provider IDs cannot change the API destination', async () => {
    global.fetch = jest.fn();
    expect(await getEmailDeliveryStatus('../other')).toEqual({
      success: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('provider failures and unknown event types fail safely', async () => {
    global.fetch=jest.fn(async()=>({ok:true,json:async()=>({id:'wrong-email',last_event:'delivered'})}));
    expect(await getEmailDeliveryStatus(id)).toEqual({success:false});
    global.fetch = jest.fn(async () => ({ ok: false }));
    expect(await getEmailDeliveryStatus(id)).toEqual({ success: false });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id, last_event: '<script>' }),
    }));
    expect(await getEmailDeliveryStatus(id)).toEqual({
      success: true,
      event: null,
    });
  });
});
