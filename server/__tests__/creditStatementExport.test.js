'use strict';

jest.mock('node:worker_threads', () => ({ Worker: jest.fn() }));
const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const { renderStatementPdfInWorker, TIMEOUT_MS, MAX_PDF_BYTES } = require('../services/creditStatementExport');
let worker;
beforeEach(() => {
  jest.useFakeTimers();
  Worker.mockReset();
  worker = new EventEmitter();
  worker.terminate = jest.fn().mockResolvedValue(0);
  Worker.mockImplementation(() => worker);
});
afterEach(() => jest.useRealTimers());

test('bounded worker returns a validated PDF and exits before releasing the export slot', async () => {
  const pending = renderStatementPdfInWorker({ id: 'synthetic' }, { language: 'ar' });
  expect(Worker).toHaveBeenCalledWith(expect.stringMatching(/creditStatementPdfWorker\.js$/), expect.objectContaining({
    workerData: { statement: { id: 'synthetic' }, language: 'ar' }, resourceLimits: expect.objectContaining({ maxOldGenerationSizeMb: 256 }),
  }));
  worker.emit('message', { ok: true, bytes: Uint8Array.from(Buffer.from('%PDF-synthetic')) });
  expect(await pending).toEqual(Buffer.from('%PDF-synthetic'));
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
test('cancellation before starting does not allocate a worker', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(renderStatementPdfInWorker({}, { signal: controller.signal })).rejects.toMatchObject({ code: 'statement_export_cancelled' });
  expect(Worker).not.toHaveBeenCalled();
});
test('disconnect cancels rendering and removes its timeout', async () => {
  const controller = new AbortController();
  const pending = renderStatementPdfInWorker({}, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'statement_export_cancelled' });
  expect(worker.terminate).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('hung renderer times out, exits, and ignores subsequent messages', async () => {
  const pending = renderStatementPdfInWorker({});
  jest.advanceTimersByTime(TIMEOUT_MS);
  await expect(pending).rejects.toMatchObject({ code: 'statement_export_timeout', statusCode: 503 });
  worker.emit('message', { ok: true, bytes: Uint8Array.from(Buffer.from('%PDF-late')) });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test.each(['error', 'exit'])('worker %s cannot become a successful attachment', async event => {
  const pending = renderStatementPdfInWorker({});
  worker.emit(event, new Error('private fixture content'));
  await expect(pending).rejects.toMatchObject({ code: 'statement_export_failed', statusCode: 503 });
});
test('renderer error forwards only a safe code, never customer content', async () => {
  const pending = renderStatementPdfInWorker({});
  worker.emit('message', { ok: false, code: 'statement_unsupported_glyph', message: 'private fixture content' });
  await expect(pending).rejects.toMatchObject({ code: 'statement_unsupported_glyph', statusCode: 422 });
});
test.each([{ ok: true, bytes: Uint8Array.from(Buffer.from('not pdf')) }, { ok: true, bytes: 'bad type' },
  { ok: true, bytes: new Uint8Array(MAX_PDF_BYTES + 1) }, { ok: false, code: '<unsafe>' }])('invalid/oversized worker payload fails closed', async payload => {
  const pending = renderStatementPdfInWorker({}); worker.emit('message', payload);
  await expect(pending).rejects.toHaveProperty('code');
});
