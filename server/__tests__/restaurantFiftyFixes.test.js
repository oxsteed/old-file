'use strict';

jest.unmock('../utils/transaction');
const {
  mockQuery,
  resetMocks
} = require('./setup');
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn()
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn()
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn()
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn()
}));
const scopeModel = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const locations = require('../services/restaurantLocationAccessService');
const accounting = require('../services/restaurantAccountingService');
const accountingController = require('../controllers/restaurantAccountingController');
const audits = require('../controllers/restaurantAuditsController');
const training = require('../controllers/restaurantTrainingController');
const ops = require('../controllers/restaurantOpsController');
const hq = require('../controllers/restaurantHQController');
const lifecycle = require('../services/restaurantTrainingLifecycle');
const {
  sendNotification
} = require('../services/notificationService');
const v = require('../utils/restaurantReviewValidation');
const id = '00000000-0000-4000-8000-000000000001';
const restaurant = {
  id: 3,
  business_id: 42,
  effective_role: 'owner',
  timezone: 'America/New_York'
};
function req(body = {}, params = {}, query = {}) {
  return {
    params: {
      restaurantId: '3',
      ...params
    },
    body,
    query,
    user: {
      id
    },
    headers: {},
    get: () => 'retry'
  };
}
async function invoke(handler, request = req()) {
  const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    },
    next = jest.fn();
  await handler(request, res, next);
  return {
    res,
    error: next.mock.calls[0]?.[0]
  };
}
beforeEach(() => {
  resetMocks();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  scopeModel.resolveRestaurantAccess.mockResolvedValue({
    ...restaurant
  });
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  locations.getLocationScope.mockResolvedValue({
    mode: 'all',
    location_ids: null
  });
  mockQuery.mockResolvedValue({
    rows: [],
    rowCount: 1
  });
});
const lines = [{
  date: '2026-10-01',
  account: '4000',
  debit: '0.00',
  credit: '10.00',
  currency: 'USD'
}, {
  date: '2026-10-01',
  account: '1000',
  debit: '10.00',
  credit: '0.00',
  currency: 'USD'
}];
const integration = {
  id: 5,
  restaurant_id: 3,
  account_mapping: accounting.DEFAULT_MAPPING
};
function exportInput(extra = {}) {
  return {
    restaurantId: 3,
    provider: 'xero',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    currencyCode: 'USD',
    idempotencyKey: 'retry',
    lines,
    ...extra
  };
}
test('accounting request bodies cannot override the authorized restaurant', async () => {
  const spy = jest.spyOn(accounting, 'upsertIntegration').mockResolvedValue({
    id: 5
  });
  expect((await invoke(accountingController.upsert, req({
    restaurantId: 999,
    provider: 'xero'
  }, {
    provider: 'xero'
  }))).error).toBeUndefined();
  expect(spy.mock.calls[0][1].restaurantId).toBe(3);
});
test.each(['list', 'listExports', 'upsert', 'queueJournal', 'updateExport'])('accounting %s requires all-store access', async name => {
  locations.getLocationScope.mockResolvedValue({
    mode: 'assigned',
    location_ids: [7]
  });
  expect((await invoke(accountingController[name])).error.statusCode).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});
