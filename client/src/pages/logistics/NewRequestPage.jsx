import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { createSourcingRequest } from '../../api/logistics';
import { listLanes, checkLaneAccess } from '../../api/logistics';
import toast from 'react-hot-toast';
import '../../styles/logistics/LogisticsHomePage.css';

const CATEGORIES = [
  'Electronics','Apparel & Clothing','Food & Beverage','Building Materials',
  'Tools & Hardware','Health & Beauty','Home Goods','Agricultural Products',
  'Auto Parts','Packaging','Machinery','Medical Supplies','Other',
];

export default function NewRequestPage() {
  const { t }    = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lanes, setLanes]     = useState([]);
  const [laneAccess, setLaneAccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep]       = useState(1);
  const [form, setForm]       = useState({
    title: '', category: '', description: '', specs: '',
    target_qty: '', target_unit: 'unit', target_price_usd: '',
    budget_max_usd: '', destination_country: '', destination_city: '',
    lane_id: '', preferred_freight: '', private_label: false,
    custom_mfg: false, deadline: '', notes: '',
  });

  useEffect(() => {
    listLanes().then(r => setLanes(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.lane_id || !user) {
      setLaneAccess(null);
      return;
    }
    checkLaneAccess(form.lane_id, {
      role: user.role,
      country: form.destination_country || user.country_code || '',
      business_verified: String(Boolean(user.business_verified || user.is_business_verified)),
    }).then((res) => setLaneAccess(res.data || null)).catch(() => setLaneAccess(null));
  }, [form.lane_id, form.destination_country, user]);

  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  const handleSubmit = async () => {
    if (!form.title || !form.category) {
      toast.error(t('logistics.requests.requiredFields','Title and category are required'));
      return;
    }
    setSubmitting(true);
    try {
      const data = { ...form };
      if (data.specs) { try { data.specs = JSON.parse(data.specs); } catch { data.specs = { notes: data.specs }; } }
      const r = await createSourcingRequest(data);
      toast.success(t('logistics.requests.created','Sourcing request submitted!'));
      navigate(`/logistics/requests/${r.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="lx-page" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom:'1rem' }}>
        <Link to="/logistics/sourcing" className="lx-link">← {t('logistics.requests.back','Back to Sourcing')}</Link>
      </div>
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('logistics.requests.newTitle','New Sourcing Request')}</h1>
        <p className="lx-page-sub">{t('logistics.requests.newSub','Tell us what you need. OxSteed will find suppliers and return quotes.')}</p>
      </div>

      {/* Step indicator */}
      <div style={{ display:'flex', gap:'.5rem', marginBottom:'1.75rem' }}>
        {[1,2,3].map(s => (
          <div key={s} style={{
            flex:1, height:4, borderRadius:999,
            background: s <= step ? '#f97316' : '#e2e8f0',
            cursor: s < step ? 'pointer' : 'default',
          }} onClick={() => s < step && setStep(s)} />
        ))}
      </div>

      <div className="lx-card">
        {step === 1 && (
          <>
            <h2 style={{ fontWeight:700, marginBottom:'1.25rem' }}>
              {t('logistics.requests.step1','Step 1: What do you need?')}
            </h2>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.requests.titleLabel','Request Title')} *</label>
              <input className="lx-input" value={form.title} placeholder="e.g. 500 Units of Industrial Safety Boots"
                onChange={e => set('title', e.target.value)} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.requests.categoryLabel','Category')} *</label>
              <select className="lx-select" value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="">— Select —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.requests.description','Description')}</label>
              <textarea className="lx-textarea" value={form.description}
                placeholder="Describe the product in detail — materials, dimensions, certifications needed…"
                onChange={e => set('description', e.target.value)} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div className="lx-form-group">
                <label className="lx-label">{t('logistics.requests.targetQty','Target Quantity')}</label>
                <input type="number" className="lx-input" value={form.target_qty} min="1"
                  onChange={e => set('target_qty', e.target.value)} />
              </div>
              <div className="lx-form-group">
                <label className="lx-label">{t('logistics.requests.unit','Unit')}</label>
                <select className="lx-select" value={form.target_unit} onChange={e => set('target_unit', e.target.value)}>
                  {['unit','pair','set','box','carton','pallet','kg','liter','meter'].map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div className="lx-form-group">
                <label className="lx-label">{t('logistics.requests.targetPrice','Target Price / Unit (USD)')}</label>
                <input type="number" className="lx-input" value={form.target_price_usd}
                  placeholder="0.00" onChange={e => set('target_price_usd', e.target.value)} />
              </div>
              <div className="lx-form-group">
                <label className="lx-label">{t('logistics.requests.budgetMax','Max Budget (USD)')}</label>
                <input type="number" className="lx-input" value={form.budget_max_usd}
                  placeholder="0.00" onChange={e => set('budget_max_usd', e.target.value)} />
              </div>
            </div>
            <div style={{ display:'flex', gap:'.75rem', marginTop:'1rem' }}>
              <button className="lx-btn-primary" onClick={() => setStep(2)}>
                {t('common.next','Next')} →
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontWeight:700, marginBottom:'1.25rem' }}>
              {t('logistics.requests.step2','Step 2: Destination & Lane')}
            </h2>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div className="lx-form-group">
                <label className="lx-label">{t('logistics.requests.destCountry','Destination Country')}</label>
                <input className="lx-input" value={form.destination_country} maxLength={2}
                  placeholder="e.g. US, HT, CA" onChange={e => set('destination_country', e.target.value.toUpperCase())} />
              </div>
              <div className="lx-form-group">
                <label className="lx-label">{t('logistics.requests.destCity','Destination City')}</label>
                <input className="lx-input" value={form.destination_city}
                  onChange={e => set('destination_city', e.target.value)} />
              </div>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.requests.lane','Logistics Lane')}</label>
              <select className="lx-select" value={form.lane_id} onChange={e => set('lane_id', e.target.value)}>
                <option value="">— Let OxSteed choose —</option>
                {lanes.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.origin_country} → {l.destination_country}) · {l.risk_tier}
                  </option>
                ))}
              </select>
            </div>
            {form.lane_id && (() => {
              const lane = lanes.find((row) => String(row.id) === String(form.lane_id));
              if (!lane) return null;
              return (
                <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'.75rem', padding:'1rem', marginBottom:'1rem', fontSize:'.85rem', lineHeight:1.7 }}>
                  <strong>Lane access and approval checks</strong>
                  <div>Risk tier: <strong>{lane.risk_tier}</strong> · Customs complexity: <strong>{lane.customs_complexity}/5</strong></div>
                  {laneAccess?.allowed === false && (
                    <div style={{ color:'#b91c1c', fontWeight:700 }}>This lane is currently blocked for your role or destination context: {laneAccess.reason}</div>
                  )}
                  {lane.requires_business_verification && (
                    <div style={{ color:'#c2410c' }}>Business verification is required to run this lane as a verified buyer.</div>
                  )}
                  {lane.requires_reseller_approval && (
                    <div style={{ color:'#7c3aed' }}>Reseller/distributor approval is required before this lane can be used for resale flows.</div>
                  )}
                  {(lane.requires_manual_approval || laneAccess?.requiresManualApproval) && (
                    <div style={{ color:'#b91c1c' }}>Manual compliance approval is required before this request can move into quoting or procurement.</div>
                  )}
                </div>
              );
            })()}
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.requests.freightPreference','Preferred Freight')}</label>
              <select className="lx-select" value={form.preferred_freight} onChange={e => set('preferred_freight', e.target.value)}>
                <option value="">— Any —</option>
                {['air','sea_fcl','sea_lcl','road','rail','courier','express'].map(f => <option key={f}>{f.replace(/_/g,' ')}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.requests.deadline','Deadline')}</label>
              <input type="date" className="lx-input" value={form.deadline} onChange={e => set('deadline', e.target.value)} />
            </div>
            <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap' }}>
              <label style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem' }}>
                <input type="checkbox" checked={form.private_label} onChange={e => set('private_label', e.target.checked)} />
                {t('logistics.requests.privateLabel','Private Label')}
              </label>
              <label style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem' }}>
                <input type="checkbox" checked={form.custom_mfg} onChange={e => set('custom_mfg', e.target.checked)} />
                {t('logistics.requests.customMfg','Custom Manufacturing')}
              </label>
            </div>
            <div style={{ display:'flex', gap:'.75rem', marginTop:'1.25rem' }}>
              <button className="lx-btn-secondary" onClick={() => setStep(1)}>← {t('common.back','Back')}</button>
              <button className="lx-btn-primary" disabled={laneAccess?.allowed === false} onClick={() => setStep(3)}>{t('common.next','Next')} →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={{ fontWeight:700, marginBottom:'1.25rem' }}>
              {t('logistics.requests.step3','Step 3: Review & Submit')}
            </h2>
            <div style={{ background:'#f8fafc', borderRadius:'.625rem', padding:'1.25rem', marginBottom:'1.25rem' }}>
              {[
                ['Title',        form.title],
                ['Category',     form.category],
                ['Quantity',     form.target_qty ? `${form.target_qty} ${form.target_unit}` : '—'],
                ['Target Price', form.target_price_usd ? `$${form.target_price_usd}/unit` : '—'],
                ['Destination',  [form.destination_city, form.destination_country].filter(Boolean).join(', ') || '—'],
                ['Deadline',     form.deadline || '—'],
                ['Private Label',form.private_label ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'.35rem 0', borderBottom:'1px solid #e2e8f0', fontSize:'.875rem' }}>
                  <span style={{ color:'#64748b' }}>{k}</span>
                  <span style={{ fontWeight:600 }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('logistics.requests.additionalNotes','Additional Notes')}</label>
              <textarea className="lx-textarea" value={form.notes}
                placeholder="Any other context for the sourcing team…"
                onChange={e => set('notes', e.target.value)} />
            </div>
            <div style={{ display:'flex', gap:'.75rem', marginTop:'.5rem' }}>
              <button className="lx-btn-secondary" onClick={() => setStep(2)}>← {t('common.back','Back')}</button>
              <button className="lx-btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? t('common.loading','Submitting…') : t('logistics.requests.submit','Submit Request')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
