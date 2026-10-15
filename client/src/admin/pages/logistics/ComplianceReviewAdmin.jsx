import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListRestrictions, adminListShipments } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';
import '../../../styles/logistics/LogisticsWorkspaces.css';
import AdminErrorState from '../../lib/AdminErrorState';
import LogisticsStatusPill from '../../../components/logistics/LogisticsStatusPill';

const RISK_LABEL_KEY = { low:'riskLow', managed:'riskManaged', restricted:'riskRestricted', prohibited:'riskProhibited' };

export default function ComplianceReviewAdmin() {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([adminListRestrictions(), adminListShipments({ limit: 100 })])
      .then(([ruleRes, shipmentRes]) => {
        setRules(ruleRes.data || []);
        setShipments((shipmentRes.data || []).filter((row) => ['arrived_destination', 'customs_hold', 'customs_cleared', 'exception'].includes(row.status)));
      })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('adminComplianceReview.title')}</h1>
        <p className="lx-page-sub">{t('adminComplianceReview.subtitle')}</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(340px, 1fr))', gap:'1.5rem' }}>
        {(!loading && loadError) ? (
          <div style={{ gridColumn:'1 / -1' }}><AdminErrorState onRetry={load} /></div>
        ) : (
        <>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>{t('adminComplianceReview.customsShipments')}</h2>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>{t('adminComplianceReview.table.reference')}</th><th>{t('adminComplianceReview.table.status')}</th><th>{t('adminComplianceReview.table.route')}</th></tr></thead>
              <tbody>
                {shipments.slice(0, 12).map((shipment) => (
                  <tr key={shipment.id}>
                    <td>{shipment.reference}</td>
                    <td><LogisticsStatusPill status={shipment.status} label={t(`logistics.status.${shipment.status}`, { defaultValue: shipment.status })} /></td>
                    <td>{shipment.origin_country} → {shipment.destination_country}</td>
                  </tr>
                ))}
                {!loading && !loadError && shipments.length === 0 && <tr><td colSpan={3} className="lx-table-empty-cell">{t('adminComplianceReview.noShipments')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>{t('adminComplianceReview.countryRestrictions')}</h2>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>{t('adminComplianceReview.rulesTable.category')}</th><th>{t('adminComplianceReview.rulesTable.country')}</th><th>{t('adminComplianceReview.rulesTable.approval')}</th><th>{t('adminComplianceReview.rulesTable.risk')}</th></tr></thead>
              <tbody>
                {rules.slice(0, 12).map((rule) => (
                  <tr key={`${rule.category}-${rule.country_code}`}>
                    <td>{rule.category}</td>
                    <td>{rule.country_code}</td>
                    <td>{rule.requires_approval ? t('adminComplianceReview.approvalRequired') : t('adminComplianceReview.approvalOpen')}</td>
                    <td><LogisticsStatusPill status={rule.risk_tier} label={t(`adminLogisticsRestrictions.${RISK_LABEL_KEY[rule.risk_tier] || 'riskLow'}`, { defaultValue: rule.risk_tier })} /></td>
                  </tr>
                ))}
                {!loading && !loadError && rules.length === 0 && <tr><td colSpan={4} className="lx-table-empty-cell">{t('adminComplianceReview.noRules')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
