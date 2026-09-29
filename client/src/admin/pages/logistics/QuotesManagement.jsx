import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListQuotes, adminReviewQuote } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

const STATUS_COLOR = {
  submitted:'#f59e0b', under_review:'#3b82f6', accepted:'#22c55e', rejected:'#ef4444', expired:'#94a3b8',
};

export default function QuotesManagement() {
  const { t, i18n } = useTranslation();
  const [quotes, setQuotes]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus]     = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm]         = useState({ action:'', admin_notes:'' });

  const load = () => {
    setLoading(true);
    setLoadError(null);
    adminListQuotes({ status: status||undefined })
      .then(r => setQuotes(r.data||[]))
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [status]);

  const review = async () => {
    if (!form.action) { toast.error(t('logistics.admin.quotes.selectDecisionError')); return; }
    try {
      await adminReviewQuote(selected.id, form);
      toast.success(form.action === 'accepted'
        ? t('logistics.admin.quotes.reviewAccepted')
        : t('logistics.admin.quotes.reviewRejected'));
      setSelected(null);
      load();
    } catch (err) { toast.error(t('logistics.admin.quotes.reviewFailed')); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">💬 {t('logistics.admin.quotes.title')}</h1>
        <p className="lx-page-sub">{t('logistics.admin.quotes.subtitle')}</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{t('logistics.admin.quotes.allStatuses')}</option>
          {Object.keys(STATUS_COLOR).map(s => <option key={s} value={s}>{t(`logistics.admin.quotes.statuses.${s}`, { defaultValue: s })}</option>)}
        </select>
      </div>

      {loading && <div className="lx-loading">{t('logistics.admin.quotes.loading')}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>{t('logistics.admin.quotes.reference')}</th><th>{t('logistics.admin.quotes.sourcingRequest')}</th><th>{t('logistics.admin.quotes.supplier')}</th>
              <th>{t('logistics.admin.quotes.unitPrice')}</th><th>{t('logistics.admin.quotes.moq')}</th><th>{t('logistics.admin.quotes.leadDays')}</th><th>{t('logistics.admin.quotes.status')}</th><th>{t('logistics.admin.quotes.submitted')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {quotes.map(q => (
              <tr key={q.id}>
                <td><code style={{ fontSize:'.78rem' }}>{q.reference || `QT-${q.id}`}</code></td>
                <td style={{ fontSize:'.82rem', color:'#64748b' }}>{q.sourcing_ref || q.sourcing_request_id}</td>
                <td style={{ fontWeight:600 }}>{q.supplier_name || '—'}</td>
                <td style={{ fontWeight:700, color:'#f97316' }}>
                  {q.unit_price_usd ? `$${parseFloat(q.unit_price_usd).toFixed(2)}` : '—'}
                </td>
                <td>{q.moq ? q.moq.toLocaleString() : '—'}</td>
                <td>{q.lead_time_days ? `${q.lead_time_days}d` : '—'}</td>
                <td>
                  <span className="lx-status-pill" style={{ background: STATUS_COLOR[q.status]||'#64748b' }}>
                    {t(`logistics.admin.quotes.statuses.${q.status}`, { defaultValue: q.status || t('logistics.admin.unknownStatus') })}
                  </span>
                </td>
                <td style={{ fontSize:'.8rem' }}>{q.created_at ? new Date(q.created_at).toLocaleDateString(i18n.language) : '—'}</td>
                <td>
                  {q.status === 'submitted' && (
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => { setSelected(q); setForm({ action:'', admin_notes:'' }); }}>
                      {t('logistics.admin.quotes.review')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {quotes.length === 0 && !loading && !loadError && (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t('logistics.admin.quotes.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:480, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.5rem' }}>{t('logistics.admin.quotes.reviewTitle')}</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              <strong>{t('logistics.admin.quotes.supplierLabel')}:</strong> {selected.supplier_name}<br/>
              <strong>{t('logistics.admin.quotes.unitPriceLabel')}:</strong> ${parseFloat(selected.unit_price_usd||0).toFixed(2)}<br/>
              <strong>{t('logistics.admin.quotes.moqLabel')}:</strong> {selected.moq?.toLocaleString(i18n.language)}<br/>
              <strong>{t('logistics.admin.quotes.leadTime')}:</strong> {selected.lead_time_days} {t('logistics.admin.quotes.days')}<br/>
              {selected.freight_included && <><strong>{t('logistics.admin.quotes.freightIncluded')}:</strong> {t('logistics.admin.quotes.yes')}<br/></>}
              {selected.notes && <><strong>{t('logistics.admin.quotes.supplierNotes')}:</strong> {selected.notes}</>}
            </div>
            {selected.sample_price_usd && (
              <div style={{ background:'#f0fdf4', borderRadius:'.5rem', padding:'.75rem', marginBottom:'1rem', fontSize:'.82rem' }}>
                {t('logistics.admin.quotes.sampleAvailable')}: <strong>${parseFloat(selected.sample_price_usd).toFixed(2)}</strong>
                {selected.sample_lead_days && ` (${selected.sample_lead_days}${t('logistics.admin.quotes.dayAbbrev')} ${t('logistics.admin.quotes.leadShort')})`}
              </div>
            )}
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.admin.quotes.decision')}</label>
              <select className="lx-select" value={form.action} onChange={e => setForm(f=>({...f,action:e.target.value}))}>
                <option value="">— {t('logistics.admin.quotes.choose')} —</option>
                <option value="accepted">{t('logistics.admin.quotes.accept')}</option>
                <option value="rejected">{t('logistics.admin.quotes.reject')}</option>
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.admin.quotes.adminNotes')}</label>
              <textarea className="lx-textarea" value={form.admin_notes}
                onChange={e => setForm(f=>({...f,admin_notes:e.target.value}))} />
            </div>
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={review}>{t('logistics.admin.quotes.submitDecision')}</button>
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>{t('logistics.admin.quotes.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
