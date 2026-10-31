'use strict';

// Bundle G (scale & robustness): ADM-225, ADM-110, ADM-025, ADM-152.

const { mockQuery, resetMocks } = require('./setup');

const businessModeration = require('../controllers/businessModerationController');
const disputeAdmin = require('../controllers/disputeAdminController');
const superAdmin = require('../controllers/superAdminController');
const adminConsulting = require('../controllers/adminConsultingController');
const { csvCell, csvRow } = require('../utils/csv');

const res = () => {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  r.send = jest.fn(() => r);
  r.set = jest.fn(() => r);
  return r;
};

beforeEach(() => resetMocks());

// ─── ADM-225: uncapped ?limit= is clamped server-side ────────────────────────

describe('ADM-225: business moderation list endpoints clamp limit to 100', () => {
  function routeList(sqlMarker, rowPayload) {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes(sqlMarker)) return { rows: rowPayload };
      if (/COUNT/i.test(sql)) return { rows: [{ count: '1', total: 1 }] };
      return { rows: [] };
    });
  }

  test('listBusinesses clamps ?limit=1000000 to 100', async () => {
    routeList('FROM businesses b', [{ id: 'b1' }]);
    const r = res();
    await businessModeration.listBusinesses({ query: { limit: '1000000' } }, r);
    const listCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM businesses b'));
    expect(listCall).toBeTruthy();
    const [, params] = listCall;
    const limitParam = params[params.length - 2];
    expect(limitParam).toBe(100);
    expect(r.json).toHaveBeenCalled();
  });

  test('listToolRentals clamps ?limit=1000000 to 100', async () => {
    routeList('tool_rentals', [{ id: 't1' }]);
    const r = res();
    await businessModeration.listToolRentals({ query: { limit: '1000000' } }, r);
    const listCall = mockQuery.mock.calls.find(([sql]) => sql.includes('tool_rentals'));
    expect(listCall).toBeTruthy();
    const [, params] = listCall;
    expect(params[params.length - 2]).toBe(100);
  });

  test('listPlannedNeeds clamps ?limit=1000000 to 100', async () => {
    routeList('planned_needs', [{ id: 'n1' }]);
    const r = res();
    await businessModeration.listPlannedNeeds({ query: { limit: '1000000' } }, r);
    const listCall = mockQuery.mock.calls.find(([sql]) => sql.includes('planned_needs'));
    expect(listCall).toBeTruthy();
    const [, params] = listCall;
    expect(params[params.length - 2]).toBe(100);
  });

  test('garbage limit values fall back to the default instead of NaN', async () => {
    routeList('FROM businesses b', [{ id: 'b1' }]);
    const r = res();
    await businessModeration.listBusinesses({ query: { limit: 'not-a-number' } }, r);
    const listCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM businesses b'));
    const [, params] = listCall;
    expect(params[params.length - 2]).toBe(25);
  });
});

// ─── ADM-110: 360 views filter server-side ────────────────────────────────────

describe('ADM-110: server-side per-user filters for 360-degree views', () => {
  test('getAllDisputes accepts user_id and filters parties in SQL', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/information_schema/.test(sql)) return { rows: [{}] };
      if (/FROM disputes d/.test(sql)) return { rows: [{ id: 'd1' }] };
      return { rows: [{ count: '1' }] };
    });
    const r = res();
    await disputeAdmin.getAllDisputes({ query: { status: 'open', user_id: 'user-1', limit: '100' } }, r);
    const listCall = mockQuery.mock.calls.find(([sql]) => /FROM disputes d/.test(sql) && /LIMIT/.test(sql));
    expect(listCall).toBeTruthy();
    const [sql, params] = listCall;
    expect(sql).toMatch(/d\.opened_by = \$4/);
    expect(params).toContain('user-1');
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ disputes: [{ id: 'd1' }] }));
  });

  test('getAuditLog accepts target_id and filters in SQL', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/information_schema/.test(sql)) return { rows: [{}] };
      if (/admin_audit_log/.test(sql)) return { rows: [{ id: 1, target_id: 'user-1' }] };
      return { rows: [] };
    });
    const r = res();
    await superAdmin.getAuditLog({ query: { target_type: 'user', target_id: 'user-1', limit: '100' } }, r);
    const auditCall = mockQuery.mock.calls.find(([sql]) => /FROM admin_audit_log/.test(sql));
    expect(auditCall).toBeTruthy();
    const [sql, params] = auditCall;
    expect(sql).toMatch(/a\.target_id = \$/);
    expect(params).toContain('user-1');
  });

  test('getAuditLog routes a numeric target_id to target_bigint', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/information_schema/.test(sql)) return { rows: [{}] };
      if (/admin_audit_log/.test(sql)) return { rows: [{ id: 1, target_bigint: '123' }] };
      return { rows: [] };
    });
    const r = res();
    await superAdmin.getAuditLog({ query: { target_type: 'affiliate_payout', target_id: '123', limit: '100' } }, r);
    const auditCall = mockQuery.mock.calls.find(([sql]) => /FROM admin_audit_log/.test(sql));
    expect(auditCall).toBeTruthy();
    const [sql, params] = auditCall;
    expect(sql).toMatch(/a\.target_bigint = \$/);
    expect(sql).not.toMatch(/a\.target_id = \$/);
    expect(params).toContain('123');
  });

  test('getPayouts accepts payee_id and filters in SQL', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/information_schema/.test(sql)) return { rows: [{}] };
      if (/FROM payments p/.test(sql)) return { rows: [{ id: 'p1' }] };
      return { rows: [{ pending: 0, processing: 0, completed: 0, failed: 0, totalPaid: 0 }] };
    });
    const r = res();
    await superAdmin.getPayouts({ query: { payee_id: 'user-9', limit: '100' } }, r);
    const payoutCall = mockQuery.mock.calls.find(([sql]) => /FROM payments p/.test(sql) && /LIMIT/.test(sql));
    expect(payoutCall).toBeTruthy();
    const [sql, params] = payoutCall;
    expect(sql).toMatch(/p\.payee_id = \$3/);
    expect(params).toContain('user-9');
  });
});

