import LogisticsStatusPill from './LogisticsStatusPill';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAllocation } from '../../api/logistics';
import LogisticsModal, { LogisticsModalLoading, LogisticsModalError } from './LogisticsModal';


/**
 * Allocation preview modal. Loads the allocation through the direct
 * GET /logistics/allocations/:id endpoint.
 * "Open full page" navigates to the owning pooled-order (campaign) record
 * at /logistics/campaigns/:id, because there is no dedicated allocation
 * detail route; it falls back to /logistics/distribution when the
 * allocation carries no pooled order.
 */
export default function AllocationPreview({ id, open, onClose, embedded = false }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [allocation, setAllocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getAllocation(id)
      .then((r) => setAllocation(r.data || null))
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

  const Shell = embedded ? Embedded : LogisticsModal;
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={reference || tx('logistics.modal.allocationPreviewTitle', 'Allocation preview')}
      fullPageHref={`/logistics/allocations/${id}`}
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
              <LogisticsStatusPill status={allocation.status} />
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
    </Shell>
  );
}

function Embedded({children}) {return <section className="lx-card">{children}</section>;}
