// My pay — Phase 3 Track B. The employee's own pay for a period
// (hours by tier, wages, premiums, tips, total) and their pay stubs.
// A stub renders only from a FINALIZED (or paid) pay run's frozen
// lines: draft runs never appear in the list, so what the worker sees
// is the pay that was actually approved, not a work in progress.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyPay, getMyPayStub, listMyPayStubs } from '../../api/restaurants';
import { apiErrorMessage, formatMinorUnits } from './foodShared';
import {
  EpRow, formatPortalDay, periodOptionsFromStubs, periodRangeForKey,
} from './RestaurantEmployeePortalShared';
import EmployedByRestaurant from './EmployedByRestaurant';

export default function RestaurantMyPayPanel({ restaurant }) {
  const { t, i18n } = useTranslation();
  const restaurantId = restaurant?.id;
  const currency = restaurant?.currency_code || 'USD';
  const [periodKey, setPeriodKey] = useState('current');
  const [pay, setPay] = useState(null);
  const [stubs, setStubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStubId, setSelectedStubId] = useState(null);
  const [stub, setStub] = useState(null);
  const [stubLoading, setStubLoading] = useState(false);
  const [stubError, setStubError] = useState('');

  const options = periodOptionsFromStubs(stubs);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError('');
    try {
      const { from, to } = periodRangeForKey(options, periodKey);
      const [mine, stubRows] = await Promise.all([
        getMyPay(restaurantId, { from, to }),
        listMyPayStubs(restaurantId),
      ]);
      setPay(mine);
      setStubs(Array.isArray(stubRows) ? stubRows : []);
    } catch (err) {
      setError(apiErrorMessage(err, t('food.employeePortal.shared.loadError')));
    } finally {
      setLoading(false);
    }
    // Period options depend on the stubs list; reloading when the
    // selected period changes keeps the summary in step with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, periodKey]);

  useEffect(() => { load(); }, [load]);

  const openStub = async (payRunId) => {
    setSelectedStubId(payRunId);
    setStub(null);
    setStubError('');
    setStubLoading(true);
    try {
      setStub(await getMyPayStub(restaurantId, payRunId));
    } catch (err) {
      setStubError(apiErrorMessage(err, t('food.employeePortal.shared.loadError')));
    } finally {
      setStubLoading(false);
    }
  };

  const { from, to } = periodRangeForKey(options, periodKey);
  const rangeLabel = pay
    ? `${formatPortalDay(pay.from_date, i18n.language)} - ${formatPortalDay(pay.to_date, i18n.language)}`
    : `${formatPortalDay(from, i18n.language)} - ${formatPortalDay(to, i18n.language)}`;
  const money = (cents, code) => formatMinorUnits(cents, code || pay?.currency || currency, i18n.language);
  const hours = (value) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const employee = pay?.employee || null;

  return (
    <div className="ep-panel">
      <label className="ep-field">
        <span>{t('food.employeePortal.shared.period')}</span>
        <select value={periodKey} onChange={(event) => setPeriodKey(event.target.value)}>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.key === 'current'
                ? t('food.employeePortal.shared.currentPeriod')
                : `${formatPortalDay(option.from, i18n.language)} - ${formatPortalDay(option.to, i18n.language)}`}
            </option>
          ))}
        </select>
      </label>
      <p className="ep-period-label">{rangeLabel}</p>

      {loading ? (
        <p className="ep-empty">{t('food.common.loading')}</p>
      ) : error ? (
        <p className="ep-empty" role="alert">{error}</p>
      ) : !employee ? (
        <p className="ep-empty">{t('food.employeePortal.myPay.noPay')}</p>
      ) : (
        <section className="ep-section">
          <EpRow label={t('food.employeePortal.myPay.hours')} value={hours(employee.hours)} />
          <EpRow label={t('food.employeePortal.myPay.regularHours')} value={hours(employee.regular_hours)} />
          <EpRow label={t('food.employeePortal.myPay.overtimeHours')} value={hours(employee.overtime_hours)} />
          <EpRow label={t('food.employeePortal.myPay.doubletimeHours')} value={hours(employee.doubletime_hours)} />
          <EpRow label={t('food.employeePortal.myPay.regularWages')} value={money(employee.regular_wages_cents)} />
          <EpRow label={t('food.employeePortal.myPay.overtimeWages')} value={money(employee.overtime_wages_cents)} />
          <EpRow label={t('food.employeePortal.myPay.doubletimeWages')} value={money(employee.doubletime_wages_cents)} />
          <EpRow label={t('food.employeePortal.myPay.mealBreakPremium')} value={money(employee.meal_break_premium_cents)} />
          <EpRow label={t('food.employeePortal.myPay.predictabilityPremium')} value={money(employee.predictability_premium_cents)} />
          <EpRow label={t('food.employeePortal.myPay.grossTips')} value={money(employee.gross_tips_cents)} />
          <EpRow label={t('food.employeePortal.myPay.tipOut')} value={money(employee.tip_out_cents)} />
          <EpRow label={t('food.employeePortal.myPay.tipIn')} value={money(employee.tip_in_cents)} />
          <EpRow label={t('food.employeePortal.myPay.netTips')} value={money(employee.net_tips_cents)} />
          {Object.entries(employee.tips_by_currency || {}).filter(([code]) => code !== (pay?.currency || currency)).map(([code, bucket]) => (
            <EpRow key={code} label={t('food.employeePortal.myPay.netTipsInCurrency', { currency: code })} value={money(bucket.net_tips_cents, code)} />
          ))}
          <EpRow label={t('food.employeePortal.myPay.totalPay')} value={money(employee.total_pay_cents)} strong />
        </section>
      )}

      <section className="ep-section">
        <h2>{t('food.employeePortal.myPay.stubsTitle')}</h2>
        {stubs.length === 0 ? (
          <p className="ep-empty">{t('food.employeePortal.myPay.noStubs')}</p>
        ) : (
          <ul className="ep-list">
            {stubs.map((row) => (
              <li key={row.pay_run_id} className="ep-list-row">
                <span>{formatPortalDay(row.period_from, i18n.language)} - {formatPortalDay(row.period_to, i18n.language)}</span>
                <span>{money(row.total_pay_cents)}</span>
                <button
                  type="button"
                  className="fd-btn fd-btn-secondary fd-btn-sm"
                  onClick={() => openStub(row.pay_run_id)}
                >
                  {t('food.employeePortal.myPay.viewStub')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedStubId != null && (
        <section className="ep-section" aria-label={t('food.employeePortal.myPay.stubTitle')}>
          <h2>{t('food.employeePortal.myPay.stubTitle')}</h2>
          {stubLoading ? (
            <p className="ep-empty">{t('food.common.loading')}</p>
          ) : stubError ? (
            <p className="ep-empty" role="alert">{stubError}</p>
          ) : stub ? (
            <>
              <p className="ep-period-label">{restaurant?.display_name}</p>
              <p className="ep-period-label">
                {formatPortalDay(stub.pay_run.period_from, i18n.language)} - {formatPortalDay(stub.pay_run.period_to, i18n.language)}
              </p>
              <p className="ep-note">
                {t(`food.employeePortal.myPay.status${stub.pay_run.status === 'paid' ? 'Paid' : 'Finalized'}`)}
              </p>
              {stub.pay_run.finalized_at && (
                <p className="ep-note">
                  {t('food.employeePortal.myPay.finalizedOn', { date: formatPortalDay(stub.pay_run.finalized_at, i18n.language) })}
                </p>
              )}
              <EpRow label={t('food.employeePortal.myPay.regularHours')} value={hours(stub.line.regular_hours)} />
              <EpRow label={t('food.employeePortal.myPay.overtimeHours')} value={hours(stub.line.overtime_hours)} />
              <EpRow label={t('food.employeePortal.myPay.doubletimeHours')} value={hours(stub.line.doubletime_hours)} />
              <EpRow label={t('food.employeePortal.myPay.regularWages')} value={money(stub.line.regular_wages_cents)} />
              <EpRow label={t('food.employeePortal.myPay.overtimeWages')} value={money(stub.line.overtime_wages_cents)} />
              <EpRow label={t('food.employeePortal.myPay.doubletimeWages')} value={money(stub.line.doubletime_wages_cents)} />
              <EpRow label={t('food.employeePortal.myPay.mealBreakPremium')} value={money(stub.line.meal_break_premium_cents)} />
              <EpRow label={t('food.employeePortal.myPay.predictabilityPremium')} value={money(stub.line.predictability_premium_cents)} />
              <EpRow label={t('food.employeePortal.myPay.grossTips')} value={money(stub.line.gross_tips_cents)} />
              <EpRow label={t('food.employeePortal.myPay.tipOut')} value={money(stub.line.tip_out_cents)} />
              <EpRow label={t('food.employeePortal.myPay.tipIn')} value={money(stub.line.tip_in_cents)} />
              <EpRow label={t('food.employeePortal.myPay.netTips')} value={money(stub.line.net_tips_cents)} />
              <EpRow label={t('food.employeePortal.myPay.totalPay')} value={money(stub.line.total_pay_cents)} strong />
              <EmployedByRestaurant restaurantName={restaurant?.display_name} />
            </>
          ) : null}
        </section>
      )}
      <EmployedByRestaurant restaurantName={restaurant?.display_name} />
    </div>
  );
}