// ─── ADM-025: template expiry job ─────────────────────────────────────────────

describe('ADM-025: template expiry job uses user_id and survives bad rows', () => {
  const job = require('../jobs/templateExpiryJob');

  test('expired businesses revert via user_id and one bad row does not abort the run', async () => {
    const expiredRows = [
      { id: 1, user_id: 'u-bad', template_slug: 'pro' },
      { id: 2, user_id: 'u-good', template_slug: 'pro' },
    ];
    let bizUpdates = 0;
    mockQuery.mockImplementation(async (sql, params) => {
      if (/UPDATE template_access/.test(sql)) return { rows: expiredRows };
      if (/FROM template_access/.test(sql)) return { rows: [] }; // no covering access
      if (/UPDATE businesses/.test(sql)) {
        expect(sql).toMatch(/WHERE user_id = \$1/);
        expect(sql).not.toMatch(/owner_id/);
        bizUpdates += 1;
        if (params[0] === 'u-bad') throw new Error('boom');
        return { rowCount: 1 };
      }
      if (/UPDATE helper_profiles/.test(sql)) return { rowCount: 0 };
      return { rows: [] };
    });

    const result = await job.runTemplateExpiryJob();
    expect(result.expired).toBe(2);
    expect(result.reverted).toBe(1); // u-good still processed after u-bad failed
    expect(result.failed).toBe(1);
    expect(bizUpdates).toBe(2);
  });
});

// ─── ADM-152: CSV formula injection ───────────────────────────────────────────

describe('ADM-152: CSV cell sanitization', () => {
  test('dangerous leading characters are neutralized with a single quote', () => {
    expect(csvCell('=cmd|\'/c calc\'!A0')).toBe("'=cmd|'/c calc'!A0");
    expect(csvCell('+1+2')).toBe("'+1+2");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(1+1)')).toBe("'@SUM(1+1)");
  });

  test('ordinary values pass through untouched', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell('5000')).toBe('5000');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  test('quotes are doubled and quoting is applied only when needed', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  test('downloadInvoice neutralizes formula prefixes in admin-supplied fields', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'inv-1',
        invoice_number: 'CONS-9',
        amount_cents: 5000,
        issued_date: '2026-10-01',
        due_date: '2026-10-31',
        status: 'issued',
        package_name: 'Growth',
        first_name: '=2+5',
        last_name: 'cmd',
        email: 'client@example.com',
        notes: '=HYPERLINK("https://evil.example","click")',
        created_at: '2026-10-01T00:00:00.000Z',
      }],
    });
    const r = res();
    await adminConsulting.downloadInvoice({ params: { invoiceId: 'inv-1' } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    const csv = r.send.mock.calls[0][0];
    expect(csv).toContain("'=2+5");
    expect(csv).toContain("'=HYPERLINK");
    // No raw unneutralized formula cell may start a field: a leading
    // =, +, -, @ is only acceptable behind the neutralizing quote.
    const cells = csv.split('\n')[1].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    for (const cell of cells) {
      expect(cell).not.toMatch(/^"?[=+\-@]/);
    }
  });
});
