import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  adminListAllocations, adminCreateAllocation, adminReleaseAllocation,
  adminListDeliveryOrders, adminCreateDeliveryOrder, adminListWarehouses,
} from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

const ALLOC_STATUS_COLOR = { pending:'#f59e0b', reserved:'#3b82f6', fulfilled:'#22c55e', released:'#94a3b8', expired:'#ef4444' };
const DO_STATUS_COLOR    = { pending:'#f59e0b', dispatched:'#3b82f6', delivered:'#22c55e', failed:'#ef4444', cancelled:'#94a3b8' };
const DELIVERY_MODES     = ['courier','freight','self_pickup','local_delivery'];

export default function AllocationsAdmin() {
  const { t } = useTranslation();
  const [tab, setTab]             = useState('allocations');
  const [allocations, setAllocations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showDoForm, setShowDoForm] = useState(false);
  const [doForm, setDoForm]       = useState({ allocation_id:'', delivery_mode:'courier', recipient_name:'', recipient_address:'', notes:'' });
  const [saving, setSaving]       = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      adminListAllocations({}),
      adminListDeliveryOrders({}),
      adminListWarehouses(),
    ]).then(([aRes, dRes, wRes]) => {
      setAllocations(aRes.data||[]);
      setDeliveries(dRes.data||[]);
      setWarehouses(wRes.data||[]);
    }).catch((err) => setLoadError(err)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  const [releaseTarget, setReleaseTarget] = useState(null);

  const doRelease = async () => {
    try {
      await adminReleaseAllocation(releaseTarget);
      toast.success(t('adminAllocations.allocationReleased'));
      setReleaseTarget(null);
      load();
    } catch (err) { throw new Error(err.message || t('adminAllocations.releaseFailed')); }
  };

  const createDO = async () => {
    if (!doForm.allocation_id || !doForm.recipient_name) {
      toast.error(t('adminAllocations.allocationRecipientRequired'));
      return;
    }
    setSaving(true);
    try {
      await adminCreateDeliveryOrder(doForm);
      toast.success(t('adminAllocations.deliveryOrderCreated'));
      setShowDoForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'1rem' }}>
          <div>
            <h1 className="lx-page-title">{t('adminAllocations.title')}</h1>
            <p className="lx-page-sub">{t('adminAllocations.subtitle')}</p>
          </div>
          {tab === 'deliveries' && (
            <button className="lx-btn-primary" onClick={() => setShowDoForm(s=>!s)}>{t('adminAllocations.newDeliveryOrder')}</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1.5rem' }}>
        {[['allocations', t('adminAllocations.tabs.allocations')], ['deliveries', t('adminAllocations.tabs.deliveries')]].map(([t2,label]) => (
          <button key={t2} onClick={() => setTab(t2)} style={{
            padding:'.6rem 1.25rem', border:'none', background:'none',
            fontWeight: tab===t2 ? 700 : 500, color: tab===t2 ? '#f97316' : '#64748b',
            borderBottom: tab===t2 ? '2px solid #f97316' : '2px solid transparent',
            marginBottom:'-2px', cursor:'pointer',
          }}>{label}</button>
        ))}
      </div>

      {loading && <div className="lx-loading">{t('common.loading')}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {/* New delivery order form */}
      {showDoForm && tab === 'deliveries' && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'2px solid #f97316' }}>
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>{t('adminAllocations.createDeliveryOrder')}</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'1rem' }}>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminAllocations.form.allocation')}</label>
              <select className="lx-select" value={doForm.allocation_id}
                onChange={e => setDoForm(f=>({...f,allocation_id:e.target.value}))}>
                <option value="">{t('adminAllocations.form.selectAllocation')}</option>
                {allocations.filter(a => a.status === 'reserved').map(a => (
                  <option key={a.id} value={a.id}>
                    {t('adminAllocations.form.allocationOption', { id: a.id, qty: a.qty, warehouse: warehouseMap[a.warehouse_id]||a.warehouse_id })}
                  </option>
                ))}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminAllocations.form.deliveryMode')}</label>
              <select className="lx-select" value={doForm.delivery_mode}
                onChange={e => setDoForm(f=>({...f,delivery_mode:e.target.value}))}>
                {DELIVERY_MODES.map(m => <option key={m} value={m}>{t(`adminAllocations.deliveryModes.${m}`)}</option>)}
              </select>
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminAllocations.form.recipientName')}</label>
              <input className="lx-input" value={doForm.recipient_name}
                onChange={e => setDoForm(f=>({...f,recipient_name:e.target.value}))} />
            </div>
            <div className="lx-form-group">
              <label className="lx-label">{t('adminAllocations.form.recipientAddress')}</label>
              <input className="lx-input" value={doForm.recipient_address}
                onChange={e => setDoForm(f=>({...f,recipient_address:e.target.value}))} />
            </div>
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{t('adminAllocations.form.notes')}</label>
            <textarea className="lx-textarea" value={doForm.notes}
              onChange={e => setDoForm(f=>({...f,notes:e.target.value}))} />
          </div>
          <div style={{ display:'flex', gap:'.75rem' }}>
            <button className="lx-btn-primary" onClick={createDO} disabled={saving}>
              {saving ? t('adminAllocations.creating') : t('adminAllocations.createDeliveryOrder')}
            </button>
            <button className="lx-btn-secondary" onClick={() => setShowDoForm(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {tab === 'allocations' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>{t('adminAllocations.table.id')}</th><th>{t('adminAllocations.table.warehouse')}</th><th>{t('adminAllocations.table.buyer')}</th><th>{t('adminAllocations.table.qty')}</th>
                <th>{t('adminAllocations.table.reservedUntil')}</th><th>{t('adminAllocations.table.status')}</th><th>{t('adminAllocations.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map(a => (
                <tr key={a.id}>
                  <td style={{ color:'#64748b', fontSize:'.8rem' }}>#{a.id}</td>
                  <td style={{ fontSize:'.82rem' }}>{warehouseMap[a.warehouse_id] || a.warehouse_id}</td>
                  <td style={{ fontSize:'.82rem' }}>{a.buyer_name || a.buyer_user_id}</td>
                  <td style={{ fontWeight:700 }}>{a.qty?.toLocaleString()}</td>
                  <td style={{ fontSize:'.8rem' }}>
                    {a.reserved_until ? new Date(a.reserved_until).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: ALLOC_STATUS_COLOR[a.status]||'#64748b' }}>
                      {t(`logistics.status.${a.status}`, { defaultValue: a.status?.replace(/_/g,' ') || t('logistics.admin.unknownStatus') })}
                    </span>
                  </td>
                  <td>
                    {a.status === 'reserved' && (
                      <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .5rem' }}
                        onClick={() => setReleaseTarget(a.id)}>
                        {t('adminAllocations.release')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {allocations.length === 0 && !loading && !loadError && (
                <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t('adminAllocations.noAllocations')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'deliveries' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>{t('adminAllocations.deliveriesTable.reference')}</th><th>{t('adminAllocations.deliveriesTable.recipient')}</th><th>{t('adminAllocations.deliveriesTable.mode')}</th>
                <th>{t('adminAllocations.deliveriesTable.tracking')}</th><th>{t('adminAllocations.deliveriesTable.dispatched')}</th><th>{t('adminAllocations.deliveriesTable.status')}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id}>
                  <td><code style={{ fontSize:'.78rem' }}>{d.reference}</code></td>
                  <td style={{ fontSize:'.82rem' }}>
                    <div style={{ fontWeight:600 }}>{d.recipient_name}</div>
                    <div style={{ color:'#94a3b8', fontSize:'.72rem' }}>{d.recipient_address}</div>
                  </td>
                  <td>
                    <span style={{ background:'#f1f5f9', borderRadius:'.375rem', padding:'.15rem .4rem', fontSize:'.72rem', fontWeight:700 }}>
                      {t(`adminAllocations.deliveryModes.${d.delivery_mode}`, { defaultValue: d.delivery_mode?.replace(/_/g,' ') })}
                    </span>
                  </td>
                  <td style={{ fontSize:'.78rem', color:'#64748b' }}>{d.tracking_number || '—'}</td>
                  <td style={{ fontSize:'.8rem' }}>
                    {d.dispatched_at ? new Date(d.dispatched_at).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: DO_STATUS_COLOR[d.status]||'#64748b' }}>
                      {t(`logistics.status.${d.status}`, { defaultValue: d.status?.replace(/_/g,' ') || t('logistics.admin.unknownStatus') })}
                    </span>
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && !loading && !loadError && (
                <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t('adminAllocations.noDeliveries')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={releaseTarget != null}
        title={t('adminAllocations.releaseTitle')}
        message={t('adminAllocations.releaseMessage')}
        confirmLabel={t('adminAllocations.release')}
        onConfirm={doRelease}
        onClose={() => setReleaseTarget(null)}
      />
    </div>
  );
}
