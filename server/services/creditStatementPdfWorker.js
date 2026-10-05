'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const SETTLEMENT_PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);

const statement = workerData && workerData.statement;
// Settlement products render through the settlement tagged-PDF renderer;
// scopes never mix because the renderer is chosen by the document's own
// product, which the archive and the issuance pipeline both enforce.
const render = SETTLEMENT_PRODUCTS.has(statement && statement.product)
  ? require('./settlementStatementPdf').renderSettlementStatementPdf
  : require('./creditStatementPdf').renderStatementPdf;

render(statement, { language: workerData.language }).then(buffer => {
  // Transfer an owned ArrayBuffer, not a slice of Node's shared buffer pool.
  const bytes = Uint8Array.from(buffer);
  parentPort.postMessage({ ok: true, bytes }, [bytes.buffer]);
}).catch(error => {
  // Do not send customer content, renderer stack traces or font diagnostics.
  parentPort.postMessage({ ok: false, code: error.code });
});
