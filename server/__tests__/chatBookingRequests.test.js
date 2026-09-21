'use strict';

const {
  buildBookingRequestMarker,
  parseBookingRequestMarker,
  stripBookingRequestMarkers,
  canProviderRespond,
  canCustomerRespond,
  toPublicBookingRequestCard,
  buildStatusMessage,
  toChatStatus,
} = require('../services/chatBookingRequests');

describe('chatBookingRequests service', () => {
  test('marker round-trip', () => {
    const marker = buildBookingRequestMarker({
      id: 'br-1',
      status: 'pending',
      date: '2026-09-22',
      start: '09:00',
      end: '10:00',
      serviceName: 'Haircut & Style',
      serviceId: 42,
    });
    expect(marker).toMatch(/\[booking_req:br-1\|pending\|2026-09-22\|09:00\|10:00/);
    expect(marker).toMatch(/svc:42/);
    const parsed = parseBookingRequestMarker(`Please\n${marker}`);
    expect(parsed.id).toBe('br-1');
    expect(parsed.status).toBe('pending');
    expect(parsed.date).toBe('2026-09-22');
    expect(parsed.serviceName).toBe('Haircut & Style');
    expect(parsed.serviceId).toBe('42');
  });

  test('strip markers leaves human text', () => {
    const marker = buildBookingRequestMarker({
      id: 'x',
      date: '2026-09-22',
      start: '09:00',
      end: '10:00',
      serviceName: 'Trim',
    });
    const text = stripBookingRequestMarkers(`${marker}\nBooking requested`);
    expect(text).not.toMatch(/booking_req/);
    expect(text).toMatch(/Booking requested/);
  });

  test('canProviderRespond allows pending and counter_proposed', () => {
    expect(canProviderRespond({ status: 'pending' }).ok).toBe(true);
    expect(canProviderRespond({ status: 'counter_proposed' }).ok).toBe(true);
    expect(canProviderRespond({ status: 'accepted' }).reason).toBe('already_accepted');
    expect(canProviderRespond({ status: 'declined' }).reason).toBe('already_declined');
  });

  test('canCustomerRespond only allows counter_proposed', () => {
    expect(canCustomerRespond({ status: 'counter_proposed' }).ok).toBe(true);
    expect(canCustomerRespond({ status: 'pending' }).reason).toBe('awaiting_provider');
    expect(canCustomerRespond({ status: 'accepted' }).reason).toBe('already_accepted');
    expect(canCustomerRespond({ status: 'declined' }).reason).toBe('already_declined');
    expect(canCustomerRespond({ status: 'expired' }).reason).toBe('expired');
  });

  test('toPublicBookingRequestCard shape', () => {
    const card = toPublicBookingRequestCard({
      id: 'abc',
      status: 'pending',
      service_name: 'Paint',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:30:00',
      helper_id: 'h1',
      conversation_id: 'c1',
    });
    expect(card.id).toBe('abc');
    expect(card.requested_start_time).toBe('09:00');
    expect(card.requested_end_time).toBe('10:30');
    expect(card.can_respond).toBe(true);
    expect(card.can_customer_respond).toBe(false);
    expect(card.marker).toMatch(/\[booking_req:abc\|pending/);
  });

  test('toPublicBookingRequestCard can_customer_respond on counter_proposed', () => {
    const card = toPublicBookingRequestCard({
      id: 'cp1',
      status: 'counter_proposed',
      service_name: 'Trim',
      requested_date: '2026-09-22',
      requested_start_time: '11:00:00',
      requested_end_time: '12:00:00',
    });
    expect(card.can_respond).toBe(true);
    expect(card.can_customer_respond).toBe(true);
    expect(card.marker).toMatch(/\[booking_req:cp1\|counter_proposed/);
  });

  test('buildStatusMessage includes updated marker', () => {
    const msg = buildStatusMessage({
      booking: {
        id: 'b1',
        status: 'accepted',
        service_name: 'Trim',
        requested_date: '2026-09-22',
        requested_start_time: '09:00',
        requested_end_time: '10:00',
      },
      event: 'accepted',
    });
    expect(msg).toMatch(/\[booking_req:b1\|accepted/);
    expect(msg).toMatch(/Booking accepted/i);
  });

  test('toChatStatus normalizes', () => {
    expect(toChatStatus('ACCEPTED')).toBe('accepted');
    expect(toChatStatus('nope')).toBe('pending');
  });
});

describe('inbox schedule create helpers', () => {
  test('inbox schedule create marker', () => {
    const marker = buildBookingRequestMarker({
      id: 'inbox-1',
      status: 'pending',
      date: '2026-09-25',
      start: '14:00',
      end: '15:00',
      serviceName: 'Consult',
    });
    expect(marker).toMatch(/\[booking_req:inbox-1\|pending\|2026-09-25\|14:00\|15:00/);
    const parsed = parseBookingRequestMarker(marker);
    expect(parsed.serviceName).toBe('Consult');
    expect(canProviderRespond({ status: 'pending' }).ok).toBe(true);
  });
});
