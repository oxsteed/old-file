import React from 'react';
import axios from '../../../api/axios';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function WarehouseOpsDashboard() {
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    // Direct requests (not the api wrappers) so the abort signal reaches the network calls.
    const [warehouses, receipts, allocations, deliveries] = await Promise.all([
      axios.get('/logistics/warehouses', { signal }).then(r => r.data),
      axios.get('/logistics/inventory-receipts', { signal }).then(r => r.data),
      axios.get('/logistics/allocations', { signal }).then(r => r.data),
      axios.get('/logistics/deliveries', { signal }).then(r => r.data),
    ]);
    return {
      warehouses: warehouses.data || [],
      receipts: receipts.data || [],
      allocations: allocations.data || [],
      deliveries: deliveries.data || [],
    };
  }, []);

  const warehouses  = data?.warehouses  || [];
  const receipts    = data?.receipts    || [];
  const allocations = data?.allocations || [];
  const deliveries  = data?.deliveries  || [];

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Warehouse Ops Workspace</h1>
        <p className="lx-page-sub">Monitor receiving, reconcile discrepancies, and move inventory into release-ready allocations and delivery orders.</p>
      </div>
      {loading && <div className="lx-loading">Loading…</div>}
      {!loading && error && <AdminErrorState onRetry={reload} />}
      {!loading && !error && (
      <>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          ['Warehouses', warehouses.length, '🏗'],
          ['Open receipts', receipts.filter((row) => row.status !== 'reconciled').length, '📥'],
          ['Allocations', allocations.length, '📊'],
          ['Deliveries', deliveries.length, '🚚'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead><tr><th>Warehouse</th><th>Country</th><th>Open receipts</th><th>Pending allocations</th></tr></thead>
          <tbody>
            {warehouses.map((warehouse) => (
              <tr key={warehouse.id}>
                <td>{warehouse.name}</td>
                <td>{warehouse.country}</td>
                <td>{receipts.filter((row) => row.warehouse_id === warehouse.id && row.status !== 'reconciled').length}</td>
                <td>{allocations.filter((row) => row.warehouse_id === warehouse.id && row.status !== 'released').length}</td>
              </tr>
            ))}
            {warehouses.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'#94a3b8' }}>No warehouses found.</td></tr>}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
