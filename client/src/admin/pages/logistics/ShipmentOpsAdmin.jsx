import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListShipments } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';

export default function ShipmentOpsAdmin() {
  const { t, i18n } = useTranslation();
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    adminListShipments({ limit: 100 })
      .then((res) => setShipments(res.data || []))
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const active = shipments.filter((row) => !['completed'].includes(row.status));
  const customs = shipments.filter((row) => ['arrived_destination', 'customs_hold', 'customs_cleared'].includes(row.status));
  const exceptions = shipments.filter((row) => row.status === 'exception');

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('logistics.admin.shipmentOps.title')}</h1>
        <p className="lx-page-sub">{t('logistics.admin.shipmentOps.subtitle')}</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          [t('logistics.admin.shipmentOps.activeShipments'), active.length, '🚢'],
          [t('logistics.admin.shipmentOps.customsQueue'), customs.length, '📋'],
          [t('logistics.admin.shipmentOps.exceptions'), exceptions.length, '⚠️'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>
      {!loading && loadError && <AdminErrorState onRetry={load} />}
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead><tr><th>{t('logistics.admin.shipmentOps.reference')}</th><th>{t('logistics.admin.shipmentOps.route')}</th><th>{t('logistics.admin.shipmentOps.freight')}</th><th>{t('logistics.admin.shipmentOps.status')}</th><th>{t('logistics.admin.shipmentOps.eta')}</th></tr></thead>
          <tbody>
            {shipments.map((shipment) => (
              <tr key={shipment.id}>
                <td>{shipment.reference}</td>
                <td>{shipment.origin_country} → {shipment.destination_country}</td>
                <td>{shipment.freight_mode || '—'}</td>
                <td><span className="lx-status-pill" style={{ background: shipment.status === 'exception' ? '#ef4444' : shipment.status === 'completed' ? '#22c55e' : '#64748b' }}>{t(`logistics.status.${shipment.status}`, { defaultValue: shipment.status || t('logistics.admin.unknownStatus') })}</span></td>
                <td>{shipment.eta ? new Date(shipment.eta).toLocaleDateString(i18n.language) : '—'}</td>
              </tr>
            ))}
            {!loading && !loadError && shipments.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8' }}>{t('logistics.admin.shipmentOps.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
