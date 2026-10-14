'use strict';

/**
 * invoices_billing adapter.
 * Source: business_invoices. Overdue → urgent; sent and due within 7 days →
 * high. Draft/paid/cancelled/partial-paid are routine or terminal.
 * Amounts are stored in dollars on the row; converted to integer cents here
 * (never summed across currencies — each item carries its own currency).
 */

const { buildItem, makeTracker } = require('../utils');

const DUE_SOON_WINDOW_MS = 7 * 24 * 3600 * 1000;

function dollarsToCents(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'business_invoices');

  if (!(await ctx.tableExists('business_invoices'))) {
    track.done(true, 'table business_invoices is missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT id, invoice_number, client_name, status, total, amount_paid,
            due_date, issue_date, created_at, updated_at
       FROM business_invoices
      WHERE business_id = $1
        AND status IN ('overdue', 'sent')`,
    [business.id]
  );

  for (const inv of rows) {
    track.touch(inv.updated_at || inv.created_at);
    const dest = {
      type: 'route',
      route: `/business/${business.id}/invoices`,
      params: { invoiceId: String(inv.id) },
    };
    const cents = dollarsToCents(inv.total);
    const base = {
      category: 'invoices_billing',
      sourceType: 'business_invoice',
      sourceId: inv.id,
      business,
      reasonParams: {
        invoiceNumber: inv.invoice_number || '',
        clientName: inv.client_name || '',
      },
      createdAt: inv.created_at,
      amountCents: cents,
      currencyCode: 'USD',
      taskDestination: dest,
    };

    if (inv.status === 'overdue') {
      items.push(buildItem({
        ...base,
        reason: 'attention.reasons.overdueInvoice',
        urgency: 'urgent',
        deadlineAt: inv.due_date || null,
      }, ctx));
      continue;
    }

    const due = inv.due_date ? new Date(inv.due_date) : null;
    if (due && !Number.isNaN(due.getTime()) && (due - ctx.now) < DUE_SOON_WINDOW_MS) {
      items.push(buildItem({
        ...base,
        reason: 'attention.reasons.followupDeadline',
        urgency: 'high',
        deadlineAt: inv.due_date,
      }, ctx));
    }
  }

  track.done(false);
  return { items, freshness };
}

module.exports = { collect };
