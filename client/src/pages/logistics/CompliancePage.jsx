import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listLanes, listTradeRules } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

const RISK_TIERS = ['low', 'managed', 'restricted', 'prohibited'];

const RISK_TIER_DESCRIPTIONS = {
  low: 'Standard processing',
  managed: 'Enhanced due diligence',
  restricted: 'Manual compliance review',
  prohibited: 'Not permitted on this lane',
};

/**
 * CompliancePage - public trade rules & lane risk overview (Phase 2).
 *
 * Shared LogisticsLayout for navigation; risk pills and accent cards use
 * theme-token tones (low/managed/restricted/prohibited) instead of
 * hardcoded colors; severity labels resolve through logistics.status.*.
 */
export default function CompliancePage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [lanes, setLanes]         = useState([]);
  const [rules, setRules]         = useState([]);
  const [selectedLane, setSelectedLane] = useState('');
  const [country, setCountry]     = useState('');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    Promise.all([listLanes(), listTradeRules()])
      .then(([lRes, rRes]) => {
        setLanes(lRes.data || []);
        setRules(rRes.data || []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = rules.filter((r) => {
    if (selectedLane && r.lane_id !== parseInt(selectedLane, 10)) return false;
    if (country && r.country_code !== country.toUpperCase()) return false;
    return true;
  });

  return (
    <PageShell>
      <PageMeta
        title={tx('logistics.compliance.title', 'Compliance & Trade Rules')}
        description={tx('logistics.compliance.subtitle', 'Import restrictions, category bans, country rules, document requirements, and risk tiers by lane.')}
        url="https://oxsteed.com/logistics/compliance"
        noIndex
      />
      <LogisticsLayout
        title={tx('logistics.compliance.title', 'Compliance & Trade Rules')}
        subtitle={tx('logistics.compliance.subtitle', 'Import restrictions, category bans, country rules, document requirements, and risk tiers by lane.')}
      >
        <div className="lx-workspaces">
          <p className="lx-t-small lx-t-muted lx-mb-6" style={{ maxWidth: '44rem', lineHeight: 1.7 }}>
            {tx('logistics.compliance.explainer', 'Compliance rules keep every lane predictable. Check risk tiers and document requirements before you commit demand or book freight.')}
          </p>

          {loading && (
            <div className="lx-loading" role="status" aria-live="polite">
              <span className="lx-spinner" aria-hidden="true" />
              {tx('logistics.modal.loading', 'Loading…')}
            </div>
          )}

          {!loading && error && (
            <div className="lx-data-error-banner" role="alert">
              <div>
                <h2>{tx('logistics.workspace.dataError.title', 'Data unavailable')}</h2>
                <p>{tx('logistics.compliance.error', "We couldn't load compliance data right now. Please try again.")}</p>
              </div>
              <button type="button" className="lx-btn-secondary" onClick={load}>
                {tx('logistics.workspace.dataError.retry', 'Try again')}
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Lane risk grid */}
              <section className="lx-section" aria-label={tx('logistics.compliance.lanesRisk', 'Lane Risk Overview')}>
                <div className="lx-section-header">
                  <h2 className="lx-section-title">{tx('logistics.compliance.lanesRisk', 'Lane Risk Overview')}</h2>
                </div>
                <div className="lx-campaign-grid lx-mb-6">
                  {lanes.map((l) => (
                    <div key={l.id} className={`lx-card lx-risk-card lx-risk-card--${l.risk_tier || 'low'}`}>
                      <div className="lx-t-xs lx-t-faint lx-mb-4">
                        {l.origin_country} → {l.destination_country}
                      </div>
                      <div className="lx-t-bold lx-t-small lx-mb-4">{l.name}</div>
                      <div className="lx-item-card-head">
                        <LogisticsStatusPill status={l.risk_tier} />
                        <span className="lx-t-xs lx-t-faint">
                          {tx('logistics.compliance.customsComplexity', 'Customs')}: {l.customs_complexity}/5
                        </span>
                      </div>
                      {l.requires_business_verification && (
                        <div className="lx-t-xs lx-t-bold lx-mt-6" style={{ color: 'var(--color-primary)' }}>
                          ⚠ {tx('logistics.compliance.businessVerificationRequired', 'Business verification required')}
                        </div>
                      )}
                      {l.requires_manual_approval && (
                        <div className="lx-t-xs lx-t-bold" style={{ color: 'var(--color-error)', marginTop: '.1rem' }}>
                          ⛔ {tx('logistics.compliance.manualApprovalRequired', 'Manual approval required')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {lanes.length === 0 && (
                  <div className="lx-empty">
                    <div className="lx-empty-icon" aria-hidden="true">🛡️</div>
                    <p>{tx('logistics.compliance.noLanes', 'No lane risk data published yet.')}</p>
                  </div>
                )}
              </section>

              {/* Trade rules */}
              <section className="lx-section" aria-label={tx('logistics.compliance.tradeRules', 'Trade Rules')}>
                <div className="lx-section-header">
                  <h2 className="lx-section-title">{tx('logistics.compliance.tradeRules', 'Trade Rules')}</h2>
                </div>
                <div className="lx-filter-bar" role="search">
                  <label className="lx-visually-hidden" htmlFor="lx-compliance-lane">
                    {tx('logistics.compliance.laneFilter', 'Filter by lane')}
                  </label>
                  <select id="lx-compliance-lane" className="lx-select" value={selectedLane} onChange={(e) => setSelectedLane(e.target.value)}>
                    <option value="">{tx('logistics.compliance.allLanes', 'All Lanes')}</option>
                    {lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <label className="lx-visually-hidden" htmlFor="lx-compliance-country">
                    {tx('logistics.compliance.countryFilter', 'Filter by country code')}
                  </label>
                  <input
                    id="lx-compliance-country"
                    className="lx-input"
                    placeholder={tx('logistics.compliance.countryPlaceholder', 'Country code (e.g. HT)')}
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    style={{ maxWidth: '10rem' }}
                  />
                </div>

                {filtered.length === 0 && (
                  <div className="lx-empty">
                    <div className="lx-empty-icon" aria-hidden="true">📋</div>
                    <p>{tx('logistics.compliance.noRules', 'No trade rules found for these filters.')}</p>
                  </div>
                )}

                {filtered.length > 0 && (
                  <div className="lx-table-wrap">
                    <table className="lx-table">
                      <thead>
                        <tr>
                          <th>{tx('logistics.compliance.headers.lane', 'Lane')}</th>
                          <th>{tx('logistics.compliance.headers.type', 'Type')}</th>
                          <th>{tx('logistics.compliance.headers.country', 'Country')}</th>
                          <th>{tx('logistics.compliance.headers.category', 'Category')}</th>
                          <th>{tx('logistics.compliance.headers.severity', 'Severity')}</th>
                          <th>{tx('logistics.compliance.headers.docRequired', 'Doc Required')}</th>
                          <th>{tx('logistics.compliance.headers.notes', 'Notes')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr key={r.id}>
                            <td className="lx-t-xs">{r.lane_name || '—'}</td>
                            <td><span className="lx-tag">{r.rule_type?.replace(/_/g, ' ')}</span></td>
                            <td>{r.country_code || tx('logistics.compliance.global', 'Global')}</td>
                            <td>{r.category || '—'}</td>
                            <td><LogisticsStatusPill status={r.severity} /></td>
                            <td className="lx-t-xs">{r.doc_required || '—'}</td>
                            <td className="lx-t-xs lx-t-faint" style={{ maxWidth: '12.5rem' }}>{r.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Info blocks */}
              <div className="lx-two-col lx-mt-6">
                <div className="lx-card lx-risk-card lx-risk-card--low">
                  <h3 className="lx-card-title lx-mb-4">📋 {tx('logistics.compliance.docRequirements.title', 'Document Requirements')}</h3>
                  <p className="lx-t-small lx-t-faint" style={{ lineHeight: 1.7 }}>
                    {tx('logistics.compliance.docRequirements.body', 'Each lane may require: Commercial Invoice, Packing List, Certificate of Origin, Phytosanitary Certificate, FDA clearance, CE markings, customs entry forms, or inspection reports. Requirements are lane- and category-specific.')}
                  </p>
                </div>
                <div className="lx-card lx-risk-card lx-risk-card--restricted">
                  <h3 className="lx-card-title lx-mb-4">⚠ {tx('logistics.compliance.riskTiers.title', 'Risk Tiers')}</h3>
                  <div className="lx-t-small lx-kv-list">
                    {RISK_TIERS.map((tier) => (
                      <div key={tier} className="lx-kv-row" style={{ justifyContent: 'flex-start', gap: 'var(--space-2)' }}>
                        <span className={`lx-risk-dot lx-risk-dot--${tier}`} aria-hidden="true" />
                        <strong style={{ textTransform: 'capitalize' }}>{tx(`logistics.status.${tier}`, tier)}</strong>
                        <span className="lx-t-faint">
                          : {tx(`logistics.compliance.riskTiers.${tier}`, RISK_TIER_DESCRIPTIONS[tier])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
