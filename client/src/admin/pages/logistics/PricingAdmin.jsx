import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListMarkupRules, adminUpdateMarkupRule, adminListFeeRules, adminUpdateFeeRule } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

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

      <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:'.75rem', padding:'1rem', marginBottom:'1.5rem', fontSize:'.875rem' }}>
        <strong>📐 {t(`${NS}.stackOrderLabel`, { defaultValue: 'Pricing Stack Order:' })}</strong> {t(`${NS}.stackOrder`, { defaultValue: 'Product Cost → Origin Handling → Sourcing Fee → OxSteed Markup → Freight Est. → Customs/Admin → Warehouse → Split Fulfillment → Last Mile → Risk Surcharge' })}
      </div>

      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1.5rem' }}>
        {[['markup', t(`${NS}.tabMarkup`, { defaultValue: 'Markup Rules' })], ['fees', t(`${NS}.tabFees`, { defaultValue: 'Fee Rules' })]].map(([t_, label]) => (
          <button key={t_} style={{
            padding:'.6rem 1.25rem', border:'none', background:'none',
            fontWeight: tab===t_ ? 700 : 500, color: tab===t_ ? '#f97316' : '#64748b',
            borderBottom: tab===t_ ? '2px solid #f97316' : '2px solid transparent',
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
                    <span style={{ background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .5rem', fontSize:'.75rem', fontWeight:700 }}>
                      {r.scope}
                    </span>
                  </td>
                  <td style={{ color:'#64748b', fontSize:'.8rem' }}>{r.scope_id || '—'}</td>
                  <td style={{ fontSize:'.8rem' }}>{r.category || '—'}</td>
                  <td style={{ fontWeight:700, color:'#f97316' }}>
                    {r.markup_pct !== null ? `${(parseFloat(r.markup_pct)*100).toFixed(1)}%` : '—'}
                  </td>
                  <td>{r.markup_fixed_cents || '—'}</td>
                  <td>{r.priority}</td>
                  <td>
                    <span style={{ color: r.is_active ? '#22c55e':'#ef4444', fontWeight:700 }}>
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
                <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t(`${NS}.emptyMarkup`, { defaultValue: 'No markup rules configured.' })}</td></tr>
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
                    <span style={{ background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .5rem', fontSize:'.75rem', fontWeight:700 }}>
                      {r.scope}
                    </span>
                  </td>
                  <td style={{ color:'#f97316', fontWeight:700 }}>
                    {r.pct_of_product ? `${(parseFloat(r.pct_of_product)*100).toFixed(2)}%` : '—'}
                  </td>
                  <td>{r.amount_cents ? `¢${r.amount_cents}` : '—'}</td>
                  <td style={{ color:'#94a3b8' }}>{r.max_cents ? `¢${r.max_cents}` : '—'}</td>
                  <td>
                    <span style={{ color: r.is_active ? '#22c55e':'#ef4444', fontWeight:700 }}>
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
                <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t(`${NS}.emptyFees`, { defaultValue: 'No fee rules configured.' })}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:380, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>
              {editing._type === 'fee' ? t(`${NS}.editFeeTitle`, { defaultValue: 'Edit Fee Rule' }) : t(`${NS}.editMarkupTitle`, { defaultValue: 'Edit Markup Rule' })}
            </h3>
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
          </div>
        </div>
      )}
    </div>
  );
}
