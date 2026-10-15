import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listAllocations } from '../../api/logistics';
import LogisticsModal, { LogisticsModalLoading, LogisticsModalError } from './LogisticsModal';

const STATUS_COLOR = {
  released: '#22c55e', assigned: '#f59e0b', pending: '#94a3b8',
};

/**
 * Allocation preview modal.
 *
 * NOTE: the logistics API has no single-allocation GET endpoint (server
 * exposes only list + release), and there is no per-allocation detail page.
 * The preview therefore loads the allocation list and finds the row by id.
 * "Open full page" navigates to /logistics/distribution, the customer-facing
 * workspace that lists allocations.
 */
export default function AllocationPreview({ id, open, onClose }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [allocation, setAllocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    listAllocations({ limit: 200 })
      .then((r) => {
        const rows = r.data || [];
        const match = rows.find((row) => String(row.id) === String(id));
        setAllocation(match || null);
      })
      .catch((err) => setError(err.response?.data?.error || tx('logistics.modal.loadError', "Couldn't load this preview.")))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    if (open) {
      setAllocation(null);
      load();
    }
  }, [open, load]);

  const reference = allocation?.reference || (allocation?.id ? `ALC-${allocation.id}` : '');

  return (
    <LogisticsModal
      open={open}
      onClose={onClose}
      title={reference || tx('logistics.modal.allocationPreviewTitle', 'Allocation preview')}
      fullPageHref="/logistics/distribution"
    >
      {loading && <LogisticsModalLoading />}
      {!loading && error && <LogisticsModalError message={error} onRetry={load} />}
      {!loading && !error && !allocation && (
        <LogisticsModalError message={tx('logistics.modal.notFound', 'This item could not be found.')} />
      )}
      {!loading && !error && allocation && (
        <div className="lxm-summary">
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.allocation.status', 'Status')}</span>
            <span className="lxm-summary-value">
              <span className="lx-status-pill" style={{ background: STATUS_COLOR[allocation.status] || '#64748b' }}>
                {allocation.status?.replace(/_/g, ' ')}
              </span>
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.allocation.recipient', 'Recipient')}</span>
            <span className="lxm-summary-value">
              {allocation.recipient_name || allocation.buyer_name || '—'}
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.allocation.warehouse', 'Warehouse')}</span>
            <span className="lxm-summary-value">{allocation.warehouse_name || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.allocation.releaseMethod', 'Release method')}</span>
            <span className="lxm-summary-value">{allocation.release_method?.replace(/_/g, ' ') || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.allocation.quantity', 'Quantity')}</span>
            <span className="lxm-summary-value">{allocation.allocated_qty ?? allocation.qty ?? '—'}</span>
          </div>
        </div>
      )}
    </LogisticsModal>
  );
}
