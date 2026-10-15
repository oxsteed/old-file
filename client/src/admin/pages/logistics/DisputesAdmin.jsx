import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminListClaims, adminUpdateClaim, adminListRefundCases } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import '../../../styles/logistics/LogisticsWorkspaces.css';
import AdminErrorState from '../../lib/AdminErrorState';
import LogisticsModal from '../../../components/logistics/LogisticsModal';
import LogisticsStatusPill from '../../../components/logistics/LogisticsStatusPill';

const NS = 'adminLogisticsDisputes';
const CLAIM_STATUS_I18N = { open:'statusOpen', under_review:'statusUnderReview', approved:'statusApproved', rejected:'statusRejected', resolved:'statusResolved', escalated:'statusEscalated' };
const REFUND_STATUS_I18N = { pending:'statusPending', reviewing:'statusReviewing', approved:'statusApproved', processed:'statusProcessed', rejected:'statusRejected' };

export default function DisputesAdmin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('claims');
  const [claims, setClaims]   = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm]         = useState({});

  const statusLabel = (value) => {
    const map = tab === 'claims' ? CLAIM_STATUS_I18N : REFUND_STATUS_I18N;
    return map[value] ? t(`${NS}.${map[value]}`) : value;
  };

  const load = () => {
    setLoading(true);
    setLoadError(null);
    adminListClaims({ status: status||undefined })
      .then(r => setClaims(r.data||[]))
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
    adminListRefundCases({ status: status||undefined })
      .then(r => setRefunds(r.data||[]))
      .catch((err) => setLoadError(err));
  };
  useEffect(() => { load(); }, [status]);

  const save = async () => {
    // Claims only. Refund cases moved to the dual-admin refunds review page
    // (/admin/logistics/refunds): direct status/stripe_refund_id editing was
    // removed server-side. This tab is now a read-only queue with a link.
    try {
      await adminUpdateClaim(selected.id, form);
      toast.success(t(`${NS}.toastClaimUpdated`));
      setSelected(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">⚖️ {t(`${NS}.title`)}</h1>
        <p className="lx-page-sub">{t(`${NS}.subtitle`)}</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={tab} onChange={e => { setTab(e.target.value); setStatus(''); }}>
          <option value="claims">{t(`${NS}.tabClaims`)}</option>
          <option value="refunds">{t(`${NS}.tabRefunds`)}</option>
        </select>
        <select className="lx-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{t(`${NS}.allStatuses`)}</option>
          {(tab === 'claims' ? Object.keys(CLAIM_STATUS_I18N) : Object.keys(REFUND_STATUS_I18N)).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>

      {loading && <div className="lx-loading">{t(`${NS}.loading`)}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {tab === 'claims' && <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>{t(`${NS}.thReference`)}</th><th>{t(`${NS}.thType`)}</th><th>{t(`${NS}.thClaimant`)}</th>
              <th>{t(`${NS}.thAmount`)}</th><th>{t(`${NS}.thStatus`)}</th><th>{t(`${NS}.thCreated`)}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {claims.map(c => (
              <tr key={c.id}>
                <td><code style={{ fontSize:'.78rem' }}>{c.reference}</code></td>
                <td>
                  <span style={{ background:'var(--color-surface-2)', borderRadius:'.375rem', padding:'.15rem .5rem', fontSize:'.72rem', fontWeight:700 }}>
                    {t(`${NS}.claimType.${c.claim_type}`, { defaultValue: c.claim_type?.replace(/_/g,' ') || '' })}
                  </span>
                </td>
                <td style={{ fontSize:'.82rem' }}>{c.claimant_name || '—'}</td>
                <td style={{ fontWeight:700, color:'var(--color-primary)' }}>
                  {c.claimed_amount_usd ? `$${parseFloat(c.claimed_amount_usd).toLocaleString()}` : '—'}
                </td>
                <td>
                  <LogisticsStatusPill status={c.status} label={statusLabel(c.status)} />
                </td>
                <td style={{ fontSize:'.8rem' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                    onClick={() => { setSelected(c); setForm({ status: c.status, approved_amount_usd: c.approved_amount_usd || c.claimed_amount_usd, resolution_notes: c.resolution_notes||'' }); }}>
                    {t(`${NS}.review`)}
                  </button>
                </td>
              </tr>
            ))}
            {claims.length === 0 && !loading && !loadError && (
              <tr><td colSpan={7} className="lx-table-empty-cell">{t(`${NS}.noClaims`)}</td></tr>
            )}
          </tbody>
        </table>
      </div>}

      {tab === 'refunds' && (
        <div className="lx-table-wrap">
          <div className="lx-alert" role="note" style={{ marginBottom: '1rem' }}>
            {t('logistics.refunds.movedNotice')}{' '}
            <Link to="/admin/logistics/refunds">{t('logistics.refunds.openReviewPage')}</Link>
          </div>
          <table className="lx-table">
            <thead>
              <tr>
                <th>{t(`${NS}.thReference`)}</th><th>{t(`${NS}.thReason`)}</th><th>{t(`${NS}.thRequester`)}</th><th>{t(`${NS}.thRequested`)}</th><th>{t(`${NS}.thStatus`)}</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.id}>
                  <td><code style={{ fontSize:'.78rem' }}>{r.reference}</code></td>
                  <td>{r.refund_reason}</td>
                  <td style={{ fontSize:'.82rem' }}>{r.requester_name || '—'}</td>
                  <td style={{ fontWeight:700, color:'var(--color-primary)' }}>${parseFloat(r.requested_amount_usd || 0).toLocaleString()}</td>
                  <td><LogisticsStatusPill status={r.status} label={statusLabel(r.status)} /></td>
                </tr>
              ))}
              {refunds.length === 0 && !loading && !loadError && (
                <tr><td colSpan={5} className="lx-table-empty-cell">{t(`${NS}.noRefunds`)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'claims' && (
      <LogisticsModal
        open={!!selected}
        title={selected?.reference}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div style={{ fontSize:'.82rem', color:'var(--color-text-muted)', marginBottom:'1rem' }}>
              <>
                <strong>{t(`${NS}.modalClaimType`)}</strong> {t(`${NS}.claimType.${selected.claim_type}`, { defaultValue: selected.claim_type?.replace(/_/g,' ') || '' })}<br/>
                <strong>{t(`${NS}.modalDescription`)}</strong> {selected.description}
              </>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.updateStatus`)}</label>
              <select className="lx-select" value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                {Object.keys(CLAIM_STATUS_I18N).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.approvedAmount`)}</label>
              <input type="number" className="lx-input" value={form.approved_amount_usd||''}
                onChange={e => setForm(f=>({...f,approved_amount_usd:e.target.value}))} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.resolutionNotes`)}</label>
              <textarea className="lx-textarea" value={form.resolution_notes||''}
                onChange={e => setForm(f=>({...f,resolution_notes:e.target.value}))} />
            </div>
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={save}>{t(`${NS}.saveDecision`)}</button>
              <button className="lx-btn-secondary" onClick={() => setSelected(null)}>{t(`${NS}.cancel`)}</button>
            </div>
          </>
        )}
      </LogisticsModal>
      )}
    </div>
  );
}
