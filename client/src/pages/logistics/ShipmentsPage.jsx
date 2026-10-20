import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listShipments } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import ShipmentPreview from '../../components/logistics/ShipmentPreview';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

const LIFECYCLE = [
  'planned', 'booked', 'origin_received', 'consolidating', 'departed_origin',
  'transshipment', 'arrived_destination', 'customs_hold', 'customs_cleared',
  'delivered_to_warehouse', 'receiving', 'allocation_ready', 'distributed', 'completed',
];

/**
 * ShipmentsPage - shipment tracking list (Phase 2 refactor).
 *
 * The lifecycle legend becomes keyboard-operable toggle chips (aria-pressed,
 * 44px targets, theme tokens) instead of inline-styled buttons. Shipment
 * cards and status pills use the shared token-based components.
 */
export default function ShipmentsPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const navigate = useNavigate();
  const [shipments, setShipments] = useState([]);
  const [status, setStatus] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    listShipments({ status: status || undefined, limit: 50 })
      .then((r) => setShipments(r.shipments || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status]);

  const toggleStatus = (s) => setStatus((current) => (current === s ? '' : s));

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.shipments.title', 'Shipments')}
        subtitle={tx('logistics.shipments.subtitle', 'Track shipments from origin through customs to warehouse receipt.')}
      >
        <div className="lx-workspaces">
          {/* Lifecycle legend: toggle chips */}
          <div className="lx-filter-chips" role="group" aria-label={tx('logistics.shipments.lifecycleLabel', 'Filter by lifecycle stage')}>
            {LIFECYCLE.map((s, i) => (
              <React.Fragment key={s}>
                <button
                  type="button"
                  className="lx-filter-chip"
                  aria-pressed={status === s}
                  onClick={() => toggleStatus(s)} data-track="ui.6044c8feb6.1"
                >
                  {tx(`logistics.status.${s}`, s.replace(/_/g, ' '))}
                </button>
                {i < LIFECYCLE.length - 1 && (
                  <span className="lx-filter-chip-separator" aria-hidden="true">→</span>
                )}
              </React.Fragment>
            ))}
          </div>

          {loading && (
            <div className="lx-loading" role="status" aria-live="polite">
              <span className="lx-spinner" aria-hidden="true" />
              {tx('logistics.shipments.loading', 'Loading…')}
            </div>
          )}

          {!loading && error && (
            <div className="lx-data-error-banner" role="alert">
              <div>
                <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                <p>{tx('logistics.shipments.error', "We couldn't load your shipments right now. Please try again.")}</p>
              </div>
              <button type="button" className="lx-btn-secondary" onClick={load} data-track="ui.6044c8feb6.2">
                {tx('logistics.workspace.dataError.retry', 'Try again')}
              </button>
            </div>
          )}

          {!loading && !error && shipments.length === 0 && (
            <div className="lx-empty">
              <div className="lx-empty-icon" aria-hidden="true">🚢</div>
              <p>{tx('logistics.shipments.empty', 'No shipments found.')}</p>
              {status && (
                <button type="button" className="lx-action-secondary" onClick={() => setStatus('')} data-track="ui.6044c8feb6.3">
                  {tx('logistics.hub.clearFilters', 'Clear filters')}
                </button>
              )}
            </div>
          )}

          {!loading && !error && shipments.length > 0 && (
            <div className="lx-compact-stack">
              {shipments.map((s) => (
                <div
                  key={s.id}
                  className="lx-card lx-item-card-head"
                  role="link"
                  tabIndex={0}
                  aria-label={tx('logistics.shipments.openShipment', 'Open shipment {{ref}}', { ref: s.reference })}
                  onClick={() => navigate(`/logistics/shipments/${s.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/logistics/shipments/${s.id}`);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div>
                    <div className="lx-t-xs lx-t-faint lx-t-bold lx-mb-4">
                      {s.origin_country} → {s.destination_country} · {s.freight_option?.replace(/_/g, ' ')} · {s.carrier || tx('logistics.shipments.noCarrier', 'No carrier')}
                    </div>
                    <div className="lx-t-semibold lx-t-small lx-mb-4">
                      <span className="lx-code" style={{ marginInlineEnd: '.5rem' }}>{s.reference}</span>
                      {s.lane_name}
                    </div>
                    <div className="lx-t-xs lx-t-faint lx-btn-row">
                      {s.tracking_number && <span>🔍 {s.tracking_number}</span>}
                      {s.total_weight_kg && <span>⚖️ {s.total_weight_kg} {tx('logistics.shipments.kg', 'kg')}</span>}
                      {s.total_cbm && <span>📦 {s.total_cbm} {tx('logistics.shipments.cbm', 'CBM')}</span>}
                      {s.eta && <span>🕐 {tx('logistics.shipments.etaLabel', 'ETA')} {new Date(s.eta).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <LogisticsStatusPill status={s.status} />
                    {s.status === 'exception' && (
                      <div className="lx-t-xs lx-t-bold lx-mt-6" style={{ color: 'var(--color-error)' }}>
                        ⚠ {tx('logistics.shipments.exception', 'Exception')}
                      </div>
                    )}
                    <button
                      type="button"
                      className="lx-action-ghost lx-mt-6"
                      onClick={(e) => { e.stopPropagation(); setPreviewId(s.id); }} data-track="ui.6044c8feb6.4"
                    >
                      {t('logistics.tables.preview')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="lx-t-small lx-t-faint lx-mt-6">
            <Link to="/logistics/buyer" className="lx-link">← {tx('logistics.shipments.backToBuyer', 'Back to Buyer workspace')}</Link>
          </p>
        </div>
      </LogisticsLayout>
      <ShipmentPreview
        key={previewId} id={previewId}
        open={previewId !== null}
        onClose={() => setPreviewId(null)}
      />
    </PageShell>
  );
}
