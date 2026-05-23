import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminGetStats } from '../../../api/logistics';
import '../../../styles/logistics/LogisticsHomePage.css';

const STATUS_COLORS = {
  draft:'#94a3b8', open:'#22c55e', quoted:'#f59e0b', approved:'#22c55e',
  placed_with_supplier:'#3b82f6', in_transit:'#06b6d4', customs_review:'#dc2626',
  warehoused:'#0ea5e9', fulfilled:'#10b981', closed:'#475569', cancelled:'#ef4444',
  planned:'#94a3b8', booked:'#3b82f6', completed:'#15803d', exception:'#ef4444',
};

const ADMIN_LINKS = [
  { label:'Sourcing Ops',   path:'/admin/logistics/sourcing-ops',   icon:'🔍' },
  { label:'Organizer Approvals', path:'/admin/logistics/organizer-approvals', icon:'🧭' },
  { label:'Lanes',          path:'/admin/logistics/lanes',          icon:'🛣' },
  { label:'Suppliers',      path:'/admin/logistics/suppliers',      icon:'🏭' },
  { label:'Quotes',         path:'/admin/logistics/quotes',         icon:'💬' },
  { label:'Campaigns',      path:'/admin/logistics/campaigns',      icon:'🤝' },
  { label:'Purchase Orders',path:'/admin/logistics/purchase-orders',icon:'📦' },
  { label:'Shipment Ops',   path:'/admin/logistics/shipment-ops',   icon:'🚦' },
  { label:'Shipments',      path:'/admin/logistics/shipments',      icon:'🚢' },
  { label:'Compliance Review', path:'/admin/logistics/compliance-review', icon:'🧪' },
  { label:'Customs',        path:'/admin/logistics/customs',        icon:'📋' },
  { label:'Warehouse Ops',  path:'/admin/logistics/warehouse-ops',  icon:'🏬' },
  { label:'Warehouses',     path:'/admin/logistics/warehouses',     icon:'🏗' },
  { label:'Allocations',    path:'/admin/logistics/allocations',    icon:'📊' },
  { label:'Pricing',        path:'/admin/logistics/pricing',        icon:'💰' },
  { label:'Restrictions',   path:'/admin/logistics/restrictions',   icon:'⛔' },
  { label:'Disputes',       path:'/admin/logistics/disputes',       icon:'⚖' },
  { label:'Super Control',  path:'/admin/logistics/control',        icon:'👑' },
];

function StatBar({ label, rows, colorMap }) {
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
              {r.status?.replace(/_/g,' ')}
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
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGetStats()
      .then(r => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">⚙️ {t('logistics.admin.title','Logistics Operations')}</h1>
        <p className="lx-page-sub">{t('logistics.admin.subtitle','Full control over lanes, suppliers, orders, shipments, warehouses, pricing, and compliance.')}</p>
      </div>

      {/* Quick nav */}
      <div className="lx-nav-grid" style={{ marginBottom:'2rem' }}>
        {ADMIN_LINKS.map(l => (
          <Link key={l.path} to={l.path} className="lx-nav-tile">
            <span className="lx-nav-icon">{l.icon}</span>
            <span className="lx-nav-label">{l.label}</span>
          </Link>
        ))}
      </div>

      {loading && <div className="lx-loading">Loading stats…</div>}

      {stats && (
        <>
          <StatBar label="Purchase Orders" rows={stats.purchaseOrders||[]} colorMap={STATUS_COLORS} />
          <StatBar label="Shipments"       rows={stats.shipments||[]}      colorMap={STATUS_COLORS} />
          <StatBar label="Pooled Campaigns" rows={stats.pooledOrders||[]}  colorMap={STATUS_COLORS} />
          <StatBar label="Sourcing Requests" rows={stats.sourcingRequests||[]} colorMap={STATUS_COLORS} />
          <StatBar label="Claims"           rows={stats.claims||[]}        colorMap={{ open:'#f59e0b', under_review:'#f97316', approved:'#22c55e', rejected:'#ef4444', resolved:'#10b981', escalated:'#8b5cf6' }} />

          {stats.warehouses?.length > 0 && (
            <div className="lx-card">
              <h3 style={{ fontWeight:700, marginBottom:'.75rem' }}>Warehouses</h3>
              <div className="lx-table-wrap">
                <table className="lx-table" style={{ fontSize:'.85rem' }}>
                  <thead><tr><th>Warehouse</th><th>Active Receipts</th><th>Total Units Received</th></tr></thead>
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
