'use strict';

/**
 * M2 — Treasury workspace: entities, chart of accounts, accounting periods,
 * double-entry journal, period close, and tax export scaffolding.
 *
 * Money fails closed everywhere:
 *   - posting to a closed period is rejected (409)
 *   - currency mismatch between entry and accounts is rejected (400)
 *   - unbalanced / invalid input is rejected (400)
 *   - the journal insert runs inside a DB transaction
 */

const { mockQuery, resetMocks } = require('./setup');

const controller = require('../controllers/treasuryController');

beforeEach(() => {
  resetMocks();
});

function makeReq({ body = {}, query = {}, params = {}, user = { id: 'admin-1' } } = {}) {
  return { body, query, params, user };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

// Routes pool.query text to canned rows; falls back to { rows: [] }.
function routeQueries(routes) {
  mockQuery.mockImplementation(async (text) => {
    for (const [fragment, response] of routes) {
      if (text.includes(fragment)) {
        return typeof response === 'function' ? response(text) : response;
      }
    }
    return { rows: [], rowCount: 0 };
  });
}

const ENTITY = {
  id: 1, code: 'OXS-US', name: 'OxSteed Inc', country_code: 'US',
  base_currency: 'USD', is_active: true,
};

const OPEN_PERIOD = {
  id: 10, entity_id: 1, period_start: '2026-01-01', period_end: '2026-01-31',
  status: 'open', closed_at: null, closed_by: null,
};

const CLOSED_PERIOD = { ...OPEN_PERIOD, status: 'closed', closed_at: '2026-02-01T00:00:00Z', closed_by: 'admin-1' };

const USD_ACCOUNTS = [
  { id: 100, entity_id: 1, code: '1000', name: 'Operating cash', currency: 'USD', account_type: 'asset' },
  { id: 400, entity_id: 1, code: '4000', name: 'Service revenue', currency: 'USD', account_type: 'revenue' },
];

function journalBody(overrides = {}) {
  return {
    entity_id: 1,
    period_id: 10,
    debit_account_id: 100,
    credit_account_id: 400,
    amount_minor: 2500,
    currency: 'USD',
    description: 'January consulting fees',
    ...overrides,
  };
}

describe('M2 treasury entities', () => {
  test('listEntities returns rows', async () => {
    routeQueries([['FROM treasury_entities', { rows: [ENTITY], rowCount: 1 }]]);
    const res = makeRes();
    await controller.listEntities(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ entities: [ENTITY] });
  });

  test('createEntity validates code and currency casing', async () => {
    const res = makeRes();
    await controller.createEntity(makeReq({ body: { code: 'oxs-us', name: 'X', base_currency: 'USD' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createEntity rejects a 4-letter currency', async () => {
    const res = makeRes();
    await controller.createEntity(makeReq({ body: { code: 'OXS-US', name: 'X', base_currency: 'USDD' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createEntity inserts and returns 201', async () => {
    routeQueries([['INSERT INTO treasury_entities', { rows: [ENTITY], rowCount: 1 }]]);
    const res = makeRes();
    await controller.createEntity(
      makeReq({ body: { code: 'OXS-US', name: 'OxSteed Inc', country_code: 'US', base_currency: 'USD' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].entity.code).toBe('OXS-US');
  });
});

describe('M2 treasury accounts', () => {
  test('listAccounts requires entity_id', async () => {
    const res = makeRes();
    await controller.listAccounts(makeReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createAccount rejects unknown account_type', async () => {
    const res = makeRes();
    await controller.createAccount(
      makeReq({ body: { entity_id: 1, code: '1000', name: 'Cash', currency: 'USD', account_type: 'whatever' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createAccount rejects an inactive entity', async () => {
    routeQueries([
      ['FROM treasury_entities', { rows: [{ ...ENTITY, is_active: false }], rowCount: 1 }],
    ]);
    const res = makeRes();
    await controller.createAccount(
      makeReq({ body: { entity_id: 1, code: '1000', name: 'Cash', currency: 'USD', account_type: 'asset' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO treasury_accounts'), expect.anything());
  });
});

describe('M2 journal posting (fails closed)', () => {
  function journalScenario({ period = OPEN_PERIOD, accounts = USD_ACCOUNTS } = {}) {
    routeQueries([
      ['BEGIN', { rows: [], rowCount: 0 }],
      ['COMMIT', { rows: [], rowCount: 0 }],
      ['ROLLBACK', { rows: [], rowCount: 0 }],
      ['FROM treasury_periods', { rows: [period], rowCount: 1 }],
      ['FROM treasury_accounts', { rows: accounts, rowCount: accounts.length }],
      ['INSERT INTO treasury_journal_entries', (text) => ({
        rows: [{ id: 9001, created_at: new Date().toISOString() }],
        rowCount: 1,
      })],
    ]);
  }

  test('REPRO: posting to a closed period fails with 409 and no insert', async () => {
    journalScenario({ period: CLOSED_PERIOD });
    const res = makeRes();
    await controller.postJournal(makeReq({ body: journalBody() }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO treasury_journal_entries'));
    expect(inserts).toHaveLength(0);
    const rollbacks = mockQuery.mock.calls.filter(([sql]) => sql === 'ROLLBACK');
    expect(rollbacks).toHaveLength(1);
  });

  test('REPRO: currency mismatch between entry and accounts fails with 400', async () => {
    journalScenario();
    const res = makeRes();
    await controller.postJournal(makeReq({ body: journalBody({ currency: 'EUR' }) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO treasury_journal_entries'));
    expect(inserts).toHaveLength(0);
  });

  test('REPRO: same debit and credit account fails with 400', async () => {
    journalScenario();
    const res = makeRes();
    await controller.postJournal(makeReq({ body: journalBody({ credit_account_id: 100 }) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO treasury_journal_entries'));
    expect(inserts).toHaveLength(0);
  });

  test('REPRO: non-positive amount fails with 400', async () => {
    journalScenario();
    const res = makeRes();
    await controller.postJournal(makeReq({ body: journalBody({ amount_minor: 0 }) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO treasury_journal_entries'), expect.anything());
  });

  test('REPRO: account from another entity fails with 400', async () => {
    journalScenario({
      accounts: [
        { ...USD_ACCOUNTS[0] },
        { ...USD_ACCOUNTS[1], entity_id: 2 }, // credit account belongs elsewhere
      ],
    });
    const res = makeRes();
    await controller.postJournal(makeReq({ body: journalBody() }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO treasury_journal_entries'));
    expect(inserts).toHaveLength(0);
  });

  test('valid post commits inside a transaction and returns 201', async () => {
    journalScenario();
    const res = makeRes();
    await controller.postJournal(makeReq({ body: journalBody() }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    const statements = mockQuery.mock.calls.map(([sql]) => sql);
    const beginIdx = statements.findIndex((s) => s === 'BEGIN');
    const insertIdx = statements.findIndex((s) => s.includes('INSERT INTO treasury_journal_entries'));
    const commitIdx = statements.findIndex((s) => s === 'COMMIT');
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(beginIdx);
    expect(commitIdx).toBeGreaterThan(insertIdx);
  });
});

describe('M2 periods and close', () => {
  test('createPeriod rejects end before start', async () => {
    const res = makeRes();
    await controller.createPeriod(
      makeReq({ body: { entity_id: 1, period_start: '2026-02-01', period_end: '2026-01-31' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('closePeriod returns 409 when already closed', async () => {
    routeQueries([['FROM treasury_periods', { rows: [CLOSED_PERIOD], rowCount: 1 }]]);
    const res = makeRes();
    await controller.closePeriod(makeReq({ params: { id: '10' } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const updates = mockQuery.mock.calls.filter(([sql]) => sql.includes("status = 'closed'"));
    expect(updates).toHaveLength(0);
  });

  test('closePeriod closes an open period and records the closer', async () => {
    routeQueries([
      ['FROM treasury_periods', { rows: [OPEN_PERIOD], rowCount: 1 }],
      ['UPDATE treasury_periods', { rows: [{ ...OPEN_PERIOD, status: 'closed' }], rowCount: 1 }],
    ]);
    const res = makeRes();
    await controller.closePeriod(makeReq({ params: { id: '10' }, user: { id: 'admin-9' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE treasury_periods'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain('admin-9');
  });

  test('periodSummary aggregates per-account debits, credits, balances', async () => {
    routeQueries([
      ['FROM treasury_periods', { rows: [OPEN_PERIOD], rowCount: 1 }],
      ['debit_account_id = a.id', {
        rows: [
          { account_id: 100, code: '1000', name: 'Operating cash', currency: 'USD', debit_total: '2500', credit_total: '0' },
          { account_id: 400, code: '4000', name: 'Service revenue', currency: 'USD', debit_total: '0', credit_total: '2500' },
        ],
        rowCount: 2,
      }],
    ]);
    const res = makeRes();
    await controller.periodSummary(makeReq({ params: { id: '10' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0].balance_minor).toBe(2500);
    expect(body.totals.USD.debits_minor).toBe(2500);
  });
});

describe('M2 tax export scaffolding', () => {
  const rows = [{
    id: 9001, created_at: '2026-01-15T10:00:00Z', description: 'January consulting fees',
    reference: 'INV-1', debit_code: '1000', debit_name: 'Operating cash',
    credit_code: '4000', credit_name: 'Service revenue', amount_minor: 2500, currency: 'USD',
  }];

  test('tax export JSON includes currency breakdowns and totals', async () => {
    routeQueries([
      ['FROM treasury_periods', { rows: [CLOSED_PERIOD], rowCount: 1 }],
      ['FROM treasury_journal_entries', { rows, rowCount: 1 }],
    ]);
    const res = makeRes();
    await controller.taxExport(makeReq({ query: { entity_id: '1', period_id: '10', format: 'json' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.entries).toHaveLength(1);
    expect(body.totals.USD.total_minor).toBe(2500);
  });

  test('tax export CSV escapes commas and quotes', async () => {
    routeQueries([
      ['FROM treasury_periods', { rows: [CLOSED_PERIOD], rowCount: 1 }],
      ['FROM treasury_journal_entries', {
        rows: [{ ...rows[0], description: 'Fees, "January" batch' }],
        rowCount: 1,
      }],
    ]);
    const res = makeRes();
    await controller.taxExport(makeReq({ query: { entity_id: '1', period_id: '10', format: 'csv' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const csv = res.send.mock.calls[0][0];
    expect(csv).toContain('"Fees, ""January"" batch"');
    expect(csv.split('\n')[0]).toContain('id,');
  });

  test('tax export requires entity_id and period_id', async () => {
    const res = makeRes();
    await controller.taxExport(makeReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
