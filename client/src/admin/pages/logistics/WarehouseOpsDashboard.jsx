import React, { useEffect, useState } from 'react';
import { adminListWarehouses, adminListReceipts, adminListAllocations, adminListDeliveryOrders } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function WarehouseOpsDashboard() {
  const [data, setData] = useState({ warehouses: [], receipts: [], allocations: [], deliveries: [], loading: true });

  useEffect(() => {
    Promise.all([
      adminListWarehouses(),
      adminListReceipts(),
      adminListAllocations(),
      adminListDeliveryOrders(),
    ])
      .then(([warehouses, receipts, allocations, deliveries]) => {
        setData({
          warehouses: warehouses.data || [],
          receipts: receipts.data || [],
          allocations: allocations.data || [],
          deliveries: deliveries.data || [],
          loading: false,
        });
      })
      .catch(() => setData((current) => ({ ...current, loading: false })));
  }, []);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Warehouse Ops Workspace</h1>
        <p className="lx-page-sub">Monitor receiving, reconcile discrepancies, and move inventory into release-ready allocations and delivery orders.</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          ['Warehouses', data.warehouses.length, '🏗'],
          ['Open receipts', data.receipts.filter((row) => row.status !== 'reconciled').length, '📥'],
          ['Allocations', data.allocations.length, '📊'],
          ['Deliveries', data.deliveries.length, '🚚'],
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
            {data.warehouses.map((warehouse) => (
              <tr key={warehouse.id}>
                <td>{warehouse.name}</td>
                <td>{warehouse.country}</td>
                <td>{data.receipts.filter((row) => row.warehouse_id === warehouse.id && row.status !== 'reconciled').length}</td>
                <td>{data.allocations.filter((row) => row.warehouse_id === warehouse.id && row.status !== 'released').length}</td>
              </tr>
            ))}
            {!data.loading && data.warehouses.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'#94a3b8' }}>No warehouses found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
