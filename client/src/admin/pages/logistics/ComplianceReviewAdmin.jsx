import React, { useEffect, useState } from 'react';
import { adminListRestrictions, adminListShipments } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function ComplianceReviewAdmin() {
  const [rules, setRules] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminListRestrictions(), adminListShipments({ limit: 100 })])
      .then(([ruleRes, shipmentRes]) => {
        setRules(ruleRes.data || []);
        setShipments((shipmentRes.data || []).filter((row) => ['arrived_destination', 'customs_hold', 'customs_cleared', 'exception'].includes(row.status)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Compliance Reviewer Workspace</h1>
        <p className="lx-page-sub">Review customs-sensitive shipments, country access restrictions, and the rules that gate market-specific logistics lanes.</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>Customs-sensitive shipments</h2>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>Reference</th><th>Status</th><th>Route</th></tr></thead>
              <tbody>
                {shipments.slice(0, 12).map((shipment) => (
                  <tr key={shipment.id}>
                    <td>{shipment.reference}</td>
                    <td><span className="lx-status-pill" style={{ background: shipment.status === 'customs_hold' || shipment.status === 'exception' ? '#ef4444' : '#64748b' }}>{shipment.status}</span></td>
                    <td>{shipment.origin_country} → {shipment.destination_country}</td>
                  </tr>
                ))}
                {!loading && shipments.length === 0 && <tr><td colSpan={3} style={{ textAlign:'center', color:'#94a3b8' }}>No customs-sensitive shipments right now.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>Country restrictions snapshot</h2>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>Category</th><th>Country</th><th>Approval</th><th>Risk</th></tr></thead>
              <tbody>
                {rules.slice(0, 12).map((rule) => (
                  <tr key={`${rule.category}-${rule.country_code}`}>
                    <td>{rule.category}</td>
                    <td>{rule.country_code}</td>
                    <td>{rule.requires_approval ? 'Required' : 'Open'}</td>
                    <td><span className="lx-status-pill" style={{ background: rule.risk_tier === 'prohibited' ? '#7f1d1d' : rule.risk_tier === 'restricted' ? '#ef4444' : rule.risk_tier === 'managed' ? '#f59e0b' : '#22c55e' }}>{rule.risk_tier}</span></td>
                  </tr>
                ))}
                {!loading && rules.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'#94a3b8' }}>No country access rules found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
