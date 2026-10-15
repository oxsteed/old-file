import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listOrders } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import OrderPreview from '../../components/logistics/OrderPreview';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

const ORDER_STATUSES = [
  'draft', 'quoted', 'approved', 'awaiting_deposit', 'deposit_collected',
  'placed_with_supplier', 'in_production', 'production_complete', 'ready_for_pickup',
  'in_transit', 'customs_review', 'cleared', 'warehoused', 'allocated',
  'fulfilled', 'closed', 'cancelled',
];

/**
 * OrdersPage - purchase order list (Phase 2 refactor).
 *
 * Shared LogisticsLayout for navigation; theme-token status pills;
 * filter options use the shared logistics.status.* labels. Rows are
 * keyboard-operable (Enter opens the order).
 */
export default function OrdersPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const navigate = useNavigate();
  const [orders, setOrders]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [status, setStatus]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [page, setPage]       = useState(1);
  const [previewId, setPreviewId] = useState(null);
  const limit = 20;

  const load = () => {
    setLoading(true);
    setError(false);
    listOrders({ status: status || undefined, limit, offset: (page - 1) * limit })
      .then((r) => { setOrders(r.orders || []); setTotal(r.total || 0); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status, page]);

  const totalPages = Math.ceil(total / limit);

  const openOrder = (id) => navigate(`/logistics/orders/${id}`);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.orders.title', 'Purchase Orders')}
        subtitle={tx('logistics.orders.subtitle', 'Track your orders from placement through customs, warehousing, and delivery.')}
      >
        <div className="lx-workspaces">
          <div className="lx-filter-bar">
            <label className="lx-visually-hidden" htmlFor="lx-orders-status">
              {tx('logistics.orders.statusFilter', 'Filter by status')}
            </label>
            <select
              id="lx-orders-status"
              className="lx-select"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            >
              <option value="">{tx('logistics.orders.allStatuses', 'All Statuses')}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tx(`logistics.status.${s}`, s.replace(/_/g, ' '))}
                </option>
              ))}
            </select>
          </div>

          {loading && (
            <div className="lx-loading" role="status" aria-live="polite">
              <span className="lx-spinner" aria-hidden="true" />
              {tx('logistics.orders.loading', 'Loading…')}
            </div>
          )}

          {!loading && error && (
            <div className="lx-data-error-banner" role="alert">
              <div>
                <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                <p>{tx('logistics.orders.error', "We couldn't load your orders right now. Please try again.")}</p>
              </div>
              <button type="button" className="lx-btn-secondary" onClick={load}>
                {tx('logistics.workspace.dataError.retry', 'Try again')}
              </button>
            </div>
          )}

          {!loading && !error && orders.length === 0 && (
            <div className="lx-empty">
              <div className="lx-empty-icon" aria-hidden="true">📦</div>
              <p>{tx('logistics.orders.empty', 'No orders found.')}</p>
            </div>
          )}

          {!loading && !error && orders.length > 0 && (
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th>{tx('logistics.orders.headers.reference', 'Reference')}</th>
                    <th>{tx('logistics.orders.headers.product', 'Product')}</th>
                    <th>{tx('logistics.orders.headers.lane', 'Lane')}</th>
                    <th>{tx('logistics.orders.headers.qty', 'Qty')}</th>
                    <th>{tx('logistics.orders.headers.landedCost', 'Landed Cost')}</th>
                    <th>{tx('logistics.orders.headers.status', 'Status')}</th>
                    <th>{tx('logistics.orders.headers.expected', 'Expected')}</th>
                    <th><span className="lx-visually-hidden">{tx('logistics.tables.actions', 'Actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr
                      key={o.id}
                      tabIndex={0}
                      role="link"
                      aria-label={tx('logistics.orders.openOrder', 'Open order {{ref}}', { ref: o.reference })}
                      onClick={() => openOrder(o.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openOrder(o.id);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td><span className="lx-code">{o.reference}</span></td>
                      <td className="lx-t-semibold">{o.product_title || '—'}</td>
                      <td className="lx-t-small lx-t-faint">
                        {o.origin_country} → {o.destination_country}
                      </td>
                      <td>{o.qty_ordered}</td>
                      <td className="lx-t-bold lx-t-small" style={{ color: 'var(--color-primary)' }}>
                        ${parseFloat(o.total_landed_usd || 0).toLocaleString()}
                      </td>
                      <td><LogisticsStatusPill status={o.status} /></td>
                      <td className="lx-t-small">
                        {o.expected_arrival_date ? new Date(o.expected_arrival_date).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="lx-action-ghost"
                          onClick={(e) => { e.stopPropagation(); setPreviewId(o.id); }}
                        >
                          {t('logistics.tables.preview')}
                        </button>
                        <span className="lx-link" aria-hidden="true"> →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && totalPages > 1 && (
            <nav className="lx-pagination" aria-label={tx('logistics.orders.pagination', 'Orders pages')}>
              <button type="button" className="lx-btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← {tx('logistics.hub.prevPage', 'Previous')}
              </button>
              <span className="lx-pagination-indicator" role="status">
                {tx('logistics.hub.pageOf', 'Page {{page}} of {{pages}}', { page, pages: totalPages })}
              </span>
              <button type="button" className="lx-btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {tx('logistics.hub.nextPage', 'Next')} →
              </button>
            </nav>
          )}

          <p className="lx-t-small lx-t-faint lx-mt-6">
            <Link to="/logistics/buyer" className="lx-link">← {tx('logistics.orders.backToBuyer', 'Back to Buyer workspace')}</Link>
          </p>
        </div>
      </LogisticsLayout>
      <OrderPreview
        id={previewId}
        open={previewId !== null}
        onClose={() => setPreviewId(null)}
      />
    </PageShell>
  );
}
