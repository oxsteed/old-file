import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getShipment } from '../../api/logistics';
import LogisticsModal, { LogisticsModalLoading, LogisticsModalError } from './LogisticsModal';

const STATUS_COLOR = {
  draft: '#94a3b8', open: '#22c55e', quoted: '#f59e0b', procurement: '#10b981',
  in_transit: '#06b6d4', customs_review: '#ef4444', warehoused: '#0ea5e9', fulfilled: '#15803d',
};

/**
 * Shipment preview modal. Fetches /api/logistics/shipments/:id and renders a
 * summary; "Open full page" navigates to /logistics/shipments/:id where
 * ShipmentDetailPage renders the complete view.
 */
export default function ShipmentPreview({ id, open, onClose }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [shipment, setShipment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getShipment(id)
      .then((r) => setShipment(r.data || null))
      .catch((err) => setError(err.response?.data?.error || tx('logistics.modal.loadError', "Couldn't load this preview.")))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    if (open) {
      setShipment(null);
      load();
    }
  }, [open, load]);

  return (
    <LogisticsModal
      open={open}
      onClose={onClose}
      title={shipment?.lane_name || tx('logistics.modal.shipmentPreviewTitle', 'Shipment preview')}
      fullPageHref={id ? `/logistics/shipments/${id}` : null}
    >
      {loading && <LogisticsModalLoading />}
      {!loading && error && <LogisticsModalError message={error} onRetry={load} />}
      {!loading && !error && !shipment && (
        <LogisticsModalError message={tx('logistics.modal.notFound', 'This item could not be found.')} />
      )}
      {!loading && !error && shipment && (
        <div className="lxm-summary">
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.shipment.status', 'Status')}</span>
            <span className="lxm-summary-value">
              <span className="lx-status-pill" style={{ background: STATUS_COLOR[shipment.status] || '#64748b' }}>
                {shipment.status?.replace(/_/g, ' ')}
              </span>
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.shipment.carrier', 'Carrier')}</span>
            <span className="lxm-summary-value">{shipment.carrier || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.shipment.trackingNumber', 'Tracking number')}</span>
            <span className="lxm-summary-value">{shipment.tracking_number || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.shipment.originPort', 'Origin port')}</span>
            <span className="lxm-summary-value">{shipment.origin_port || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.shipment.destinationPort', 'Destination port')}</span>
            <span className="lxm-summary-value">{shipment.destination_port || '—'}</span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.shipment.eta', 'ETA')}</span>
            <span className="lxm-summary-value">
              {shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}
            </span>
          </div>
        </div>
      )}
    </LogisticsModal>
  );
}
