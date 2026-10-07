import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listShipments } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  planned:'#94a3b8', booked:'#3b82f6', origin_received:'#f59e0b',
  consolidating:'#f97316', departed_origin:'#8b5cf6', transshipment:'#7c3aed',
  arrived_destination:'#06b6d4', customs_hold:'#dc2626', customs_cleared:'#22c55e',
  delivered_to_warehouse:'#10b981', receiving:'#0284c7', allocation_ready:'#059669',
  distributed:'#16a34a', completed:'#15803d', exception:'#ef4444',
};

const LIFECYCLE = [
  'planned','booked','origin_received','consolidating','departed_origin',
  'transshipment','arrived_destination','customs_hold','customs_cleared',
  'delivered_to_warehouse','receiving','allocation_ready','distributed','completed',
];

export default function ShipmentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [shipments, setShipments] = useState([]);
  const [total, setTotal]         = useState(0);
  const [status, setStatus]       = useState('');
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    setLoading(true);
    listShipments({ status: status||undefined, limit:50 })
      .then(r => { setShipments(r.shipments||[]); setTotal(r.total||0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('logistics.shipments.title','Shipments')}</h1>
        <p className="lx-page-sub">{t('logistics.shipments.subtitle','Track shipments from origin through customs to warehouse receipt.')}</p>
      </div>

      {/* Lifecycle legend */}
      <div style={{ overflowX:'auto', marginBottom:'1.5rem' }}>
        <div style={{ display:'flex', gap:'.5rem', padding:'.75rem 0', minWidth:'max-content' }}>
          {LIFECYCLE.map((s, i) => (
            <React.Fragment key={s}>
              <button
                onClick={() => setStatus(status === s ? '' : s)}
                style={{
                  padding:'.3rem .75rem', borderRadius:999,
                  border: `2px solid ${STATUS_COLOR[s]}`,
                  background: status === s ? STATUS_COLOR[s] : 'transparent',
                  color: status === s ? '#fff' : STATUS_COLOR[s],
                  fontWeight:700, fontSize:'.72rem', cursor:'pointer', whiteSpace:'nowrap',
                }}
              >{s.replace(/_/g,' ')}</button>
              {i < LIFECYCLE.length - 1 && <span style={{ color:'#cbd5e1', alignSelf:'center' }}>→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {loading && <div className="lx-loading">{t('logistics.shipments.loading')}</div>}

      {!loading && shipments.length === 0 && (
        <div className="lx-empty">
          <div className="lx-empty-icon">🚢</div>
          <p>{t('logistics.shipments.empty','No shipments found.')}</p>
        </div>
      )}

      {shipments.length > 0 && (
        <div style={{ display:'grid', gap:'1rem' }}>
          {shipments.map(s => (
            <div key={s.id} className="lx-card" style={{ cursor:'pointer', display:'grid', gridTemplateColumns:'1fr auto', gap:'1rem' }}
              onClick={() => navigate(`/logistics/shipments/${s.id}`)}>
              <div>
                <div style={{ fontSize:'.75rem', color:'#64748b', fontWeight:700, marginBottom:'.25rem' }}>
                  {s.origin_country} → {s.destination_country} · {s.freight_option?.replace(/_/g,' ')} · {s.carrier || 'No carrier'}
                </div>
                <div style={{ fontWeight:700, fontSize:'.95rem', marginBottom:'.35rem' }}>
                  <code style={{ color:'#64748b', marginRight:'.5rem', fontSize:'.8rem' }}>{s.reference}</code>
                  {s.lane_name}
                </div>
                <div style={{ display:'flex', gap:'1rem', fontSize:'.8rem', color:'#64748b', flexWrap:'wrap' }}>
                  {s.tracking_number && <span>🔍 {s.tracking_number}</span>}
                  {s.total_weight_kg && <span>⚖️ {s.total_weight_kg} kg</span>}
                  {s.total_cbm && <span>📦 {s.total_cbm} CBM</span>}
                  {s.eta && <span>🕐 ETA {new Date(s.eta).toLocaleDateString()}</span>}
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <span className="lx-status-pill" style={{ background: STATUS_COLOR[s.status]||'#64748b' }}>
                  {s.status?.replace(/_/g,' ')}
                </span>
                {s.status === 'exception' && (
                  <div style={{ color:'#ef4444', fontWeight:700, fontSize:'.8rem', marginTop:'.3rem' }}>⚠ Exception</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </PageShell>
  );
}
