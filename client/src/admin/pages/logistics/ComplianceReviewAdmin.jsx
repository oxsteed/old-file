import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListRestrictions, adminListShipments } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

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
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
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
                    <td><span className="lx-status-pill" style={{ background: shipment.status === 'customs_hold' || shipment.status === 'exception' ? '#ef4444' : '#64748b' }}>{shipment.status}</span></td>
                    <td>{shipment.origin_country} → {shipment.destination_country}</td>
                  </tr>
                ))}
                {!loading && !loadError && shipments.length === 0 && <tr><td colSpan={3} style={{ textAlign:'center', color:'#94a3b8' }}>{t('adminComplianceReview.noShipments')}</td></tr>}
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
                    <td><span className="lx-status-pill" style={{ background: rule.risk_tier === 'prohibited' ? '#7f1d1d' : rule.risk_tier === 'restricted' ? '#ef4444' : rule.risk_tier === 'managed' ? '#f59e0b' : '#22c55e' }}>{rule.risk_tier}</span></td>
                  </tr>
                ))}
                {!loading && !loadError && rules.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'#94a3b8' }}>{t('adminComplianceReview.noRules')}</td></tr>}
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
