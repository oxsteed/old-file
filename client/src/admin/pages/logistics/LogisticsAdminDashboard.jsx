import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../hooks/useAuth';
import axios from '../../../api/axios';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import LogisticsStatusPill from '../../../components/logistics/LogisticsStatusPill';
import '../../../styles/logistics/LogisticsHomePage.css';

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
  { labelKey:'refunds', path:'/admin/logistics/refunds', icon:'↩' },
  { labelKey:'superControl', path:'/admin/logistics/control', icon:'👑' },
];

function StatBar({ label, rows, t }) {
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
            <LogisticsStatusPill
              status={r.status}
              label={t(`logistics.status.${r.status}`, { defaultValue: r.status?.replace(/_/g,' ') || t('logistics.admin.unknownStatus') })}
            />
            <span style={{ fontWeight:700 }}>{r.count}</span>
            {r.total_value && <span style={{ color:'var(--color-primary)', fontWeight:700, fontSize:'.8rem' }}>
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
          <StatBar label={t('logistics.admin.metrics.purchaseOrders')} rows={stats.purchaseOrders||[]} t={t} />
          <StatBar label={t('logistics.admin.metrics.shipments')} rows={stats.shipments||[]} t={t} />
          <StatBar label={t('logistics.admin.metrics.pooledCampaigns')} rows={stats.pooledOrders||[]} t={t} />
          <StatBar label={t('logistics.admin.metrics.sourcingRequests')} rows={stats.sourcingRequests||[]} t={t} />
          <StatBar label={t('logistics.admin.metrics.claims')} rows={stats.claims||[]} t={t} />

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
