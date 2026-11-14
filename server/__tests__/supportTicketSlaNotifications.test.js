'use strict';

/**
 * supportTicketSlaNotifications.test.js
 *
 * Item 21: a breached ticket must produce a persistent staff notification
 * (in-app row, via the shared notifySupportStaff fan-out) per breach, and
 * an unclaimed ticket must re-escalate on a cadence instead of alerting
 * once and going silent.
 */

jest.mock('../services/socketService', () => ({ broadcastToAdmins: jest.fn() }));
jest.mock('../services/supportNotificationService', () => ({
  resolveSupportStaffIds: jest.fn().mockResolvedValue(['admin-1', 'admin-2']),
  notifySupportStaff: jest.fn().mockResolvedValue({ notified: 2, failed: 0, recipients: 2 }),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(),
}));

const { sweepSupportTicketSla, runSupportTicketSlaJob } = require('../jobs/supportTicketSlaJob');
const { broadcastToAdmins } = require('../services/socketService');
const { notifySupportStaff, resolveSupportStaffIds } = require('../services/supportNotificationService');
const { withFencedJobLock } = require('../jobs/jobLockingService');

beforeEach(() => {
  jest.clearAllMocks();
  resolveSupportStaffIds.mockResolvedValue(['admin-1', 'admin-2']);
  notifySupportStaff.mockResolvedValue({ notified: 2, failed: 0, recipients: 2 });
  withFencedJobLock.mockReset();
});

function stubDb({ first = [], reescalation = [] } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push(String(sql));
    if (/escalated_at IS NULL/.test(sql) && /SELECT/i.test(sql)) return { rows: first };
    if (/SET escalated_at = NOW\(\)/.test(sql)) return { rowCount: 1 };
    if (/escalated_at IS NOT NULL/.test(sql) && /SELECT/i.test(sql)) return { rows: reescalation };
    if (/sla_last_reescalated_at/.test(sql) && /UPDATE/i.test(sql)) return { rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { db: { query }, calls };
}

const FIRST_TICKET = {
  id: 7,
  ticket_number: 'T-7',
  priority: 'normal',
  created_at: new Date(Date.now() - 25 * 3600000).toISOString(),
  sla_due_at: new Date(Date.now() - 3600000).toISOString(),
};

test('sends a persistent staff notification per first-escalation breach', async () => {
  const { db } = stubDb({ first: [FIRST_TICKET] });

  const result = await sweepSupportTicketSla(db);

  expect(result).toEqual(expect.objectContaining({ escalated: 1, reescalated: 0 }));
  expect(notifySupportStaff).toHaveBeenCalledWith(expect.objectContaining({
    type: 'support_sla_breach',
    action_url: '/admin/support',
    data: expect.objectContaining({ supportTicketId: '7', ticketNumber: 'T-7' }),
  }));
  expect(notifySupportStaff.mock.calls[0][0].idempotencyKeyPrefix)
    .toMatch(/^support-ticket-sla:7:/);
  expect(broadcastToAdmins).toHaveBeenCalledTimes(1);
});

test('re-escalates an unclaimed ticket after the cadence and notifies again', async () => {
  const stale = {
    ...FIRST_TICKET,
    id: 8,
    ticket_number: 'T-8',
    priority: 'high',
    escalated_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    metadata: {
      sla_escalated_at: new Date(Date.now() - 5 * 3600000).toISOString(),
      sla_escalation_count: 1,
    },
  };
  const { db, calls } = stubDb({ reescalation: [stale] });

  const result = await sweepSupportTicketSla(db);

  expect(result).toEqual(expect.objectContaining({ escalated: 0, reescalated: 1 }));
  expect(notifySupportStaff).toHaveBeenCalledWith(expect.objectContaining({
    type: 'support_sla_breach',
    data: expect.objectContaining({ supportTicketId: '8' }),
  }));
  expect(calls.some((sql) => /sla_last_reescalated_at/.test(sql) && /INTERVAL '4 hours'/.test(sql))).toBe(true);
  expect(broadcastToAdmins).toHaveBeenCalledTimes(1);
});

test('stamps the round when staff resolution succeeds with nobody to notify', async () => {
  resolveSupportStaffIds.mockResolvedValue([]);
  const stale = {
    ...FIRST_TICKET,
    id: 10,
    ticket_number: 'T-10',
    escalated_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    metadata: { sla_escalated_at: new Date(Date.now() - 5 * 3600000).toISOString() },
  };
  const { db } = stubDb({ reescalation: [stale] });

  const result = await sweepSupportTicketSla(db);

  expect(result).toEqual(expect.objectContaining({ reescalated: 1 }));
  expect(notifySupportStaff).not.toHaveBeenCalled();
});

test('does not stamp the round when staff resolution itself fails', async () => {
  resolveSupportStaffIds.mockRejectedValue(new Error('users table unavailable'));
  const stale = {
    ...FIRST_TICKET,
    id: 11,
    ticket_number: 'T-11',
    escalated_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    metadata: { sla_escalated_at: new Date(Date.now() - 5 * 3600000).toISOString() },
  };
  const { db, calls } = stubDb({ reescalation: [stale] });

  const result = await sweepSupportTicketSla(db);

  expect(result).toEqual(expect.objectContaining({ reescalated: 0 }));
  expect(calls.some((sql) => /UPDATE/i.test(sql) && /sla_last_reescalated_at/.test(sql))).toBe(false);
});

test('runSupportTicketSlaJob runs the sweep under the fenced job lock (item 29)', async () => {
  withFencedJobLock.mockImplementation(async (_name, handler) => handler());
  const { db } = stubDb({ first: [FIRST_TICKET] });

  const result = await runSupportTicketSlaJob(db);

  expect(withFencedJobLock).toHaveBeenCalledWith('support-ticket-sla', expect.any(Function), 300);
  expect(result).toEqual(expect.objectContaining({ escalated: 1, reescalated: 0 }));
});

test('runSupportTicketSlaJob skips the sweep when another instance holds the lock', async () => {
  withFencedJobLock.mockResolvedValue({ skipped: true, lockSkipped: true });
  const { db } = stubDb({ first: [FIRST_TICKET] });

  const result = await runSupportTicketSlaJob(db);

  expect(result).toEqual({ escalated: 0, reescalated: 0, skipped: true });
  expect(db.query).not.toHaveBeenCalled();
});

test('a failed breach notification does not stamp the re-escalation round', async () => {
  notifySupportStaff.mockResolvedValue({ notified: 0, failed: 2, recipients: 2 });
  const stale = {
    ...FIRST_TICKET,
    id: 9,
    ticket_number: 'T-9',
    escalated_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    metadata: { sla_escalated_at: new Date(Date.now() - 5 * 3600000).toISOString() },
  };
  const { db, calls } = stubDb({ reescalation: [stale] });

  const result = await sweepSupportTicketSla(db);

  // Money rule: never mark a round notified on failed delivery. The
  // ticket stays eligible so the next sweep retries the same round.
  expect(result).toEqual(expect.objectContaining({ reescalated: 0 }));
  expect(calls.some((sql) => /UPDATE/i.test(sql) && /sla_last_reescalated_at/.test(sql))).toBe(false);
});
