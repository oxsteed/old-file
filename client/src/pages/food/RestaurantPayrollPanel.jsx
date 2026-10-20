// Local Food Directory — Payroll, tips, labor and team activity panel
// (staff review S-04 / S-15 / S-16). Mounted inside the Reports panel of
// FoodMerchantPage's Operations tab; shares the panel's date range.
//
// Server gates: labor + payroll export require payroll.view (fail
// closed — managers do not hold it by default), team activity requires
// audit.view, everything here is manager-only. Each section degrades
// to an explanatory note on 403 instead of failing the whole panel.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moneyMinor } from '../../lib/moneyExact';
import toast from 'react-hot-toast';
import EmptyState from '../../components/EmptyState';
import { Users } from 'lucide-react';
import {
  getLaborReport,
  downloadPayrollCsv,
  getExceptionsReport,
  getTeamActivity,
  getTipPoolSettings,
  updateTipPoolSettings,
  declareCashTip,
} from '../../api/restaurants';

function apiErr(err, fallback) {
  const m = err?.response?.data?.error?.message || err?.response?.data?.message;
  return typeof m === 'string' ? m : fallback;
}
function errCode(err) {
  return err?.response?.data?.error?.code || err?.response?.data?.code || null;
}

export function PayrollPanel({ t, restaurant, from, to }) {
  const { i18n } = useTranslation();
  const restaurantId = restaurant.id;
  const currency = restaurant.currency_code || 'USD';
  const money = (cents) => moneyMinor(Number(cents) || 0, currency, i18n.language);

  const [labor, setLabor] = useState(null);
  const [laborError, setLaborError] = useState(null); // 'payroll' | 'generic'
  const [exceptions, setExceptions] = useState(null);
  const [activity, setActivity] = useState(null);
  const [activityError, setActivityError] = useState(false);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [tipSettings, setTipSettings] = useState(null);
  const [rules, setRules] = useState([]);
  const [savingTips, setSavingTips] = useState(false);
  const [cashForm, setCashForm] = useState({ staffUserId: '', date: to, amount: '', note: '' });
  const [exporting, setExporting] = useState(false);

  const loadLabor = useCallback(() => {
    setLaborError(null);
    getLaborReport(restaurantId, { from, to })
      .then(setLabor)
      .catch((err) => {
        if (err?.response?.status === 403 && errCode(err) === 'payroll_permission_required') {
          setLaborError('payroll');
        } else if (err?.response?.status !== 403) {
          setLaborError('generic');
        }
      });
    getExceptionsReport(restaurantId, { from, to })
      .then(setExceptions)
      .catch(() => {});
  }, [restaurantId, from, to]);

  useEffect(() => { loadLabor(); }, [loadLabor]);

  const loadActivity = useCallback(() => {
    const params = { limit: 50 };
    if (actorFilter) params.actor_user_id = actorFilter;
    if (actionFilter) params.action_prefix = actionFilter;
    getTeamActivity(restaurantId, params)
      .then((data) => { setActivity(data); setActivityError(false); })
      .catch((err) => { if (err?.response?.status === 403) setActivityError(true); });
  }, [restaurantId, actorFilter, actionFilter]);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  useEffect(() => {
    getTipPoolSettings(restaurantId)
      .then((settings) => {
        setTipSettings(settings);
        setRules((settings?.tip_out_rules || []).map((r) => ({
          target_type: r.target_type,
          target_key: r.target_key || '',
          percent: String((Number(r.percent_bps) || 0) / 100),
        })));
      })
      .catch(() => {});
  }, [restaurantId]);

  const onExportPayroll = async () => {
    setExporting(true);
    try {
      const blob = await downloadPayrollCsv(restaurantId, { from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `payroll-${from}-to-${to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.payroll.exportError')));
    } finally {
      setExporting(false);
    }
  };

  const saveTipSettings = async () => {
    setSavingTips(true);
    try {
      const payload = {
        pooling_enabled: !!tipSettings?.pooling_enabled,
        tip_out_rules: rules.map((r) => ({
          target_type: r.target_type,
          target_key: r.target_type === 'role' ? r.target_key.trim() : null,
          percent_bps: Math.round(Number(r.percent) * 100),
        })),
      };
      const saved = await updateTipPoolSettings(restaurantId, payload);
      setTipSettings(saved);
      toast.success(t('restaurants.ops.reports.tipPool.saved'));
      loadLabor();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.tipPool.saveError')));
    } finally {
      setSavingTips(false);
    }
  };

  const submitCashTip = async (e) => {
    e.preventDefault();
    const amountCents = Math.round(Number(cashForm.amount) * 100);
    if (!cashForm.staffUserId || !cashForm.date || !Number.isFinite(amountCents) || amountCents <= 0) {
      toast.error(t('restaurants.ops.reports.tipPool.cashInvalid'));
      return;
    }
    try {
      await declareCashTip(restaurantId, {
        staffUserId: cashForm.staffUserId,
        date: cashForm.date,
        amountCents,
        note: cashForm.note || undefined,
      });
      toast.success(t('restaurants.ops.reports.tipPool.cashSaved'));
      setCashForm((f) => ({ ...f, amount: '', note: '' }));
      loadLabor();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.tipPool.cashError')));
    }
  };

  const employees = labor?.employees || [];
  const fmtTime = (iso) => {
    try {
      return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    } catch { return String(iso || ''); }
  };

  return (
    <div>
      {/* ── Labor & payroll ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.payroll.title')}</h3>
      {laborError === 'payroll' ? (
        <p className="fd-ops-notice">{t('restaurants.ops.reports.payroll.permissionNote')}</p>
      ) : laborError === 'generic' ? (
        <div className="fd-empty" role="alert"><p>{t('restaurants.ops.reports.payroll.loadError')}</p></div>
      ) : !labor ? (
        <div className="fd-empty">{t('food.common.loading')}</div>
      ) : (
        <>
          <div className="fd-ops-checklists-grid">
            <div className="fd-ops-checklist-card">
              <strong>{labor.labor_percent == null ? '—' : `${labor.labor_percent}%`}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.payroll.laborPercent')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{money(labor.labor_cost_cents)}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.payroll.laborCost')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{money(labor.revenue_cents)}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.payroll.netSales')}</p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{labor.total_hours}</strong>
              <p className="fd-card-meta">
                {t('restaurants.ops.reports.payroll.hoursWorked')} · {t('restaurants.ops.reports.payroll.scheduledHours', { hours: labor.scheduled_hours })}
              </p>
            </div>
            <div className="fd-ops-checklist-card">
              <strong>{labor.sales_per_labor_hour_cents == null ? '—' : money(labor.sales_per_labor_hour_cents)}</strong>
              <p className="fd-card-meta">{t('restaurants.ops.reports.payroll.salesPerLaborHour')}</p>
            </div>
          </div>
          {(labor.missing_wage_user_ids || []).length > 0 && (
            <p className="fd-ops-notice fd-ops-notice--warn">
              {t('restaurants.ops.reports.payroll.missingWage', { count: labor.missing_wage_user_ids.length })}
            </p>
          )}
          {employees.length === 0 ? (
            <EmptyState icon={Users} title={t('restaurants.ops.reports.payroll.noData')} />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('restaurants.ops.reports.payroll.employee')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.jobRole')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.hours')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.wages')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.netTips')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.totalPay')}</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.user_id}>
                      <td>{emp.name || emp.user_id}</td>
                      <td>{emp.job_role || emp.membership_role || ''}</td>
                      <td>{emp.hours}</td>
                      <td>{emp.wages_cents == null ? '—' : money(emp.wages_cents)}</td>
                      <td>{money(emp.net_tips_cents)}</td>
                      <td>{money(emp.total_pay_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" onClick={onExportPayroll} disabled={exporting} data-track="ui.aa258f5ea1.1">
            {t('restaurants.ops.reports.payroll.exportCsv')}
          </button>
        </>
      )}

      {/* ── Tip pool + declared cash tips ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.tipPool.title')}</h3>
      {tipSettings && (
        <div className="fd-card">
          <label className="fd-card-meta">
            <input
              type="checkbox"
              checked={!!tipSettings.pooling_enabled}
              onChange={(e) => setTipSettings((s) => ({ ...s, pooling_enabled: e.target.checked }))} data-track="ui.aa258f5ea1.2"
            />{' '}
            {t('restaurants.ops.reports.tipPool.enablePooling')}
          </label>
          {rules.map((rule, idx) => (
            <div key={idx} className="fd-ops-inventory-row">
              <select
                aria-label={t('restaurants.ops.reports.tipPool.ruleTarget')}
                value={rule.target_type}
                onChange={(e) => setRules((rs) => rs.map((r, i) => (i === idx ? { ...r, target_type: e.target.value } : r)))}
              >
                <option value="role">{t('restaurants.ops.reports.tipPool.targetRole')}</option>
                <option value="pool">{t('restaurants.ops.reports.tipPool.targetPool')}</option>
              </select>
              {rule.target_type === 'role' && (
                <input
                  aria-label={t('restaurants.ops.reports.tipPool.ruleRole')}
                  value={rule.target_key}
                  placeholder={t('restaurants.ops.reports.tipPool.ruleRolePlaceholder')}
                  onChange={(e) => setRules((rs) => rs.map((r, i) => (i === idx ? { ...r, target_key: e.target.value } : r)))}
                />
              )}
              <input
                aria-label={t('restaurants.ops.reports.tipPool.rulePercent')}
                type="number" min="0" max="100" step="0.25"
                value={rule.percent}
                onChange={(e) => setRules((rs) => rs.map((r, i) => (i === idx ? { ...r, percent: e.target.value } : r)))}
              />
              <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary"
                onClick={() => setRules((rs) => rs.filter((_, i) => i !== idx))} data-track="ui.aa258f5ea1.3">
                {t('restaurants.ops.reports.tipPool.removeRule')}
              </button>
            </div>
          ))}
          <div className="fd-ops-inventory-row">
            <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary"
              onClick={() => setRules((rs) => [...rs, { target_type: 'role', target_key: '', percent: '5' }])} data-track="ui.aa258f5ea1.4">
              {t('restaurants.ops.reports.tipPool.addRule')}
            </button>
            <button type="button" className="fd-btn fd-btn-sm" onClick={saveTipSettings} disabled={savingTips} data-track="ui.aa258f5ea1.5">
              {t('restaurants.ops.reports.tipPool.save')}
            </button>
          </div>
          <p className="fd-card-meta">{t('restaurants.ops.reports.tipPool.hint')}</p>
        </div>
      )}
      {labor && employees.length > 0 && (
        <form onSubmit={submitCashTip} className="fd-card" data-track="ui.aa258f5ea1.6">
          <p className="fd-card-meta">{t('restaurants.ops.reports.tipPool.cashTitle')}</p>
          <div className="fd-ops-inventory-row">
            <select
              aria-label={t('restaurants.ops.reports.payroll.employee')}
              value={cashForm.staffUserId}
              onChange={(e) => setCashForm((f) => ({ ...f, staffUserId: e.target.value }))}
            >
              <option value="">{t('restaurants.ops.reports.tipPool.cashSelectStaff')}</option>
              {employees.map((emp) => (
                <option key={emp.user_id} value={emp.user_id}>{emp.name || emp.user_id}</option>
              ))}
            </select>
            <input
              aria-label={t('restaurants.ops.reports.tipPool.cashDate')}
              type="date" value={cashForm.date}
              onChange={(e) => setCashForm((f) => ({ ...f, date: e.target.value }))}
            />
            <input
              aria-label={t('restaurants.ops.reports.tipPool.cashAmount')}
              type="number" min="0" step="0.01" value={cashForm.amount}
              placeholder={t('restaurants.ops.reports.tipPool.cashAmount')}
              onChange={(e) => setCashForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <button type="submit" className="fd-btn fd-btn-sm" data-track="ui.aa258f5ea1.7">{t('restaurants.ops.reports.tipPool.cashAdd')}</button>
          </div>
        </form>
      )}

      {/* ── Exceptions ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.exceptions.title')}</h3>
      {!exceptions ? (
        <div className="fd-empty">{t('food.common.loading')}</div>
      ) : (exceptions.employees || []).length === 0 ? (
        <EmptyState icon={Users} title={t('restaurants.ops.reports.exceptions.none')} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('restaurants.ops.reports.payroll.employee')}</th>
                <th scope="col">{t('restaurants.ops.reports.exceptions.voids')}</th>
                <th scope="col">{t('restaurants.ops.reports.exceptions.refunds')}</th>
                <th scope="col">{t('restaurants.ops.reports.exceptions.comps')}</th>
                <th scope="col">{t('restaurants.ops.reports.exceptions.discounts')}</th>
                <th scope="col">{t('restaurants.ops.reports.exceptions.noSales')}</th>
                <th scope="col">{t('restaurants.ops.reports.exceptions.payouts')}</th>
                <th scope="col">{t('restaurants.ops.reports.exceptions.missingPunches')}</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.employees.map((emp) => (
                <tr key={emp.user_id}>
                  <td>{emp.name || emp.user_id}</td>
                  <td>{emp.voids} · {money(emp.voided_cents)}</td>
                  <td>{emp.refunds} · {money(emp.refund_cents)}</td>
                  <td>{emp.comps} · {money(emp.comp_cents)}</td>
                  <td>{emp.discounted_orders} · {money(emp.discount_cents)}</td>
                  <td>{emp.no_sales}</td>
                  <td>{emp.payouts} · {money(emp.payout_cents)}</td>
                  <td>{emp.missing_punches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fd-card-meta">{t('restaurants.ops.reports.exceptions.missingPunchesHint')}</p>

      {/* ── Team activity ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.activity.title')}</h3>
      {activityError ? (
        <p className="fd-ops-notice">{t('restaurants.ops.reports.activity.permissionNote')}</p>
      ) : !activity ? (
        <div className="fd-empty">{t('food.common.loading')}</div>
      ) : (
        <>
          <div className="fd-ops-inventory-row">
            <select
              aria-label={t('restaurants.ops.reports.activity.filterPerson')}
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
            >
              <option value="">{t('restaurants.ops.reports.activity.allPeople')}</option>
              {(activity.actors || []).map((a) => (
                <option key={a.user_id} value={a.user_id}>{a.name || a.user_id}</option>
              ))}
            </select>
            <input
              aria-label={t('restaurants.ops.reports.activity.filterAction')}
              value={actionFilter}
              placeholder={t('restaurants.ops.reports.activity.filterActionPlaceholder')}
              onChange={(e) => setActionFilter(e.target.value)}
            />
          </div>
          {(activity.entries || []).length === 0 ? (
            <EmptyState icon={Users} title={t('restaurants.ops.reports.activity.none')} />
          ) : (
            <div className="fd-ops-inventory-list">
              {activity.entries.map((entry) => (
                <div key={entry.id} className="fd-ops-inventory-row">
                  <span>{entry.action}</span>
                  <span className="fd-card-meta">
                    {(activity.actors || []).find((a) => a.user_id === entry.actor_user_id)?.name || entry.actor_role || ''} · {fmtTime(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
