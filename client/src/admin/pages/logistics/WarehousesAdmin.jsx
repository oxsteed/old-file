import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  adminListWarehouses, adminCreateWarehouse,
  adminListReceipts, adminReceiveInventory, adminReconcileReceipt,
} from '../../../api/logistics';
import toast from 'react-hot-toast';
import '../../../styles/logistics/LogisticsHomePage.css';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

const RECEIPT_STATUS_COLOR = {
  pending:'#f59e0b', received:'#22c55e', discrepancy:'#dc2626', reconciled:'#10b981',
};

export default function WarehousesAdmin() {
  const { t } = useTranslation();
  const [tab, setTab]             = useState('warehouses');
  const [warehouses, setWarehouses] = useState([]);
  const [receipts, setReceipts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ name:'', country:'', city:'', address:'', contact_name:'', contact_email:'', capacity_cbm:'', notes:'' });
  const [receiptModal, setReceiptModal] = useState(null);
  const [receiveForm, setReceiveForm] = useState({ received_qty:'', shortage_qty:'', damaged_qty:'', notes:'' });
  const [saving, setSaving]       = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([adminListWarehouses(), adminListReceipts({})])
      .then(([wRes, rRes]) => {
        setWarehouses(wRes.data||[]);
        setReceipts(rRes.data||[]);
      }).catch((err) => setLoadError(err)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const createWarehouse = async () => {
    if (!form.name || !form.country) { toast.error(t('adminWarehouses.nameCountryRequired')); return; }
    setSaving(true);
    try {
      await adminCreateWarehouse(form);
      toast.success(t('adminWarehouses.warehouseCreated'));
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const doReceive = async () => {
    if (!receiveForm.received_qty) { toast.error(t('adminWarehouses.enterReceivedQty')); return; }
    setSaving(true);
    try {
      await adminReceiveInventory(receiptModal.id, receiveForm);
      toast.success(t('adminWarehouses.inventoryReceived'));
      setReceiptModal(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  const [reconcileTarget, setReconcileTarget] = useState(null);

  const doReconcile = async (notes) => {
    try {
      await adminReconcileReceipt(reconcileTarget, { notes });
      toast.success(t('adminWarehouses.receiptReconciled'));
      setReconcileTarget(null);
      load();
    } catch (err) { throw new Error(err.response?.data?.message || err.message || t('adminWarehouses.reconcileFailed')); }
  };

  const set = (k, v) => setForm(f=>({...f,[k]:v}));

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'1rem' }}>
          <div>
            <h1 className="lx-page-title">{t('adminWarehouses.title')}</h1>
            <p className="lx-page-sub">{t('adminWarehouses.subtitle')}</p>
          </div>
          {tab === 'warehouses' && (
            <button className="lx-btn-primary" onClick={() => setShowForm(s=>!s)}>{t('adminWarehouses.addWarehouse')}</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'.25rem', borderBottom:'2px solid #e2e8f0', marginBottom:'1.5rem' }}>
        {['warehouses','receipts'].map(tabKey => (
          <button key={tabKey} onClick={() => setTab(tabKey)} style={{
            padding:'.6rem 1.25rem', border:'none', background:'none',
            fontWeight: tab===tabKey ? 700 : 500, color: tab===tabKey ? '#f97316' : '#64748b',
            borderBottom: tab===tabKey ? '2px solid #f97316' : '2px solid transparent',
            marginBottom:'-2px', cursor:'pointer', textTransform:'capitalize',
          }}>{tabKey === 'warehouses' ? t('adminWarehouses.tabs.warehouses') : t('adminWarehouses.tabs.receipts')}</button>
        ))}
      </div>

      {loading && <div className="lx-loading">{t('common.loading')}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {/* Create warehouse form */}
      {showForm && tab === 'warehouses' && (
        <div className="lx-card" style={{ marginBottom:'1.5rem', border:'2px solid #f97316' }}>
          <h3 style={{ fontWeight:700, marginBottom:'1rem' }}>{t('adminWarehouses.newWarehouse')}</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'1rem' }}>
            {[
              ['name', t('adminWarehouses.form.name')],['country', t('adminWarehouses.form.country')],['city', t('adminWarehouses.form.city')],
              ['address', t('adminWarehouses.form.address')],['contact_name', t('adminWarehouses.form.contactName')],['contact_email', t('adminWarehouses.form.contactEmail')],
              ['capacity_cbm', t('adminWarehouses.form.capacity')],
            ].map(([k,label]) => (
              <div key={k} className="lx-form-group">
                <label className="lx-label">{label}</label>
                <input className="lx-input" value={form[k]} onChange={e => set(k, e.target.value)} />
              </div>
            ))}
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{t('adminWarehouses.form.notes')}</label>
            <textarea className="lx-textarea" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          <div style={{ display:'flex', gap:'.75rem' }}>
            <button className="lx-btn-primary" onClick={createWarehouse} disabled={saving}>
              {saving ? t('common.saving') : t('adminWarehouses.createWarehouse')}
            </button>
            <button className="lx-btn-secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {tab === 'warehouses' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'1.25rem' }}>
          {warehouses.map(w => (
            <div key={w.id} className="lx-card">
              <div style={{ fontWeight:700, fontSize:'1rem', marginBottom:'.25rem' }}>{w.name}</div>
              <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'.75rem' }}>
                {w.city ? `${w.city}, ` : ''}{w.country}
              </div>
              {[
                [t('adminWarehouses.card.contact'), w.contact_name],
                [t('adminWarehouses.card.email'), w.contact_email],
                [t('adminWarehouses.card.capacity'), w.capacity_cbm ? t('adminWarehouses.card.capacityValue', { value: w.capacity_cbm }) : null],
              ].filter(([,v])=>v).map(([k,v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:'.8rem', padding:'.2rem 0', borderBottom:'1px solid #f1f5f9' }}>
                  <span style={{ color:'#94a3b8' }}>{k}</span>
                  <span style={{ fontWeight:600 }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop:'.75rem', display:'flex', gap:'.4rem', flexWrap:'wrap' }}>
                <span style={{ fontSize:'.72rem', background:'#f1f5f9', borderRadius:999, padding:'.1rem .5rem', fontWeight:600 }}>
                  {w.is_active ? t('adminWarehouses.card.active') : t('adminWarehouses.card.inactive')}
                </span>
              </div>
            </div>
          ))}
          {warehouses.length === 0 && !loading && !loadError && (
            <div style={{ textAlign:'center', color:'#94a3b8', padding:'2rem' }}>{t('adminWarehouses.noWarehousesYet')}</div>
          )}
        </div>
      )}

      {tab === 'receipts' && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>{t('adminWarehouses.receiptsTable.reference')}</th><th>{t('adminWarehouses.receiptsTable.warehouse')}</th><th>{t('adminWarehouses.receiptsTable.expectedQty')}</th>
                <th>{t('adminWarehouses.receiptsTable.receivedQty')}</th><th>{t('adminWarehouses.receiptsTable.shortage')}</th><th>{t('adminWarehouses.receiptsTable.damaged')}</th><th>{t('adminWarehouses.receiptsTable.status')}</th><th>{t('adminWarehouses.receiptsTable.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => (
                <tr key={r.id}>
                  <td><code style={{ fontSize:'.78rem' }}>{r.reference}</code></td>
                  <td style={{ fontSize:'.82rem' }}>{r.warehouse_name || r.warehouse_id}</td>
                  <td>{r.expected_qty?.toLocaleString()}</td>
                  <td style={{ fontWeight: r.received_qty ? 700 : 400 }}>
                    {r.received_qty?.toLocaleString() || '—'}
                  </td>
                  <td style={{ color: r.shortage_qty > 0 ? '#dc2626' : 'inherit', fontWeight: r.shortage_qty > 0 ? 700 : 400 }}>
                    {r.shortage_qty > 0 ? r.shortage_qty : '—'}
                  </td>
                  <td style={{ color: r.damaged_qty > 0 ? '#f97316' : 'inherit', fontWeight: r.damaged_qty > 0 ? 700 : 400 }}>
                    {r.damaged_qty > 0 ? r.damaged_qty : '—'}
                  </td>
                  <td>
                    <span className="lx-status-pill" style={{ background: RECEIPT_STATUS_COLOR[r.status]||'#64748b' }}>
                      {t(`logistics.status.${r.status}`, { defaultValue: r.status?.replace(/_/g,' ') || t('logistics.admin.unknownStatus') })}
                    </span>
                  </td>
                  <td style={{ display:'flex', gap:'.4rem', flexWrap:'wrap' }}>
                    {r.status === 'pending' && (
                      <button className="lx-btn-primary" style={{ fontSize:'.72rem', padding:'.25rem .5rem' }}
                        onClick={() => { setReceiptModal(r); setReceiveForm({ received_qty:'', shortage_qty:'', damaged_qty:'', notes:'' }); }}>
                        {t('adminWarehouses.receive')}
                      </button>
                    )}
                    {r.status === 'discrepancy' && (
                      <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .5rem' }}
                        onClick={() => setReconcileTarget(r.id)}>
                        {t('adminWarehouses.reconcile')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {receipts.length === 0 && !loading && !loadError && (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>{t('adminWarehouses.noReceipts')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {receiptModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ background:'var(--card-bg,#fff)', borderRadius:'1rem', padding:'1.5rem', width:420, maxWidth:'90vw' }}>
            <h3 style={{ fontWeight:700, marginBottom:'.5rem' }}>{t('adminWarehouses.receiveModal.title', { reference: receiptModal.reference })}</h3>
            <div style={{ fontSize:'.82rem', color:'#64748b', marginBottom:'1rem' }}>
              {t('adminWarehouses.receiveModal.expectedText', { qty: receiptModal.expected_qty?.toLocaleString() })}
            </div>
            {['received_qty','shortage_qty','damaged_qty'].map(k => (
              <div key={k} className="lx-form-group">
                <label className="lx-label">{t(`adminWarehouses.receiveModal.fields.${k}`)}</label>
                <input type="number" className="lx-input" value={receiveForm[k]}
                  onChange={e => setReceiveForm(f=>({...f,[k]:e.target.value}))} />
              </div>
            ))}
            <div className="lx-form-group">
              <label className="lx-label">{t('adminWarehouses.receiveModal.notes')}</label>
              <textarea className="lx-textarea" rows={2} value={receiveForm.notes}
                onChange={e => setReceiveForm(f=>({...f,notes:e.target.value}))} />
            </div>
            <div style={{ display:'flex', gap:'.75rem' }}>
              <button className="lx-btn-primary" onClick={doReceive} disabled={saving}>
                {saving ? t('common.saving') : t('adminWarehouses.receiveModal.confirmReceipt')}
              </button>
              <button className="lx-btn-secondary" onClick={() => setReceiptModal(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={reconcileTarget != null}
        title={t('adminWarehouses.reconcileDialog.title')}
        message={t('adminWarehouses.reconcileDialog.message')}
        requireReason
        reasonLabel={t('adminWarehouses.reconcileDialog.reasonLabel')}
        reasonPlaceholder={t('adminWarehouses.reconcileDialog.reasonPlaceholder')}
        confirmLabel={t('adminWarehouses.reconcile')}
        onConfirm={doReconcile}
        onClose={() => setReconcileTarget(null)}
      />
    </div>
  );
}
