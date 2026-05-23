import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listCampaigns, listLanes } from '../../api/logistics';
import '../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLOR = {
  draft:'#94a3b8', open:'#22c55e', pledging:'#f59e0b', deposit_phase:'#f97316',
  locked:'#8b5cf6', placed:'#3b82f6', in_transit:'#06b6d4',
  completed:'#10b981', cancelled:'#ef4444',
};

export default function CampaignsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal]         = useState(0);
  const [lanes, setLanes]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const status  = params.get('status')  || '';
  const laneId  = params.get('lane_id') || '';
  const open    = params.get('open')    || '';
  const page    = parseInt(params.get('page') || '1');
  const limit   = 20;

  const load = useCallback(() => {
    setLoading(true);
    listCampaigns({
      status:   status || undefined,
      lane_id:  laneId || undefined,
      open:     open === 'true' ? 'true' : undefined,
      limit,
      offset:   (page - 1) * limit,
    })
      .then(r => { setCampaigns(r.orders || []); setTotal(r.total || 0); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, laneId, open, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    listLanes().then(r => setLanes(r.data || [])).catch(() => {});
  }, []);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'1rem' }}>
          <div>
            <h1 className="lx-page-title">{t('logistics.campaigns.title','Pooled Campaigns')}</h1>
            <p className="lx-page-sub">{t('logistics.campaigns.subtitle','Join group buying campaigns to unlock MOQ pricing across lanes.')}</p>
          </div>
          <Link to="/logistics/requests/new" className="lx-btn-primary">
            + {t('logistics.campaigns.startRequest','Start a Request')}
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="lx-filter-bar">
        <select className="lx-select" value={status} onChange={e => { setParams(p => { p.set('status',e.target.value); p.set('page','1'); return p; }); }}>
          <option value="">{t('logistics.campaigns.allStatuses','All Statuses')}</option>
          {['open','pledging','deposit_phase','locked','placed','in_transit','completed','cancelled'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
          ))}
        </select>
        <select className="lx-select" value={laneId} onChange={e => setParams(p => { p.set('lane_id',e.target.value); p.set('page','1'); return p; })}>
          <option value="">{t('logistics.campaigns.allLanes','All Lanes')}</option>
          {lanes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <label style={{ display:'flex', alignItems:'center', gap:'.4rem', fontSize:'.85rem', fontWeight:600 }}>
          <input type="checkbox" checked={open==='true'} onChange={e => setParams(p => { p.set('open',e.target.checked?'true':''); p.set('page','1'); return p; })} />
          {t('logistics.campaigns.openOnly','Open Only')}
        </label>
      </div>

      {loading && <div className="lx-loading">{t('common.loading','Loading…')}</div>}
      {error   && <div className="lx-error">{error}</div>}

      {!loading && campaigns.length === 0 && (
        <div className="lx-empty">
          <div className="lx-empty-icon">📦</div>
          <p>{t('logistics.campaigns.empty','No campaigns found. Try different filters or start a sourcing request.')}</p>
          <Link to="/logistics/requests/new" className="lx-btn-primary">{t('logistics.campaigns.startRequest','Start a Request')}</Link>
        </div>
      )}

      <div className="lx-campaign-grid">
        {campaigns.map(c => (
          <div key={c.id} className="lx-campaign-card" onClick={() => navigate(`/logistics/campaigns/${c.id}`)}>
            <div className="lx-campaign-lane">
              🌐 {c.origin_country} → {c.destination_country}
              {c.lane_name && <span> · {c.lane_name}</span>}
            </div>
            <h3 className="lx-campaign-title">{c.title}</h3>
            {c.product_title && (
              <div className="lx-campaign-product">
                {c.product_category} · {c.product_title}
              </div>
            )}
            <div className="lx-moq-bar-wrap">
              <div className="lx-moq-bar" style={{ width:`${Math.min(c.moq_pct || 0, 100)}%` }} />
            </div>
            <div className="lx-campaign-meta">
              <span style={{ fontWeight:700 }}>
                {c.current_committed_qty || 0} / {c.target_moq}
                {' '}{t('logistics.campaigns.units','units')}
                {' '}({c.moq_pct || 0}%)
              </span>
              <span className="lx-status-pill" style={{ background: STATUS_COLOR[c.status]||'#64748b' }}>
                {c.status?.replace(/_/g,' ')}
              </span>
            </div>
            {c.unit_landed_cost_usd && (
              <div style={{ fontSize:'.82rem', color:'#f97316', fontWeight:700, marginTop:'.5rem' }}>
                ${parseFloat(c.unit_landed_cost_usd).toFixed(2)} {t('logistics.campaigns.perUnit','/unit landed')}
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:'.5rem' }}>
              {c.participant_count && (
                <span style={{ fontSize:'.75rem', color:'#64748b' }}>
                  👤 {c.participant_count} {t('logistics.campaigns.participants','participants')}
                </span>
              )}
              {c.close_date && (
                <span className="lx-campaign-close">
                  {t('logistics.campaigns.closes','Closes')} {new Date(c.close_date).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="lx-pagination">
          <button className="lx-btn-secondary" disabled={page<=1}
            onClick={() => setParams(p => { p.set('page', page-1); return p; })}>
            ← {t('common.prev','Prev')}
          </button>
          <span>{page} / {totalPages}</span>
          <button className="lx-btn-secondary" disabled={page>=totalPages}
            onClick={() => setParams(p => { p.set('page', page+1); return p; })}>
            {t('common.next','Next')} →
          </button>
        </div>
      )}

      <style>{`
        .lx-loading { text-align:center; padding:3rem; color:#64748b; }
        .lx-error   { background:#fee2e2; border-radius:.75rem; padding:1rem; color:#b91c1c; margin-bottom:1rem; }
        .lx-empty   { text-align:center; padding:4rem 2rem; }
        .lx-empty-icon { font-size:3rem; margin-bottom:1rem; }
        .lx-pagination { display:flex; gap:1rem; align-items:center; justify-content:center; margin-top:2rem; }
      `}</style>
    </div>
  );
}
