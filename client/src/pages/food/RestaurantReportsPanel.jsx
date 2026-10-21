// Local Food Directory — Reports panel (franchise reports).
// Mounted inside FoodMerchantPage's Operations tab. Talks to /api/restaurants.
//
// Reports are manager-only on the server (owner/manager roles); the backend
// returns 403 for staff, which we surface as a friendly empty state instead
// of an error toast.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moneyMinor } from '../../lib/moneyExact';
import toast from 'react-hot-toast';
import { Receipt, Activity } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import {
  getSalesReport,
  downloadSalesReportCsv,
  downloadSalesJournalCsv,
  getInventoryReport,
  getOperationsReport,
  getLoyaltyReport,
} from '../../api/restaurants';
import { PayrollPanel } from './RestaurantPayrollPanel';
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
  const { i18n } = useTranslation();
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
  // Loyalty analytics (Phase 2, Item 10): fixed 90-day window, fetched
  // independently so its loading/error/empty states don't block the rest.
  const [loyalty, setLoyalty] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loyaltyError, setLoyaltyError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoyaltyLoading(true);
    setLoyaltyError(false);
    getLoyaltyReport(restaurantId)
      .then((data) => { if (!cancelled) setLoyalty(data); })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status === 403) {
          setManagerBlocked(true); // same friendly state as the other reports
          return;
        }
        setLoyaltyError(true);
      })
      .finally(() => { if (!cancelled) setLoyaltyLoading(false); });
    return () => { cancelled = true; };
  }, [restaurantId]);

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

  const [exporting, setExporting] = useState(false);
  const [exportingJournal, setExportingJournal] = useState(false);
  const onExportCsv = async () => {
    setExporting(true);
    try {
      const blob = await downloadSalesReportCsv(restaurantId, { from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sales-report-${from}-to-${to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExporting(false);
    }
  };
  const onExportJournal = async () => {
    setExportingJournal(true);
    try {
      const blob = await downloadSalesJournalCsv(restaurantId, { from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sales-journal-${from}-to-${to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExportingJournal(false);
    }
  };

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
              onClick={() => applyPreset(days)} data-track="ui.e7f53817fe.1"
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
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={onExportCsv}
            disabled={exporting} data-track="ui.e7f53817fe.3"
          >
            {t('restaurants.ops.reports.downloadCsv')}
          </button>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={onExportJournal}
            disabled={exportingJournal}
            data-track="ui.e7f53817fe.4"
          >
            {t('restaurants.ops.reports.downloadJournalCsv')}
          </button>
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

  const currency = sales?.currency || 'USD';
  // F-07: the sales report is per currency; figures are never summed
  // across currencies. Fall back to the legacy top-level shape if an
  // older API response has no currencies array.
  const currencySections = Array.isArray(sales?.currencies) && sales.currencies.length > 0
    ? sales.currencies
    : (sales ? [{
        currency,
        totals: sales.totals || {},
        daily: Array.isArray(sales.daily) ? sales.daily : [],
        by_fulfillment: Array.isArray(sales.by_fulfillment) ? sales.by_fulfillment : [],
        by_source: Array.isArray(sales.by_source) ? sales.by_source : [],
        payment_methods: Array.isArray(sales.payment_methods) ? sales.payment_methods : [],
      }] : []);
  const hasSalesOrders = currencySections.some((s) => (s.totals?.orders || 0) > 0);
  const adjustments = Array.isArray(inventory?.by_type) ? inventory.by_type : [];
  const waste = Array.isArray(inventory?.top_waste) ? inventory.top_waste : [];
  const ops = operations || {};
  const checklist = ops.checklists || {};
  const audits = ops.audits || {};
  const training = ops.training || {};

  const dayLabel = (iso, dayCount) => {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return dayCount > 14
      ? d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
      : d.toLocaleDateString(undefined, { weekday: 'short' });
  };

  const KNOWN_PAYMENT_TYPES = ['cash', 'card', 'mobile', 'wallet_credit', 'oxsteed_credit'];

  const renderSalesSection = (section) => {
    const ccy = section.currency || 'USD';
    const totals = section.totals || {};
    const daily = Array.isArray(section.daily) ? section.daily : [];
    const maxRevenue = daily.reduce((m, d) => Math.max(m, Number(d.revenue_cents) || 0), 0);
    const fulfillment = Array.isArray(section.by_fulfillment) ? section.by_fulfillment : [];
    const sources = Array.isArray(section.by_source) ? section.by_source : [];
    const methods = Array.isArray(section.payment_methods) ? section.payment_methods : [];
    const breakdownRows = [
      ['gross', totals.gross_cents],
      ['discounts', totals.discount_cents],
      ['netSales', totals.net_sales_cents],
      ['tax', totals.tax_cents],
      ['tips', totals.tips_cents],
      ['serviceFees', totals.service_fee_cents],
      ['deliveryFees', totals.delivery_fee_cents],
      ['refunds', totals.refunds_cents],
      ['netCollected', totals.revenue_cents],
    ];
    return (
      <div key={ccy}>
        {currencySections.length > 1 && (
          <h3 className="fd-ops-subhead">{ccy}</h3>
        )}
        <div className="fd-ops-checklists-grid">
          <div className="fd-ops-checklist-card">
            <strong>{formatFoodMoney(totals.revenue_cents || 0, ccy)}</strong>
            <p className="fd-card-meta">{t('restaurants.ops.reports.revenue', 'Revenue')}</p>
          </div>
          <div className="fd-ops-checklist-card">
            <strong>{totals.orders || 0}</strong>
            <p className="fd-card-meta">{t('restaurants.ops.reports.orders', 'Orders')}</p>
          </div>
          <div className="fd-ops-checklist-card">
            <strong>{formatFoodMoney(totals.avg_ticket_cents || 0, ccy)}</strong>
            <p className="fd-card-meta">{t('restaurants.ops.reports.avgTicket', 'Avg ticket')}</p>
          </div>
          <div className="fd-ops-checklist-card">
            <strong>{totals.cancelled || 0}</strong>
            <p className="fd-card-meta">{t('restaurants.ops.reports.cancelled', 'Cancelled')}</p>
          </div>
        </div>

        <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.breakdown')}</h3>
        <div className="fd-ops-inventory-list">
          {breakdownRows.map(([key, cents]) => (
            <div key={key} className="fd-ops-inventory-row">
              <span>{t(`restaurants.ops.reports.${key}`)}</span>
              <span className="fd-card-meta">{formatFoodMoney(cents || 0, ccy)}</span>
            </div>
          ))}
        </div>

        {methods.length > 0 && (
          <>
            <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.paymentMethods')}</h3>
            <div className="fd-ops-inventory-list">
              {methods.map((m) => (
                <div key={m.payment_type} className="fd-ops-inventory-row">
                  <span>
                    {t(`restaurants.ops.reports.paymentType.${KNOWN_PAYMENT_TYPES.includes(m.payment_type) ? m.payment_type : 'other'}`)}
                  </span>
                  <span className="fd-card-meta">
                    {t('restaurants.ops.reports.paymentsCount', { count: m.payments || 0 })} · {formatFoodMoney(m.amount_cents || 0, ccy)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

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
                      title={`${d.day}: ${formatFoodMoney(rev, ccy)}`}
                      style={{ height: `${heightPct}%`, width: '100%', maxWidth: '2.25rem', borderRadius: '4px 4px 0 0', background: 'var(--color-primary, #f97316)' }}
                    />
                    <span className="fd-card-meta">{dayLabel(d.day, daily.length)}</span>
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
                    {t('restaurants.ops.reports.ordersCount', '{{count}} orders', { count: f.orders || 0 })} · {formatFoodMoney(f.revenue_cents || 0, ccy)}
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
                    {t('restaurants.ops.reports.ordersCount', '{{count}} orders', { count: s.orders || 0 })} · {formatFoodMoney(s.revenue_cents || 0, ccy)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      {toolbar(true)}

      {/* ── Sales ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.salesTitle', 'Sales')}</h3>
      {!hasSalesOrders ? (
        <EmptyState icon={Receipt} title={t('restaurants.ops.reports.noOrders', 'No orders in this period.')} />
      ) : (
        currencySections.map((section) => renderSalesSection(section))
      )}

      {/* ── Customer loyalty (Phase 2, Item 10) ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.loyalty.title')}</h3>
      <p className="fd-card-meta">{t('restaurants.ops.reports.loyalty.windowHint')}</p>
      {loyaltyLoading ? (
        <div className="fd-empty">{t('food.common.loading')}</div>
      ) : loyaltyError ? (
        <div className="fd-empty" role="alert">
          <p>{t('restaurants.ops.reports.loyalty.loadError')}</p>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={() => {
              setLoyaltyLoading(true);
              setLoyaltyError(false);
              getLoyaltyReport(restaurantId)
                .then(setLoyalty)
                .catch((err) => {
                  if (err?.response?.status === 403) { setManagerBlocked(true); return; }
                  setLoyaltyError(true);
                })
                .finally(() => setLoyaltyLoading(false));
            }} data-track="ui.e7f53817fe.2"
          >
            {t('food.common.retry')}
          </button>
        </div>
      ) : (loyalty?.total_identified_orders || 0) === 0 ? (
        <EmptyState icon={Activity} title={t('restaurants.ops.reports.loyalty.noData')} />
      ) : (
        <>
          <div className="fd-ops-checklists-grid">
            <div className="fd-ops-checklist-card">
              <strong>
                {loyalty.repeat_order_rate == null
                  ? '—'
                  : `${Math.round(loyalty.repeat_order_rate * 100)}%`}
              </strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.loyalty.repeatRate')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{loyalty.repeat_orders || 0}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.loyalty.repeatOrders')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{loyalty.repeat_customers || 0}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.loyalty.repeatCustomers')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{loyalty.total_identified_orders || 0}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.loyalty.identifiedOrders')}</p>
            </div>
          </div>

          {(loyalty.top_items || []).length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.loyalty.topItems')}</h3>
              <div className="fd-ops-inventory-list">
                {loyalty.top_items.map((item, idx) => (
                  <div key={item.menu_item_id != null ? `id-${item.menu_item_id}` : `name-${item.item_name}-${idx}`} className="fd-ops-inventory-row">
                    <span>{idx + 1}. {item.item_name}</span>
                    <span className="fd-card-meta">
                      {t('restaurants.ops.reports.loyalty.unitsSold', { units: item.units_sold || 0 })} · {moneyMinor(item.revenue_cents || 0, item.currency_code || currency, i18n.language)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {loyalty.retention_cohorts?.length > 0 && <section className="fd-card">
            <h3>{t('analyticsCompletion.retention')}</h3>
            <p>{t('analyticsCompletion.retentionNote')}</p>
            <div style={{ overflowX: 'auto' }}><table>
              <thead><tr>{['cohort', 'monthAge', 'customers', 'retained', 'retentionRate'].map(key =>
                <th key={key} scope="col">{t(`analyticsCompletion.${key}`)}</th>)}</tr></thead>
              <tbody>{loyalty.retention_cohorts.map(row => <tr key={`${row.cohort_month}:${row.month_index}`}>
                <td>{String(row.cohort_month).slice(0,7)}</td><td>{row.month_index}</td>
                <td>{row.cohort_customers}</td><td>{row.returning_customers}</td>
                <td>{new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }).format(row.retention_rate)}</td>
              </tr>)}</tbody>
            </table></div>
          </section>}
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

      {/* ── Payroll, tips, labor + team activity (S-04/S-15/S-16) ── */}
      <PayrollPanel t={t} restaurant={restaurant} from={from} to={to} />
    </div>
  );
}
