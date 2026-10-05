'use strict';

const { getStatement } = require('../services/creditStatementService');
const { renderStatementCsv } = require('../services/creditStatementPdf');
const { renderStatementPdfInWorker } = require('../services/creditStatementExport');
const { withDbBudget } = require('../utils/dbBudgets');
const { AppError } = require('../middleware/errorHandler');

function handler(product, format = 'json', admin = false) {
  return async (req, res, next) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once?.('close', disconnected);
    try {
      res.set('Cache-Control', 'private, no-store');
      res.set('Pragma', 'no-cache');
      res.set('X-Content-Type-Options', 'nosniff');
      const customerId = admin ? req.params.customerId : req.user.id;
      if (admin && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId || '')) {
        throw new AppError('Invalid statement owner', 400, 'statement_invalid_account');
      }
      // Never accept an owner/account id from a customer's body or query.
      const language = ['en', 'es', 'fr', 'ht', 'ar'].includes(req.query.language) ? req.query.language : 'en';
      // Hold the export budget through rendering as well as querying. Set
      // attachment headers only after successful rendering so error JSON
      // cannot masquerade as a PDF/CSV download.
      const { statement, data } = await withDbBudget('exports', async () => {
        const document = await getStatement(customerId, {
          product, restaurantId: req.params.restaurantId,
          from: req.query.from, to: req.query.to, currencyCode: req.query.currencyCode,
        });
        if (controller.signal.aborted) throw new AppError('Statement export cancelled', 499, 'statement_export_cancelled');
        const output = format === 'pdf' ? await renderStatementPdfInWorker(document, { language, signal: controller.signal })
          : format === 'csv' ? renderStatementCsv(document, { language }) : null;
        return { statement: document, data: output };
      });
      if (format === 'json') return res.json({ statement });
      const filename = `${product}-credit-${statement.period.from}-${statement.period.to}.${format}`;
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      if (format === 'pdf') {
        res.type('application/pdf');
        return res.send(data);
      }
      res.type('text/csv; charset=utf-8');
      return res.send(data);
    } catch (err) { if (!controller.signal.aborted) next(err); }
    finally { res.removeListener?.('close', disconnected); }
  };
}
module.exports = { handler };
