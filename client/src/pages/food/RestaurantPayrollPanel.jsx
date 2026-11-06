// Local Food Directory — Payroll, tips, labor and team activity panel
// (staff review S-04 / S-15 / S-16). Mounted inside the Reports panel of
// FoodMerchantPage's Operations tab; shares the panel's date range.
//
// Server gates: labor + payroll export require payroll.view (fail
// closed — managers do not hold it by default), team activity requires
// audit.view, everything here is manager-only. Each section degrades
// to an explanatory note on 403 instead of failing the whole panel.

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperationStore, OperationStorePicker, permits, requestIdentity } from './restaurantOperationsContext';
import { parseCreditMajorAmount, getCreditMinorUnits } from '../../lib/creditCurrency';
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
  listPayRuns,
  createPayRun,
  getPayRun,
  rebuildPayRun,
  finalizePayRun,
  approvePayRun,
  voidPayRun,
  downloadPayRunCsv,
  linkPayRunPayout,
  recordPayRunDisbursement,
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
  const selection=useOperationStore(restaurant),locationId=selection.locationId;
  const laborGeneration=useRef(0),activityGeneration=useRef(0),cashKey=useRef(null);
  const [activityOffset,setActivityOffset]=useState(0),[exceptionsError,setExceptionsError]=useState(false);
  const canManageTips=permits(restaurant,'payroll.manage')&&selection.brandAccess;
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
  const [tipSettingsError, setTipSettingsError] = useState(false);
  const [rules, setRules] = useState([]);
  const [savingTips, setSavingTips] = useState(false);
  const [cashForm, setCashForm] = useState({ staffUserId: '', date: to, amount: '', note: '' });
  const [exporting, setExporting] = useState(false);

  // ── Pay runs (Phase 5) ──
  const [payRuns, setPayRuns] = useState(null);
  const [payRunsError, setPayRunsError] = useState(null); // 'payroll' | 'generic'
  const [payRunForm, setPayRunForm] = useState({ from, to });
  const [selectedPayRun, setSelectedPayRun] = useState(null);
  const [payRunBusy, setPayRunBusy] = useState(false);
  const [payoutForm, setPayoutForm] = useState({ payoutId: '', note: '' });
  const [disbForm, setDisbForm] = useState({ lineId: '', method: 'bank_transfer', reference: '' });
  const canManagePayRuns = permits(restaurant, 'payroll.manage') && selection.brandAccess;

  const loadPayRuns = useCallback(() => {
    setPayRunsError(null);
    setPayRuns(null);
    listPayRuns(restaurantId, { limit: 20 })
      .then((data) => setPayRuns(data?.payRuns || []))
      .catch((error) => setPayRunsError(error?.response?.status === 403 ? 'payroll' : 'generic'));
  }, [restaurantId]);

  useEffect(() => { loadPayRuns(); }, [loadPayRuns]);

  const runPayRunAction = async (label, fn) => {
    setPayRunBusy(true);
    try {
      const run = await fn();
      if (run) {
        setSelectedPayRun(run);
        setPayRuns((rows) => (rows || []).map((row) => (Number(row.id) === Number(run.id) ? { ...row, ...run } : row)));
      }
      toast.success(label);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.payRuns.actionError')));
    } finally {
      setPayRunBusy(false);
    }
  };

  const onCreatePayRun = async (e) => {
    e.preventDefault();
    if (!payRunForm.from || !payRunForm.to) return;
    setPayRunBusy(true);
    try {
      const run = await createPayRun(restaurantId, { periodFrom: payRunForm.from, periodTo: payRunForm.to });
      toast.success(t('restaurants.ops.reports.payRuns.created'));
      loadPayRuns();
      if (run) setSelectedPayRun(run);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.payRuns.actionError')));
    } finally {
      setPayRunBusy(false);
    }
  };

  const onOpenPayRun = async (payRunId) => {
    setPayRunBusy(true);
    try {
      const run = await getPayRun(restaurantId, payRunId);
      setSelectedPayRun(run);
      setDisbForm({ lineId: '', method: 'bank_transfer', reference: '' });
      setPayoutForm({ payoutId: '', note: '' });
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.payRuns.actionError')));
    } finally {
      setPayRunBusy(false);
    }
  };

  const onExportPayRun = async (payRunId, format) => {
    setPayRunBusy(true);
    try {
      const blob = await downloadPayRunCsv(restaurantId, payRunId, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `pay-run-${payRunId}${format === 'provider' ? '-provider' : ''}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.payRuns.exportError')));
    } finally {
      setPayRunBusy(false);
    }
  };

  const onLinkPayout = async (e) => {
    e.preventDefault();
    if (!selectedPayRun || !payoutForm.payoutId.trim()) return;
    await runPayRunAction(
      t('restaurants.ops.reports.payRuns.payoutLinked'),
      () => linkPayRunPayout(restaurantId, selectedPayRun.id, {
        restaurantPayoutId: payoutForm.payoutId.trim(),
        note: payoutForm.note || undefined,
      }),
    );
  };

  const onRecordDisbursement = async (e) => {
    e.preventDefault();
    if (!selectedPayRun || !disbForm.lineId) return;
    const line = (selectedPayRun.lines || []).find((l) => String(l.id) === String(disbForm.lineId));
    if (!line) return;
    await runPayRunAction(
      t('restaurants.ops.reports.payRuns.disbursementRecorded'),
      () => recordPayRunDisbursement(restaurantId, selectedPayRun.id, {
        payRunLineId: Number(line.id),
        amountCents: Math.round(Number(line.total_pay_cents) || 0),
        method: disbForm.method,
        reference: disbForm.reference || undefined,
      }),
    );
  };

  const loadLabor=useCallback(()=>{
    const generation=++laborGeneration.current;if(!locationId)return;
    setLaborError(null);setLabor(null);setExceptions(null);setExceptionsError(false);
    getLaborReport(restaurantId,{from,to,locationId}).then(data=>{if(generation===laborGeneration.current)setLabor(data);}).catch(error=>{if(generation===laborGeneration.current)setLaborError(error?.response?.status===403?'payroll':'generic');});
    getExceptionsReport(restaurantId,{from,to,locationId}).then(data=>{if(generation===laborGeneration.current)setExceptions(data);}).catch(()=>{if(generation===laborGeneration.current)setExceptionsError(true);});
  },[restaurantId,from,to,locationId]);
  useEffect(()=>{loadLabor();return()=>{laborGeneration.current+=1;};},[loadLabor]);
  const loadActivity=useCallback(()=>{
    const generation=++activityGeneration.current;if(!locationId)return;
    setActivityError(false);setActivity(null);
    const params={limit:50,offset:activityOffset,from,to,locationId};
    if(actorFilter)params.actor_user_id=actorFilter;if(actionFilter)params.action_prefix=actionFilter;
    getTeamActivity(restaurantId,params).then(data=>{if(generation===activityGeneration.current)setActivity(data);}).catch(error=>{if(generation===activityGeneration.current)setActivityError(error?.response?.status===403?'permission':'generic');});
  },[restaurantId,actorFilter,actionFilter,from,to,locationId,activityOffset]);
  useEffect(()=>{setActivityOffset(0);},[restaurantId,actorFilter,actionFilter,from,to,locationId]);
  useEffect(()=>{loadActivity();return()=>{activityGeneration.current+=1;};},[loadActivity]);

  const loadTipSettings = useCallback(() => {
    setTipSettingsError(false);
    getTipPoolSettings(restaurantId)
      .then((settings) => {
        setTipSettings(settings);
        setRules((settings?.tip_out_rules || []).map((r) => ({
          target_type: r.target_type,
          target_key: r.target_key || '',
          percent: String((Number(r.percent_bps) || 0) / 100),
          weight_basis: r.weight_basis || 'equal',
        })));
      })
      // A failed tip-pool read used to make the whole section silently
      // vanish; surface it with a retry instead.
      .catch(() => setTipSettingsError(true));
  }, [restaurantId]);

  useEffect(() => { loadTipSettings(); }, [loadTipSettings]);

  const onExportPayroll = async () => {
    setExporting(true);
    try {
      const blob = await downloadPayrollCsv(restaurantId, { from, to, locationId });
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
          weight_basis: r.weight_basis || 'equal',
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
    const amountCents = parseCreditMajorAmount(cashForm.amount,currency);
    if (!cashForm.staffUserId || !cashForm.date || !Number.isFinite(amountCents) || amountCents <= 0) {
      toast.error(t('restaurants.ops.reports.tipPool.cashInvalid'));
      return;
    }
    try {
      const hash=JSON.stringify([restaurantId,locationId,cashForm]);if(cashKey.current?.hash!==hash)cashKey.current={hash,key:requestIdentity()};
      await declareCashTip(restaurantId, {
        locationId:Number(locationId),idempotencyKey:cashKey.current.key,
        staffUserId: cashForm.staffUserId,
        date: cashForm.date,
        amountCents,
        note: cashForm.note || undefined,
      });
      toast.success(t('restaurants.ops.reports.tipPool.cashSaved'));
      cashKey.current=null;
      setCashForm((f) => ({ ...f, amount: '', note: '' }));
      loadLabor();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.reports.tipPool.cashError')));
    }
  };

  const employees = labor?.employees || [];
  const fmtTime = (iso) => {
    try {
      return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short',timeZone:selection.store?.timezone||restaurant.timezone||'UTC' }).format(new Date(iso));
    } catch { return String(iso || ''); }
  };

  return (
    <div>
      <OperationStorePicker t={t} selection={selection}/>
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

      {/* ── Pay runs (Phase 5) ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.payRuns.title')}</h3>
      {payRunsError === 'payroll' ? (
        <p className="fd-ops-notice">{t('restaurants.ops.reports.payroll.permissionNote')}</p>
      ) : payRunsError === 'generic' ? (
        <div className="fd-empty" role="alert"><p>{t('restaurants.ops.reports.payRuns.loadError')}</p><button type="button" className="fd-btn fd-btn-sm" onClick={loadPayRuns} data-track="ui.aa258f5ea1.13">{t('restaurants.ops.shared.retry')}</button></div>
      ) : !payRuns ? (
        <div className="fd-empty">{t('food.common.loading')}</div>
      ) : (
        <>
          {canManagePayRuns && (
            <form onSubmit={onCreatePayRun} className="fd-card" data-track="ui.aa258f5ea1.14">
              <p className="fd-card-meta">{t('restaurants.ops.reports.payRuns.createTitle')}</p>
              <div className="fd-ops-inventory-row">
                <input
                  aria-label={t('restaurants.ops.reports.payRuns.periodFrom')}
                  type="date" value={payRunForm.from || ''}
                  onChange={(e) => setPayRunForm((f) => ({ ...f, from: e.target.value }))}
                />
                <input
                  aria-label={t('restaurants.ops.reports.payRuns.periodTo')}
                  type="date" value={payRunForm.to || ''}
                  onChange={(e) => setPayRunForm((f) => ({ ...f, to: e.target.value }))}
                />
                <button type="submit" className="fd-btn fd-btn-sm" disabled={payRunBusy} data-track="ui.aa258f5ea1.15">{t('restaurants.ops.reports.payRuns.create')}</button>
              </div>
            </form>
          )}
          {payRuns.length === 0 ? (
            <EmptyState icon={Users} title={t('restaurants.ops.reports.payRuns.none')} />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.period')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.status')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.totalPay')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.approval')}</th>
                    <th scope="col"><span className="sr-only">{t('restaurants.ops.reports.payRuns.view')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {payRuns.map((run) => (
                    <tr key={run.id}>
                      <td>{String(run.period_from || '').slice(0, 10)} - {String(run.period_to || '').slice(0, 10)}</td>
                      <td>{t(`restaurants.ops.reports.payRuns.status.${run.status}`)}</td>
                      <td>{money(run.totals?.total_pay_cents ?? run.linkedPayoutCents ?? 0)}</td>
                      <td>{run.approved_by ? t('restaurants.ops.reports.payRuns.approved') : t('restaurants.ops.reports.payRuns.notApproved')}</td>
                      <td>
                        <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={payRunBusy} onClick={() => onOpenPayRun(run.id)} data-track="ui.aa258f5ea1.16">
                          {t('restaurants.ops.reports.payRuns.view')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {selectedPayRun && (
        <div className="fd-card">
          <p className="fd-card-meta">
            {t('restaurants.ops.reports.payRuns.run', { id: selectedPayRun.id })} · {String(selectedPayRun.period_from || '').slice(0, 10)} - {String(selectedPayRun.period_to || '').slice(0, 10)} · {t(`restaurants.ops.reports.payRuns.status.${selectedPayRun.status}`)}
          </p>
          <p className="fd-card-meta">
            {selectedPayRun.status === 'finalized' && !selectedPayRun.approved_by
              ? t('restaurants.ops.reports.payRuns.awaitingApproval')
              : selectedPayRun.approved_by
                ? t('restaurants.ops.reports.payRuns.approvedNote')
                : ''}
          </p>
          {(selectedPayRun.lines || []).length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('restaurants.ops.reports.payroll.employee')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.hours')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.wages')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.grossTips')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.tipOut')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.tipIn')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.netTips')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payroll.totalPay')}</th>
                    <th scope="col">{t('restaurants.ops.reports.payRuns.disbursed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPayRun.lines.map((line) => {
                    const disbursed = (selectedPayRun.disbursements || []).find((d) => Number(d.payRunLineId) === Number(line.id));
                    return (
                      <tr key={line.id}>
                        <td>{line.staff_label || line.staff_user_id}</td>
                        <td>{line.regular_hours} + {line.overtime_hours} OT + {line.doubletime_hours} DT</td>
                        <td>{line.wages_cents == null ? '—' : money(line.wages_cents)}</td>
                        <td>{money(line.gross_tips_cents)}</td>
                        <td>{money(line.tip_out_cents)}</td>
                        <td>{money(line.tip_in_cents)}</td>
                        <td>{money(line.net_tips_cents)}</td>
                        <td>{money(line.total_pay_cents)}</td>
                        <td>{disbursed ? money(disbursed.amountCents) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selectedPayRun.disbursementCoverage && (
            <p className="fd-card-meta">
              {t('restaurants.ops.reports.payRuns.coverage', {
                covered: selectedPayRun.disbursementCoverage.lines_covered,
                total: selectedPayRun.disbursementCoverage.lines_total,
                disbursed: money(selectedPayRun.disbursementCoverage.disbursed_cents),
                runTotal: money(selectedPayRun.disbursementCoverage.run_total_cents),
              })}
            </p>
          )}
          {canManagePayRuns && (
            <div className="fd-ops-inventory-row">
              {selectedPayRun.status === 'draft' && (
                <>
                  <button type="button" className="fd-btn fd-btn-sm" disabled={payRunBusy} onClick={() => runPayRunAction(t('restaurants.ops.reports.payRuns.finalized'), () => finalizePayRun(restaurantId, selectedPayRun.id))} data-track="ui.aa258f5ea1.17">{t('restaurants.ops.reports.payRuns.finalize')}</button>
                  <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={payRunBusy} onClick={() => runPayRunAction(t('restaurants.ops.reports.payRuns.rebuilt'), () => rebuildPayRun(restaurantId, selectedPayRun.id))} data-track="ui.aa258f5ea1.18">{t('restaurants.ops.reports.payRuns.rebuild')}</button>
                </>
              )}
              {selectedPayRun.status === 'finalized' && !selectedPayRun.approved_by && (
                <button type="button" className="fd-btn fd-btn-sm" disabled={payRunBusy} onClick={() => runPayRunAction(t('restaurants.ops.reports.payRuns.approved'), () => approvePayRun(restaurantId, selectedPayRun.id))} data-track="ui.aa258f5ea1.19">{t('restaurants.ops.reports.payRuns.approve')}</button>
              )}
              {(selectedPayRun.status === 'finalized' || selectedPayRun.status === 'paid') && (
                <>
                  <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={payRunBusy} onClick={() => onExportPayRun(selectedPayRun.id, 'native')} data-track="ui.aa258f5ea1.20">{t('restaurants.ops.reports.payRuns.exportCsv')}</button>
                  <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={payRunBusy} onClick={() => onExportPayRun(selectedPayRun.id, 'provider')} data-track="ui.aa258f5ea1.21">{t('restaurants.ops.reports.payRuns.exportProvider')}</button>
                </>
              )}
              {(selectedPayRun.status === 'draft' || selectedPayRun.status === 'finalized') && (
                <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={payRunBusy} onClick={() => runPayRunAction(t('restaurants.ops.reports.payRuns.voided'), () => voidPayRun(restaurantId, selectedPayRun.id))} data-track="ui.aa258f5ea1.22">{t('restaurants.ops.reports.payRuns.void')}</button>
              )}
              <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" onClick={() => setSelectedPayRun(null)} data-track="ui.aa258f5ea1.23">{t('restaurants.ops.reports.payRuns.close')}</button>
            </div>
          )}
          {canManagePayRuns && selectedPayRun.status === 'finalized' && selectedPayRun.approved_by && (
            <>
              <form onSubmit={onLinkPayout} className="fd-ops-inventory-row" data-track="ui.aa258f5ea1.26">
                <input
                  aria-label={t('restaurants.ops.reports.payRuns.payoutId')}
                  value={payoutForm.payoutId}
                  placeholder={t('restaurants.ops.reports.payRuns.payoutIdPlaceholder')}
                  onChange={(e) => setPayoutForm((f) => ({ ...f, payoutId: e.target.value }))}
                />
                <input
                  aria-label={t('restaurants.ops.reports.payRuns.payoutNote')}
                  value={payoutForm.note}
                  placeholder={t('restaurants.ops.reports.payRuns.payoutNotePlaceholder')}
                  onChange={(e) => setPayoutForm((f) => ({ ...f, note: e.target.value }))}
                />
                <button type="submit" className="fd-btn fd-btn-sm" disabled={payRunBusy || !payoutForm.payoutId.trim()} data-track="ui.aa258f5ea1.24">{t('restaurants.ops.reports.payRuns.linkPayout')}</button>
              </form>
              <form onSubmit={onRecordDisbursement} className="fd-ops-inventory-row" data-track="ui.aa258f5ea1.27">
                <select
                  aria-label={t('restaurants.ops.reports.payRuns.disburseEmployee')}
                  value={disbForm.lineId}
                  onChange={(e) => setDisbForm((f) => ({ ...f, lineId: e.target.value }))}
                >
                  <option value="">{t('restaurants.ops.reports.payRuns.disburseSelect')}</option>
                  {(selectedPayRun.lines || []).filter((line) => !(selectedPayRun.disbursements || []).some((d) => Number(d.payRunLineId) === Number(line.id))).map((line) => (
                    <option key={line.id} value={line.id}>{line.staff_label || line.staff_user_id} · {money(line.total_pay_cents)}</option>
                  ))}
                </select>
                <select
                  aria-label={t('restaurants.ops.reports.payRuns.disburseMethod')}
                  value={disbForm.method}
                  onChange={(e) => setDisbForm((f) => ({ ...f, method: e.target.value }))}
                >
                  <option value="bank_transfer">{t('restaurants.ops.reports.payRuns.method.bank_transfer')}</option>
                  <option value="cash">{t('restaurants.ops.reports.payRuns.method.cash')}</option>
                  <option value="check">{t('restaurants.ops.reports.payRuns.method.check')}</option>
                  <option value="provider_export">{t('restaurants.ops.reports.payRuns.method.provider_export')}</option>
                </select>
                <input
                  aria-label={t('restaurants.ops.reports.payRuns.disburseReference')}
                  value={disbForm.reference}
                  placeholder={t('restaurants.ops.reports.payRuns.disburseReferencePlaceholder')}
                  onChange={(e) => setDisbForm((f) => ({ ...f, reference: e.target.value }))}
                />
                <button type="submit" className="fd-btn fd-btn-sm" disabled={payRunBusy || !disbForm.lineId} data-track="ui.aa258f5ea1.25">{t('restaurants.ops.reports.payRuns.recordDisbursement')}</button>
              </form>
              <p className="fd-card-meta">{t('restaurants.ops.reports.payRuns.disburseHint')}</p>
            </>
          )}
        </div>
      )}

      {/* ── Tip pool + declared cash tips ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.tipPool.title')}</h3>
      {tipSettingsError && <p role="alert">{t('restaurants.ops.reports.tipPool.loadError')} <button type="button" className="fd-btn fd-btn-sm" onClick={loadTipSettings} data-track="ui.aa258f5ea1.12">{t('restaurants.ops.shared.retry')}</button></p>}
      {tipSettings && canManageTips && (
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
              <select
                aria-label={t('restaurants.ops.reports.tipPool.ruleWeightBasis')}
                value={rule.weight_basis || 'equal'}
                onChange={(e) => setRules((rs) => rs.map((r, i) => (i === idx ? { ...r, weight_basis: e.target.value } : r)))}
              >
                <option value="equal">{t('restaurants.ops.reports.tipPool.weightEqual')}</option>
                <option value="hours">{t('restaurants.ops.reports.tipPool.weightHours')}</option>
                <option value="gross_tips">{t('restaurants.ops.reports.tipPool.weightGrossTips')}</option>
              </select>
              <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary"
                onClick={() => setRules((rs) => rs.filter((_, i) => i !== idx))} data-track="ui.aa258f5ea1.3">
                {t('restaurants.ops.reports.tipPool.removeRule')}
              </button>
            </div>
          ))}
          <div className="fd-ops-inventory-row">
            <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary"
              onClick={() => setRules((rs) => [...rs, { target_type: 'role', target_key: '', percent: '5', weight_basis: 'equal' }])} data-track="ui.aa258f5ea1.4">
              {t('restaurants.ops.reports.tipPool.addRule')}
            </button>
            <button type="button" className="fd-btn fd-btn-sm" onClick={saveTipSettings} disabled={savingTips} data-track="ui.aa258f5ea1.5">
              {t('restaurants.ops.reports.tipPool.save')}
            </button>
          </div>
          <p className="fd-card-meta">{t('restaurants.ops.reports.tipPool.hint')}</p>
        </div>
      )}
      {labor && employees.length > 0 && permits(restaurant,'payroll.manage') && (
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
              type="number" min="0" step={10**-getCreditMinorUnits(currency)} value={cashForm.amount}
              placeholder={t('restaurants.ops.reports.tipPool.cashAmount')}
              onChange={(e) => setCashForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <button type="submit" className="fd-btn fd-btn-sm" data-track="ui.aa258f5ea1.7">{t('restaurants.ops.reports.tipPool.cashAdd')}</button>
          </div>
        </form>
      )}

      {/* ── Exceptions ── */}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.exceptions.title')}</h3>
      {exceptionsError ? <div role="alert">{t('restaurants.ops.shared.loadError')} <button type="button" className="fd-btn" onClick={loadLabor} data-track="ui.aa258f5ea1.8">{t('restaurants.ops.shared.retry')}</button></div> : !exceptions ? (
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
      <div className="fd-row"><button type="button" className="fd-btn" disabled={!activityOffset} onClick={()=>setActivityOffset(n=>Math.max(0,n-50))} data-track="ui.aa258f5ea1.9">{t('restaurants.ops.shared.previous')}</button><button type="button" className="fd-btn" disabled={!activity||activityOffset+50>=(activity.total||0)} onClick={()=>setActivityOffset(n=>n+50)} data-track="ui.aa258f5ea1.10">{t('restaurants.ops.shared.next')}</button></div>
      <h3 className="fd-ops-subhead">{t('restaurants.ops.reports.activity.title')}</h3>
      {activityError ? (
        <p className="fd-ops-notice">{activityError==='permission'?t('restaurants.ops.reports.activity.permissionNote'):t('restaurants.ops.shared.loadError')} <button type="button" className="fd-btn" onClick={loadActivity} data-track="ui.aa258f5ea1.11">{t('restaurants.ops.shared.retry')}</button></p>
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
