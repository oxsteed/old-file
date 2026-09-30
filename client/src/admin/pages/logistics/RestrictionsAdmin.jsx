import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListRestrictions, adminUpsertRestriction } from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

const ACCESS_LEVELS   = ['open','business_only','verified_only','invite_only','blocked'];
const RISK_TIERS      = ['low','managed','restricted','prohibited'];
const ACCESS_COLOR    = { open:'#22c55e', business_only:'#3b82f6', verified_only:'#f59e0b', invite_only:'#8b5cf6', blocked:'#ef4444' };
const RISK_COLOR      = { low:'#22c55e', managed:'#f59e0b', restricted:'#dc2626', prohibited:'#7f1d1d' };

const NS = 'adminLogisticsRestrictions';
const ACCESS_LEVEL_I18N = { open:'accessOpen', business_only:'accessBusinessOnly', verified_only:'accessVerifiedOnly', invite_only:'accessInviteOnly', blocked:'accessBlocked' };
const RISK_I18N         = { low:'riskLow', managed:'riskManaged', restricted:'riskRestricted', prohibited:'riskProhibited' };
const DIRECTION_I18N    = { import:'dirImportShort', export:'dirExportShort', both:'dirBothShort' };

export default function RestrictionsAdmin() {
  const { t } = useTranslation();
  const [rules, setRules]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing]   = useState(null); // null = new, or existing rule
  const [form, setForm]         = useState({
    country_code:'', direction:'import', access_level:'open', risk_tier:'low',
    max_order_value_usd:'', requires_license:false, requires_certificate:false,
    requires_business_only:false, notes:'',
  });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    adminListRestrictions({})
      .then(r => setRules(r.data||[]))
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ country_code:'', direction:'import', access_level:'open', risk_tier:'low', max_order_value_usd:'', requires_license:false, requires_certificate:false, requires_business_only:false, notes:'' });
    setShowForm(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setForm({
      country_code: rule.country_code,
      direction: rule.direction,
      access_level: rule.access_level,
      risk_tier: rule.risk_tier,
      max_order_value_usd: rule.max_order_value_usd || '',
      requires_license: !!rule.requires_license,
      requires_certificate: !!rule.requires_certificate,
      requires_business_only: !!rule.requires_business_only,
      notes: rule.notes || '',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.country_code || form.country_code.length !== 2) {
      toast.error(t(`${NS}.invalidCountryCode`));
      return;
    }
    setSaving(true);
    try {
      await adminUpsertRestriction(form);
      toast.success(t(`${NS}.ruleSaved`));
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  const set = (k, v) => setForm(f=>({...f,[k]:v}));
  const labelFor = (map, value) => (map[value] ? t(`${NS}.${map[value]}`) : value);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'1rem' }}>
          <div>
            <h1 className="lx-page-title">⛔ {t(`${NS}.title`)}</h1>
            <p className="lx-page-sub">{t(`${NS}.subtitle`)}</p>
          </div>
          <button className="lx-btn-primary" onClick={openNew}>{t(`${NS}.addRule`)}</button>
        </div>
      </div>

      {/* Info box */}
      <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'.75rem', padding:'1rem', marginBottom:'1.5rem', fontSize:'.875rem' }}>
        <strong>ℹ️ {t(`${NS}.infoTitle`)}</strong> {t(`${NS}.infoBody1`)}
        {t(`${NS}.infoBody2`)}
        {t(`${NS}.infoBody3`)} <strong>{t(`${NS}.openWord`)}</strong>.
      </div>

      {showForm && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'2px solid #f97316' }}>
          <h3 style={{ fontWeight:700, marginBottom:'1.25rem' }}>
            {editing ? t(`${NS}.editTitle`, { code: editing.country_code, direction: editing.direction }) : t(`${NS}.newTitle`)}
          </h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.countryCode`)}</label>
              <input className="lx-input" maxLength={2} value={form.country_code}
                placeholder={t(`${NS}.countryCodePlaceholder`)}
                onChange={e => set('country_code', e.target.value.toUpperCase())}
                disabled={!!editing} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.direction`)}</label>
              <select className="lx-select" value={form.direction} onChange={e => set('direction', e.target.value)}>
                <option value="import">{t(`${NS}.dirImport`)}</option>
                <option value="export">{t(`${NS}.dirExport`)}</option>
                <option value="both">{t(`${NS}.dirBoth`)}</option>
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.accessLevel`)}</label>
              <select className="lx-select" value={form.access_level} onChange={e => set('access_level', e.target.value)}>
                {ACCESS_LEVELS.map(a => <option key={a} value={a}>{t(`${NS}.${ACCESS_LEVEL_I18N[a]}`)}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.riskTier`)}</label>
              <select className="lx-select" value={form.risk_tier} onChange={e => set('risk_tier', e.target.value)}>
                {RISK_TIERS.map(r => <option key={r} value={r}>{t(`${NS}.${RISK_I18N[r]}`)}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t(`${NS}.maxOrderValue`)}</label>
              <input type="number" className="lx-input" value={form.max_order_value_usd}
                placeholder={t(`${NS}.maxOrderValuePlaceholder`)}
                onChange={e => set('max_order_value_usd', e.target.value)} />
            </div>
          </div>
          <div style={{ display:'flex', gap:'1.5rem', flexWrap:'wrap', marginBottom:'1rem' }}>
            {[
              ['requires_license','requiresLicense'],
              ['requires_certificate','requiresCertificate'],
              ['requires_business_only','requiresBusinessOnly'],
            ].map(([k,labelKey]) => (
              <label key={k} style={{ display:'flex', gap:'.4rem', alignItems:'center', fontWeight:600, fontSize:'.85rem', cursor:'pointer' }}>
                <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)} />
                {t(`${NS}.${labelKey}`)}
              </label>
            ))}
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{t(`${NS}.notes`)}</label>
            <textarea className="lx-textarea" value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder={t(`${NS}.notesPlaceholder`)} />
          </div>
          <div style={{ display:'flex', gap:'.75rem' }}>
            <button className="lx-btn-primary" onClick={save} disabled={saving}>
              {saving ? t(`${NS}.saving`) : t(`${NS}.saveRule`)}
            </button>
            <button className="lx-btn-secondary" onClick={() => setShowForm(false)}>{t(`${NS}.cancel`)}</button>
          </div>
        </div>
      )}

      {loading && <div className="lx-loading">{t(`${NS}.loading`)}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>{t(`${NS}.thCountry`)}</th><th>{t(`${NS}.direction`)}</th><th>{t(`${NS}.accessLevel`)}</th><th>{t(`${NS}.riskTier`)}</th>
              <th>{t(`${NS}.thMaxValue`)}</th><th>{t(`${NS}.thFlags`)}</th><th>{t(`${NS}.notes`)}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={`${r.country_code}_${r.direction}`}>
                <td>
                  <span style={{ fontWeight:700, fontSize:'1rem' }}>{r.country_code}</span>
                </td>
                <td>
                  <span style={{ background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .5rem', fontSize:'.75rem', fontWeight:700 }}>
                    {labelFor(DIRECTION_I18N, r.direction)}
                  </span>
                </td>
                <td>
                  <span className="lx-status-pill" style={{ background: ACCESS_COLOR[r.access_level]||'#64748b' }}>
                    {labelFor(ACCESS_LEVEL_I18N, r.access_level)}
                  </span>
                </td>
                <td>
                  <span className="lx-status-pill" style={{ background: RISK_COLOR[r.risk_tier]||'#64748b' }}>
                    {labelFor(RISK_I18N, r.risk_tier)}
                  </span>
                </td>
                <td style={{ fontSize:'.82rem' }}>
                  {r.max_order_value_usd ? `$${parseFloat(r.max_order_value_usd).toLocaleString()}` : '—'}
                </td>
                <td style={{ fontSize:'.72rem' }}>
                  {r.requires_license && <span style={{ background:'#fef3c7', borderRadius:999, padding:'.1rem .4rem', marginRight:'.25rem' }}>LIC</span>}
                  {r.requires_certificate && <span style={{ background:'#ede9fe', borderRadius:999, padding:'.1rem .4rem', marginRight:'.25rem' }}>CERT</span>}
                  {r.requires_business_only && <span style={{ background:'#dbeafe', borderRadius:999, padding:'.1rem .4rem' }}>BIZ</span>}
                </td>
                <td style={{ fontSize:'.78rem', color:'#64748b', maxWidth:200 }}>
                  {r.notes ? r.notes.slice(0,60) + (r.notes.length > 60 ? '…' : '') : '—'}
                </td>
                <td>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                    onClick={() => openEdit(r)}>
                    {t(`${NS}.edit`)}
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && !loading && !loadError && (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t(`${NS}.emptyState`)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
