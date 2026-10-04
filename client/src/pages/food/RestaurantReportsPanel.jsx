// Local Food Directory — Reports panel (franchise reports).
// Mounted inside FoodMerchantPage's Operations tab. Talks to /api/restaurants.
//
// Reports are manager-only on the server (owner/manager roles); the backend
// returns 403 for staff, which we surface as a friendly empty state instead
// of an error toast.

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Receipt, Activity } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import {
  getSalesReport,
  getInventoryReport,
  getOperationsReport,
} from '../../api/restaurants';
import { formatFoodMoney } from '../../api/food';

function apiErr(err, fallback) {
  const m = err?.response?.data?.error?.message || err?.response?.data?.message;
  return typeof m === 'string' ? m : fallback;
}

function fmtQty(q) {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pct(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return 0;
  return Math.round((p / w) * 100);
}

const PRESETS = [7, 30, 90];
const ADJUSTMENT_TYPES = ['receive', 'waste', 'usage', 'count', 'correction'];

export function ReportsPanel({ t, restaurant, bare, onStats }) {
  const restaurantId = restaurant.id;
  const [preset, setPreset] = useState(30);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toISODate(d);
  });
  const [to, setTo] = useState(() => toISODate(new Date()));
  const [sales, setSales] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [operations, setOperations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [managerBlocked, setManagerBlocked] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setManagerBlocked(false);
    Promise.all([
      getSalesReport(restaurantId, { from, to }),
      getInventoryReport(restaurantId, { from, to }),
      getOperationsReport(restaurantId, { from, to }),
    ])
      .then(([s, inv, ops]) => {
        setSales(s);
        setInventory(inv);
        setOperations(ops);
        onStats?.({ reports: true });
      })
      .catch((err) => {
        if (err?.response?.status === 403) {
          setManagerBlocked(true);
          return;
        }
        toast.error(apiErr(err, t('restaurants.ops.reports.loadError', 'Could not load reports')));
      })
      .finally(() => setLoading(false));
  }, [restaurantId, from, to, t, onStats]);
  useEffect(() => { load(); }, [load]);

  const applyPreset = (days) => {
    setPreset(days);
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setTo(toISODate(end));
    setFrom(toISODate(start));
  };
  const onFromChange = (value) => { setPreset(null); setFrom(value); };
  const onToChange = (value) => { setPreset(null); setTo(value); };

  const toolbar = (withControls) => (
    <div className={`fd-ops-toolbar${bare ? ' fd-ops-toolbar--end' : ''}`}>
      {!bare && <h3 className="fd-ops-panel-title">{t('restaurants.ops.reports.title', 'Reports')}</h3>}
      {withControls && (
        <div className="fd-row" role="group" aria-label={t('restaurants.ops.reports.rangeLabel', 'Date range')}>
          {PRESETS.map((days) => (
            <button
              key={days}
              type="button"
              className={`fd-btn fd-btn-sm${preset === days ? '' : ' fd-btn-secondary'}`}
              aria-pressed={preset === days}
              onClick={() => applyPreset(days)}
            >
              {t(`restaurants.ops.reports.range${days}`, `${days} days`)}
            </button>
          ))}
          <div className="fd-field">
            <label htmlFor="rpt-from">{t('restaurants.ops.reports.fromLabel', 'From')}</label>
            <input id="rpt-from" type="date" value={from} max={to} onChange={(e) => onFromChange(e.target.value)} />
          </div>
          <div className="fd-field">
            <label htmlFor="rpt-to">{t('restaurants.ops.reports.toLabel', 'To')}</label>
            <input id="rpt-to" type="date" value={to} min={from} onChange={(e) => onToChange(e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div>
        {toolbar(false)}
        <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>
      </div>
    );
  }

  if (managerBlocked) {
    return (
      <div>
        {toolbar(false)}
        <div className="fd-empty">{t('restaurants.ops.reports.managersOnly', 'Reports are available to managers.')}</div>
      </div>
    );
  }

  const totals = sales?.totals || {};
  const currency = sales?.currency || 'USD';
  const daily = Array.isArray(sales?.daily) ? sales.daily : [];
  const maxRevenue = daily.reduce((m, d) => Math.max(m, Number(d.revenue_cents) || 0), 0);
  const fulfillment = Array.isArray(sales?.by_fulfillment) ? sales.by_fulfillment : [];
  const sources = Array.isArray(sales?.by_source) ? sales.by_source : [];
  const adjustments = Array.isArray(inventory?.by_type) ? inventory.by_type : [];
  const waste = Array.isArray(inventory?.top_waste) ? inventory.top_waste : [];
  const ops = operations || {};
  const checklist = ops.checklists || {};
  const audits = ops.audits || {};
  const training = ops.training || {};

  const dayLabel = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return daily.length > 14
      ? d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
      : d.toLocaleDateString(undefined, { weekday: 'short' });
  };

  return (
    <div>
      {toolbar(true)}

      {/* ── Sales ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.salesTitle', 'Sales')}</h3>
      {(totals.orders || 0) === 0 ? (
        <EmptyState icon={Receipt} title={t('restaurants.ops.reports.noOrders', 'No orders in this period.')} />
      ) : (
        <>
          <div className="fd-ops-checklists-grid">
            <div className="fd-ops-checklist-card">
              <strong>{formatFoodMoney(totals.revenue_cents || 0, currency)}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.revenue', 'Revenue')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{totals.orders || 0}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.orders', 'Orders')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{formatFoodMoney(totals.avg_ticket_cents || 0, currency)}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.avgTicket', 'Avg ticket')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{totals.cancelled || 0}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.cancelled', 'Cancelled')}</p>
            </div>
          </div>

          {daily.length > 0 && maxRevenue > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.dailyRevenue', 'Daily revenue')}</h3>
              <div
                role="img"
                aria-label={t('restaurants.ops.reports.dailyRevenue', 'Daily revenue')}
                style={{ display: 'flex', alignItems: 'flex-end', gap: '0.25rem', height: '8rem', overflowX: 'auto', padding: '0.5rem 0' }}
              >
                {daily.map((d) => {
                  const rev = Number(d.revenue_cents) || 0;
                  const heightPct = maxRevenue > 0 ? Math.max(2, Math.round((rev / maxRevenue) * 100)) : 0;
                  return (
                    <div
                      key={d.day}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', flex: '1 0 auto', minWidth: '1.5rem' }}
                    >
                      <div
                        title={`${d.day}: ${formatFoodMoney(rev, currency)}`}
                        style={{ height: `${heightPct}%`, width: '100%', maxWidth: '2.25rem', borderRadius: '4px 4px 0 0', background: 'var(--color-primary, #f97316)' }}
                      />
                      <span className="fd-card-meta">{dayLabel(d.day)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {fulfillment.length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.byFulfillment', 'By fulfillment')}</h3>
              <div className="fd-ops-inventory-list">
                {fulfillment.map((f) => (
                  <div key={f.fulfillment_type} className="fd-ops-inventory-row">
                    <span>{t(`restaurants.ops.reports.fulfillment.${f.fulfillment_type}`, f.fulfillment_type)}</span>
                    <span className="fd-card-meta">
                      {t('restaurants.ops.reports.ordersCount', '{{count}} orders', { count: f.orders || 0 })} · {formatFoodMoney(f.revenue_cents || 0, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {sources.length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.bySource', 'By order source')}</h3>
              <div className="fd-ops-inventory-list">
                {sources.map((s) => (
                  <div key={s.order_source} className="fd-ops-inventory-row">
                    <span>{t(`restaurants.ops.reports.source.${s.order_source}`, s.order_source)}</span>
                    <span className="fd-card-meta">
                      {t('restaurants.ops.reports.ordersCount', '{{count}} orders', { count: s.orders || 0 })} · {formatFoodMoney(s.revenue_cents || 0, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Inventory ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.inventoryTitle', 'Inventory')}</h3>
      {(inventory?.out_of_stock_count || 0) > 0 && (
        <p className="fd-ops-notice fd-ops-notice--warn">
          {t('restaurants.ops.reports.outOfStockAlert', '{{count}} item(s) are out of stock.', { count: inventory.out_of_stock_count })}
        </p>
      )}
      <div className="fd-ops-checklists-grid">
        <div className="fd-ops-checklist-card">
          <strong>{inventory?.low_stock_count || 0}</strong>
          <p className="fd-card-meta">{t('restaurants.ops.reports.lowStock', 'Low stock')}</p>
        </div>
        <div className="fd-ops-checklist-card">
          <strong>{inventory?.out_of_stock_count || 0}</strong>
          <p className="fd-card-meta">{t('restaurants.ops.reports.outOfStock', 'Out of stock')}</p>
        </div>
      </div>
      {adjustments.length === 0 && waste.length === 0 ? (
        <EmptyState icon={Activity} title={t('restaurants.ops.reports.noActivity', 'No inventory activity in this period.')} />
      ) : (
        <>
          {adjustments.length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.adjustments', 'Adjustments')}</h3>
              <div className="fd-ops-inventory-list">
                {ADJUSTMENT_TYPES.filter((ty) => adjustments.some((a) => a.adjustment_type === ty))
                  .concat(adjustments.filter((a) => !ADJUSTMENT_TYPES.includes(a.adjustment_type)).map((a) => a.adjustment_type))
                  .map((ty) => {
                    const row = adjustments.find((a) => a.adjustment_type === ty) || {};
                    return (
                      <div key={ty} className="fd-ops-inventory-row">
                        <span>{t(`restaurants.ops.inventory.adjType.${ty}`, ty)}</span>
                        <span className="fd-card-meta">
                          {t('restaurants.ops.reports.eventsCount', '{{count}} events', { count: row.events || 0 })} · {fmtQty(row.total_qty || 0)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
          {waste.length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.topWaste', 'Top waste')}</h3>
              <div className="fd-ops-inventory-list">
                {waste.map((w, i) => (
                  <div key={`${w.item_name}-${i}`} className="fd-ops-inventory-row">
                    <span>{i + 1}. {w.item_name}</span>
                    <span className="fd-card-meta">
                      {t('restaurants.ops.reports.wastedQty', '{{qty}} wasted', { qty: fmtQty(w.wasted_qty || 0) })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Operations ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.operationsTitle', 'Operations')}</h3>
      <div className="fd-ops-checklists-grid">
        <div className="fd-ops-checklist-card">
          <strong>{pct(checklist.completed, checklist.runs)}%</strong>
          <p className="fd-card-meta">
            {t('restaurants.ops.reports.checklistCompletion', 'Checklist completion')} ·{' '}
            {t('restaurants.ops.reports.runsCompleted', '{{completed}} of {{runs}} runs', { completed: checklist.completed || 0, runs: checklist.runs || 0 })}
          </p>
        </div>
        <div className="fd-ops-checklist-card">
          <strong>{pct(audits.avg_score_pct, 100)}%</strong>
          <p className="fd-card-meta">
            {t('restaurants.ops.reports.auditScore', 'Audit score')} ·{' '}
            {t('restaurants.ops.reports.openActions', '{{count}} open corrective actions', { count: audits.open_corrective_actions || 0 })}
          </p>
        </div>
        <div className="fd-ops-checklist-card">
          <strong>{pct(training.completed, training.assigned)}%</strong>
          <p className="fd-card-meta">
            {t('restaurants.ops.reports.trainingCompleted', 'Training completed')} ·{' '}
            {t('restaurants.ops.reports.passedCount', '{{count}} passed', { count: training.passed || 0 })}
          </p>
        </div>
      </div>
    </div>
  );
}
