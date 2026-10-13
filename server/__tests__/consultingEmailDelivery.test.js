'use strict';

// Review P3-3-F03 / P3-3-F19: consulting emails must route through the branded
// template (HTML + text part) and must not report success when sendEmail
// resolves { success: false }.
const { mockQuery, resetMocks } = require('./setup');
const { sendEmail } = require('../utils/email');
const controller = require('../controllers/adminConsultingController');

function response() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

const sessionRow = {
  id: 7,
  email: 'client@example.com',
  first_name: 'Dana',
  scheduled_at: '2026-11-01T14:00:00Z',
  meeting_url: 'https://meet.example.com/s/7',
};

beforeEach(() => {
  resetMocks();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ success: true, id: 'email-test' });
});

test('sendSessionReminder reports failure when delivery fails', async () => {
  const res = response();
  mockQuery
    .mockResolvedValueOnce({ rows: [sessionRow] }) // SELECT session
    .mockResolvedValueOnce({ rows: [] });          // UPDATE (not reached)
  sendEmail.mockResolvedValue({ success: false, error: 'provider rejected' });

  await controller.sendSessionReminder({ params: { id: '7' } }, res, jest.fn());

  expect(sendEmail).toHaveBeenCalledTimes(1);
  const payload = sendEmail.mock.calls[0][0];
  expect(typeof payload.text).toBe('string');
  expect(payload.text.length).toBeGreaterThan(0);
  expect(payload.html).toContain('OxSteed');
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Failed to send reminder' });
});

test('sendSessionReminder reports success only on confirmed delivery', async () => {
  const res = response();
  mockQuery
    .mockResolvedValueOnce({ rows: [sessionRow] })
    .mockResolvedValueOnce({ rows: [] });

  await controller.sendSessionReminder({ params: { id: '7' } }, res, jest.fn());

  const payload = sendEmail.mock.calls[0][0];
  expect(payload.html).toContain('Join the session');
  expect(payload.text).toContain('https://meet.example.com/s/7');
  expect(res.json).toHaveBeenCalledWith({ message: 'Reminder sent' });
});

test('sendSessionFollowUp reports failure when delivery fails', async () => {
  const res = response();
  mockQuery.mockResolvedValueOnce({ rows: [sessionRow] });
  sendEmail.mockResolvedValue({ success: false, error: 'provider rejected' });

  await controller.sendSessionFollowUp({ params: { id: '7' } }, res, jest.fn());

  const payload = sendEmail.mock.calls[0][0];
  expect(typeof payload.text).toBe('string');
  expect(payload.text.length).toBeGreaterThan(0);
  expect(payload.html).toContain('OxSteed');
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Failed to send follow-up' });
});

test('reminder email treats a throwing provider as failure', async () => {
  const res = response();
  mockQuery.mockResolvedValueOnce({ rows: [sessionRow] });
  sendEmail.mockRejectedValue(new Error('SMTP down'));

  await controller.sendSessionReminder({ params: { id: '7' } }, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Failed to send reminder' });
});
