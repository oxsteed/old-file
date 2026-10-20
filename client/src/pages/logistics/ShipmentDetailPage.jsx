import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getShipment } from '../../api/logistics';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * ShipmentDetailPage - shipment detail (Phase 2 refactor).
 *
 * Now renders inside PageShell + the shared LogisticsLayout (previously it
 * skipped the site chrome entirely). Milestones, documents, and detail rows
 * use token-based classes; status pills use theme tones.
 */
export default function ShipmentDetailPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { id } = useParams();
  const [shipment, setShipment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getShipment(id)
      .then((r) => setShipment(r.data))
      .catch((err) => setError(err.response?.data?.error || tx('logistics.shipmentDetail.loadError', 'Failed to load shipment.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="lx-loading" role="status" aria-live="polite">
          <span className="lx-spinner" aria-hidden="true" />
          {tx('logistics.shipmentDetail.loading', 'Loading…')}
        </div>
      );
    }
    if (error) {
      return (
        <div className="lx-empty" role="alert">
          <p>{error}</p>
          <button type="button" onClick={load} className="lx-action-secondary" data-track="ui.d47697dc72.1">
            {tx('logistics.workspace.dataError.retry', 'Try again')}
          </button>
        </div>
      );
    }
    if (!shipment) {
      return (
        <div className="lx-empty" role="alert">
          <p>{tx('logistics.shipmentDetail.notFound', 'Shipment not found.')}</p>
          <Link to="/logistics/shipments" className="lx-link">{tx('logistics.shipmentDetail.backToShipments', '← Back to Shipments')}</Link>
        </div>
      );
    }

    return (
      <>
        <div className="lx-card lx-mb-6">
          <div className="lx-detail-head">
            <div>
              <p className="lx-detail-kicker">{shipment.reference}</p>
              <h2 className="lx-detail-title" style={{ fontSize: 'var(--text-2xl)' }}>
                {shipment.lane_name || tx('logistics.shipmentDetail.defaults.shipment', 'Shipment')}
              </h2>
              <p className="lx-detail-sub">{shipment.origin_country} → {shipment.destination_country} · {shipment.freight_option?.replace(/_/g, ' ')}</p>
            </div>
            <LogisticsStatusPill status={shipment.status} />
          </div>
        </div>

        <div className="lx-two-col">
          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">{tx('logistics.shipmentDetail.sections.details', 'Shipment details')}</h3>
            <div className="lx-kv-list">
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.carrier', 'Carrier')}</span><span className="lx-kv-value">{shipment.carrier || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.trackingNumber', 'Tracking number')}</span><span className="lx-kv-value">{shipment.tracking_number || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.bookingRef', 'Booking ref')}</span><span className="lx-kv-value">{shipment.carrier_booking_ref || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.originPort', 'Origin port')}</span><span className="lx-kv-value">{shipment.origin_port || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.destinationPort', 'Destination port')}</span><span className="lx-kv-value">{shipment.destination_port || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.totalCartons', 'Total cartons')}</span><span className="lx-kv-value">{shipment.total_cartons || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.totalWeight', 'Total weight')}</span><span className="lx-kv-value">{shipment.total_weight_kg ? `${shipment.total_weight_kg} ${tx('logistics.shipmentDetail.labels.kg', 'kg')}` : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.totalCbm', 'Total CBM')}</span><span className="lx-kv-value">{shipment.total_cbm || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.shipmentDetail.labels.eta', 'ETA')}</span><span className="lx-kv-value">{shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}</span></div>
            </div>
          </div>

          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">
              {tx('logistics.shipmentDetail.sections.documents', 'Documents ({{count}})', { count: shipment.documents?.length || 0 })}
            </h3>
            {!shipment.documents?.length && (
              <div className="lx-empty">
                <div className="lx-empty-icon" aria-hidden="true">📄</div>
                <p>{tx('logistics.shipmentDetail.empty.documents', 'No shipping documents uploaded.')}</p>
              </div>
            )}
            {!!shipment.documents?.length && (
              <div className="lx-compact-stack">
                {shipment.documents.map((doc) => (
                  <a key={doc.id} href={doc.file_url} target="_blank" rel="noreferrer" className="lx-item-card" style={{ textDecoration: 'none', padding: 'var(--space-3)' }} data-track="ui.d47697dc72.2">
                    <div className="lx-t-semibold lx-t-small" style={{ color: 'var(--color-text)' }}>{doc.doc_type || tx('logistics.shipmentDetail.defaults.document', 'Document')}</div>
                    <div className="lx-t-xs lx-t-faint">{doc.filename}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lx-card lx-mt-6">
          <h3 className="lx-card-title lx-mb-4">{tx('logistics.shipmentDetail.sections.milestones', 'Milestones')}</h3>
          {(shipment.milestones || []).length === 0 && (
            <p className="lx-overview-empty">{tx('logistics.shipmentDetail.empty.milestones', 'No milestones recorded yet.')}</p>
          )}
          <div className="lx-compact-stack">
            {(shipment.milestones || []).map((m) => (
              <div key={m.id} className="lx-item-card-head" style={{ borderBlockEnd: '1px solid var(--color-border-faint)', paddingBlockEnd: 'var(--space-3)' }}>
                <div>
                  <LogisticsStatusPill status={m.milestone} />
                  <div className="lx-t-xs lx-t-faint lx-mt-6" style={{ marginTop: '.35rem' }}>
                    {m.occurred_at ? new Date(m.occurred_at).toLocaleString() : '—'}
                  </div>
                </div>
                <div>
                  <div className="lx-t-semibold lx-t-small">{m.location || tx('logistics.shipmentDetail.defaults.noLocation', 'No location')}</div>
                  <div className="lx-t-faint lx-t-small">{m.notes || tx('logistics.shipmentDetail.defaults.noNotes', 'No notes.')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  };

  return (
    <PageShell>
      <LogisticsLayout showNav={false}>
        <div className="lx-workspaces">
          <div className="lx-back-row">
            <Link to="/logistics/shipments" className="lx-link">
              {tx('logistics.shipmentDetail.backToShipments', '← Back to Shipments')}
            </Link>
          </div>
          {renderBody()}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
