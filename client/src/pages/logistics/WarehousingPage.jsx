import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listWarehouses, listInventoryReceipts, listAllocations, listDeliveries } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * WarehousingPage - inventory receipts, allocations, deliveries, warehouses
 * (Phase 2 refactor).
 *
 * Keyboard-operable tabs (role=tablist, aria-selected, 44px targets);
 * receipt/allocation/delivery status pills use theme tokens; bonded badge
 * and shortage coloring use token classes.
 */
export default function WarehousingPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [tab, setTab]               = useState('receipts');
  const [warehouses, setWarehouses] = useState([]);
  const [receipts, setReceipts]     = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    Promise.all([
      listWarehouses(),
      listInventoryReceipts({ limit: 30 }),
      listAllocations({ limit: 50 }),
      listDeliveries({ limit: 30 }),
    ]).then(([wRes, rRes, aRes, dRes]) => {
      setWarehouses(wRes.data || []);
      setReceipts(rRes.data || []);
      setAllocations(aRes.data || []);
      setDeliveries(dRes.data || []);
    }).catch(() => setError(true)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const TABS = [
    { key: 'receipts',    label: tx('logistics.warehousing.receipts', 'Inventory Receipts') },
    { key: 'allocations', label: tx('logistics.warehousing.allocations', 'Allocations') },
    { key: 'deliveries',  label: tx('logistics.warehousing.deliveries', 'Delivery Orders') },
    { key: 'warehouses',  label: tx('logistics.warehousing.warehouses', 'Warehouses') },
  ];

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.warehousing.title', 'Warehousing & Distribution')}
        subtitle={tx('logistics.warehousing.subtitle', 'Receive, reconcile, allocate, and release inventory to buyers.')}
      >
        <div className="lx-workspaces">
          {/* Tab bar */}
          <div className="lx-tabs" role="tablist" aria-label={tx('logistics.warehousing.tabsLabel', 'Warehousing views')}>
            {TABS.map((tb) => (
              <button
                key={tb.key}
                role="tab"
                type="button"
                className="lx-tab"
                aria-selected={tab === tb.key}
                onClick={() => setTab(tb.key)} data-track="ui.9f86c46ca2.1"
              >
                {tb.label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="lx-loading" role="status" aria-live="polite">
              <span className="lx-spinner" aria-hidden="true" />
              {tx('logistics.modal.loading', 'Loading…')}
            </div>
          )}

          {!loading && error && (
            <div className="lx-data-error-banner" role="alert">
              <div>
                <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                <p>{tx('logistics.warehousing.error', "We couldn't load warehousing data right now. Please try again.")}</p>
              </div>
              <button type="button" className="lx-btn-secondary" onClick={load} data-track="ui.9f86c46ca2.2">
                {tx('logistics.workspace.dataError.retry', 'Try again')}
              </button>
            </div>
          )}

          {!loading && !error && tab === 'warehouses' && (
            <div role="tabpanel" className="lx-campaign-grid">
              {warehouses.map((w) => (
                <div key={w.id} className="lx-card">
                  <div className="lx-item-card-head lx-mb-4">
                    <span className="lx-t-xs lx-t-faint lx-t-bold">🏭 {w.country} · {w.city}</span>
                    {w.is_bonded && <span className="lx-tag lx-tag--warning">{tx('logistics.warehousing.bonded', 'Bonded')}</span>}
                  </div>
                  <h3 className="lx-t-semibold" style={{ fontSize: '1rem', margin: '0 0 .4rem' }}>{w.name}</h3>
                  <div className="lx-t-xs lx-t-faint">
                    {tx('logistics.warehousing.activeReceipts', '{{count}} active receipts', { count: w.active_receipts })}
                    {w.total_sqft && ` · ${w.total_sqft.toLocaleString()} ${tx('logistics.warehousing.sqft', 'sqft')}`}
                  </div>
                </div>
              ))}
              {warehouses.length === 0 && (
                <div className="lx-empty" style={{ gridColumn: '1/-1' }}>
                  <div className="lx-empty-icon" aria-hidden="true">🏭</div>
                  <p>{tx('logistics.warehousing.noWarehouses', 'No warehouses configured yet.')}</p>
                </div>
              )}
            </div>
          )}

          {!loading && !error && tab === 'receipts' && (
            <div role="tabpanel" className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th>{tx('logistics.warehousing.headers.reference', 'Reference')}</th>
                    <th>{tx('logistics.warehousing.headers.warehouse', 'Warehouse')}</th>
                    <th>{tx('logistics.warehousing.headers.expected', 'Expected')}</th>
                    <th>{tx('logistics.warehousing.headers.received', 'Received')}</th>
                    <th>{tx('logistics.warehousing.headers.shortage', 'Shortage')}</th>
                    <th>{tx('logistics.warehousing.headers.status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => {
                    const full = (r.received_qty || 0) >= (r.expected_qty || 0);
                    return (
                      <tr key={r.id}>
                        <td><span className="lx-code">{r.reference}</span></td>
                        <td>{r.warehouse_name}</td>
                        <td>{r.expected_qty}</td>
                        <td className="lx-t-bold" style={{ color: full ? 'var(--color-success)' : 'inherit' }}>
                          {r.received_qty || 0}
                        </td>
                        <td style={{ color: r.shortage_qty > 0 ? 'var(--color-error)' : 'inherit' }}>
                          {r.shortage_qty || 0}
                        </td>
                        <td><LogisticsStatusPill status={r.status} /></td>
                      </tr>
                    );
                  })}
                  {receipts.length === 0 && (
                    <tr><td colSpan={6} className="lx-table-empty-cell">{tx('logistics.warehousing.noReceipts', 'No inventory receipts.')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && tab === 'allocations' && (
            <div role="tabpanel" className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th>{tx('logistics.warehousing.headers.buyer', 'Buyer')}</th>
                    <th>{tx('logistics.warehousing.headers.qty', 'Qty')}</th>
                    <th>{tx('logistics.warehousing.headers.status', 'Status')}</th>
                    <th>{tx('logistics.warehousing.headers.warehouse', 'Warehouse')}</th>
                    <th>{tx('logistics.warehousing.headers.releaseMethod', 'Release Method')}</th>
                    <th>{tx('logistics.warehousing.headers.released', 'Released')}</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((a) => (
                    <tr key={a.id}>
                      <td>{a.buyer_name || (a.buyer_user_id ? `${a.buyer_user_id.slice(0, 8)}…` : '—')}</td>
                      <td className="lx-t-bold">{a.allocated_qty}</td>
                      <td><LogisticsStatusPill status={a.status} /></td>
                      <td>{a.warehouse_name}</td>
                      <td className="lx-t-xs">{a.release_method?.replace(/_/g, ' ')}</td>
                      <td className="lx-t-xs lx-t-faint">
                        {a.released_at ? new Date(a.released_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                  {allocations.length === 0 && (
                    <tr><td colSpan={6} className="lx-table-empty-cell">{tx('logistics.warehousing.noAllocations', 'No allocations.')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && tab === 'deliveries' && (
            <div role="tabpanel" className="lx-compact-stack">
              {deliveries.map((d) => (
                <div key={d.id} className="lx-card">
                  <div className="lx-item-card-head">
                    <div>
                      <span className="lx-code">{d.reference}</span>
                      <div className="lx-t-bold lx-t-small lx-mt-6" style={{ marginTop: '.2rem' }}>{d.recipient_name || '—'}</div>
                      <div className="lx-t-xs lx-t-faint">
                        {d.delivery_city}, {d.delivery_country} · {d.method?.replace(/_/g, ' ')}
                      </div>
                    </div>
                    <LogisticsStatusPill status={d.status} />
                  </div>
                  {d.tracking_number && (
                    <div className="lx-t-xs lx-t-faint lx-mt-6">
                      📦 {d.carrier} · {d.tracking_number}
                    </div>
                  )}
                </div>
              ))}
              {deliveries.length === 0 && (
                <div className="lx-empty">
                  <div className="lx-empty-icon" aria-hidden="true">🚚</div>
                  <p>{tx('logistics.warehousing.noDeliveries', 'No delivery orders.')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
