'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));

const payroll = require('../services/restaurantPayrollService');

describe('restaurant labor policy calculations', () => {
  const policy = {
    overtime_threshold_hours: 40,
    overtime_multiplier_bps: 15000,
    break_after_minutes: 360,
    break_duration_minutes: 30,
  };

  test('prices weekly overtime separately from regular hours', () => {
    const rows = [
      { user_id: 'u1', entry_date: '2026-10-05', hours_worked: 24, breaks: [] },
      { user_id: 'u1', entry_date: '2026-10-06', hours_worked: 20, breaks: [{ started_at: '2026-10-06T12:00:00Z', ended_at: '2026-10-06T12:30:00Z' }] },
      { user_id: 'u1', entry_date: '2026-10-12', hours_worked: 8, breaks: [{ started_at: '2026-10-12T12:00:00Z', ended_at: '2026-10-12T12:30:00Z' }] },
    ];
    const result = payroll.calculatePolicyHours(rows, policy).get('u1');
    expect(result.totalHours).toBe(52);
    expect(result.overtimeHours).toBe(4);
    expect(result.breakExceptions).toBe(1);
  });

  test('does not create overtime or break exceptions below policy thresholds', () => {
    const rows = [
      { user_id: 'u2', entry_date: '2026-10-05', hours_worked: 5, breaks: [] },
      { user_id: 'u2', entry_date: '2026-10-06', hours_worked: 5, breaks: [] },
    ];
    const result = payroll.calculatePolicyHours(rows, policy).get('u2');
    expect(result.totalHours).toBe(10);
    expect(result.overtimeHours).toBe(0);
    expect(result.breakExceptions).toBe(0);
  });
});

