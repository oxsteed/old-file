import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getShipment } from '../../api/logistics';
import { useTranslation } from 'react-i18next';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  planned:'#94a3b8', booked:'#3b82f6', origin_received:'#f59e0b',
  consolidating:'#f97316', departed_origin:'#8b5cf6', transshipment:'#7c3aed',
  arrived_destination:'#06b6d4', customs_hold:'#dc2626', customs_cleared:'#22c55e',
  delivered_to_warehouse:'#10b981', receiving:'#0284c7', allocation_ready:'#059669',
  distributed:'#16a34a', completed:'#15803d', exception:'#ef4444',
};

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
      .catch((err) => setError(err.response?.data?.error || tx('shipmentDetailPage.loadError', 'Failed to load shipment.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="lx-page"><div className="lx-loading">{tx('shipmentDetailPage.loading', 'Loading…')}</div></div>;
  if (error) return (
    <div className="lx-page">
      <div className="lx-error">
        <p>{error}</p>
        <button type="button" onClick={load} className="lx-btn">{tx('common.retry', 'Retry')}</button>
      </div>
    </div>
  );
  if (!shipment) return (
    <div className="lx-page">
      <div className="lx-error">
        <p>{tx('shipmentDetailPage.notFound', 'Shipment not found.')}</p>
        <Link to="/logistics/shipments" className="lx-link">{tx('shipmentDetailPage.backToShipments', '← Back to Shipments')}</Link>
      </div>
    </div>
  );

  return (
    <div className="lx-page">
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/logistics/shipments" className="lx-link">
          {tx('shipmentDetailPage.backToShipments', '← Back to Shipments')}
        </Link>
      </div>

      <div className="lx-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '.78rem', color: '#64748b', fontWeight: 700 }}>{shipment.reference}</div>
            <h1 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '.35rem 0' }}>{shipment.lane_name || tx('shipmentDetailPage.defaults.shipment', 'Shipment')}</h1>
            <p style={{ color: '#64748b', margin: 0 }}>{shipment.origin_country} → {shipment.destination_country} · {shipment.freight_option?.replace(/_/g, ' ')}</p>
          </div>
          <span className="lx-status-pill" style={{ background: STATUS_COLOR[shipment.status] || '#64748b', alignSelf: 'flex-start' }}>
            {tx(`shipmentDetailPage.statuses.${shipment.status}`, shipment.status?.replace(/_/g, ' '))}
          </span>
        </div>
      </div>

      <div className="lx-detail-grid">
        <div className="lx-card">
          <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>{tx('shipmentDetailPage.sections.details', 'Shipment details')}</h3>
          <div style={{ display: 'grid', gap: '.55rem', fontSize: '.88rem' }}>
            <div><strong>{tx('shipmentDetailPage.labels.carrier', 'Carrier')}:</strong> {shipment.carrier || '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.trackingNumber', 'Tracking number')}:</strong> {shipment.tracking_number || '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.bookingRef', 'Booking ref')}:</strong> {shipment.carrier_booking_ref || '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.originPort', 'Origin port')}:</strong> {shipment.origin_port || '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.destinationPort', 'Destination port')}:</strong> {shipment.destination_port || '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.totalCartons', 'Total cartons')}:</strong> {shipment.total_cartons || '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.totalWeight', 'Total weight')}:</strong> {shipment.total_weight_kg ? `${shipment.total_weight_kg} ${tx('shipmentDetailPage.labels.kg', 'kg')}` : '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.totalCbm', 'Total CBM')}:</strong> {shipment.total_cbm || '—'}</div>
            <div><strong>{tx('shipmentDetailPage.labels.eta', 'ETA')}:</strong> {shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}</div>
          </div>
        </div>

        <div className="lx-card">
          <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>
            {tx('shipmentDetailPage.sections.documents', 'Documents {{count}}', { count: shipment.documents?.length || 0 })}
          </h3>
          {!shipment.documents?.length && <div className="lx-empty"><div className="lx-empty-icon">📄</div><p>{tx('shipmentDetailPage.empty.documents', 'No shipping documents uploaded.')}</p></div>}
          {!!shipment.documents?.length && (
            <div style={{ display: 'grid', gap: '.75rem' }}>
              {shipment.documents.map((doc) => (
                <a key={doc.id} href={doc.file_url} target="_blank" rel="noreferrer" className="lx-card" style={{ padding: '.9rem', textDecoration: 'none' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{doc.doc_type || tx('shipmentDetailPage.defaults.document', 'Document')}</div>
                  <div style={{ fontSize: '.8rem', color: '#64748b' }}>{doc.filename}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="lx-card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>{tx('shipmentDetailPage.sections.milestones', 'Milestones')}</h3>
        <div style={{ display: 'grid', gap: '.75rem' }}>
          {(shipment.milestones || []).map((m) => (
            <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '.75rem' }}>
              <div>
                <span className="lx-status-pill" style={{ background: STATUS_COLOR[m.milestone] || '#64748b' }}>
                  {tx(`shipmentDetailPage.milestones.${m.milestone}`, m.milestone?.replace(/_/g, ' '))}
                </span>
                <div style={{ fontSize: '.78rem', color: '#94a3b8', marginTop: '.35rem' }}>
                  {m.occurred_at ? new Date(m.occurred_at).toLocaleString() : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{m.location || tx('shipmentDetailPage.defaults.noLocation', 'No location')}</div>
                <div style={{ color: '#64748b' }}>{m.notes || tx('shipmentDetailPage.defaults.noNotes', 'No notes.')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
