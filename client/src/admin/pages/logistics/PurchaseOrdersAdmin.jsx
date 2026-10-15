import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminTransitionPOStatus } from '../../../api/logistics';
import axios from '../../../api/axios';
import toast from 'react-hot-toast';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import '../../../styles/logistics/LogisticsHomePage.css';
import '../../../styles/logistics/LogisticsWorkspaces.css';
import LogisticsModal from '../../../components/logistics/LogisticsModal';
import LogisticsStatusPill from '../../../components/logistics/LogisticsStatusPill';
import OrderPreview from '../../../components/logistics/OrderPreview';

const PO_STATUSES = [
  'draft','quoted','approved','awaiting_deposit','deposit_collected',
  'placed_with_supplier','in_production','production_complete','ready_for_pickup',
  'in_transit','customs_review','cleared','warehoused','allocated','fulfilled',
  'closed','cancelled',
];

const VALID_TRANSITIONS = {
  draft: ['quoted','cancelled'],
  quoted: ['approved','draft','cancelled'],
  approved: ['awaiting_deposit','cancelled'],
  awaiting_deposit: ['deposit_collected','cancelled'],
  deposit_collected: ['placed_with_supplier','cancelled'],
  placed_with_supplier: ['in_production','cancelled'],
  in_production: ['production_complete','cancelled'],
  production_complete: ['ready_for_pickup'],
  ready_for_pickup: ['in_transit'],
  in_transit: ['customs_review','cleared'],
  customs_review: ['cleared'],
  cleared: ['warehoused'],
  warehoused: ['allocated'],
  allocated: ['fulfilled'],
  fulfilled: ['closed'],
};

