import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listOrders } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', quoted:'#f59e0b', approved:'#22c55e', awaiting_deposit:'#f97316',
  deposit_collected:'#8b5cf6', placed_with_supplier:'#3b82f6', in_production:'#06b6d4',
  production_complete:'#10b981', ready_for_pickup:'#22d3ee', in_transit:'#0284c7',
  customs_review:'#dc2626', cleared:'#16a34a', warehoused:'#7c3aed',
  allocated:'#0891b2', fulfilled:'#059669', closed:'#475569', cancelled:'#ef4444',
};

export default function OrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [status, setStatus]   = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    listOrders({ status: status||undefined, limit, offset:(page-1)*limit })
      .then(r => { setOrders(r.orders||[]); setTotal(r.total||0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status, page]);

  const STATUSES = Object.keys(STATUS_COLOR);

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('logistics.orders.title','Purchase Orders')}</h1>
        <p className="lx-page-sub">{t('logistics.orders.subtitle','Track your orders from placement through customs, warehousing, and delivery.')}</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
      </div>

      {loading && <div className="lx-loading">Loading…</div>}

      {!loading && orders.length === 0 && (
        <div className="lx-empty">
          <div className="lx-empty-icon">📦</div>
          <p>{t('logistics.orders.empty','No orders found.')}</p>
        </div>
      )}

      {orders.length > 0 && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>Reference</th><th>Product</th><th>Lane</th><th>Qty</th>
                <th>Landed Cost</th><th>Status</th><th>Expected</th><th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} onClick={() => navigate(`/logistics/orders/${o.id}`)} style={{ cursor:'pointer' }}>
                  <td><code style={{ fontSize:'.78rem' }}>{o.reference}</code></td>
                  <td style={{ fontWeight:600 }}>{o.product_title || '—'}</td>
                  <td style={{ fontSize:'.8rem', color:'#64748b' }}>
                    {o.origin_country} → {o.destination_country}
                  </td>
                  <td>{o.qty_ordered}</td>
                  <td style={{ fontWeight:700, color:'#f97316' }}>
                    ${parseFloat(o.total_landed_usd||0).toLocaleString()}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: STATUS_COLOR[o.status]||'#64748b' }}>
                      {o.status?.replace(/_/g,' ')}
                    </span>
                  </td>
                  <td style={{ fontSize:'.8rem' }}>
                    {o.expected_arrival_date ? new Date(o.expected_arrival_date).toLocaleDateString() : '—'}
                  </td>
                  <td><span className="lx-link">→</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Math.ceil(total/limit) > 1 && (
        <div className="lx-pagination" style={{ display:'flex', gap:'1rem', justifyContent:'center', marginTop:'1.5rem' }}>
          <button className="lx-btn-secondary" disabled={page<=1} onClick={() => setPage(p=>p-1)}>← Prev</button>
          <span style={{ lineHeight:'2.2' }}>{page} / {Math.ceil(total/limit)}</span>
          <button className="lx-btn-secondary" disabled={page>=Math.ceil(total/limit)} onClick={() => setPage(p=>p+1)}>Next →</button>
        </div>
      )}
      </div>
    </PageShell>
  );
}
