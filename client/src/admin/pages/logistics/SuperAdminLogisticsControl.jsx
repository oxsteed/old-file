import React from 'react';
import axios from '../../../api/axios';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function SuperAdminLogisticsControl() {
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    // Direct requests (not the api wrappers) so the abort signal reaches the network calls.
    const [markup, fees, restrictions, stats] = await Promise.all([
      axios.get('/admin/logistics/markup-rules', { signal }).then(r => r.data),
      axios.get('/admin/logistics/fee-rules', { signal }).then(r => r.data),
      axios.get('/admin/logistics/restrictions', { signal }).then(r => r.data),
      axios.get('/admin/logistics/stats', { signal }).then(r => r.data),
    ]);
    return {
      markup: markup.data || [],
      fees: fees.data || [],
      restrictions: restrictions.data || [],
      stats: stats.data || null,
    };
  }, []);

  const markup       = data?.markup       || [];
  const fees         = data?.fees         || [];
  const restrictions = data?.restrictions || [];
  const stats        = data?.stats        || null;

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Super Admin Logistics Control</h1>
        <p className="lx-page-sub">See the branch-level pricing engine, restriction fabric, and operational volume from one super-admin control room.</p>
      </div>
      {loading && <div className="lx-loading">Loading…</div>}
      {!loading && error && <AdminErrorState onRetry={reload} />}
      {!loading && !error && (
      <>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          ['Markup rules', markup.length, '📈'],
          ['Fee rules', fees.length, '💸'],
          ['Country restrictions', restrictions.length, '⛔'],
          ['PO statuses', stats?.purchaseOrders?.length || 0, '📦'],
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
                {markup.slice(0, 12).map((rule) => (
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
                {fees.slice(0, 6).map((fee) => (
                  <tr key={`f-${fee.id}`}>
                    <td>{fee.fee_type}</td>
                    <td>{fee.scope}</td>
                    <td>{fee.is_active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
                {restrictions.slice(0, 6).map((rule) => (
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
      </>
      )}
    </div>
  );
}