export default function PurchaseOrdersAdmin() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [toStatus, setToStatus] = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    // Direct request (not the api wrapper) so the abort signal reaches the network call.
    const { data: payload } = await axios.get('/logistics/orders', {
      params: { status: statusFilter || undefined, limit: 200 },
      signal,
    });
    return payload.data || [];
  }, [statusFilter]);
  const orders = data || [];

  const doTransition = async () => {
    if (!toStatus) { toast.error(t('adminPurchaseOrders.selectTargetStatus')); return; }
    setSaving(true);
    try {
      await adminTransitionPOStatus(selected.id, { to_status: toStatus, notes });
      toast.success(t('adminPurchaseOrders.poMoved', { status: toStatus }));
      setSelected(null);
      reload();
    } catch (err) { toast.error(err.response?.data?.message || err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('adminPurchaseOrders.title')}</h1>
        <p className="lx-page-sub">{t('adminPurchaseOrders.subtitle')}</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('adminPurchaseOrders.allStatuses')}</option>
          {PO_STATUSES.map(s => (
            <option key={s} value={s}>{t(`logistics.admin.purchaseOrders.statuses.${s}`, { defaultValue: s.replace(/_/g,' ') })}</option>
          ))}
        </select>
      </div>

      {loading && <div className="lx-loading">{t('common.loading')}</div>}
      {!loading && error && <AdminErrorState onRetry={reload} />}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>{t('adminPurchaseOrders.table.reference')}</th><th>{t('adminPurchaseOrders.table.buyer')}</th><th>{t('adminPurchaseOrders.table.supplier')}</th><th>{t('adminPurchaseOrders.table.lane')}</th>
              <th>{t('adminPurchaseOrders.table.product')}</th><th>{t('adminPurchaseOrders.table.qty')}</th><th>{t('adminPurchaseOrders.table.landedTotal')}</th><th>{t('adminPurchaseOrders.table.status')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td><code style={{ fontSize:'.78rem' }}>{o.reference}</code></td>
                <td style={{ fontSize:'.82rem' }}>{o.buyer_name || o.buyer_user_id}</td>
                <td style={{ fontSize:'.82rem' }}>{o.supplier_name || '—'}</td>
                <td style={{ fontSize:'.78rem', color:'var(--color-text-muted)' }}>{o.lane_code || o.lane_id}</td>
                <td style={{ fontSize:'.82rem' }}>{o.product_name || '—'}</td>
                <td>{o.quantity?.toLocaleString()}</td>
                <td style={{ fontWeight:700, color:'var(--color-primary)' }}>
                  {o.total_landed_cost_usd ? `$${parseFloat(o.total_landed_cost_usd).toLocaleString()}` : '—'}
                </td>
                <td>
                  <LogisticsStatusPill
                    status={o.status}
                    label={t(`logistics.admin.purchaseOrders.statuses.${o.status}`, { defaultValue: o.status?.replace(/_/g,' ') || t('logistics.admin.unknownStatus') })}
                  />
                </td>
                <td>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem', marginInlineEnd:'.4rem' }}
                    onClick={() => setPreviewId(o.id)}>
                    {t('logistics.tables.preview')}
                  </button>
                  <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                    onClick={() => { setSelected(o); setToStatus(''); setNotes(''); }}>
{t('adminPurchaseOrders.manage')}
                  </button>
                </td>
              </tr>
            ))}
            {orders.length === 0 && !loading && !error && (
              <tr><td colSpan={9} className="lx-table-empty-cell">{t('adminPurchaseOrders.noOrders')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <LogisticsModal
        open={!!selected}
        title={selected?.reference}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div style={{ fontSize:'.82rem', color:'var(--color-text-muted)', marginBottom:'1rem' }}>
              <strong>{t('adminPurchaseOrders.modal.buyer', { defaultValue: 'Buyer:' })}</strong> {selected.buyer_name || selected.buyer_user_id} &nbsp;|&nbsp;
              <strong>{t('adminPurchaseOrders.modal.supplier', { defaultValue: 'Supplier:' })}</strong> {selected.supplier_name || '—'} &nbsp;|&nbsp;
              <strong>{t('adminPurchaseOrders.modal.qty', { defaultValue: 'Qty:' })}</strong> {selected.quantity?.toLocaleString()}
            </div>

            {/* Cost breakdown */}
            <div style={{ background:'var(--color-surface)', borderRadius:'.5rem', padding:'.75rem', marginBottom:'1rem', fontSize:'.8rem' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'.25rem' }}>
                {[
                  [t('adminPurchaseOrders.costBreakdown.productCost'), selected.product_cost_usd],
                  [t('adminPurchaseOrders.costBreakdown.sourcingFee'), selected.sourcing_fee_usd],
                  [t('adminPurchaseOrders.costBreakdown.oxsteedMarkup'), selected.oxsteed_markup_usd],
                  [t('adminPurchaseOrders.costBreakdown.freightEst'), selected.freight_est_usd],
                  [t('adminPurchaseOrders.costBreakdown.customsAdmin'), selected.customs_admin_fee_usd],
                  [t('adminPurchaseOrders.costBreakdown.warehouseFee'), selected.warehouse_fee_usd],
                  [t('adminPurchaseOrders.costBreakdown.lastMile'), selected.last_mile_fee_usd],
                  [t('adminPurchaseOrders.costBreakdown.riskSurcharge'), selected.risk_surcharge_usd],
                ].map(([label, val]) => val ? (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'.15rem 0' }}>
                    <span style={{ color:'var(--color-text-muted)' }}>{label}</span>
                    <span style={{ fontWeight:600 }}>${parseFloat(val).toFixed(2)}</span>
                  </div>
                ) : null)}
              </div>
              <div style={{ borderTop:'1px solid var(--color-border)', marginTop:'.5rem', paddingTop:'.5rem', display:'flex', justifyContent:'space-between', fontWeight:700 }}>
                <span>{t('adminPurchaseOrders.costBreakdown.totalLanded')}</span>
                <span style={{ color:'var(--color-primary)' }}>${parseFloat(selected.total_landed_cost_usd||0).toLocaleString()}</span>
              </div>
            </div>

            <div className="lx-form-group">
              <label className="lx-label">{t('adminPurchaseOrders.modal.currentStatus')} <strong>{t(`logistics.admin.purchaseOrders.statuses.${selected.status}`, { defaultValue: selected.status?.replace(/_/g,' ') || '' })}</strong></label>
            </div>

            {VALID_TRANSITIONS[selected.status]?.length > 0 ? (
              <>
                <div className="lx-form-group">
                  <label className="lx-label">{t('adminPurchaseOrders.modal.transitionTo')}</label>
                  <select className="lx-select" value={toStatus} onChange={e => setToStatus(e.target.value)}>
                    <option value="">{t('adminPurchaseOrders.modal.selectOption')}</option>
                    {VALID_TRANSITIONS[selected.status].map(s => (
                      <option key={s} value={s}>{t(`logistics.admin.purchaseOrders.statuses.${s}`, { defaultValue: s.replace(/_/g,' ') })}</option>
                    ))}
                  </select>
                </div>
                <div className="lx-form-group">
                  <label className="lx-label">{t('adminPurchaseOrders.modal.notesOptional')}</label>
                  <textarea className="lx-textarea" rows={2} value={notes}
                    onChange={e => setNotes(e.target.value)} />
                </div>
                <div style={{ display:'flex', gap:'.75rem' }}>
                  <button className="lx-btn-primary" onClick={doTransition} disabled={saving}>
                    {saving ? t('common.saving') : t('adminPurchaseOrders.modal.applyTransition')}
                  </button>
                  <button className="lx-btn-secondary" onClick={() => setSelected(null)}>{t('common.cancel')}</button>
                </div>
              </>
            ) : (
              <div style={{ display:'flex', gap:'.75rem' }}>
                <div style={{ color:'var(--color-text-faint)', fontSize:'.85rem', flex:1 }}>
{t('adminPurchaseOrders.modal.noTransitions', { status: selected.status })}
                </div>
                <button className="lx-btn-secondary" onClick={() => setSelected(null)}>{t('common.close')}</button>
              </div>
            )}
          </>
        )}
      </LogisticsModal>
      <OrderPreview
        key={previewId} id={previewId}
        open={previewId !== null}
        onClose={() => setPreviewId(null)}
      />
    </div>
  );
}
