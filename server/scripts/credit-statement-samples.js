'use strict';

// Deterministic visual-QA fixtures, never queries a database or calls a provider.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { renderStatementPdfInWorker } = require('../services/creditStatementExport');
const destination = path.resolve(__dirname, '../../tmp/pdfs/credit-statement-final-qa');
async function run() {
  await fs.mkdir(destination, { recursive: true });
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    let balance = 25000; let credits = 0; let debits = 0;
    const transactions = Array.from({ length: 24 }, (_, index) => {
      const debit = index % 3 === 1 ? 1850 : index % 3 === 2 ? 25 : 0;
      const credit = debit ? 0 : 2500;
      balance += credit - debit; credits += credit; debits += debit;
      return { id: `SYNTHETIC-${String(index + 1).padStart(5, '0')}`, date: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
        type: debit === 25 ? 'transfer_fee' : debit ? 'purchase' : 'load',
        description: language === 'ar' ? 'معاملة توضيحية - مطعم Café Délice رقم 123' : 'Illustrative activity - Café Délice',
        debitCents: debit, creditCents: credit, balanceAfterCents: balance };
    });
    const statement = { id: `SYNTHETIC-NOT-A-REAL-ACCOUNT-${language}`, kind: 'monthly', product: language === 'ar' ? 'restaurant' : 'oxsteed',
      ownerName: language === 'ar' ? 'حساب توضيحي - ليس حساباً حقيقياً' : 'Illustrative account - not a real account',
      accountLabel: language === 'ar' ? 'مطعم توضيحي' : 'OxSteed Credit', accountReference: `${language === 'ar' ? 'RC' : 'OC'}-••••0042`, currencyCode: 'USD',
      period: { from: '2026-09-01', to: '2026-09-30' }, generatedAt: '2026-10-01T12:00:00Z',
      openingBalanceCents: 25000, closingBalanceCents: balance, totalCreditsCents: credits, totalDebitsCents: debits,
      transactionCount: transactions.length, transactions, holds: [], holdsAsOf: null, totalHeldCents: 0 };
    statement.contentHash = crypto.createHash('sha256').update(JSON.stringify(statement)).digest('hex');
    const pdf = await renderStatementPdfInWorker(statement, { language });
    const output = path.join(destination, `${language}.pdf`);
    await fs.writeFile(output, pdf);
    console.log(output);
  }
}
run().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
