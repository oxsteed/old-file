import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListMarkupRules, adminUpdateMarkupRule, adminListFeeRules, adminUpdateFeeRule } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

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
      toast.success('Markup rule updated');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const saveFee = async () => {
    try {
      await adminUpdateFeeRule(editing.id, editForm);
      toast.success('Fee rule updated');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">💰 Pricing & Fee Rules</h1>
        <p className="lx-page-sub">Control stackable markup and fee layers across the logistics branch. Changes apply to all future cost calculations.</p>
      </div>

      <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:'.75rem', padding:'1rem', marginBottom:'1.5rem', fontSize:'.875rem' }}>
        <strong>📐 Pricing Stack Order:</strong> Product Cost → Origin Handling → Sourcing Fee → OxSteed Markup → Freight Est. → Customs/Admin → Warehouse → Split Fulfillment → Last Mile → Risk Surcharge
      </div>

      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1.5rem' }}>
        {['markup','fees'].map(t_ => (
          <button key={t_} style={{
            padding:'.6rem 1.25rem', border:'none', background:'none',
            fontWeight: tab===t_ ? 700 : 500, color: tab===t_ ? '#f97316' : '#64748b',
            borderBottom: tab===t_ ? '2px solid #f97316' : '2px solid transparent',
            marginBottom:'-2px', cursor:'pointer', textTransform:'capitalize',
          }} onClick={() => setTab(t_)}>{t_} Rules</button>
        ))}
      </div>

      {loading && <div className="lx-loading">Loading…</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {tab === 'markup' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr><th>Scope</th><th>Scope ID</th><th>Category</th><th>Markup %</th><th>Fixed (¢)</th><th>Priority</th><th>Active</th><th></th></tr>
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
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'fees' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr><th>Fee Type</th><th>Scope</th><th>% of Product</th><th>Fixed (¢)</th><th>Max (¢)</th><th>Active</th><th></th></tr>
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
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:380, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>
              {editing._type === 'fee' ? 'Edit Fee Rule' : 'Edit Markup Rule'}
            </h3>
            {editing._type !== 'fee' && (
              <div className="lx-form-group">
                <label className="lx-label">Markup % (decimal e.g. 0.20)</label>
                <input type="number" className="lx-input" step="0.01" value={editForm.markup_pct||''}
                  onChange={e => setEditForm(f=>({...f,markup_pct:e.target.value}))} />
              </div>
            )}
            {editing._type === 'fee' && (
              <>
                <div className="lx-form-group">
                  <label className="lx-label">% of Product (decimal)</label>
                  <input type="number" className="lx-input" step="0.001" value={editForm.pct_of_product||''}
                    onChange={e => setEditForm(f=>({...f,pct_of_product:e.target.value}))} />
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">Fixed Amount (cents)</label>
                  <input type="number" className="lx-input" value={editForm.amount_cents||''}
                    onChange={e => setEditForm(f=>({...f,amount_cents:e.target.value}))} />
                </div>
              </>
            )}
            <div className="lx-form-group">
              <label style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem' }}>
                <input type="checkbox" checked={!!editForm.is_active}
                  onChange={e => setEditForm(f=>({...f,is_active:e.target.checked}))} />
                Active
              </label>
            </div>
            <div style={{ display:'flex', gap:'.75rem', marginTop:'.5rem' }}>
              <button className="lx-btn-primary" onClick={editing._type==='fee' ? saveFee : saveMarkup}>Save</button>
              <button className="lx-btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
