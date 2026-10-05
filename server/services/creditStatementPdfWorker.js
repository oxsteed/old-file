'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { renderStatementPdf } = require('./creditStatementPdf');

renderStatementPdf(workerData.statement, { language: workerData.language }).then(buffer => {
  // Transfer an owned ArrayBuffer, not a slice of Node's shared buffer pool.
  const bytes = Uint8Array.from(buffer);
  parentPort.postMessage({ ok: true, bytes }, [bytes.buffer]);
}).catch(error => {
  // Do not send customer content, renderer stack traces or font diagnostics.
  parentPort.postMessage({ ok: false, code: error.code });
});
