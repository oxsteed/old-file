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
import { Receipt, Activity, RefreshCw } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import {
  getSalesReport,
  downloadSalesReportCsv,
  downloadSalesJournalCsv,
  downloadSalesAccountingCsv,
  downloadSalesBiNdjson,
  downloadSalesLocationComparisonCsv,
  downloadSalesLocationComparisonXlsx,
  downloadSalesCloseCsv,
  getInventoryReport,
  getOperationsReport,
  getLoyaltyReport,
  listAccountingIntegrations,
  listAccountingExports,
  getPrimeCost,
  listScheduledReports,
  createScheduledReport,
  deleteScheduledReport,
  runScheduledReportNow,
  listScheduledReportDeliveries,
  listBreakAttestations,
  getRetentionPolicies,
  setRetentionPolicy,
  listErasureRequests,
  createErasureRequest,
  decideErasureRequest,
  runErasureRequest,
  downloadLaborRollupCsv,
} from '../../api/restaurants';
import { PayrollPanel } from './RestaurantPayrollPanel';
import { formatFoodMoney, listRestaurantBrands } from '../../api/food';

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
  const [accountingIntegrations, setAccountingIntegrations] = useState([]);
  const [accountingExports, setAccountingExports] = useState([]);
  const [accountingLoading, setAccountingLoading] = useState(true);
  const [accountingError, setAccountingError] = useState(false);

  const loadAccounting = useCallback(() => {
    let cancelled = false;
    setAccountingLoading(true);
    setAccountingError(false);
    Promise.all([listAccountingIntegrations(restaurantId), listAccountingExports(restaurantId)])
      .then(([integrations, exports]) => {
        if (cancelled) return;
        setAccountingIntegrations(integrations);
        setAccountingExports(exports);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status !== 403) setAccountingError(true);
      })
      .finally(() => { if (!cancelled) setAccountingLoading(false); });
    return () => { cancelled = true; };
  }, [restaurantId]);

  useEffect(() => loadAccounting(), [loadAccounting]);

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
  const [accountingProvider, setAccountingProvider] = useState('quickbooks');
  const [exportingAccounting, setExportingAccounting] = useState(false);
  const [exportingBi, setExportingBi] = useState(false);
  const [exportingLocationComparison, setExportingLocationComparison] = useState(false);
  const [exportingLocationComparisonXlsx, setExportingLocationComparisonXlsx] = useState(false);
  const [exportingClose, setExportingClose] = useState(false);
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
  const onExportAccounting = async () => {
    setExportingAccounting(true);
    try {
      const blob = await downloadSalesAccountingCsv(restaurantId, accountingProvider, { from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sales-${accountingProvider}-${from}-to-${to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExportingAccounting(false);
    }
  };
  const onExportBi = async () => {
    setExportingBi(true);
    try {
      const blob = await downloadSalesBiNdjson(restaurantId, { from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sales-bi-${from}-to-${to}.ndjson`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExportingBi(false);
    }
  };
  const onExportClose = async () => {
    setExportingClose(true);
    try {
      const blob = await downloadSalesCloseCsv(restaurantId, { date: to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sales-close-${to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExportingClose(false);
    }
  };
  const onExportLocationComparison = async () => {
    setExportingLocationComparison(true);
    try {
      const blob = await downloadSalesLocationComparisonCsv(restaurantId, { from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sales-location-comparison-${from}-to-${to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExportingLocationComparison(false);
    }
  };
  const onExportLocationComparisonXlsx = async () => {
    setExportingLocationComparisonXlsx(true);
    try {
      const blob = await downloadSalesLocationComparisonXlsx(restaurantId, { from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sales-location-comparison-${from}-to-${to}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExportingLocationComparisonXlsx(false);
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
          <label className="fd-field fd-field-inline" htmlFor="rpt-accounting-provider">
            <span>{t('restaurants.ops.reports.accountingProvider', 'Accounting format')}</span>
            <select id="rpt-accounting-provider" value={accountingProvider} onChange={(e) => setAccountingProvider(e.target.value)}>
              <option value="quickbooks">QuickBooks</option>
              <option value="xero">Xero</option>
            </select>
          </label>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={onExportAccounting}
            disabled={exportingAccounting}
            data-track="ui.e7f53817fe.11"
          >
            {t('restaurants.ops.reports.downloadAccountingCsv', 'Download accounting CSV')}
          </button>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={onExportBi}
            disabled={exportingBi}
            data-track="ui.e7f53817fe.12"
          >
            {t('restaurants.ops.reports.downloadBiExport', 'Download BI export')}
          </button>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={onExportClose}
            disabled={exportingClose}
            data-track="ui.e7f53817fe.5"
          >
            {t('restaurants.ops.reports.downloadCloseCsv', 'Download daily close')}
          </button>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={onExportLocationComparison}
            disabled={exportingLocationComparison}
            data-track="ui.e7f53817fe.6"
          >
            {t('restaurants.ops.reports.downloadLocationComparisonCsv', 'Compare stores CSV')}
          </button>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={onExportLocationComparisonXlsx}
            disabled={exportingLocationComparisonXlsx}
            data-track="ui.e7f53817fe.7"
          >
            {t('restaurants.ops.reports.downloadLocationComparisonXlsx', 'Compare stores XLSX')}
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

      <section className="fd-card" aria-labelledby="accounting-outbox-title">
        <div className="fd-ops-toolbar">
          <h3 id="accounting-outbox-title" className="fd-ops-subhead">
            {t('restaurants.ops.reports.accountingOutbox.title', 'Accounting integrations')}
          </h3>
          <button
            type="button"
            className="fd-btn fd-btn-sm fd-btn-secondary"
            onClick={loadAccounting}
            disabled={accountingLoading}
            aria-label={t('restaurants.ops.reports.accountingOutbox.refresh', 'Refresh accounting status')}
            data-track="ui.e7f53817fe.13"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('restaurants.ops.reports.accountingOutbox.refresh', 'Refresh')}
          </button>
        </div>
        {accountingLoading ? (
          <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>
        ) : accountingError ? (
          <div className="fd-empty" role="alert">
            {t('restaurants.ops.reports.accountingOutbox.loadError', 'Could not load accounting status.')}
          </div>
        ) : (
          <>
            <div className="fd-ops-inventory-list">
              {accountingIntegrations.length === 0 ? (
                <div className="fd-card-meta">
                  {t('restaurants.ops.reports.accountingOutbox.noIntegrations', 'No accounting provider is configured.')}
                </div>
              ) : accountingIntegrations.map((integration) => (
                <div key={integration.id} className="fd-ops-inventory-row">
                  <span>{integration.provider === 'quickbooks' ? 'QuickBooks' : 'Xero'}</span>
                  <span className="fd-card-meta">
                    {t(`restaurants.ops.reports.accountingOutbox.status.${integration.status}`, integration.status)}
                    {integration.credentialsConfigured ? ` · ${t('restaurants.ops.reports.accountingOutbox.credentialsReady', 'credentials ready')}` : ''}
                  </span>
                </div>
              ))}
            </div>
            <h4 className="fd-ops-subhead">{t('restaurants.ops.reports.accountingOutbox.exports', 'Recent journal exports')}</h4>
            {accountingExports.length === 0 ? (
              <div className="fd-card-meta">{t('restaurants.ops.reports.accountingOutbox.noExports', 'No journal exports have been queued.')}</div>
            ) : (
              <div className="fd-ops-inventory-list">
                {accountingExports.slice(0, 10).map((item) => (
                  <div key={item.id} className="fd-ops-inventory-row">
                    <span>{item.periodFrom} – {item.periodTo} · {item.currencyCode} · {item.lineCount} {t('restaurants.ops.reports.accountingOutbox.lines', 'lines')}</span>
                    <span className="fd-card-meta">{t(`restaurants.ops.reports.accountingOutbox.status.${item.status}`, item.status)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="fd-card-meta">{t('restaurants.ops.reports.accountingOutbox.providerNote', 'Exports are queued for a separately authenticated provider worker; no provider credentials are stored in the browser.')}</p>
          </>
        )}
      </section>

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

      {/* ── Phase 7: prime cost, scheduled reports, retention/erasure ── */}
      <ComplianceReportsSections t={t} restaurant={restaurant} from={from} to={to} currency={currency} />
    </div>
  );
}

// ── Phase 7 (gaps 15, 19, 20, 21): prime cost, scheduled reports,
// retention and erasure. Fetched independently so a 403 (reports
// policy) hides these sections without breaking the rest of the page.
// Scheduled deliveries are snapshots stamped with an as-of time, not
// locked closes: the daily close is re-computed from live orders.
const SCHEDULE_REPORT_TYPES = ['daily_close', 'labor', 'exceptions', 'hq_digest', 'franchise_digest'];
const SCHEDULE_FREQUENCIES = ['daily', 'weekly'];
const SCHEDULE_CHANNELS = ['in_app', 'email', 'both'];
const RETENTION_CLASSES = ['time_entries', 'pay_runs', 'schedule_versions', 'staff_documents', 'tip_records', 'audit_events'];

function ComplianceReportsSections({ t, restaurant, from, to, currency }) {
  const { i18n } = useTranslation();
  const restaurantId = restaurant.id;
  const [prime, setPrime] = useState(null);
  const [primeHidden, setPrimeHidden] = useState(false);
  const [schedules, setSchedules] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [attestations, setAttestations] = useState(null);
  const [attestationFilters, setAttestationFilters] = useState({ waivedOnly: false, disputedOnly: false });
  const [policies, setPolicies] = useState(null);
  const [erasureRequests, setErasureRequests] = useState([]);
  const [scheduleForm, setScheduleForm] = useState({ reportType: 'daily_close', frequency: 'daily', deliveryChannel: 'in_app', userIds: '', emails: '', brandId: '' });
  const [brands, setBrands] = useState([]);
  const [erasureForm, setErasureForm] = useState({ userId: '', reason: '' });
  const [policyDrafts, setPolicyDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [exportingRollup, setExportingRollup] = useState(false);

  const loadPrime = useCallback(() => {
    getPrimeCost(restaurantId, { from, to })
      .then(setPrime)
      .catch((err) => { if (err?.response?.status === 403) setPrimeHidden(true); });
  }, [restaurantId, from, to]);
  useEffect(() => { loadPrime(); }, [loadPrime]);

  const loadSchedules = useCallback(() => {
    Promise.all([
      listScheduledReports(restaurantId).catch((err) => { if (err?.response?.status === 403) return null; throw err; }),
      listScheduledReportDeliveries(restaurantId).catch(() => []),
      getRetentionPolicies(restaurantId).catch((err) => { if (err?.response?.status === 403) return null; throw err; }),
      listErasureRequests(restaurantId).catch(() => []),
      // Phase 8: HQ/franchise digests need a brand; a merchant with
      // no brands simply never sees the brand picker.
      listRestaurantBrands().catch(() => []),
    ])
      .then(([sc, dl, pol, er, br]) => {
        if (sc !== null) setSchedules(sc);
        setDeliveries(Array.isArray(dl) ? dl : []);
        if (pol !== null) setPolicies(pol);
        setErasureRequests(Array.isArray(er) ? er : []);
        setBrands(Array.isArray(br) ? br : []);
      })
      .catch(() => { /* sections stay hidden on load failure */ });
  }, [restaurantId]);
  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  // Domain 8 #31: break attestations for the report range, latest
  // version per time entry. A 403 hides the section like the other
  // compliance sections; filters reload the list.
  const loadAttestations = useCallback(() => {
    listBreakAttestations(restaurantId, {
      from,
      to,
      ...(attestationFilters.waivedOnly ? { waivedOnly: true } : {}),
      ...(attestationFilters.disputedOnly ? { disputedOnly: true } : {}),
    })
      .then(setAttestations)
      .catch((err) => { if (err?.response?.status === 403) setAttestations(null); });
  }, [restaurantId, from, to, attestationFilters]);
  useEffect(() => { loadAttestations(); }, [loadAttestations]);

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const onExportLaborRollup = async () => {
    setExportingRollup(true);
    try {
      downloadBlob(await downloadLaborRollupCsv(restaurantId, { from, to }), `labor-rollup-${from}-to-${to}.csv`);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.exportError')));
    } finally {
      setExportingRollup(false);
    }
  };

  const submitSchedule = async (e) => {
    e.preventDefault();
    const recipients = [
      ...scheduleForm.userIds.split(',').map((s) => s.trim()).filter(Boolean).map((user_id) => ({ user_id })),
      ...scheduleForm.emails.split(',').map((s) => s.trim()).filter(Boolean).map((email) => ({ email })),
    ];
    setBusy(true);
    try {
      await createScheduledReport(restaurantId, {
        reportType: scheduleForm.reportType,
        frequency: scheduleForm.frequency,
        deliveryChannel: scheduleForm.deliveryChannel,
        recipients,
        // Phase 8: HQ/franchise digests are brand-scoped; the server
        // rejects a digest without a brand that owns this restaurant.
        ...(scheduleForm.reportType === 'hq_digest' || scheduleForm.reportType === 'franchise_digest'
          ? { brandId: Number(scheduleForm.brandId) }
          : {}),
      });
      toast.success(t('restaurants.ops.reports.scheduled.created', 'Scheduled report saved.'));
      setScheduleForm({ reportType: 'daily_close', frequency: 'daily', deliveryChannel: 'in_app', userIds: '', emails: '', brandId: '' });
      loadSchedules();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.scheduled.createError', 'Could not save the scheduled report.')));
    } finally {
      setBusy(false);
    }
  };

  const submitErasure = async (e) => {
    e.preventDefault();
    if (!erasureForm.userId.trim()) {
      toast.error(t('restaurants.ops.reports.retention.erasureUserRequired', 'Enter the staff user ID to erase.'));
      return;
    }
    setBusy(true);
    try {
      await createErasureRequest(restaurantId, { userId: Number(erasureForm.userId), reason: erasureForm.reason.trim() || undefined });
      toast.success(t('restaurants.ops.reports.retention.erasureCreated', 'Erasure request created.'));
      setErasureForm({ userId: '', reason: '' });
      loadSchedules();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.retention.erasureError', 'Could not create the erasure request.')));
    } finally {
      setBusy(false);
    }
  };

  const savePolicy = async (recordClass) => {
    const years = Number(policyDrafts[recordClass]);
    if (!Number.isInteger(years) || years < 1 || years > 30) {
      toast.error(t('restaurants.ops.reports.retention.yearsInvalid', 'Retention must be 1 to 30 years.'));
      return;
    }
    setBusy(true);
    try {
      await setRetentionPolicy(restaurantId, { recordClass, retentionYears: years });
      toast.success(t('restaurants.ops.reports.retention.saved', 'Retention policy saved.'));
      loadSchedules();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.retention.saveError', 'Could not save the retention policy.')));
    } finally {
      setBusy(false);
    }
  };

  const policyFor = (recordClass) => {
    if (!policies) return null;
    if (Array.isArray(policies)) return policies.find((p) => (p.record_class || p.recordClass) === recordClass) || null;
    return policies[recordClass] || null;
  };
  const policyYears = (recordClass) => {
    const p = policyFor(recordClass);
    if (policyDrafts[recordClass] != null) return policyDrafts[recordClass];
    return p ? (p.retention_years ?? p.retentionYears ?? 7) : 7;
  };

  const actOnErasure = async (requestId, action, payload) => {
    setBusy(true);
    try {
      if (action === 'decide') await decideErasureRequest(restaurantId, requestId, payload);
      else await runErasureRequest(restaurantId, requestId);
      toast.success(t('restaurants.ops.reports.retention.erasureUpdated', 'Erasure request updated.'));
      loadSchedules();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.retention.erasureError', 'Could not update the erasure request.')));
    } finally {
      setBusy(false);
    }
  };

  const primeCurrency = prime?.currency || currency;
  const servers = Array.isArray(prime?.servers?.servers) ? prime.servers.servers : [];
  const unattributed = prime?.servers?.unattributed || null;
  const daypartRows = Array.isArray(prime?.dayparts?.dayparts) ? prime.dayparts.dayparts : [];

  return (
    <>
      {/* ── Prime cost ── */}
      {!primeHidden && prime && (
        <>
          <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.prime.title', 'Prime cost')}</h3>
          <div className="fd-ops-checklists-grid">
            <div className="fd-ops-checklist-card">
              <strong>{moneyMinor(prime.prime_cost_cents || 0, primeCurrency, i18n.language)}</strong>
              <p className="fd-card-meta">
                {t('restaurants.ops.reports.prime.primeCost', 'Prime cost')}
                {prime.prime_cost_pct != null ? ` · ${prime.prime_cost_pct}% ${t('restaurants.ops.reports.prime.ofRevenue', 'of revenue')}` : ''}
              </p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{moneyMinor(prime.labor?.labor_cost_cents || 0, primeCurrency, i18n.language)}</strong>
              <p className="fd-card-meta">
                {t('restaurants.ops.reports.prime.labor', 'Labor')}
                {prime.labor?.labor_percent != null ? ` · ${prime.labor.labor_percent}%` : ''}
                {` · ${Number(prime.labor?.total_hours || 0).toFixed(1)} ${t('restaurants.ops.reports.prime.hours', 'hours')}`}
              </p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{moneyMinor(prime.food?.actual_cost_cents || 0, primeCurrency, i18n.language)}</strong>
              <p className="fd-card-meta">
                {t('restaurants.ops.reports.prime.foodActual', 'Food cost (actual)')}
                {prime.food?.actual_cost_pct != null ? ` · ${prime.food.actual_cost_pct}%` : ''}
                {prime.food?.theoretical_cost_pct != null ? ` · ${t('restaurants.ops.reports.prime.theoretical', { pct: prime.food.theoretical_cost_pct })}` : ''}
              </p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{moneyMinor(prime.revenue_cents || 0, primeCurrency, i18n.language)}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.prime.revenue', 'Revenue')}</p>
            </div>
          </div>
          <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" onClick={onExportLaborRollup} disabled={exportingRollup} data-track="restaurant_labor_rollup_csv">
            {t('restaurants.ops.reports.prime.downloadLaborRollup', 'Download labor rollup CSV')}
          </button>
          {servers.length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.prime.byServer', 'Sales by server')}</h3>
              <div className="fd-ops-inventory-list">
                {servers.map((s) => (
                  <div key={s.user_id} className="fd-ops-inventory-row">
                    <span>{t('restaurants.ops.reports.prime.server', { id: s.user_id })}</span>
                    <span className="fd-card-meta">
                      {t('restaurants.ops.reports.prime.orders', { count: s.orders || 0 })} · {moneyMinor(s.net_sales_cents || 0, primeCurrency, i18n.language)} · {t('restaurants.ops.reports.prime.tips', { amount: moneyMinor(s.tips_cents || 0, primeCurrency, i18n.language) })}
                    </span>
                  </div>
                ))}
                {unattributed && (
                  <div className="fd-ops-inventory-row">
                    <span>{t('restaurants.ops.reports.prime.unattributed', 'No server recorded')}</span>
                    <span className="fd-card-meta">
                      {t('restaurants.ops.reports.prime.orders', { count: unattributed.orders || 0 })} · {moneyMinor(unattributed.net_sales_cents || 0, primeCurrency, i18n.language)}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
          {daypartRows.length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.prime.byDaypart', 'Sales by daypart')}</h3>
              <div className="fd-ops-inventory-list">
                {daypartRows.map((d) => (
                  <div key={d.key} className="fd-ops-inventory-row">
                    <span>{d.label || d.key}</span>
                    <span className="fd-card-meta">
                      {t('restaurants.ops.reports.prime.orders', { count: d.orders || 0 })} · {moneyMinor(d.net_sales_cents || 0, primeCurrency, i18n.language)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Scheduled reports ── */}
      {schedules !== null && (
        <>
          <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.scheduled.title', 'Scheduled reports')}</h3>
          <p className="fd-card-meta">{t('restaurants.ops.reports.scheduled.snapshotNote', 'Scheduled reports are snapshots stamped with the time they were built, not locked closes. The daily close is re-computed from live orders.')}</p>
          <form onSubmit={submitSchedule} className="fd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }} data-track="ui.e7f53817fe.14">
            <div className="fd-field">
              <label htmlFor="sr-type">{t('restaurants.ops.reports.scheduled.reportType', 'Report')}</label>
              <select id="sr-type" value={scheduleForm.reportType} onChange={(e) => setScheduleForm((f) => ({ ...f, reportType: e.target.value }))}>
                {SCHEDULE_REPORT_TYPES.map((rt) => (
                  <option key={rt} value={rt}>{t(`restaurants.ops.reports.scheduled.type.${rt}`, rt)}</option>
                ))}
              </select>
            </div>
            <div className="fd-field">
              <label htmlFor="sr-freq">{t('restaurants.ops.reports.scheduled.frequency', 'Frequency')}</label>
              <select id="sr-freq" value={scheduleForm.frequency} onChange={(e) => setScheduleForm((f) => ({ ...f, frequency: e.target.value }))}>
                {SCHEDULE_FREQUENCIES.map((fr) => (
                  <option key={fr} value={fr}>{t(`restaurants.ops.reports.scheduled.frequency.${fr}`, fr)}</option>
                ))}
              </select>
            </div>
            <div className="fd-field">
              <label htmlFor="sr-channel">{t('restaurants.ops.reports.scheduled.channel', 'Delivery')}</label>
              <select id="sr-channel" value={scheduleForm.deliveryChannel} onChange={(e) => setScheduleForm((f) => ({ ...f, deliveryChannel: e.target.value }))}>
                {SCHEDULE_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>{t(`restaurants.ops.reports.scheduled.channel.${ch}`, ch)}</option>
                ))}
              </select>
            </div>
            {(scheduleForm.reportType === 'hq_digest' || scheduleForm.reportType === 'franchise_digest') && (
              <div className="fd-field">
                <label htmlFor="sr-brand">{t('restaurants.ops.reports.scheduled.brand', 'Brand')}</label>
                <select id="sr-brand" value={scheduleForm.brandId} onChange={(e) => setScheduleForm((f) => ({ ...f, brandId: e.target.value }))} required>
                  <option value="">{t('restaurants.ops.reports.scheduled.brandPlaceholder', 'Choose a brand')}</option>
                  {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
              </div>
            )}
            <div className="fd-field">
              <label htmlFor="sr-users">{t('restaurants.ops.reports.scheduled.userIds', 'Recipient user IDs (comma-separated)')}</label>
              <input id="sr-users" value={scheduleForm.userIds} onChange={(e) => setScheduleForm((f) => ({ ...f, userIds: e.target.value }))} placeholder="12, 34" />
            </div>
            <div className="fd-field">
              <label htmlFor="sr-emails">{t('restaurants.ops.reports.scheduled.emails', 'Recipient emails (comma-separated)')}</label>
              <input id="sr-emails" value={scheduleForm.emails} onChange={(e) => setScheduleForm((f) => ({ ...f, emails: e.target.value }))} placeholder="owner@example.com" />
            </div>
            <button type="submit" className="fd-btn fd-btn-sm" disabled={busy} data-track="restaurant_scheduled_report_create">
              {t('restaurants.ops.reports.scheduled.create', 'Schedule report')}
            </button>
          </form>
          {schedules.length === 0 ? (
            <p className="fd-card-meta">{t('restaurants.ops.reports.scheduled.none', 'No scheduled reports yet.')}</p>
          ) : (
            <ul className="fd-list">
              {schedules.map((s) => (
                <li key={s.id}>
                  {t(`restaurants.ops.reports.scheduled.type.${s.report_type}`, s.report_type)}
                  {' · '}{t(`restaurants.ops.reports.scheduled.frequency.${s.frequency}`, s.frequency)}
                  {' · '}{t(`restaurants.ops.reports.scheduled.channel.${s.delivery_channel}`, s.delivery_channel)}
                  {s.last_business_date ? ` · ${t('restaurants.ops.reports.scheduled.lastRun', { date: String(s.last_business_date).slice(0, 10) })}` : ''}
                  {' '}
                  <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await runScheduledReportNow(restaurantId, s.id); toast.success(t('restaurants.ops.reports.scheduled.ran', 'Report sent.')); loadSchedules(); } catch (err) { toast.error(apiErr(err, t('restaurants.ops.reports.scheduled.runError', 'Could not send the report.'))); } finally { setBusy(false); } }} data-track="restaurant_scheduled_report_run_now">
                    {t('restaurants.ops.reports.scheduled.runNow', 'Send now')}
                  </button>
                  {' '}
                  <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await deleteScheduledReport(restaurantId, s.id); loadSchedules(); } catch (err) { toast.error(apiErr(err, t('restaurants.ops.reports.scheduled.deleteError', 'Could not delete the schedule.'))); } finally { setBusy(false); } }} data-track="restaurant_scheduled_report_delete">
                    {t('food.common.delete', 'Delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {deliveries.length > 0 && (
            <>
              <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.scheduled.deliveries', 'Recent deliveries')}</h3>
              <ul className="fd-list">
                {deliveries.slice(0, 10).map((d) => (
                  <li key={d.id}>
                    {String(d.business_date).slice(0, 10)} · {t(`restaurants.ops.reports.scheduled.type.${d.report_type}`, d.report_type)} · {d.status}
                    {d.as_of ? ` · ${t('restaurants.ops.reports.scheduled.asOf', { time: new Date(d.as_of).toLocaleString(i18n.language) })}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* ── Domain 8 #31: break attestations ── */}
      {attestations !== null && (
        <>
          <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.breakAttestations.title')}</h3>
          <p className="fd-card-meta">{t('restaurants.ops.reports.breakAttestations.hint')}</p>
          <div className="fd-row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <label className="fd-checkbox-row">
              <input
                type="checkbox"
                checked={attestationFilters.waivedOnly}
                onChange={(e) => setAttestationFilters((f) => ({ ...f, waivedOnly: e.target.checked }))}
              />
              <span>{t('restaurants.ops.reports.breakAttestations.waivedOnly')}</span>
            </label>
            <label className="fd-checkbox-row">
              <input
                type="checkbox"
                checked={attestationFilters.disputedOnly}
                onChange={(e) => setAttestationFilters((f) => ({ ...f, disputedOnly: e.target.checked }))}
              />
              <span>{t('restaurants.ops.reports.breakAttestations.disputedOnly')}</span>
            </label>
          </div>
          {attestations.length === 0 ? (
            <p className="fd-card-meta">{t('restaurants.ops.reports.breakAttestations.empty')}</p>
          ) : (
            <div className="fd-ops-inventory-list">
              {attestations.map((attestation) => (
                <div key={attestation.id} className="fd-ops-inventory-row">
                  <span>{attestation.user_name || attestation.user_id} · {String(attestation.entry_date).slice(0, 10)}</span>
                  <span className="fd-card-meta">
                    {attestation.waived
                      ? t('restaurants.ops.reports.breakAttestations.waived')
                      : attestation.meal_break_taken
                        ? t('restaurants.ops.reports.breakAttestations.taken')
                        : t('restaurants.ops.reports.breakAttestations.missed')}
                    {attestation.disputed ? ` · ${t('restaurants.ops.reports.breakAttestations.disputed')}` : ''}
                    {attestation.waiver_reason ? ` · ${attestation.waiver_reason}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Retention + erasure ── */}
      {policies !== null && (
        <>
          <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.retention.title', 'Retention and erasure')}</h3>
          <p className="fd-card-meta">{t('restaurants.ops.reports.retention.note', 'Records are kept for the years below, then former staff are anonymized. History rows are never deleted.')}</p>
          <div className="fd-ops-inventory-list">
            {RETENTION_CLASSES.map((rc) => (
              <div key={rc} className="fd-ops-inventory-row">
                <span>{t(`restaurants.ops.reports.retention.class.${rc}`, rc)}</span>
                <span className="fd-card-meta">
                  <label>
                    {t('restaurants.ops.reports.retention.years', 'Years')}{' '}
                    <input type="number" min="1" max="30" step="1" style={{ width: 64 }} value={policyYears(rc)} onChange={(e) => setPolicyDrafts((d) => ({ ...d, [rc]: e.target.value }))} aria-label={t(`restaurants.ops.reports.retention.class.${rc}`, rc)} />
                  </label>
                  {' '}
                  <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy} onClick={() => savePolicy(rc)} data-track="restaurant_retention_policy_save">
                    {t('restaurants.ops.reports.retention.save', 'Save')}
                  </button>
                  {policyFor(rc)?.source ? ` · ${policyFor(rc).source}` : ''}
                </span>
              </div>
            ))}
          </div>
          <form onSubmit={submitErasure} className="fd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }} data-track="ui.e7f53817fe.15">
            <div className="fd-field">
              <label htmlFor="er-user">{t('restaurants.ops.reports.retention.erasureUser', 'Staff user ID')}</label>
              <input id="er-user" inputMode="numeric" value={erasureForm.userId} onChange={(e) => setErasureForm((f) => ({ ...f, userId: e.target.value }))} />
            </div>
            <div className="fd-field">
              <label htmlFor="er-reason">{t('restaurants.ops.reports.retention.erasureReason', 'Reason (optional)')}</label>
              <input id="er-reason" value={erasureForm.reason} onChange={(e) => setErasureForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
            <button type="submit" className="fd-btn fd-btn-sm" disabled={busy} data-track="restaurant_erasure_request_create">
              {t('restaurants.ops.reports.retention.requestErasure', 'Request erasure')}
            </button>
          </form>
          {erasureRequests.length > 0 && (
            <ul className="fd-list">
              {erasureRequests.map((r) => (
                <li key={r.id}>
                  {t('restaurants.ops.reports.retention.requestFor', { id: r.user_id })} · {r.status}
                  {r.status === 'requested' && (
                    <>
                      {' '}
                      <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy} onClick={() => actOnErasure(r.id, 'decide', { decision: 'approved' })} data-track="restaurant_erasure_request_approve">
                        {t('restaurants.ops.reports.retention.approve', 'Approve')}
                      </button>
                      {' '}
                      <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy} onClick={() => actOnErasure(r.id, 'decide', { decision: 'rejected' })} data-track="restaurant_erasure_request_reject">
                        {t('restaurants.ops.reports.retention.reject', 'Reject')}
                      </button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <>
                      {' '}
                      <button type="button" className="fd-btn fd-btn-sm" disabled={busy} onClick={() => actOnErasure(r.id, 'run')} data-track="restaurant_erasure_request_run">
                        {t('restaurants.ops.reports.retention.run', 'Run erasure')}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
