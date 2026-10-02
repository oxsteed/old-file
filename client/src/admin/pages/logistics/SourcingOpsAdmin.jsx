import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { adminListSourcingRequests, adminListQuotes, adminAssignSourcingOperator, adminUpdateSourcingRequestStatus, adminListRecurringPrograms } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

const REQUEST_STATUSES = ['draft', 'quoted', 'pooled', 'procurement', 'private_label', 'cancelled', 'closed'];

export default function SourcingOpsAdmin() {
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ operator_user_id: '', status: '', notes: '' });

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      adminListSourcingRequests({ limit: 100 }),
      adminListQuotes({ limit: 50 }),
      adminListRecurringPrograms({ status: 'active' }),
    ])
      .then(([requestRes, quoteRes, programRes]) => {
        setRequests(requestRes.requests || []);
        setQuotes(quoteRes.data || []);
        setPrograms(programRes.data || []);
      })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const apply = async () => {
    if (!selected) return;
    try {
      if (form.operator_user_id) {
        await adminAssignSourcingOperator(selected.id, form.operator_user_id);
      }
      if (form.status) {
        await adminUpdateSourcingRequestStatus(selected.id, { status: form.status, notes: form.notes });
      }
      toast.success(t('adminSourcingOps.sourcingUpdated'));
      setSelected(null);
      setForm({ operator_user_id: '', status: '', notes: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('adminSourcingOps.title')}</h1>
        <p className="lx-page-sub">{t('adminSourcingOps.subtitle')}</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          [t('adminSourcingOps.stats.openRequests'), requests.filter((row) => !['closed', 'cancelled'].includes(row.status)).length, '🔍'],
          [t('adminSourcingOps.stats.submittedQuotes'), quotes.filter((row) => row.status === 'submitted').length, '💬'],
          [t('adminSourcingOps.stats.activePrograms'), programs.length, '🔁'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>

      {!loading && loadError && <AdminErrorState onRetry={load} />}

      <div className="lx-card" style={{ marginBottom:'1.5rem' }}>
        <div className="lx-section-header"><h2>{t('adminSourcingOps.queueTitle')}</h2></div>
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead><tr><th>{t('adminSourcingOps.queueTable.reference')}</th><th>{t('adminSourcingOps.queueTable.request')}</th><th>{t('adminSourcingOps.queueTable.status')}</th><th>{t('adminSourcingOps.queueTable.quotes')}</th><th>{t('adminSourcingOps.queueTable.operator')}</th><th></th></tr></thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>{request.reference}</td>
                  <td>{request.title}</td>
                  <td><span className="lx-status-pill" style={{ background:'#64748b' }}>{t(`logistics.status.${request.status}`, { defaultValue: request.status })}</span></td>
                  <td>{request.quote_count || 0}</td>
                  <td>{request.assigned_operator || '—'}</td>
                  <td><button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }} onClick={() => setSelected(request)}>{t('adminSourcingOps.manage')}</button></td>
                </tr>
              ))}
              {!loading && !loadError && requests.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8' }}>{t('adminSourcingOps.noRequests')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lx-card">
        <div className="lx-section-header"><h2>{t('adminSourcingOps.programsTitle')}</h2></div>
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead><tr><th>{t('adminSourcingOps.programsTable.program')}</th><th>{t('adminSourcingOps.programsTable.cadence')}</th><th>{t('adminSourcingOps.programsTable.nextRun')}</th><th>{t('adminSourcingOps.programsTable.lane')}</th><th>{t('adminSourcingOps.programsTable.status')}</th></tr></thead>
            <tbody>
              {programs.slice(0, 12).map((program) => (
                <tr key={program.id}>
                  <td>{program.title}</td>
                  <td>{program.cadence}</td>
                  <td>{program.next_run_date ? new Date(program.next_run_date).toLocaleDateString(i18n.language) : '—'}</td>
                  <td>{program.lane_name || t('adminSourcingOps.unassigned')}</td>
                  <td><span className="lx-status-pill" style={{ background: program.status === 'active' ? '#22c55e' : '#64748b' }}>{program.status}</span></td>
                </tr>
              ))}
              {!loading && !loadError && programs.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8' }}>{t('adminSourcingOps.noPrograms')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:440, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>{t('adminSourcingOps.modal.manageTitle', { reference: selected.reference })}</h3>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminSourcingOps.modal.assignOperator')}</label>
              <input className="lx-input" value={form.operator_user_id} onChange={(e) => setForm((f) => ({ ...f, operator_user_id: e.target.value }))} placeholder={t('adminSourcingOps.modal.operatorPlaceholder')} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminSourcingOps.modal.updateStatus')}</label>
              <select className="lx-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="">{t('adminSourcingOps.modal.noStatusChange')}</option>
                {REQUEST_STATUSES.map((status) => <option key={status} value={status}>{t(`logistics.status.${status}`, { defaultValue: status.replace(/_/g,' ') })}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminSourcingOps.modal.notes')}</label>
              <textarea className="lx-textarea" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={apply}>{t('adminSourcingOps.modal.apply')}</button>
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
