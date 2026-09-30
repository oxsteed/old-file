import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListShipments, adminAddMilestone } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

// Customs admin focuses on shipments at customs stages
const CUSTOMS_STATUSES = ['arrived_destination','customs_hold','customs_cleared'];

export default function CustomsAdmin() {
  const { t } = useTranslation();
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected]   = useState(null);
  const [form, setForm]           = useState({ action:'', notes:'' });
  const [saving, setSaving]       = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    // Filter to customs-relevant statuses
    const filterStatus = statusFilter || undefined;
    adminListShipments({ status: filterStatus, customs_queue: true })
      .then(r => {
        const rows = (r.data||[]).filter(s =>
          !statusFilter
            ? CUSTOMS_STATUSES.includes(s.status)
            : s.status === statusFilter
        );
        setShipments(rows);
      })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [statusFilter]);

  const applyAction = async () => {
    if (!form.action) { toast.error(t('adminCustoms.selectAction')); return; }
    setSaving(true);
    try {
      // Map action → milestone status
      const milestoneStatus = form.action === 'clear' ? 'customs_cleared' : 'customs_hold';
      await adminAddMilestone(selected.id, {
        status: milestoneStatus,
        location: 'Customs',
        notes: form.notes,
      });
      toast.success(form.action === 'clear' ? t('adminCustoms.markedCleared') : t('adminCustoms.markedHold'));
      setSelected(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  const RISK_COLOR = { low:'#22c55e', managed:'#f59e0b', restricted:'#dc2626', prohibited:'#7f1d1d' };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('adminCustoms.title')}</h1>
        <p className="lx-page-sub">{t('adminCustoms.subtitle')}</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('adminCustoms.allStages')}</option>
          {CUSTOMS_STATUSES.map(s => (
            <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
          ))}
        </select>
      </div>

      {loading && <div className="lx-loading">{t('common.loading')}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>{t('adminCustoms.table.shipment')}</th><th>{t('adminCustoms.table.route')}</th><th>{t('adminCustoms.table.freight')}</th>
              <th>{t('adminCustoms.table.laneRisk')}</th><th>{t('adminCustoms.table.complexity')}</th><th>{t('adminCustoms.table.eta')}</th><th>{t('adminCustoms.table.status')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shipments.map(s => (
              <tr key={s.id}>
                <td><code style={{ fontSize:'.78rem' }}>{s.reference}</code></td>
                <td style={{ fontSize:'.8rem', color:'#64748b' }}>
                  {s.origin_country} → {s.destination_country}
                </td>
                <td style={{ fontSize:'.78rem' }}>
                  <span style={{ background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .4rem' }}>
                    {s.freight_mode?.replace(/_/g,' ') || '—'}
                  </span>
                </td>
                <td>
                  {s.lane_risk_tier && (
                    <span className="lx-status-pill" style={{ background: RISK_COLOR[s.lane_risk_tier]||'#64748b' }}>
                      {s.lane_risk_tier}
                    </span>
                  )}
                </td>
                <td style={{ textAlign:'center' }}>
                  {s.customs_complexity ? `${s.customs_complexity}/5` : '—'}
                </td>
                <td style={{ fontSize:'.8rem' }}>
                  {s.eta ? new Date(s.eta).toLocaleDateString() : '—'}
                </td>
                <td>
                  <span className="lx-status-pill" style={{
                    background: s.status === 'customs_cleared' ? '#22c55e'
                      : s.status === 'customs_hold' ? '#dc2626' : '#f59e0b'
                  }}>
                    {s.status?.replace(/_/g,' ')}
                  </span>
                </td>
                <td>
                  {s.status !== 'customs_cleared' && (
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => { setSelected(s); setForm({ action:'', notes:'' }); }}>
{t('adminCustoms.review')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {shipments.length === 0 && !loading && !loadError && (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t('adminCustoms.noShipments')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:460, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.5rem' }}>{t('adminCustoms.modal.title', { reference: selected.reference })}</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              <strong>{t('adminCustoms.modal.route')}</strong> {selected.origin_country} → {selected.destination_country}<br/>
              <strong>{t('adminCustoms.modal.freight')}</strong> {selected.freight_mode?.replace(/_/g,' ') || '—'}<br/>
              <strong>{t('adminCustoms.modal.laneRisk')}</strong> {selected.lane_risk_tier || '—'} &nbsp;|&nbsp;
              <strong>{t('adminCustoms.modal.complexity')}</strong> {selected.customs_complexity || '—'}/5
            </div>

            {selected.status === 'customs_hold' && (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'.5rem', padding:'.75rem', marginBottom:'1rem', fontSize:'.82rem', color:'#b91c1c' }}>
                {t('adminCustoms.modal.holdWarning')}
              </div>
            )}

            <div className="lx-form-group">
              <label className="lx-label">{t('adminCustoms.modal.action')}</label>
              <select className="lx-select" value={form.action}
                onChange={e => setForm(f=>({...f,action:e.target.value}))}>
                <option value="">{t('adminCustoms.modal.selectOption')}</option>
                <option value="clear">{t('adminCustoms.modal.clearCustoms')}</option>
                <option value="hold">{t('adminCustoms.modal.placeOnHold')}</option>
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminCustoms.modal.notes')}</label>
              <textarea className="lx-textarea" rows={3} value={form.notes}
                onChange={e => setForm(f=>({...f,notes:e.target.value}))}
                placeholder={t('adminCustoms.modal.notesPlaceholder')} />
            </div>
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={applyAction} disabled={saving}>
                {saving ? t('common.saving') : t('adminCustoms.modal.apply')}
              </button>
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
