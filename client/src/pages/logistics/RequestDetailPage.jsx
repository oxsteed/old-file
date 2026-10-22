import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSourcingRequest } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * RequestDetailPage - sourcing request detail (Phase 2 refactor).
 *
 * Now renders inside PageShell + the shared LogisticsLayout (previously it
 * skipped the site chrome entirely). Specifications and quotes use
 * token-based key/value rows and item cards; status pills use theme tones.
 */
export default function RequestDetailPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { id } = useParams();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    getSourcingRequest(id)
      .then((r) => setRequest(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="lx-loading" role="status" aria-live="polite">
          <span className="lx-spinner" aria-hidden="true" />
          {tx('logistics.requestDetail.loading', 'Loading…')}
        </div>
      );
    }
    if (error || !request) {
      return (
        <div className="lx-empty" role="alert">
          <p>{tx('logistics.requestDetail.notFound', 'Sourcing request not found.')}</p>
          <div className="lx-btn-row" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={load} className="lx-action-secondary" data-track="ui.426706938f.1">
              {tx('logistics.workspace.dataError.retry', 'Try again')}
            </button>
            <Link to="/logistics/sourcing" className="lx-link">{tx('logistics.requestDetail.backToSourcing', '← Back to Sourcing')}</Link>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="lx-card lx-mb-6">
          <div className="lx-detail-head">
            <div>
              <p className="lx-detail-kicker">
                {request.reference} {request.origin_country && `· ${request.origin_country} → ${request.destination_country}`}
              </p>
              <h2 className="lx-detail-title" style={{ fontSize: 'var(--text-2xl)' }}>{request.title}</h2>
              <p className="lx-detail-sub">{request.description || tx('logistics.requestDetail.defaultDescription', 'No description provided.')}</p>
            </div>
            <LogisticsStatusPill status={request.status} />
          </div>
        </div>

        <div className="lx-two-col">
          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">{tx('logistics.requestDetail.sections.specifications', 'Specifications')}</h3>
            <div className="lx-kv-list">
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.category', 'Category')}</span><span className="lx-kv-value">{request.category}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.targetQuantity', 'Target quantity')}</span><span className="lx-kv-value">{request.target_qty ? `${request.target_qty} ${request.target_unit}` : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.targetPrice', 'Target price')}</span><span className="lx-kv-value">{request.target_price_usd ? `$${parseFloat(request.target_price_usd).toFixed(2)}` : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.budgetMax', 'Budget max')}</span><span className="lx-kv-value">{request.budget_max_usd ? `$${parseFloat(request.budget_max_usd).toFixed(2)}` : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.destination', 'Destination')}</span><span className="lx-kv-value">{[request.destination_city, request.destination_country].filter(Boolean).join(', ') || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.preferredFreight', 'Preferred freight')}</span><span className="lx-kv-value">{request.preferred_freight || '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.privateLabel', 'Private label')}</span><span className="lx-kv-value">{request.private_label ? tx('logistics.requestDetail.labels.yes', 'Yes') : tx('logistics.requestDetail.labels.no', 'No')}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.customMfg', 'Custom manufacturing')}</span><span className="lx-kv-value">{request.custom_mfg ? tx('logistics.requestDetail.labels.yes', 'Yes') : tx('logistics.requestDetail.labels.no', 'No')}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.deadline', 'Deadline')}</span><span className="lx-kv-value">{request.deadline ? new Date(request.deadline).toLocaleDateString() : '—'}</span></div>
              <div className="lx-kv-row"><span className="lx-kv-label">{tx('logistics.requestDetail.labels.business', 'Business')}</span><span className="lx-kv-value">{request.business_name || tx('logistics.requestDetail.values.personalRequest', 'Personal request')}</span></div>
            </div>
            {request.specs && (
              <div className="lx-mt-6">
                <h4 className="lx-t-semibold lx-t-small lx-mb-4">{tx('logistics.requestDetail.labels.structuredSpecs', 'Structured specs')}</h4>
                <pre className="lx-t-xs" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', overflowX: 'auto', border: '1px solid var(--color-border)' }}>
                  {JSON.stringify(request.specs, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="lx-card">
            <h3 className="lx-card-title lx-mb-4">
              {tx('logistics.requestDetail.quotes.title', 'Quotes ({{count}})', { count: request.quotes?.length || 0 })}
            </h3>
            {!request.quotes?.length && (
              <div className="lx-empty">
                <div className="lx-empty-icon" aria-hidden="true">💬</div>
                <p>{tx('logistics.requestDetail.quotes.empty', 'No supplier quotes yet.')}</p>
              </div>
            )}
            {!!request.quotes?.length && (
              <div className="lx-compact-stack">
                {request.quotes.map((q) => (
                  <div key={q.id} className="lx-item-card">
                    <div className="lx-item-card-head">
                      <div>
                        <div className="lx-t-bold lx-t-small">{q.reference}</div>
                        <div className="lx-t-xs lx-t-faint">{tx('logistics.requestDetail.quotes.supplier', 'Supplier #{{id}}', { id: q.supplier_id })}</div>
                      </div>
                      <LogisticsStatusPill status={q.status} />
                    </div>
                    <div className="lx-item-card-grid">
                      <div><span className="lx-kv-label">{tx('logistics.requestDetail.labels.quotedQty', 'Quoted qty')}: </span><strong>{q.qty_quoted}</strong></div>
                      <div><span className="lx-kv-label">{tx('logistics.requestDetail.labels.unitPrice', 'Unit price')}: </span><strong>${parseFloat(q.unit_price_usd || 0).toFixed(2)}</strong></div>
                      <div><span className="lx-kv-label">{tx('logistics.requestDetail.labels.freightEst', 'Freight est')}: </span><strong>{q.freight_est_usd ? `$${parseFloat(q.freight_est_usd).toFixed(2)}` : '—'}</strong></div>
                      <div><span className="lx-kv-label">{tx('logistics.requestDetail.labels.leadTime', 'Lead time')}: </span><strong>{q.lead_time_days ? `${q.lead_time_days} ${tx('logistics.requestDetail.labels.days', 'days')}` : '—'}</strong></div>
                    </div>
                    {q.notes && <p className="lx-t-faint lx-t-small lx-mt-6" style={{ marginBottom: 0 }}>{q.notes}</p>}
                  </div>
                ))}
              </div>
            )}
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
            <Link to="/logistics/sourcing" className="lx-link">
              {tx('logistics.requestDetail.backToSourcing', '← Back to Sourcing')}
            </Link>
          </div>
          {renderBody()}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
