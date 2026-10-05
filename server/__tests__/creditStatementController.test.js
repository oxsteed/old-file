'use strict';

jest.mock('../services/creditStatementService', () => ({ getStatement: jest.fn() }));
jest.mock('../services/creditStatementPdf', () => ({ renderStatementCsv: jest.fn() }));
jest.mock('../services/creditStatementExport', () => ({ renderStatementPdfInWorker: jest.fn() }));
jest.mock('../utils/dbBudgets', () => ({ withDbBudget: jest.fn((_name, operation) => operation()) }));
const { getStatement } = require('../services/creditStatementService');
const { renderStatementCsv } = require('../services/creditStatementPdf');
const { renderStatementPdfInWorker: renderStatementPdf } = require('../services/creditStatementExport');
const { withDbBudget } = require('../utils/dbBudgets');
const { handler } = require('../controllers/creditStatementController');

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const statement = { id: 'report', period: { from: '2026-09-01', to: '2026-09-30' }, currencyCode: 'USD' };
let req, res, next;
beforeEach(() => {
  jest.clearAllMocks();
  getStatement.mockResolvedValue(statement); renderStatementPdf.mockResolvedValue(Buffer.from('%PDF-synthetic'));
  renderStatementCsv.mockReturnValue('\ufeffSynthetic CSV');
  req = { user: { id: OWNER }, params: {}, query: { from: statement.period.from, to: statement.period.to, currencyCode: 'USD' }, body: {} };
  res = { set: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), type: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
  next = jest.fn();
});

test('customer report ignores supplied owner/account identifiers', async () => {
  req.params.customerId = OTHER; req.query.customerId = OTHER; req.query.accountId = '88';
  req.body = { customerId: OTHER, accountId: '88' };
  await handler('oxsteed')(req, res, next);
  expect(getStatement).toHaveBeenCalledWith(OWNER, { product: 'oxsteed', from: statement.period.from,
    to: statement.period.to, currencyCode: 'USD', restaurantId: undefined });
  expect(withDbBudget).toHaveBeenCalledWith('exports', expect.any(Function));
  expect(res.json).toHaveBeenCalledWith({ statement }); expect(next).not.toHaveBeenCalled();
});
test('restaurant report uses authenticated customer and route restaurant, not query restaurant', async () => {
  req.params.restaurantId = '41'; req.query.restaurantId = '42';
  await handler('restaurant')(req, res, next);
  expect(getStatement).toHaveBeenCalledWith(OWNER, expect.objectContaining({ product: 'restaurant', restaurantId: '41' }));
});
test('authorized admin handler selects validated path owner', async () => {
  req.params.customerId = OTHER;
  await handler('oxsteed', 'json', true)(req, res, next);
  expect(getStatement).toHaveBeenCalledWith(OTHER, expect.any(Object));
});
test.each(['', 'not-a-uuid', '1 OR 1=1', undefined])('admin handler rejects invalid owner %p before DB lookup', async id => {
  req.params.customerId = id;
  await handler('oxsteed', 'pdf', true)(req, res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'statement_invalid_account' }));
  expect(getStatement).not.toHaveBeenCalled(); expect(res.send).not.toHaveBeenCalled();
});
test.each(['json', 'pdf', 'csv'])('%s reports are private/no-store and cannot be content-sniffed', async format => {
  await handler('oxsteed', format)(req, res, next);
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(res.set).toHaveBeenCalledWith('Pragma', 'no-cache');
  expect(res.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
});
test.each(['en', 'es', 'fr', 'ht', 'ar'])('PDF export forwards supported locale %s and sends binary attachment', async language => {
  req.query.language = language;
  await handler('restaurant', 'pdf')(req, res, next);
  expect(renderStatementPdf).toHaveBeenCalledWith(statement, { language, signal: expect.any(AbortSignal) });
  expect(res.type).toHaveBeenCalledWith('application/pdf');
  expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="restaurant-credit-2026-09-01-2026-09-30.pdf"');
  expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-synthetic'));
});
test.each([undefined, 'de', ['ar'], 'ar\r\nInjected: true'])('invalid PDF locale %p falls back safely to English', async language => {
  req.query.language = language;
  await handler('oxsteed', 'pdf')(req, res, next);
  expect(renderStatementPdf).toHaveBeenCalledWith(statement, { language: 'en', signal: expect.any(AbortSignal) });
});
test('CSV download sends localized export with correctly typed attachment', async () => {
  req.query.language = 'fr';
  await handler('oxsteed', 'csv')(req, res, next);
  expect(renderStatementCsv).toHaveBeenCalledWith(statement, { language: 'fr' });
  expect(res.type).toHaveBeenCalledWith('text/csv; charset=utf-8');
  expect(res.send).toHaveBeenCalledWith('\ufeffSynthetic CSV');
});
test('missing owned account is forwarded without response or renderer access', async () => {
  const error = Object.assign(new Error('not found'), { code: 'statement_account_not_found', status: 404 });
  getStatement.mockRejectedValue(error);
  await handler('oxsteed', 'pdf')(req, res, next);
  expect(next).toHaveBeenCalledWith(error); expect(res.send).not.toHaveBeenCalled();
  expect(renderStatementPdf).not.toHaveBeenCalled();
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(res.set.mock.calls.some(([name]) => name === 'Content-Disposition')).toBe(false);
  expect(res.type).not.toHaveBeenCalled();
});
test('PDF rendering failure is passed to the central error handler, never sent as a successful download', async () => {
  const error = new Error('synthetic rendering failure'); renderStatementPdf.mockRejectedValue(error);
  await handler('oxsteed', 'pdf')(req, res, next);
  expect(next).toHaveBeenCalledWith(error); expect(res.send).not.toHaveBeenCalled();
  expect(res.set.mock.calls.some(([name]) => name === 'Content-Disposition')).toBe(false);
  expect(res.type).not.toHaveBeenCalled();
});
