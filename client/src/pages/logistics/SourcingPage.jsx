import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listSourcingRequests, listSuppliers } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * SourcingPage - sourcing requests + supplier directory (Phase 2 refactor).
 *
 * The tab bar becomes keyboard-operable tabs (role=tablist, aria-selected,
 * 44px targets) on theme tokens. Status pills use the shared component;
 * supplier cards use token classes.
 */
export default function SourcingPage() {
  const { t }    = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState('my-requests');

  useEffect(() => {
    listSourcingRequests({ limit: 20 })
      .then((r) => setRequests(r.requests || []))
      .catch(() => setLoadError(true))
      .finally(() => setLoadingReqs(false));
    listSuppliers({ limit: 20 })
      .then((r) => setSuppliers(r.suppliers || []))
      .catch(() => {});
  }, []);

  const TABS = [
    { key: 'my-requests', label: tx('logistics.sourcing.myRequests', 'My Requests') },
    { key: 'suppliers',   label: tx('logistics.sourcing.suppliers', 'Suppliers') },
  ];

  const openRequest = (id) => navigate(`/logistics/requests/${id}`);

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.sourcing.title', 'Sourcing')}
        subtitle={tx('logistics.sourcing.subtitle', 'Request, quote, and convert, from first inquiry to purchase order.')}
        actions={
          <Link to="/logistics/requests/new" className="lx-btn-primary lx-next-step-action">
            + {tx('logistics.sourcing.newRequest', 'New Request')}
          </Link>
        }
      >
        <div className="lx-workspaces">
          {/* Tab bar */}
          <div className="lx-tabs" role="tablist" aria-label={tx('logistics.sourcing.tabsLabel', 'Sourcing views')}>
            {TABS.map((tab_) => (
              <button
                key={tab_.key}
                role="tab"
                type="button"
                className="lx-tab"
                aria-selected={tab === tab_.key}
                onClick={() => setTab(tab_.key)}
              >
                {tab_.label}
              </button>
            ))}
          </div>

          {tab === 'my-requests' && (
            <div role="tabpanel">
              {loadingReqs && (
                <div className="lx-loading" role="status" aria-live="polite">
                  <span className="lx-spinner" aria-hidden="true" />
                  {tx('logistics.modal.loading', 'Loading…')}
                </div>
              )}

              {!loadingReqs && loadError && (
                <div className="lx-data-error-banner" role="alert">
                  <div>
                    <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                    <p>{tx('logistics.sourcing.error', "We couldn't load your sourcing requests right now. Please try again.")}</p>
                  </div>
                  <button type="button" className="lx-btn-secondary" onClick={() => window.location.reload()}>
                    {tx('logistics.workspace.dataError.retry', 'Try again')}
                  </button>
                </div>
              )}

              {!loadingReqs && !loadError && requests.length === 0 && (
                <div className="lx-empty">
                  <div className="lx-empty-icon" aria-hidden="true">🔍</div>
                  <p>{tx('logistics.sourcing.noRequests', 'You have no sourcing requests yet.')}</p>
                  <Link to="/logistics/requests/new" className="lx-btn-primary lx-next-step-action">
                    {tx('logistics.sourcing.startFirst', 'Start Your First Request')}
                  </Link>
                </div>
              )}

              {!loadingReqs && !loadError && requests.length > 0 && (
                <div className="lx-table-wrap">
                  <table className="lx-table">
                    <thead>
                      <tr>
                        <th>{tx('logistics.sourcing.headers.reference', 'Reference')}</th>
                        <th>{tx('logistics.sourcing.headers.title', 'Title')}</th>
                        <th>{tx('logistics.sourcing.headers.category', 'Category')}</th>
                        <th>{tx('logistics.sourcing.headers.lane', 'Lane')}</th>
                        <th>{tx('logistics.sourcing.headers.qty', 'Qty')}</th>
                        <th>{tx('logistics.sourcing.headers.status', 'Status')}</th>
                        <th>{tx('logistics.sourcing.headers.quotes', 'Quotes')}</th>
                        <th><span className="lx-visually-hidden">{tx('logistics.tables.actions', 'Actions')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => (
                        <tr
                          key={r.id}
                          tabIndex={0}
                          role="link"
                          aria-label={tx('logistics.sourcing.openRequest', 'Open request {{ref}}', { ref: r.reference })}
                          onClick={() => openRequest(r.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openRequest(r.id);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <td><span className="lx-code">{r.reference}</span></td>
                          <td className="lx-t-semibold">{r.title}</td>
                          <td>{r.category}</td>
                          <td className="lx-t-small">{r.origin_country && `${r.origin_country} → ${r.destination_country}`}</td>
                          <td>{r.target_qty ? `${r.target_qty} ${r.target_unit}` : '—'}</td>
                          <td><LogisticsStatusPill status={r.status} /></td>
                          <td>{r.quote_count || 0}</td>
                          <td><span className="lx-link" aria-hidden="true">{tx('logistics.sourcing.viewRow', 'View →')}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'suppliers' && (
            <div role="tabpanel" className="lx-campaign-grid">
              {suppliers.map((s) => (
                <div key={s.id} className="lx-card">
                  <div className="lx-item-card-head lx-mb-4">
                    <span className="lx-t-xs lx-t-faint lx-t-bold">
                      🌍 {s.country} · {s.approved_categories?.slice(0, 2).join(', ')}
                    </span>
                    <span className="lx-stars" role="img" aria-label={tx('logistics.sourcing.qualityScore', 'Quality score {{score}} of 5', { score: Math.round(s.quality_score || 0) })}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span key={i} className={`lx-star${i < Math.round(s.quality_score || 0) ? ' lx-star--on' : ''}`} aria-hidden="true">★</span>
                      ))}
                    </span>
                  </div>
                  <h3 className="lx-t-semibold lx-t-small" style={{ margin: '0 0 .25rem', fontSize: '1rem' }}>{s.company_name}</h3>
                  {s.city && <div className="lx-t-xs lx-t-faint">{s.city}</div>}
                  <div className="lx-btn-row lx-mt-6">
                    {s.approved_categories?.slice(0, 3).map((c) => (
                      <span key={c} className="lx-tag">{c}</span>
                    ))}
                  </div>
                  {s.product_count > 0 && (
                    <div className="lx-t-xs lx-t-faint lx-mt-6">
                      {tx('logistics.suppliers.products', '{{count}} products', { count: s.product_count })}
                    </div>
                  )}
                </div>
              ))}
              {suppliers.length === 0 && (
                <div className="lx-empty">
                  <div className="lx-empty-icon" aria-hidden="true">🏭</div>
                  <p>{tx('logistics.sourcing.noSuppliers', 'No suppliers listed yet.')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