test.each(['3junk', '1e2', true, [], {}, Number.MAX_SAFE_INTEGER + 1])('resource identifiers reject coercion %p', async value => {
  expect(() => v.integer(value, 'id')).toThrow();
  expect((await invoke(accountingController.list, req({}, {
    restaurantId: value
  }))).error).toBeDefined();
  expect((await invoke(audits.listTemplates, req({}, {
    restaurantId: value
  }))).error).toBeDefined();
  expect((await invoke(training.listModules, req({}, {
    restaurantId: value
  }))).error).toBeDefined();
});
test.each(['NaN', 'Infinity', '-1.00', '1.001', '1e3', true, {}, '90071992547409.92'])('journal money rejects %p', value => expect(() => accounting.money(value)).toThrow());
test('journal amounts use exact decimal cents and require a balanced period/currency', () => {
  expect(accounting.money('0.10')).toEqual({
    cents: 10n,
    formatted: '0.10'
  });
  expect(() => accounting.assertJournal(lines, '2026-10-01', '2026-10-31', 'USD')).not.toThrow();
  expect(() => accounting.assertJournal(lines.slice(0, 1), '2026-10-01', '2026-10-31', 'USD')).toThrow(/balance/);
  expect(() => accounting.assertJournal(lines, '2026-10-02', '2026-10-31', 'USD')).toThrow(/period/);
  expect(() => accounting.assertJournal(lines, '2026-10-01', '2026-10-31', 'EUR')).toThrow(/currency/);
});
test('accounting period bounds reject over a year before loading integrations', async () => {
  const client = {
    query: jest.fn()
  };
  await expect(accounting.queueExport(client, exportInput({
    periodFrom: '2025-01-01'
  }))).rejects.toMatchObject({
    code: 'accounting_period_invalid'
  });
  expect(client.query).not.toHaveBeenCalled();
});
test('export retries reject a changed balanced payload', async () => {
  const client = {
    query: jest.fn().mockResolvedValueOnce({
      rows: [integration]
    }).mockResolvedValueOnce({
      rows: [{
        id: 1,
        payload: {
          different: true
        }
      }]
    })
  };
  await expect(accounting.queueExport(client, exportInput())).rejects.toMatchObject({
    code: 'accounting_idempotency_conflict'
  });
});
test('JSONB key order does not cause false retry conflicts', () => expect(accounting.payloadHash({
  a: 1,
  b: [{
    x: 2,
    z: 3
  }]
})).toBe(accounting.payloadHash({
  b: [{
    z: 3,
    x: 2
  }],
  a: 1
})));
test('export status transitions reject skipped states and acknowledge identical posted retries', async () => {
  const client = {
    query: jest.fn().mockResolvedValue({
      rows: [{
        id: 1,
        restaurant_id: 3,
        status: 'pending'
      }]
    })
  };
  await expect(accounting.updateExportStatus(client, {
    restaurantId: 3,
    exportId: 1,
    status: 'posted',
    externalBatchId: 'proof'
  })).rejects.toMatchObject({
    code: 'accounting_export_transition_invalid'
  });
  client.query.mockResolvedValue({
    rows: [{
      id: 1,
      restaurant_id: 3,
      status: 'posted',
      external_batch_id: ' proof '
    }]
  });
  await expect(accounting.updateExportStatus(client, {
    restaurantId: 3,
    exportId: 1,
    status: 'posted',
    externalBatchId: 'proof'
  })).resolves.toMatchObject({
    status: 'posted'
  });
});
test('audit.view alone cannot manage templates', async () => {
  permissions.hasRestaurantPermission.mockImplementation(async (_r, _u, codes) => !codes.includes('audit.manage'));
  expect((await invoke(audits.createTemplate, req({
    name: 'Inspection'
  }))).error.statusCode).toBe(403);
});
test.each([null, {}, [null], [{
  label: ' '
}], Array.from({
  length: 201
}, () => ({
  label: 'Item'
}))])('audit template items reject malformed input %p', items => expect(() => audits._validation.itemsInput(items)).toThrow());
test.each([{
  maxScore: true
}, {
  maxScore: 0
}, {
  maxScore: 1001
}, {
  weight: Infinity
}, {
  weight: 'Infinity'
}, {
  weight: -1
}])('audit scoring policies reject invalid bounds %p', extra => expect(() => audits._validation.itemsInput([{
  label: 'Floor',
  ...extra
}])).toThrow());
test.each([true, 'false', false])('explicit active flags preserve boolean meaning %p', value => expect(v.boolean(value, 'isActive')).toBe(value === 'false' ? false : value));
test('another auditor cannot alter a run using view-only permissions', async () => {
  permissions.hasRestaurantPermission.mockResolvedValue(false);
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('FROM restaurant_audits WHERE') ? [{
      id: 5,
      auditor_id: 'another',
      status: 'in_progress',
      location_id: 7
    }] : []
  }));
  expect((await invoke(audits.scoreItem, req({
    itemId: 1,
    score: 2
  }, {
    auditId: '5'
  }))).error.statusCode).toBe(403);
});
test.each([true, null, -1, '4junk', 6])('audit scores reject invalid values or values above the run maximum %p', async score => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('FROM restaurant_audits WHERE') ? [{
      id: 5,
      auditor_id: id,
      status: 'in_progress',
      snapshot_items: [{
        id: 1,
        max_score: 5
      }]
    }] : []
  }));
  expect((await invoke(audits.scoreItem, req({
    itemId: 1,
    score
  }, {
    auditId: '5'
  }))).error.statusCode).toBe(400);
});
test('audit completion refuses a partial score set', async () => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('FROM restaurant_audits WHERE') ? [{
      id: 5,
      auditor_id: id,
      status: 'in_progress',
      snapshot_items: [{
        id: 1
      }, {
        id: 2
      }]
    }] : []
  }));
  expect((await invoke(audits.completeAudit, req({}, {
    auditId: '5'
  }))).error.code).toBe('audit_incomplete');
});
test('findings reject items that belong to a different template', async () => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('FROM restaurant_audits WHERE') ? [{
      id: 5,
      auditor_id: id,
      status: 'in_progress',
      snapshot_items: [{
        id: 1
      }]
    }] : []
  }));
  expect((await invoke(audits.addFinding, req({
    itemId: 999,
    note: 'Unsafe'
  }, {
    auditId: '5'
  }))).error.code).toBe('item_not_found');
});
test.each(['-1', '1junk', '0', true])('audit pagination rejects invalid limits %p', limit => expect(() => audits._validation.page({
  limit
})).toThrow());
test.each([true, 101, -1, 'five'])('training pass-score updates reject %p', async passScorePct => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('SELECT * FROM restaurant_training_modules') ? [{
      id: 2
    }] : []
  }));
  expect((await invoke(training.updateModule, req({
    passScorePct
  }, {
    moduleId: '2'
  }))).error.statusCode).toBe(400);
});
test('training policies reject boolean and null attempt budgets while allowing cleared validity', () => {
  const n = training._validation.parseBoundedInt;
  for (const value of [true, null]) expect(() => n(value, {
    min: 1,
    max: 20,
    label: 'attempts'
  })).toThrow();
  expect(n(null, {
    min: 1,
    max: 3650,
    label: 'validity',
    allowNull: true
  })).toBeNull();
});
test.each([{}, null, [null], [{
  question: 'Q',
  options: ['a', 'b'],
  correct_index: 2
}], [{
  question: 'Q',
  options: ['a', ' '],
  correct_index: 1
}], [{
  question: 'Q',
  options: [' a ', 'a'],
  correct_index: 0
}]])('training quizzes reject malformed or ambiguous questions %p', questions => expect(() => training._validation.normalizeQuestions(questions)).toThrow());
test('auto-assignment string false stays false', () => expect(training._validation.validateRuleBody({
  onHire: 'false'
}).onHire).toBe(false));
test.each(['2026-02-30T12:00:00Z', 'tomorrow', '2026-10-21', true])('due timestamps reject invalid or timezone-free values %p', value => expect(() => v.timestamp(value, 'dueAt')).toThrow());
test('checklist creation uses the real transaction wrapper with a pool', async () => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('INSERT INTO restaurant_checklists') ? [{
      id: 1
    }] : [],
    rowCount: 1
  }));
  expect((await invoke(ops.createChecklist, req({
    name: 'Opening'
  }))).error).toBeUndefined();
  const sql = mockQuery.mock.calls.map(([s]) => s);
  expect(sql).toContain('BEGIN');
  expect(sql).toContain('COMMIT');
});
test('failed certificate notifications do not acknowledge the expiry alert', async () => {
  sendNotification.mockResolvedValue({
    success: false
  });
  const db = {
    query: jest.fn().mockResolvedValueOnce({
      rows: [{
        id: 7,
        business_id: 42,
        owner_user_id: id,
        expires_on: '2026-10-23',
        title: 'Certificate'
      }]
    }).mockResolvedValueOnce({
      rows: [{
        user_id: id
      }]
    })
  };
  expect(await lifecycle.sendCertificateExpiryAlerts(db)).toBe(0);
  expect(db.query).toHaveBeenCalledTimes(2);
});
test.each([{
  from: '2026-02-30',
  to: '2026-03-01'
}, {
  from: '2024-01-01',
  to: '2026-10-21'
}])('HQ ranges reject impossible or unbounded dates %p', query => expect(() => hq._dateRange({
  query
}, restaurant)).toThrow());
test('HQ ranges include a single local day and use next-day exclusive bounds', () => expect(hq._dateRange({
  query: {
    from: '2026-03-08',
    to: '2026-03-08'
  }
}, restaurant)).toEqual({
  from: '2026-03-08',
  to: '2026-03-09',
  timezone: 'America/New_York'
}));
test('accounting queue acknowledgement rolls back when its required audit fails', async () => {
  const reports = require('../controllers/restaurantReportsController');
  jest.spyOn(reports._accountingTest, 'loadSalesJournalRows').mockResolvedValue({
    rows: [],
    fromDate: '2026-10-01',
    toDate: '2026-10-31'
  });
  jest.spyOn(accounting, 'queueExport').mockResolvedValue({
    export: {
      id: 1
    },
    replayed: false
  });
  mockQuery.mockImplementation(async sql => {
    if (sql.includes('FROM restaurant_locations l JOIN food_restaurants')) {
      return { rows: [{ business_date: '2026-11-01' }] };
    }
    if (sql.includes('INSERT INTO business_audit_log')) throw new Error('audit unavailable');
    return {
      rows: []
    };
  });
  expect((await invoke(accountingController.queueJournal, req({
    currency: 'USD'
  }, {
    provider: 'xero'
  }))).error.message).toBe('audit unavailable');
  expect(mockQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
});
