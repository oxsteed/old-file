import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSourcingRequest } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft: '#94a3b8',
  open: '#22c55e',
  quoting: '#f59e0b',
  quoted: '#f97316',
  converting: '#8b5cf6',
  direct_order: '#3b82f6',
  pooled: '#06b6d4',
  procurement: '#10b981',
  cancelled: '#ef4444',
  closed: '#64748b',
};

export default function RequestDetailPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { id } = useParams();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSourcingRequest(id)
      .then((r) => setRequest(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="lx-page"><div className="lx-loading">{tx('requestDetailPage.loading', 'Loading…')}</div></div>;
  if (!request) return <div className="lx-page"><div className="lx-error">{tx('requestDetailPage.notFound', 'Sourcing request not found.')}</div></div>;

  return (
    <div className="lx-page">
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/logistics/sourcing" className="lx-link">
          {tx('requestDetailPage.backToSourcing', '← Back to Sourcing')}
        </Link>
      </div>

      <div className="lx-card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '.78rem', color: '#64748b', fontWeight: 700 }}>
                {request.reference} {request.origin_country && `· ${request.origin_country} → ${request.destination_country}`}
              </div>
              <h1 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '.35rem 0' }}>{request.title}</h1>
              <p style={{ color: '#64748b', margin: 0 }}>{request.description || tx('requestDetailPage.defaultDescription', 'No description provided.')}</p>
            </div>
          <span className="lx-status-pill" style={{ background: STATUS_COLOR[request.status] || '#64748b', alignSelf: 'flex-start' }}>
            {tx(`requestDetailPage.statuses.request.${request.status}`, request.status?.replace(/_/g, ' '))}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: '1.5rem' }}>
        <div className="lx-card">
          <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>{tx('requestDetailPage.sections.specifications', 'Specifications')}</h3>
          <div style={{ display: 'grid', gap: '.6rem', fontSize: '.88rem' }}>
            <div><strong>{tx('requestDetailPage.labels.category', 'Category')}:</strong> {request.category}</div>
            <div><strong>{tx('requestDetailPage.labels.targetQuantity', 'Target quantity')}:</strong> {request.target_qty ? `${request.target_qty} ${request.target_unit}` : '—'}</div>
            <div><strong>{tx('requestDetailPage.labels.targetPrice', 'Target price')}:</strong> {request.target_price_usd ? `$${parseFloat(request.target_price_usd).toFixed(2)}` : '—'}</div>
            <div><strong>{tx('requestDetailPage.labels.budgetMax', 'Budget max')}:</strong> {request.budget_max_usd ? `$${parseFloat(request.budget_max_usd).toFixed(2)}` : '—'}</div>
            <div><strong>{tx('requestDetailPage.labels.destination', 'Destination')}:</strong> {[request.destination_city, request.destination_country].filter(Boolean).join(', ') || '—'}</div>
            <div><strong>{tx('requestDetailPage.labels.preferredFreight', 'Preferred freight')}:</strong> {request.preferred_freight || '—'}</div>
            <div><strong>{tx('requestDetailPage.labels.privateLabel', 'Private label')}:</strong> {request.private_label ? tx('requestDetailPage.labels.yes', 'Yes') : tx('requestDetailPage.labels.no', 'No')}</div>
            <div><strong>{tx('requestDetailPage.labels.customMfg', 'Custom manufacturing')}:</strong> {request.custom_mfg ? tx('requestDetailPage.labels.yes', 'Yes') : tx('requestDetailPage.labels.no', 'No')}</div>
            <div><strong>{tx('requestDetailPage.labels.deadline', 'Deadline')}:</strong> {request.deadline ? new Date(request.deadline).toLocaleDateString() : '—'}</div>
            <div><strong>{tx('requestDetailPage.labels.business', 'Business')}:</strong> {request.business_name || tx('requestDetailPage.values.personalRequest', 'Personal request')}</div>
          </div>
          {request.specs && (
            <div style={{ marginTop: '1rem' }}>
              <h4 style={{ fontWeight: 700, marginBottom: '.5rem' }}>{tx('requestDetailPage.labels.structuredSpecs', 'Structured specs')}</h4>
              <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '1rem', borderRadius: '.75rem', overflowX: 'auto', fontSize: '.78rem' }}>
                {JSON.stringify(request.specs, null, 2)}
              </pre>
            </div>
          )}
        </div>

      <div className="lx-card">
        <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>
          {tx('requestDetailPage.quotes.title', 'Quotes {{count}}', { count: request.quotes?.length || 0 })}
        </h3>
          {!request.quotes?.length && (
            <div className="lx-empty" style={{ minHeight: 180 }}>
              <div className="lx-empty-icon">💬</div>
              <p>{tx('requestDetailPage.quotes.empty', 'No supplier quotes yet.')}</p>
            </div>
          )}
          {!!request.quotes?.length && (
            <div style={{ display: 'grid', gap: '.75rem' }}>
              {request.quotes.map((q) => (
                <div key={q.id} style={{ border: '1px solid #e2e8f0', borderRadius: '.9rem', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{q.reference}</div>
                      <div style={{ fontSize: '.8rem', color: '#64748b' }}>{`Supplier #${q.supplier_id}`}</div>
                    </div>
                    <span className="lx-status-pill" style={{ background: STATUS_COLOR[q.status] || '#64748b' }}>
                      {tx(`requestDetailPage.statuses.quote.${q.status}`, q.status?.replace(/_/g, ' '))}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginTop: '.75rem', fontSize: '.82rem' }}>
                    <div><strong>{tx('requestDetailPage.labels.quotedQty', 'Quoted qty')}:</strong> {q.qty_quoted}</div>
                    <div><strong>{tx('requestDetailPage.labels.unitPrice', 'Unit price')}:</strong> ${parseFloat(q.unit_price_usd || 0).toFixed(2)}</div>
                    <div><strong>{tx('requestDetailPage.labels.freightEst', 'Freight est')}:</strong> {q.freight_est_usd ? `$${parseFloat(q.freight_est_usd).toFixed(2)}` : '—'}</div>
                    <div><strong>{tx('requestDetailPage.labels.leadTime', 'Lead time')}:</strong> {q.lead_time_days ? `${q.lead_time_days} ${tx('requestDetailPage.labels.days', 'days')}` : '—'}</div>
                  </div>
                  {q.notes && <p style={{ color: '#64748b', marginTop: '.6rem', marginBottom: 0 }}>{q.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
