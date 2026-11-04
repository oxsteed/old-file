'use strict';
// Cost audit 2026-11-04 item 8: the accounting metadata cache must survive
// a credentials refresh. tokens() builds a fresh credentials object per
// batch, so a cache hung off that object reset every batch; the cache now
// lives per integration, and a second batch with a fresh credentials
// object must not refetch account metadata.
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/restaurantProviderSecrets', () => ({ resolveReferences: jest.fn() }));
const provider = require('../services/restaurantAccountingProvider');

const integration = { id: 4242, provider: 'quickbooks', external_company_id: 'synthetic-company', credential_version: 0 };
const document = {
  id: '00000000-0000-4000-8000-000000000001',
  document_date: '2026-10-01',
  payload: {
    currency: 'USD',
    lines: [
      { account: '1000', debit: '12.00', credit: '0.00', description: 'Cash' },
      { account: '4000', debit: '0.00', credit: '12.00', description: 'Sales' },
    ],
  },
};
const response = (value) => ({ ok: true, text: async () => JSON.stringify(value) });

test('account metadata fetched once across two credentials objects', async () => {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    return response(url.includes('/query?')
      ? { QueryResponse: { Account: [{ Id: url.includes('1000') ? '10' : '40', Active: true }] } }
      : { JournalEntry: { Id: 'journal-1' } });
  });
  try {
    expect(await provider.postDocument(integration, document, { accessToken: 'first' })).toBe('journal-1');
    expect(await provider.postDocument(integration, document, { accessToken: 'second' })).toBe('journal-1');
  } finally {
    delete global.fetch;
  }
  const accountFetches = calls.filter((url) => url.includes('/query?'));
  expect(accountFetches).toHaveLength(2);
  expect(calls.filter((url) => !url.includes('/query?'))).toHaveLength(2);
});
