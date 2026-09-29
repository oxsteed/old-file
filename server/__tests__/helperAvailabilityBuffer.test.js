'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { getAvailableSlots } = require('../controllers/helperAvailabilityController');

function buildApp() {
  const app = express();
  app.get('/api/helpers/:helperId/available-slots', getAvailableSlots);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, fields: err.fields }));
  return app;
}

beforeEach(() => resetMocks());

describe('helper availability booking buffer', () => {
  test('subtracts helper booking buffer around existing appointments', async () => {
    const helperId = '11111111-1111-4111-8111-111111111111';

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { day_of_week: 1, start_min: 540, end_min: 780 },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ booking_buffer_minutes: 30 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            scheduled_start_time: '2026-06-08T10:00:00',
            scheduled_end_time: '2026-06-08T11:00:00',
          },
        ],
      });

    const res = await request(buildApp())
      .get(`/api/helpers/${helperId}/available-slots?from=2026-06-08&to=2026-06-08`);

    expect(res.status).toBe(200);
    expect(res.body.bookingBufferMinutes).toBe(30);
    expect(res.body.slots).toEqual([
      expect.objectContaining({ date: '2026-06-08', start: '12:00', end: '13:00' }),
    ]);
    expect(res.body.slots).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start: '09:00' }),
        expect.objectContaining({ start: '10:00' }),
        expect.objectContaining({ start: '11:00' }),
      ])
    );
  });
});
