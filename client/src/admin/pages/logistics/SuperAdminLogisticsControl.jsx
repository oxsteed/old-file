import React, { useEffect, useState } from 'react';
import { adminListMarkupRules, adminListFeeRules, adminListRestrictions, adminGetStats } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function SuperAdminLogisticsControl() {
  const [data, setData] = useState({ markup: [], fees: [], restrictions: [], stats: null, loading: true });

  useEffect(() => {
    Promise.all([
      adminListMarkupRules(),
      adminListFeeRules(),
      adminListRestrictions(),
      adminGetStats(),
    ])
      .then(([markup, fees, restrictions, stats]) => {
        setData({
          markup: markup.data || [],
          fees: fees.data || [],
          restrictions: restrictions.data || [],
          stats: stats.data || null,
          loading: false,
        });
      })
      .catch(() => setData((current) => ({ ...current, loading: false })));
  }, []);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Super Admin Logistics Control</h1>
        <p className="lx-page-sub">See the branch-level pricing engine, restriction fabric, and operational volume from one super-admin control room.</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          ['Markup rules', data.markup.length, '📈'],
          ['Fee rules', data.fees.length, '💸'],
          ['Country restrictions', data.restrictions.length, '⛔'],
          ['PO statuses', data.stats?.purchaseOrders?.length || 0, '📦'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>Markup hierarchy</h2>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>Scope</th><th>Category</th><th>Markup %</th><th>Priority</th></tr></thead>
              <tbody>
                {data.markup.slice(0, 12).map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.scope}</td>
                    <td>{rule.category || '—'}</td>
                    <td>{rule.markup_pct !== null ? `${(Number(rule.markup_pct) * 100).toFixed(1)}%` : '—'}</td>
                    <td>{rule.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>Fee stack + restrictions</h2>
          <div style={{ fontSize:'.85rem', color:'#64748b', lineHeight:1.8, marginBottom:'1rem' }}>
            Super-admin control covers markup policy, fee policy, lane restrictions, approval thresholds, and the overall profitability posture of the logistics branch.
          </div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>Fee type / category</th><th>Scope</th><th>Active</th></tr></thead>
              <tbody>
                {data.fees.slice(0, 6).map((fee) => (
                  <tr key={`f-${fee.id}`}>
                    <td>{fee.fee_type}</td>
                    <td>{fee.scope}</td>
                    <td>{fee.is_active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
                {data.restrictions.slice(0, 6).map((rule) => (
                  <tr key={`r-${rule.category}-${rule.country_code}`}>
                    <td>{rule.category} ({rule.country_code})</td>
                    <td>restriction</td>
                    <td>{rule.requires_approval ? 'Approval' : 'Open'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
