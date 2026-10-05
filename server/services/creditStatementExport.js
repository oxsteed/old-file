'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { AppError } = require('../middleware/errorHandler');

// Rendering large, multilingual PDFs must not block ordinary API requests.
// The controller also holds the existing exports semaphore through this job.
const TIMEOUT_MS = 60000;
const MAX_PDF_BYTES = 32 * 1024 * 1024;

function renderStatementPdfInWorker(statement, { language = 'en', signal } = {}) {
  if (signal?.aborted) return Promise.reject(new AppError('Statement export cancelled', 499, 'statement_export_cancelled'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'creditStatementPdfWorker.js'), {
      workerData: { statement, language },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    });
    let finished = false;
    const finish = (error, buffer) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // Wait for exit before freeing the export slot, even on cancellation.
      Promise.resolve(worker.terminate()).catch(() => {}).finally(() => error ? reject(error) : resolve(buffer));
    };
    const abort = () => finish(new AppError('Statement export cancelled', 499, 'statement_export_cancelled'));
    const timer = setTimeout(() => finish(new AppError('Statement export timed out; select a shorter period', 503, 'statement_export_timeout')), TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', result => {
      if (!result?.ok) {
        const code = /^statement_[a-z_]+$/.test(result?.code || '') ? result.code : 'statement_export_failed';
        return finish(new AppError('Statement could not be rendered; try CSV or contact support', 422, code));
      }
      if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength > MAX_PDF_BYTES) {
        return finish(new AppError('Statement export is too large; select a shorter period', 409, 'statement_export_too_large'));
      }
      const buffer = Buffer.from(result.bytes);
      if (buffer.subarray(0, 5).toString() !== '%PDF-') return finish(new AppError('Invalid statement export', 500, 'statement_export_failed'));
      finish(null, buffer);
    });
    worker.once('error', () => finish(new AppError('Statement export failed', 503, 'statement_export_failed')));
    worker.once('exit', () => { if (!finished) finish(new AppError('Statement export exited before completion', 503, 'statement_export_failed')); });
    if (signal?.aborted) abort();
  });
}

module.exports = { renderStatementPdfInWorker, TIMEOUT_MS, MAX_PDF_BYTES };
