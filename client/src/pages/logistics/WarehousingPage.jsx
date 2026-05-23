import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listWarehouses, listInventoryReceipts, listAllocations, listDeliveries } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import '../../styles/logistics/LogisticsHomePage.css';

const RECEIPT_COLOR = {
  expected:'#94a3b8', receiving:'#f59e0b', reconciled:'#22c55e',
  discrepancy:'#dc2626', closed:'#475569',
};

export default function WarehousingPage() {
  const { t } = useTranslation();
  const [tab, setTab]               = useState('receipts');
  const [warehouses, setWarehouses] = useState([]);
  const [receipts, setReceipts]     = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
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
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const TABS = [
    { key:'receipts',    label: t('logistics.warehousing.receipts','Inventory Receipts') },
    { key:'allocations', label: t('logistics.warehousing.allocations','Allocations') },
    { key:'deliveries',  label: t('logistics.warehousing.deliveries','Delivery Orders') },
    { key:'warehouses',  label: t('logistics.warehousing.warehouses','Warehouses') },
  ];

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('logistics.warehousing.title','Warehousing & Distribution')}</h1>
        <p className="lx-page-sub">{t('logistics.warehousing.subtitle','Receive, reconcile, allocate, and release inventory to buyers.')}</p>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1.5rem' }}>
        {TABS.map(tb => (
          <button key={tb.key}
            style={{
              padding:'.6rem 1.25rem', border:'none', background:'none',
              fontWeight: tab === tb.key ? 700 : 500,
              color: tab === tb.key ? '#f97316' : '#64748b',
              borderBottom: tab === tb.key ? '2px solid #f97316' : '2px solid transparent',
              marginBottom:'-2px', cursor:'pointer', fontSize:'.875rem',
            }}
            onClick={() => setTab(tb.key)}
          >{tb.label}</button>
        ))}
      </div>

      {loading && <div className="lx-loading">Loading…</div>}

      {tab === 'warehouses' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'1rem' }}>
          {warehouses.map(w => (
            <div key={w.id} className="lx-card">
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.5rem' }}>
                <span style={{ fontSize:'.72rem', color:'#64748b', fontWeight:700 }}>🏭 {w.country} · {w.city}</span>
                {w.is_bonded && <span style={{ background:'#fef3c7', color:'#92400e', fontSize:'.7rem', padding:'.1rem .5rem', borderRadius:999, fontWeight:700 }}>Bonded</span>}
              </div>
              <h3 style={{ fontWeight:700, fontSize:'1rem', margin:'0 0 .4rem' }}>{w.name}</h3>
              <div style={{ fontSize:'.8rem', color:'#64748b' }}>
                {w.active_receipts} active receipts
                {w.total_sqft && ` · ${w.total_sqft.toLocaleString()} sqft`}
              </div>
            </div>
          ))}
          {warehouses.length === 0 && !loading && (
            <div className="lx-empty" style={{ gridColumn:'1/-1' }}>
              <div className="lx-empty-icon">🏭</div>
              <p>No warehouses configured yet.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'receipts' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>Reference</th><th>Warehouse</th><th>Expected</th>
                <th>Received</th><th>Shortage</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => (
                <tr key={r.id}>
                  <td><code style={{ fontSize:'.78rem' }}>{r.reference}</code></td>
                  <td>{r.warehouse_name}</td>
                  <td>{r.expected_qty}</td>
                  <td style={{ fontWeight: r.received_qty >= r.expected_qty ? 700 : 400,
                    color: r.received_qty >= r.expected_qty ? '#22c55e' : 'inherit' }}>
                    {r.received_qty || 0}
                  </td>
                  <td style={{ color: r.shortage_qty > 0 ? '#dc2626' : 'inherit' }}>
                    {r.shortage_qty || 0}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: RECEIPT_COLOR[r.status]||'#64748b' }}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
              {receipts.length === 0 && !loading && (
                <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8', padding:'2rem' }}>No inventory receipts.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'allocations' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>Buyer</th><th>Qty</th><th>Status</th><th>Warehouse</th><th>Release Method</th><th>Released</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map(a => (
                <tr key={a.id}>
                  <td>{a.buyer_name || a.buyer_user_id?.slice(0,8)+'…'}</td>
                  <td style={{ fontWeight:700 }}>{a.allocated_qty}</td>
                  <td>
                    <span className="lx-status-pill" style={{
                      background: {pending:'#94a3b8',ready:'#22c55e',released:'#3b82f6',delivered:'#10b981',disputed:'#ef4444'}[a.status]||'#64748b'
                    }}>{a.status}</span>
                  </td>
                  <td>{a.warehouse_name}</td>
                  <td style={{ fontSize:'.8rem' }}>{a.release_method?.replace(/_/g,' ')}</td>
                  <td style={{ fontSize:'.8rem', color:'#64748b' }}>
                    {a.released_at ? new Date(a.released_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
              {allocations.length === 0 && !loading && (
                <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8', padding:'2rem' }}>No allocations.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'deliveries' && (
        <div style={{ display:'grid', gap:'1rem' }}>
          {deliveries.map(d => (
            <div key={d.id} className="lx-card">
              <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'.5rem' }}>
                <div>
                  <code style={{ fontSize:'.78rem', color:'#64748b' }}>{d.reference}</code>
                  <div style={{ fontWeight:700, marginTop:'.2rem' }}>{d.recipient_name || '—'}</div>
                  <div style={{ fontSize:'.8rem', color:'#64748b' }}>
                    {d.delivery_city}, {d.delivery_country} · {d.method?.replace(/_/g,' ')}
                  </div>
                </div>
                <span className="lx-status-pill" style={{
                  background: {pending:'#94a3b8',assigned:'#3b82f6',in_transit:'#f59e0b',delivered:'#22c55e',failed:'#ef4444',cancelled:'#64748b'}[d.status]||'#64748b'
                }}>{d.status}</span>
              </div>
              {d.tracking_number && (
                <div style={{ fontSize:'.8rem', marginTop:'.5rem', color:'#64748b' }}>
                  📦 {d.carrier} · {d.tracking_number}
                </div>
              )}
            </div>
          ))}
          {deliveries.length === 0 && !loading && (
            <div className="lx-empty">
              <div className="lx-empty-icon">🚚</div>
              <p>No delivery orders.</p>
            </div>
          )}
        </div>
      )}
      </div>
    </PageShell>
  );
}
