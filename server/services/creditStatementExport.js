'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { AppError } = require('../middleware/errorHandler');
const crypto = require('node:crypto');
const { decimal, languageCopy } = require('./creditStatementPdf');

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

function csvText(value) {
  let text = String(value ?? '').replace(/\u0000/g, '');
  const candidate = text.replace(/^[\s\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]+/u, '');
  if (/^[=+\-@]/.test(candidate) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}

function rowDescriptor(row) {
  return JSON.stringify({ ordinal:Number(row.ordinal),id:String(row.id),transactionId:String(row.transactionId||row.id),
    date:row.date,type:row.type,description:row.description||'',creditCents:String(row.creditCents),
    debitCents:String(row.debitCents),balanceAfterCents:String(row.balanceAfterCents) })+'\n';
}

// Incremental integrity checks are shared by CSV and numbered PDF volumes.
// An incomplete iteration cannot produce a complete manifest.
function createEvidenceAccumulator(header) {
  let count=0,credits=0n,debits=0n,balance=BigInt(header.openingBalanceCents);
  let completed;
  const hash=crypto.createHash('sha256').update(JSON.stringify(header)+'\n');
  return {
    add(row) {
      if(completed)throw new AppError('Frozen export already finalized',409,'statement_integrity_failed');
      const credit=BigInt(row.creditCents),debit=BigInt(row.debitCents);
      if (Number(row.ordinal)!==count+1 || credit<0n || debit<0n || credit+debit===0n || (credit>0n&&debit>0n)) {
        throw new AppError('Frozen export row integrity failed',409,'statement_integrity_failed');
      }
      balance+=credit-debit; credits+=credit; debits+=debit; count+=1;
      if (balance!==BigInt(row.balanceAfterCents)) throw new AppError('Frozen export balance integrity failed',409,'statement_integrity_failed');
      hash.update(rowDescriptor(row));
    },
    finish() {
      if(completed)return completed;
      if (count!==Number(header.transactionCount) || balance!==BigInt(header.closingBalanceCents)
          || credits!==BigInt(header.totalCreditsCents) || debits!==BigInt(header.totalDebitsCents)) {
        throw new AppError('Frozen export is incomplete',409,'statement_integrity_failed');
      }
      completed={rowCount:count,sourceHash:hash.digest('hex'),creditsMinor:String(credits),debitsMinor:String(debits),closingMinor:String(balance)};
      return completed;
    },
  };
}

async function* streamStatementCsv(header, chunks, {language='en',onRow=()=>{}}={}) {
  const {labels:l}=languageCopy(language);
  const text=(...values)=>values.map(csvText).join(',')+'\r\n';
  const money=value=>decimal(value,header.currencyCode);
  yield '\uFEFF'+text(l.title,header.accountLabel)+text(l.period,header.period.from,header.period.to,'UTC')
    +text(l.generated,header.generatedAt)+text(l.currency,header.currencyCode)
    +text(l.opening,money(header.openingBalanceCents))+text(l.credits,money(header.totalCreditsCents))
    +text(l.debits,money(header.totalDebitsCents))+text(l.closing,money(header.closingBalanceCents))
    +text(l.activity,header.transactionCount)+text(l.date,l.activity,l.reference,l.debit,l.credit,l.balance,l.currency);
  for await (const rows of chunks) {
    for (const row of rows) {
      onRow(row);
      // Money is deliberately serialized separately: a legitimate negative
      // balance is numeric, while user-controlled text is neutralized.
      yield [csvText(row.date),csvText(`${l[row.type]||row.type}${row.description?' - '+row.description:''}`),csvText(row.id),
        money(row.debitCents),money(row.creditCents),money(row.balanceAfterCents),csvText(header.currencyCode)].join(',')+'\r\n';
    }
  }
  yield text(l.end);
}

function pdfVolumeDocument(header, rows, {jobId,part,parts,openingMinor}) {
  const credits=rows.reduce((n,r)=>n+BigInt(r.creditCents),0n),debits=rows.reduce((n,r)=>n+BigInt(r.debitCents),0n);
  const number=value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new AppError('Unsafe PDF amount',409,'statement_integrity_failed');return n;};
  const rowFrom=rows[0]?.ordinal||0,rowTo=rows.at(-1)?.ordinal||0;
  // The renderer receives a complete, bounded volume, explicitly marked as a
  // volume. This object never goes through the issued-original JSON endpoint.
  const document={...header,id:jobId,version:1,product:header.product==='restaurant_settlement'?'oxsteed':header.product,
    accountLabel:`${header.accountLabel} [${part}/${parts}; ${rowFrom}-${rowTo}/${header.transactionCount}]`,
    documentContract:'statement-export-volume-v1',volume:{part,parts,rowFrom,rowTo,totalRows:header.transactionCount},
    openingBalanceCents:number(openingMinor),closingBalanceCents:number(BigInt(openingMinor)+credits-debits),
    totalCreditsCents:number(credits),totalDebitsCents:number(debits),transactionCount:rows.length,
    transactions:rows.map(row=>({...row,type:row.type==='credit'?'load':row.type==='debit'?'purchase':row.type,
      debitCents:number(row.debitCents),creditCents:number(row.creditCents),balanceAfterCents:number(row.balanceAfterCents)})),
    holds:[],holdsAsOf:null,totalHeldCents:0};
  document.contentHash=require('./creditStatementService').hashDocument(document);
  return document;
}

module.exports = { renderStatementPdfInWorker, TIMEOUT_MS, MAX_PDF_BYTES,
  csvText,rowDescriptor,createEvidenceAccumulator,streamStatementCsv,pdfVolumeDocument };
