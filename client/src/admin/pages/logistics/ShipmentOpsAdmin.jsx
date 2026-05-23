import React, { useEffect, useState } from 'react';
import { adminListShipments } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function ShipmentOpsAdmin() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminListShipments({ limit: 100 })
      .then((res) => setShipments(res.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const active = shipments.filter((row) => !['completed'].includes(row.status));
  const customs = shipments.filter((row) => ['arrived_destination', 'customs_hold', 'customs_cleared'].includes(row.status));
  const exceptions = shipments.filter((row) => row.status === 'exception');

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">Shipment Ops Workspace</h1>
        <p className="lx-page-sub">Watch the active freight pipeline, customs queue, and exception posture across all logistics lanes.</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          ['Active shipments', active.length, '🚢'],
          ['Customs queue', customs.length, '📋'],
          ['Exceptions', exceptions.length, '⚠️'],
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
          <thead><tr><th>Reference</th><th>Route</th><th>Freight</th><th>Status</th><th>ETA</th></tr></thead>
          <tbody>
            {shipments.map((shipment) => (
              <tr key={shipment.id}>
                <td>{shipment.reference}</td>
                <td>{shipment.origin_country} → {shipment.destination_country}</td>
                <td>{shipment.freight_mode || '—'}</td>
                <td><span className="lx-status-pill" style={{ background: shipment.status === 'exception' ? '#ef4444' : shipment.status === 'completed' ? '#22c55e' : '#64748b' }}>{shipment.status}</span></td>
                <td>{shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {!loading && shipments.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8' }}>No shipments found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
