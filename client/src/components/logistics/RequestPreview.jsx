import LogisticsStatusPill from './LogisticsStatusPill';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSourcingRequest } from '../../api/logistics';
import LogisticsModal, { LogisticsModalLoading, LogisticsModalError } from './LogisticsModal';


/**
 * Sourcing-request preview modal. Fetches /api/logistics/requests/:id and
 * renders a summary; "Open full page" navigates to /logistics/requests/:id
 * where RequestDetailPage renders the complete view.
 */
export default function RequestPreview({ id, open, onClose }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getSourcingRequest(id)
      .then((r) => setRequest(r.data || null))
      .catch((err) => setError(err.response?.data?.error || tx('logistics.modal.loadError', "Couldn't load this preview.")))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    if (open) {
      setRequest(null);
      load();
    }
  }, [open, load]);

  return (
    <LogisticsModal
      open={open}
      onClose={onClose}
      title={request?.title || tx('logistics.modal.requestPreviewTitle', 'Request preview')}
      fullPageHref={id ? `/logistics/requests/${id}` : null}
    >
      {loading && <LogisticsModalLoading />}
      {!loading && error && <LogisticsModalError message={error} onRetry={load} />}
      {!loading && !error && !request && (
        <LogisticsModalError message={tx('logistics.modal.notFound', 'This item could not be found.')} />
      )}
      {!loading && !error && request && (
        <div className="lxm-summary">
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.request.status', 'Status')}</span>
            <span className="lxm-summary-value">
              <LogisticsStatusPill status={request.status} />
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.request.category', 'Category')}</span>
            <span className="lxm-summary-value">{request.category || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.request.targetQuantity', 'Target quantity')}</span>
            <span className="lxm-summary-value">
              {request.target_qty ? `${request.target_qty} ${request.target_unit || ''}`.trim() : '—'}
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.request.targetPrice', 'Target price')}</span>
            <span className="lxm-summary-value">
              {request.target_price_usd ? `$${parseFloat(request.target_price_usd).toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.request.destination', 'Destination')}</span>
            <span className="lxm-summary-value">
              {[request.destination_city, request.destination_country].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.request.deadline', 'Deadline')}</span>
            <span className="lxm-summary-value">
              {request.deadline ? new Date(request.deadline).toLocaleDateString() : '—'}
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.request.quotes', 'Quotes')}</span>
            <span className="lxm-summary-value">{request.quotes?.length ?? request.quote_count ?? '—'}</span>
          </div>
        </div>
      )}
    </LogisticsModal>
  );
}
