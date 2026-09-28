import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listSourcingRequests, listSuppliers } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', open:'#22c55e', quoting:'#f59e0b', quoted:'#f97316',
  converting:'#8b5cf6', direct_order:'#3b82f6', pooled:'#06b6d4',
  procurement:'#10b981', cancelled:'#ef4444', closed:'#64748b',
};

export default function SourcingPage() {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [tab, setTab] = useState('my-requests');

  useEffect(() => {
    listSourcingRequests({ limit: 20 })
      .then(r => setRequests(r.requests || []))
      .catch(() => {})
      .finally(() => setLoadingReqs(false));
    listSuppliers({ limit: 20 })
      .then(r => setSuppliers(r.suppliers || []))
      .catch(() => {});
  }, []);

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'1rem' }}>
          <div>
            <h1 className="lx-page-title">{t('logistics.sourcing.title','Sourcing')}</h1>
            <p className="lx-page-sub">{t('logistics.sourcing.subtitle','Request, quote, and convert, from first inquiry to purchase order.')}</p>
          </div>
          <Link to="/logistics/requests/new" className="lx-btn-primary">
            + {t('logistics.sourcing.newRequest','New Request')}
          </Link>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1.5rem' }}>
        {[
          { key:'my-requests',  label: t('logistics.sourcing.myRequests','My Requests') },
          { key:'suppliers',    label: t('logistics.sourcing.suppliers','Suppliers') },
        ].map(tab_ => (
          <button key={tab_.key}
            style={{
              padding:'.6rem 1.25rem', border:'none', background:'none',
              fontWeight: tab === tab_.key ? 700 : 500,
              color: tab === tab_.key ? '#f97316' : '#64748b',
              borderBottom: tab === tab_.key ? '2px solid #f97316' : '2px solid transparent',
              marginBottom:'-2px', cursor:'pointer', fontSize:'.9rem',
            }}
            onClick={() => setTab(tab_.key)}
          >{tab_.label}</button>
        ))}
      </div>

      {tab === 'my-requests' && (
        <>
          {loadingReqs && <div className="lx-loading">Loading…</div>}
          {!loadingReqs && requests.length === 0 && (
            <div className="lx-empty">
              <div className="lx-empty-icon">🔍</div>
              <p>{t('logistics.sourcing.noRequests','You have no sourcing requests yet.')}</p>
              <Link to="/logistics/requests/new" className="lx-btn-primary">
                {t('logistics.sourcing.startFirst','Start Your First Request')}
              </Link>
            </div>
          )}
          {requests.length > 0 && (
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th>Reference</th><th>Title</th><th>Category</th>
                    <th>Lane</th><th>Qty</th><th>Status</th><th>Quotes</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id} style={{ cursor:'pointer' }} onClick={() => navigate(`/logistics/requests/${r.id}`)}>
                      <td><code style={{ fontSize:'.78rem', color:'#64748b' }}>{r.reference}</code></td>
                      <td style={{ fontWeight:600 }}>{r.title}</td>
                      <td>{r.category}</td>
                      <td>{r.origin_country && `${r.origin_country} → ${r.destination_country}`}</td>
                      <td>{r.target_qty ? `${r.target_qty} ${r.target_unit}` : '—'}</td>
                      <td>
                        <span className="lx-status-pill" style={{ background: STATUS_COLOR[r.status]||'#64748b' }}>
                          {r.status}
                        </span>
                      </td>
                      <td>{r.quote_count || 0}</td>
                      <td><span className="lx-link">View →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'suppliers' && (
        <div className="lx-campaign-grid">
          {suppliers.map(s => (
            <div key={s.id} className="lx-card" style={{ cursor:'default' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.5rem' }}>
                <span style={{ fontSize:'.75rem', color:'#64748b', fontWeight:700 }}>
                  🌍 {s.country} · {s.approved_categories?.slice(0,2).join(', ')}
                </span>
                <div style={{ display:'flex', gap:'.25rem' }}>
                  {Array.from({length:5}).map((_,i) => (
                    <span key={i} style={{ color: i < Math.round(s.quality_score||0) ? '#f97316' : '#e2e8f0' }}>★</span>
                  ))}
                </div>
              </div>
              <h3 style={{ fontWeight:700, margin:'0 0 .25rem', fontSize:'1rem' }}>{s.company_name}</h3>
              {s.city && <div style={{ fontSize:'.8rem', color:'#64748b' }}>{s.city}</div>}
              <div style={{ display:'flex', gap:'.5rem', marginTop:'.75rem', flexWrap:'wrap' }}>
                {s.approved_categories?.slice(0,3).map(c => (
                  <span key={c} style={{
                    background:'#f1f5f9', borderRadius:999, padding:'.15rem .6rem',
                    fontSize:'.72rem', fontWeight:600, color:'#475569',
                  }}>{c}</span>
                ))}
              </div>
              {s.product_count > 0 && (
                <div style={{ fontSize:'.78rem', color:'#94a3b8', marginTop:'.5rem' }}>
                  {s.product_count} {t('logistics.suppliers.products','products')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </div>
    </PageShell>
  );
}
