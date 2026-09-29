import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../hooks/useAuth';
import axios from '../../../api/axios';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import '../../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLORS = {
  draft:'#94a3b8', open:'#22c55e', quoted:'#f59e0b', approved:'#22c55e',
  placed_with_supplier:'#3b82f6', in_transit:'#06b6d4', customs_review:'#dc2626',
  warehoused:'#0ea5e9', fulfilled:'#10b981', closed:'#475569', cancelled:'#ef4444',
  planned:'#94a3b8', booked:'#3b82f6', completed:'#15803d', exception:'#ef4444',
};

const ADMIN_LINKS = [
  { labelKey:'sourcingOps', path:'/admin/logistics/sourcing-ops', icon:'🔍' },
  { labelKey:'organizerApprovals', path:'/admin/logistics/organizer-approvals', icon:'🧭' },
  { labelKey:'lanes', path:'/admin/logistics/lanes', icon:'🛣' },
  { labelKey:'suppliers', path:'/admin/logistics/suppliers', icon:'🏭' },
  { labelKey:'quotes', path:'/admin/logistics/quotes', icon:'💬' },
  { labelKey:'campaigns', path:'/admin/logistics/campaigns', icon:'🤝' },
  { labelKey:'purchaseOrders', path:'/admin/logistics/purchase-orders', icon:'📦' },
  { labelKey:'shipmentOps', path:'/admin/logistics/shipment-ops', icon:'🚦' },
  { labelKey:'shipments', path:'/admin/logistics/shipments', icon:'🚢' },
  { labelKey:'complianceReview', path:'/admin/logistics/compliance-review', icon:'🧪' },
  { labelKey:'customs', path:'/admin/logistics/customs', icon:'📋' },
  { labelKey:'warehouseOps', path:'/admin/logistics/warehouse-ops', icon:'🏬' },
  { labelKey:'warehouses', path:'/admin/logistics/warehouses', icon:'🏗' },
  { labelKey:'allocations', path:'/admin/logistics/allocations', icon:'📊' },
  { labelKey:'pricing', path:'/admin/logistics/pricing', icon:'💰' },
  { labelKey:'restrictions', path:'/admin/logistics/restrictions', icon:'⛔' },
  { labelKey:'disputes', path:'/admin/logistics/disputes', icon:'⚖' },
  { labelKey:'superControl', path:'/admin/logistics/control', icon:'👑' },
];

function StatBar({ label, rows, colorMap, t }) {
  const total = rows.reduce((s, r) => s + parseInt(r.count||0), 0);
  return (
    <div className="lx-card" style={{ marginBottom:'1.25rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.75rem' }}>
        <h3 style={{ fontWeight:700, margin:0 }}>{label}</h3>
        <span style={{ fontWeight:800, fontSize:'1.1rem' }}>{total}</span>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'.5rem' }}>
        {rows.map(r => (
          <div key={r.status} style={{ display:'flex', gap:'.4rem', alignItems:'center' }}>
            <span className="lx-status-pill" style={{ background: colorMap[r.status]||'#64748b' }}>
              {t(`logistics.status.${r.status}`, { defaultValue: r.status?.replace(/_/g,' ') || t('logistics.admin.unknownStatus') })}
            </span>
            <span style={{ fontWeight:700 }}>{r.count}</span>
            {r.total_value && <span style={{ color:'#f97316', fontWeight:700, fontSize:'.8rem' }}>
              (${parseFloat(r.total_value).toLocaleString()})
            </span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LogisticsAdminDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const { data: stats, loading, error, reload } = useAbortableFetch(
    // Direct request (not the api wrapper) so the abort signal reaches the network call.
    async (signal) => (await axios.get('/admin/logistics/stats', { signal })).data.data,
    []
  );

  const links = isSuperAdmin
    ? ADMIN_LINKS
    : ADMIN_LINKS.filter((l) => l.path !== '/admin/logistics/control');

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">⚙️ {t('logistics.admin.title','Logistics Operations')}</h1>
        <p className="lx-page-sub">{t('logistics.admin.subtitle','Full control over lanes, suppliers, orders, shipments, warehouses, pricing, and compliance.')}</p>
      </div>

      {/* Quick nav */}
      <div className="lx-nav-grid" style={{ marginBottom:'2rem' }}>
        {links.map(l => (
          <Link key={l.path} to={l.path} className="lx-nav-tile">
            <span className="lx-nav-icon">{l.icon}</span>
            <span className="lx-nav-label">{t(`logistics.admin.links.${l.labelKey}`)}</span>
          </Link>
        ))}
      </div>

      {loading && <div className="lx-loading">{t('logistics.admin.loading')}</div>}

      {!loading && error && <AdminErrorState onRetry={reload} />}

      {!loading && !error && stats && (
        <>
          <StatBar label={t('logistics.admin.metrics.purchaseOrders')} rows={stats.purchaseOrders||[]} colorMap={STATUS_COLORS} t={t} />
          <StatBar label={t('logistics.admin.metrics.shipments')} rows={stats.shipments||[]} colorMap={STATUS_COLORS} t={t} />
          <StatBar label={t('logistics.admin.metrics.pooledCampaigns')} rows={stats.pooledOrders||[]} colorMap={STATUS_COLORS} t={t} />
          <StatBar label={t('logistics.admin.metrics.sourcingRequests')} rows={stats.sourcingRequests||[]} colorMap={STATUS_COLORS} t={t} />
          <StatBar label={t('logistics.admin.metrics.claims')} rows={stats.claims||[]} colorMap={{ open:'#f59e0b', under_review:'#f97316', approved:'#22c55e', rejected:'#ef4444', resolved:'#10b981', escalated:'#8b5cf6' }} t={t} />

          {stats.warehouses?.length > 0 && (
            <div className="lx-card">
              <h3 style={{ fontWeight:700, marginBottom:'.75rem' }}>{t('logistics.admin.warehouseTable.title')}</h3>
              <div className="lx-table-wrap">
                <table className="lx-table" style={{ fontSize:'.85rem' }}>
                  <thead><tr><th>{t('logistics.admin.warehouseTable.warehouse')}</th><th>{t('logistics.admin.warehouseTable.activeReceipts')}</th><th>{t('logistics.admin.warehouseTable.totalUnits')}</th></tr></thead>
                  <tbody>
                    {stats.warehouses.map(w => (
                      <tr key={w.name}>
                        <td style={{ fontWeight:600 }}>{w.name}</td>
                        <td>{w.receipts}</td>
                        <td>{parseInt(w.total_units||0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
