import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listLanes, listTradeRules } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import '../../styles/logistics/LogisticsHomePage.css';

const RISK_COLOR = { low:'#22c55e', managed:'#f59e0b', restricted:'#dc2626', prohibited:'#7f1d1d' };

export default function CompliancePage() {
  const { t } = useTranslation();
  const [lanes, setLanes]         = useState([]);
  const [rules, setRules]         = useState([]);
  const [selectedLane, setSelectedLane] = useState('');
  const [country, setCountry]     = useState('');
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([listLanes(), listTradeRules()])
      .then(([lRes, rRes]) => {
        setLanes(lRes.data || []);
        setRules(rRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = rules.filter(r => {
    if (selectedLane && r.lane_id !== parseInt(selectedLane)) return false;
    if (country && r.country_code !== country.toUpperCase()) return false;
    return true;
  });

  return (
    <PageShell>
      <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('logistics.compliance.title','Compliance & Trade Rules')}</h1>
        <p className="lx-page-sub">{t('logistics.compliance.subtitle','Import restrictions, category bans, country rules, document requirements, and risk tiers by lane.')}</p>
      </div>

      {/* Lane risk grid */}
      <section className="lx-section">
        <div className="lx-section-header">
          <h2>{t('logistics.compliance.lanesRisk','Lane Risk Overview')}</h2>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'1rem', marginBottom:'2rem' }}>
          {lanes.map(l => (
            <div key={l.id} className="lx-card" style={{ borderLeft:`4px solid ${RISK_COLOR[l.risk_tier]||'#94a3b8'}` }}>
              <div style={{ fontSize:'.75rem', color:'#64748b', marginBottom:'.25rem' }}>
                {l.origin_country} → {l.destination_country}
              </div>
              <div style={{ fontWeight:700, fontSize:'.9rem', marginBottom:'.4rem' }}>{l.name}</div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.78rem' }}>
                <span className="lx-status-pill" style={{ background: RISK_COLOR[l.risk_tier]||'#64748b' }}>
                  {l.risk_tier}
                </span>
                <span style={{ color:'#64748b' }}>
                  Customs: {l.customs_complexity}/5
                </span>
              </div>
              {l.requires_business_verification && (
                <div style={{ fontSize:'.72rem', color:'#f97316', marginTop:'.35rem', fontWeight:600 }}>
                  ⚠ Business verification required
                </div>
              )}
              {l.requires_manual_approval && (
                <div style={{ fontSize:'.72rem', color:'#dc2626', marginTop:'.1rem', fontWeight:600 }}>
                  ⛔ Manual approval required
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Trade rules */}
      <section className="lx-section">
        <div className="lx-section-header">
          <h2>{t('logistics.compliance.tradeRules','Trade Rules')}</h2>
        </div>
        <div className="lx-filter-bar">
          <select className="lx-select" value={selectedLane} onChange={e => setSelectedLane(e.target.value)}>
            <option value="">All Lanes</option>
            {lanes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input className="lx-input" placeholder="Country code (e.g. HT)"
            value={country} onChange={e => setCountry(e.target.value)} style={{ maxWidth:160 }} />
        </div>

        {loading && <div className="lx-loading">Loading…</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>
            No trade rules found for these filters.
          </div>
        )}

        {filtered.length > 0 && (
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead>
                <tr><th>Lane</th><th>Type</th><th>Country</th><th>Category</th><th>Severity</th><th>Doc Required</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize:'.8rem' }}>{r.lane_name || '—'}</td>
                    <td>
                      <span style={{
                        background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .5rem',
                        fontSize:'.72rem', fontWeight:700, color:'#475569',
                      }}>{r.rule_type?.replace(/_/g,' ')}</span>
                    </td>
                    <td>{r.country_code || 'Global'}</td>
                    <td>{r.category || '—'}</td>
                    <td>
                      <span className="lx-status-pill" style={{ background: RISK_COLOR[r.severity]||'#64748b' }}>
                        {r.severity}
                      </span>
                    </td>
                    <td style={{ fontSize:'.8rem' }}>{r.doc_required || '—'}</td>
                    <td style={{ fontSize:'.78rem', color:'#64748b', maxWidth:200 }}>{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Info blocks */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem', marginTop:'1rem' }}>
        <div className="lx-card" style={{ borderLeft:'4px solid #f97316' }}>
          <h3 style={{ fontWeight:700, marginBottom:'.75rem' }}>📋 Document Requirements</h3>
          <p style={{ fontSize:'.875rem', color:'#64748b', lineHeight:1.7 }}>
            Each lane may require: Commercial Invoice, Packing List, Certificate of Origin, Phytosanitary Certificate, FDA clearance, CE markings, customs entry forms, or inspection reports. Requirements are lane- and category-specific.
          </p>
        </div>
        <div className="lx-card" style={{ borderLeft:'4px solid #dc2626' }}>
          <h3 style={{ fontWeight:700, marginBottom:'.75rem' }}>⚠ Risk Tiers</h3>
          <div style={{ fontSize:'.875rem', lineHeight:2 }}>
            {Object.entries(RISK_COLOR).map(([tier, color]) => (
              <div key={tier} style={{ display:'flex', alignItems:'center', gap:'.5rem' }}>
                <span style={{ width:10, height:10, borderRadius:'50%', background:color, display:'inline-block' }} />
                <strong style={{ textTransform:'capitalize' }}>{tier}</strong>
                <span style={{ color:'#64748b' }}>
                  {tier==='low' && ': Standard processing'}
                  {tier==='managed' && ': Enhanced due diligence'}
                  {tier==='restricted' && ': Manual compliance review'}
                  {tier==='prohibited' && ': Not permitted on this lane'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>
    </PageShell>
  );
}
