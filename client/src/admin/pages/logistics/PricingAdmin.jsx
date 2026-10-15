import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListMarkupRules, adminUpdateMarkupRule, adminListFeeRules, adminUpdateFeeRule } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import '../../../styles/logistics/LogisticsWorkspaces.css';
import AdminErrorState from '../../lib/AdminErrorState';
import LogisticsModal from '../../../components/logistics/LogisticsModal';

const NS = 'adminPricing';

export default function PricingAdmin() {
  const { t } = useTranslation();
  const [markupRules, setMarkupRules] = useState([]);
  const [feeRules, setFeeRules]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab]                 = useState('markup');
  const [editing, setEditing]         = useState(null);
  const [editForm, setEditForm]       = useState({});

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([adminListMarkupRules(), adminListFeeRules()])
      .then(([mRes, fRes]) => { setMarkupRules(mRes.data||[]); setFeeRules(fRes.data||[]); })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const saveMarkup = async () => {
    try {
      await adminUpdateMarkupRule(editing.id, editForm);
      toast.success(t(`${NS}.markupUpdatedToast`, { defaultValue: 'Markup rule updated' }));
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const saveFee = async () => {
    try {
      await adminUpdateFeeRule(editing.id, editForm);
      toast.success(t(`${NS}.feeUpdatedToast`, { defaultValue: 'Fee rule updated' }));
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">💰 {t(`${NS}.title`, { defaultValue: 'Pricing & Fee Rules' })}</h1>
        <p className="lx-page-sub">{t(`${NS}.subtitle`, { defaultValue: 'Control stackable markup and fee layers across the logistics branch. Changes apply to all future cost calculations.' })}</p>
      </div>

      <div style={{ background:'var(--color-primary-bg)', border:'1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)', borderRadius:'.75rem', padding:'1rem', marginBottom:'1.5rem', fontSize:'.875rem' }}>
        <strong>📐 {t(`${NS}.stackOrderLabel`, { defaultValue: 'Pricing Stack Order:' })}</strong> {t(`${NS}.stackOrder`, { defaultValue: 'Product Cost → Origin Handling → Sourcing Fee → OxSteed Markup → Freight Est. → Customs/Admin → Warehouse → Split Fulfillment → Last Mile → Risk Surcharge' })}
      </div>

      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid var(--color-border)', marginBottom:'1.5rem' }}>
        {[['markup', t(`${NS}.tabMarkup`, { defaultValue: 'Markup Rules' })], ['fees', t(`${NS}.tabFees`, { defaultValue: 'Fee Rules' })]].map(([t_, label]) => (
          <button key={t_} style={{
            padding:'.6rem 1.25rem', border:'none', background:'none',
            fontWeight: tab===t_ ? 700 : 500, color: tab===t_ ? 'var(--color-primary)' : 'var(--color-text-muted)',
            borderBottom: tab===t_ ? '2px solid var(--color-primary)' : '2px solid transparent',
            marginBottom:'-2px', cursor:'pointer', textTransform:'capitalize',
          }} onClick={() => setTab(t_)}>{label}</button>
        ))}
      </div>

      {loading && <div className="lx-loading">{t('common.loading')}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {tab === 'markup' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr><th>{t(`${NS}.thScope`, { defaultValue: 'Scope' })}</th><th>{t(`${NS}.thScopeId`, { defaultValue: 'Scope ID' })}</th><th>{t(`${NS}.thCategory`, { defaultValue: 'Category' })}</th><th>{t(`${NS}.thMarkupPct`, { defaultValue: 'Markup %' })}</th><th>{t(`${NS}.thFixedCents`, { defaultValue: 'Fixed (¢)' })}</th><th>{t(`${NS}.thPriority`, { defaultValue: 'Priority' })}</th><th>{t(`${NS}.thActive`, { defaultValue: 'Active' })}</th><th></th></tr>
            </thead>
            <tbody>
              {markupRules.map(r => (
                <tr key={r.id}>
                  <td>
                    <span style={{ background:'var(--color-surface-2)', borderRadius:'.375rem', padding:'.15rem .5rem', fontSize:'.75rem', fontWeight:700 }}>
                      {r.scope}
                    </span>
                  </td>
                  <td style={{ color:'var(--color-text-muted)', fontSize:'.8rem' }}>{r.scope_id || '—'}</td>
                  <td style={{ fontSize:'.8rem' }}>{r.category || '—'}</td>
                  <td style={{ fontWeight:700, color:'var(--color-primary)' }}>
                    {r.markup_pct !== null ? `${(parseFloat(r.markup_pct)*100).toFixed(1)}%` : '—'}
                  </td>
                  <td>{r.markup_fixed_cents || '—'}</td>
                  <td>{r.priority}</td>
                  <td>
                    <span style={{ color: r.is_active ? 'var(--color-success)':'var(--color-error)', fontWeight:700 }}>
                      {r.is_active ? '●':'○'}
                    </span>
                  </td>
                  <td>
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => { setEditing(r); setEditForm({ markup_pct: r.markup_pct, priority: r.priority, is_active: r.is_active, description: r.description }); }}>
                      {t(`${NS}.edit`, { defaultValue: 'Edit' })}
                    </button>
                  </td>
                </tr>
              ))}
              {markupRules.length === 0 && !loading && !loadError && (
                <tr><td colSpan={8} className="lx-table-empty-cell">{t(`${NS}.emptyMarkup`, { defaultValue: 'No markup rules configured.' })}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'fees' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr><th>{t(`${NS}.thFeeType`, { defaultValue: 'Fee Type' })}</th><th>{t(`${NS}.thScope`, { defaultValue: 'Scope' })}</th><th>{t(`${NS}.thPctOfProduct`, { defaultValue: '% of Product' })}</th><th>{t(`${NS}.thFixedCents`, { defaultValue: 'Fixed (¢)' })}</th><th>{t(`${NS}.thMaxCents`, { defaultValue: 'Max (¢)' })}</th><th>{t(`${NS}.thActive`, { defaultValue: 'Active' })}</th><th></th></tr>
            </thead>
            <tbody>
              {feeRules.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight:700 }}>{r.fee_type?.replace(/_/g,' ')}</td>
                  <td>
                    <span style={{ background:'var(--color-surface-2)', borderRadius:'.375rem', padding:'.15rem .5rem', fontSize:'.75rem', fontWeight:700 }}>
                      {r.scope}
                    </span>
                  </td>
                  <td style={{ color:'var(--color-primary)', fontWeight:700 }}>
                    {r.pct_of_product ? `${(parseFloat(r.pct_of_product)*100).toFixed(2)}%` : '—'}
                  </td>
                  <td>{r.amount_cents ? `¢${r.amount_cents}` : '—'}</td>
                  <td style={{ color:'var(--color-text-faint)' }}>{r.max_cents ? `¢${r.max_cents}` : '—'}</td>
                  <td>
                    <span style={{ color: r.is_active ? 'var(--color-success)':'var(--color-error)', fontWeight:700 }}>
                      {r.is_active ? '●':'○'}
                    </span>
                  </td>
                  <td>
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => { setEditing({...r,_type:'fee'}); setEditForm({ amount_cents:r.amount_cents, pct_of_product:r.pct_of_product, is_active:r.is_active }); }}>
                      {t(`${NS}.edit`, { defaultValue: 'Edit' })}
                    </button>
                  </td>
                </tr>
              ))}
              {feeRules.length === 0 && !loading && !loadError && (
                <tr><td colSpan={7} className="lx-table-empty-cell">{t(`${NS}.emptyFees`, { defaultValue: 'No fee rules configured.' })}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      <LogisticsModal
        open={!!editing}
        title={editing && (editing._type === 'fee' ? t(`${NS}.editFeeTitle`, { defaultValue: 'Edit Fee Rule' }) : t(`${NS}.editMarkupTitle`, { defaultValue: 'Edit Markup Rule' }))}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <>
            {editing._type !== 'fee' && (
              <div className="lx-form-group">
                <label className="lx-label">{t(`${NS}.markupPctLabel`, { defaultValue: 'Markup % (decimal e.g. 0.20)' })}</label>
                <input type="number" className="lx-input" step="0.01" value={editForm.markup_pct||''}
                  onChange={e => setEditForm(f=>({...f,markup_pct:e.target.value}))} />
              </div>
            )}
            {editing._type === 'fee' && (
              <>
                <div className="lx-form-group">
                  <label className="lx-label">{t(`${NS}.pctOfProductLabel`, { defaultValue: '% of Product (decimal)' })}</label>
                  <input type="number" className="lx-input" step="0.001" value={editForm.pct_of_product||''}
                    onChange={e => setEditForm(f=>({...f,pct_of_product:e.target.value}))} />
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">{t(`${NS}.fixedAmountLabel`, { defaultValue: 'Fixed Amount (cents)' })}</label>
                  <input type="number" className="lx-input" value={editForm.amount_cents||''}
                    onChange={e => setEditForm(f=>({...f,amount_cents:e.target.value}))} />
                </div>
              </>
            )}
            <div className="lx-form-group">
              <label style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem' }}>
                <input type="checkbox" checked={!!editForm.is_active}
                  onChange={e => setEditForm(f=>({...f,is_active:e.target.checked}))} />
                {t(`${NS}.activeLabel`, { defaultValue: 'Active' })}
              </label>
            </div>
            <div style={{ display:'flex', gap:'.75rem', marginTop:'.5rem' }}>
              <button className="lx-btn-primary" onClick={editing._type==='fee' ? saveFee : saveMarkup}>{t('common.save')}</button>
              <button className="lx-btn-secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
            </div>
          </>
        )}
      </LogisticsModal>
    </div>
  );
}
