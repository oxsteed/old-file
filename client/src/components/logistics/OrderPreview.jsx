import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getOrder } from '../../api/logistics';
import LogisticsModal, { LogisticsModalLoading, LogisticsModalError } from './LogisticsModal';

const STATUS_COLOR = {
  draft: '#94a3b8', open: '#22c55e', quoted: '#f59e0b', procurement: '#10b981',
  placed: '#3b82f6', in_transit: '#06b6d4', warehoused: '#0ea5e9', fulfilled: '#15803d',
};

/**
 * Purchase-order preview modal. Fetches /api/logistics/orders/:id and renders
 * a summary; "Open full page" navigates to /logistics/orders/:id where
 * OrderDetailPage renders the complete view.
 */
export default function OrderPreview({ id, open, onClose }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getOrder(id)
      .then((r) => setOrder(r.data || null))
      .catch((err) => setError(err.response?.data?.error || tx('logistics.modal.loadError', "Couldn't load this preview.")))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    if (open) {
      setOrder(null);
      load();
    }
  }, [open, load]);

  const balanceDue = order
    ? Math.max(0, parseFloat(order.final_due_usd || 0) - parseFloat(order.final_paid_usd || 0))
    : 0;

  return (
    <LogisticsModal
      open={open}
      onClose={onClose}
      title={order?.product_title || tx('logistics.modal.orderPreviewTitle', 'Order preview')}
      fullPageHref={id ? `/logistics/orders/${id}` : null}
    >
      {loading && <LogisticsModalLoading />}
      {!loading && error && <LogisticsModalError message={error} onRetry={load} />}
      {!loading && !error && !order && (
        <LogisticsModalError message={tx('logistics.modal.notFound', 'This item could not be found.')} />
      )}
      {!loading && !error && order && (
        <div className="lxm-summary">
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.order.status', 'Status')}</span>
            <span className="lxm-summary-value">
              <span className="lx-status-pill" style={{ background: STATUS_COLOR[order.status] || '#64748b' }}>
                {order.status?.replace(/_/g, ' ')}
              </span>
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.order.supplier', 'Supplier')}</span>
            <span className="lxm-summary-value">{order.supplier_name || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.order.quantity', 'Quantity')}</span>
            <span className="lxm-summary-value">{order.qty_ordered ?? '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.order.total', 'Order total')}</span>
            <span className="lxm-summary-value">
              {order.total_product_usd ? `$${parseFloat(order.total_product_usd).toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.order.balanceDue', 'Balance due')}</span>
            <span className="lxm-summary-value">${balanceDue.toFixed(2)}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.order.expectedArrival', 'Expected arrival')}</span>
            <span className="lxm-summary-value">
              {order.expected_arrival_date ? new Date(order.expected_arrival_date).toLocaleDateString() : '—'}
            </span>
          </div>
        </div>
      )}
    </LogisticsModal>
  );
}
