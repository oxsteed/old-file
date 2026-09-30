import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listLanes, adminCreateLane, adminUpdateLane, listTradeRules } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

const RISK_TIERS   = ['low','managed','restricted','prohibited'];
const FREIGHT_OPTS = ['air','sea_fcl','sea_lcl','road','rail','multimodal','courier','express'];
const FULFILLMENT  = ['direct','pooled','freight_forward','distributor','recurring','private_label'];

const NS = 'adminLogisticsLanes';
const RISK_I18N = { low:'riskLow', managed:'riskManaged', restricted:'riskRestricted', prohibited:'riskProhibited' };
const FULFILLMENT_I18N = { direct:'fulDirect', pooled:'fulPooled', freight_forward:'fulFreightForward', distributor:'fulDistributor', recurring:'fulRecurring', private_label:'fulPrivateLabel' };
const FREIGHT_I18N = { air:'freightAir', sea_fcl:'freightSeaFcl', sea_lcl:'freightSeaLcl', road:'freightRoad', rail:'freightRail', multimodal:'freightMultimodal', courier:'freightCourier', express:'freightExpress' };

export default function LanesManagement() {
  const { t } = useTranslation();
  const [lanes, setLanes]   = useState([]);
  const [rules, setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editLane, setEditLane] = useState(null);
  const [form, setForm]     = useState({
    code:'', name:'', description:'', origin_country:'', destination_country:'',
    risk_tier:'low', fulfillment_model:'direct', default_markup_pct:0.15,
    customs_complexity:2, requires_business_verification:false,
    requires_manual_approval:false, is_active:true,
    freight_options:[], notes:'',
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([listLanes({ isActive: null }), listTradeRules()])
      .then(([lRes, rRes]) => { setLanes(lRes.data||[]); setRules(rRes.data||[]); })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openEdit = lane => {
    setEditLane(lane);
    setForm({ ...lane, freight_options: lane.freight_options||[] });
    setShowForm(true);
  };

  const openCreate = () => {
    setEditLane(null);
    setForm({ code:'', name:'', description:'', origin_country:'', destination_country:'',
      risk_tier:'low', fulfillment_model:'direct', default_markup_pct:0.15,
      customs_complexity:2, requires_business_verification:false,
      requires_manual_approval:false, is_active:true, freight_options:[], notes:'',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.code || !form.name || !form.origin_country || !form.destination_country) {
      toast.error(t(`${NS}.toastMissingFields`));
      return;
    }
    setSaving(true);
    try {
      if (editLane) { await adminUpdateLane(editLane.id, form); toast.success(t(`${NS}.toastLaneUpdated`)); }
      else          { await adminCreateLane(form); toast.success(t(`${NS}.toastLaneCreated`)); }
      setShowForm(false); load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  const set = (k, v) => setForm(f => ({...f, [k]: v}));
  const toggleFreight = opt => set('freight_options',
    form.freight_options.includes(opt)
      ? form.freight_options.filter(x => x !== opt)
      : [...form.freight_options, opt]
  );

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'1rem' }}>
          <div>
            <h1 className="lx-page-title">🛣 {t(`${NS}.title`)}</h1>
            <p className="lx-page-sub">{t(`${NS}.subtitle`)}</p>
          </div>
          <button className="lx-btn-primary" onClick={openCreate}>{t(`${NS}.newLane`)}</button>
        </div>
      </div>

      {loading && <div className="lx-loading">{t(`${NS}.loading`)}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {showForm && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'2px solid #f97316' }}>
          <h3 style={{ fontWeight:700, marginBottom:'1.25rem' }}>{editLane ? t(`${NS}.formEditTitle`) : t(`${NS}.formCreateTitle`)}</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            {!editLane && <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.code`)}</label>
              <input className="lx-input" value={form.code} placeholder="cn_us_wholesale"
                onChange={e => set('code', e.target.value.toLowerCase().replace(/\s/g,'_'))} />
            </div>}
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.name`)}</label>
              <input className="lx-input" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.originCountry`)}</label>
              <input className="lx-input" value={form.origin_country} maxLength={2}
                onChange={e => set('origin_country', e.target.value.toUpperCase())} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.destinationCountry`)}</label>
              <input className="lx-input" value={form.destination_country} maxLength={2}
                onChange={e => set('destination_country', e.target.value.toUpperCase())} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.riskTier`)}</label>
              <select className="lx-select" value={form.risk_tier} onChange={e => set('risk_tier', e.target.value)}>
                {RISK_TIERS.map(rt => <option key={rt} value={rt}>{t(`${NS}.${RISK_I18N[rt]}`)}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.fulfillmentModel`)}</label>
              <select className="lx-select" value={form.fulfillment_model} onChange={e => set('fulfillment_model', e.target.value)}>
                {FULFILLMENT.map(f => <option key={f} value={f}>{t(`${NS}.${FULFILLMENT_I18N[f]}`)}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.defaultMarkup`)}</label>
              <input type="number" className="lx-input" value={form.default_markup_pct} step="0.01"
                onChange={e => set('default_markup_pct', parseFloat(e.target.value))} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.customsComplexity`)}</label>
              <input type="number" className="lx-input" value={form.customs_complexity} min="1" max="5"
                onChange={e => set('customs_complexity', parseInt(e.target.value))} />
            </div>
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{t(`${NS}.freightOptions`)}</label>
            <div style={{ display:'flex', gap:'.5rem', flexWrap:'wrap', marginTop:'.4rem' }}>
              {FREIGHT_OPTS.map(opt => (
                <button key={opt}
                  onClick={() => toggleFreight(opt)}
                  style={{
                    padding:'.25rem .75rem', borderRadius:999, border:'2px solid',
                    borderColor: form.freight_options.includes(opt) ? '#f97316' : '#e2e8f0',
                    background: form.freight_options.includes(opt) ? '#fff7ed' : 'transparent',
                    color: form.freight_options.includes(opt) ? '#f97316' : '#64748b',
                    fontWeight:600, fontSize:'.78rem', cursor:'pointer',
                  }}
                >{t(`${NS}.${FREIGHT_I18N[opt]}`)}</button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap', marginBottom:'1rem' }}>
            <label style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem' }}>
              <input type="checkbox" checked={form.requires_business_verification}
                onChange={e => set('requires_business_verification', e.target.checked)} />
              {t(`${NS}.businessVerificationRequired`)}
            </label>
            <label style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem' }}>
              <input type="checkbox" checked={form.requires_manual_approval}
                onChange={e => set('requires_manual_approval', e.target.checked)} />
              {t(`${NS}.manualApprovalRequired`)}
            </label>
            <label style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem' }}>
              <input type="checkbox" checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)} />
              {t(`${NS}.active`)}
            </label>
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{t(`${NS}.notes`)}</label>
            <textarea className="lx-textarea" value={form.notes||''} onChange={e => set('notes', e.target.value)} />
          </div>
          <div style={{ display:'flex', gap:'.75rem' }}>
            <button className="lx-btn-primary" onClick={save} disabled={saving}>
              {saving ? t(`${NS}.saving`) : (editLane ? t(`${NS}.updateLane`) : t(`${NS}.createLane`))}
            </button>
            <button className="lx-btn-secondary" onClick={() => setShowForm(false)}>{t(`${NS}.cancel`)}</button>
          </div>
        </div>
      )}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>{t(`${NS}.thCode`)}</th><th>{t(`${NS}.thName`)}</th><th>{t(`${NS}.thRoute`)}</th><th>{t(`${NS}.thRisk`)}</th>
              <th>{t(`${NS}.thMarkup`)}</th><th>{t(`${NS}.thCustoms`)}</th><th>{t(`${NS}.thFlags`)}</th><th>{t(`${NS}.thStatus`)}</th><th>{t(`${NS}.thPos`)}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {lanes.map(l => (
              <tr key={l.id}>
                <td><code style={{ fontSize:'.75rem' }}>{l.code}</code></td>
                <td style={{ fontWeight:600 }}>{l.name}</td>
                <td style={{ fontSize:'.8rem', color:'#64748b' }}>{l.origin_country} → {l.destination_country}</td>
                <td>
                  <span className="lx-status-pill" style={{
                    background: {low:'#22c55e',managed:'#f59e0b',restricted:'#dc2626',prohibited:'#7f1d1d'}[l.risk_tier]||'#64748b'
                  }}>{RISK_I18N[l.risk_tier] ? t(`${NS}.${RISK_I18N[l.risk_tier]}`) : l.risk_tier}</span>
                </td>
                <td>{(parseFloat(l.default_markup_pct||0)*100).toFixed(0)}%</td>
                <td>{l.customs_complexity}/5</td>
                <td style={{ fontSize:'.72rem' }}>
                  {l.requires_business_verification && <span style={{ color:'#f97316' }}>BV </span>}
                  {l.requires_manual_approval && <span style={{ color:'#dc2626' }}>MA</span>}
                </td>
                <td>
                  <span style={{ color: l.is_active ? '#22c55e' : '#ef4444', fontWeight:700, fontSize:'.8rem' }}>
                    {t(l.is_active ? `${NS}.active` : `${NS}.inactive`)}
                  </span>
                </td>
                <td>{l.active_po_count || 0}</td>
                <td>
                  <button className="lx-btn-secondary" style={{ padding:'.25rem .75rem', fontSize:'.78rem' }}
                    onClick={() => openEdit(l)}>{t(`${NS}.edit`)}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
