'use strict';

const {
  buildBookingRequestMarker,
  parseBookingRequestMarker,
  stripBookingRequestMarkers,
  canProviderRespond,
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
    expect(card.marker).toMatch(/\[booking_req:abc\|pending/);
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
