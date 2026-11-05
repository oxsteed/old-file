// My tips — Phase 3 Track B. The employee's own tips for a period
// (gross, tip-out, tip-in, net, per currency), their declared cash
// tips with the manager-review state, and the self-declare form. A
// declaration enters review as pending and counts toward pay only
// after a manager confirms it; the panel says so next to the form
// instead of letting a pending amount read as paid.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { declareMyCashTip, getMyTips, listMyPayStubs } from '../../api/restaurants';
import { apiErrorMessage, formatMinorUnits, majorToMinorUnits, minorUnitDecimals } from './foodShared';
import {
  EpRow, formatPortalDay, periodOptionsFromStubs,
  periodRangeForKey, todayIso,
} from './RestaurantEmployeePortalShared';
import EmployedByRestaurant from './EmployedByRestaurant';

export default function RestaurantMyTipsPanel({ restaurant }) {
  const { t, i18n } = useTranslation();
  const restaurantId = restaurant?.id;
  const currency = restaurant?.currency_code || 'USD';
  const [periodKey, setPeriodKey] = useState('current');
  const [tips, setTips] = useState(null);
  const [stubs, setStubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ amount: '', date: todayIso(), note: '' });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const options = periodOptionsFromStubs(stubs);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError('');
    try {
      const { from, to } = periodRangeForKey(options, periodKey);
      const [mine, stubRows] = await Promise.all([
        getMyTips(restaurantId, { from, to }),
        listMyPayStubs(restaurantId),
      ]);
      setTips(mine);
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

  const submitDeclaration = async (event) => {
    event.preventDefault();
    const amountCents = majorToMinorUnits(form.amount, currency);
    if (amountCents == null || !form.date) return;
    setSubmitting(true);
    setNotice('');
    setError('');
    try {
      await declareMyCashTip(restaurantId, {
        amountCents,
        date: form.date,
        note: form.note.trim() || undefined,
        idempotencyKey: `portal-${crypto.randomUUID()}`,
      });
      setForm({ amount: '', date: todayIso(), note: '' });
      setNotice(t('food.employeePortal.myTips.declareSuccess'));
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t('food.employeePortal.myTips.declareError')));
    } finally {
      setSubmitting(false);
    }
  };

  const { from, to } = periodRangeForKey(options, periodKey);
  const rangeLabel = tips
    ? `${formatPortalDay(tips.from_date, i18n.language)} - ${formatPortalDay(tips.to_date, i18n.language)}`
    : `${formatPortalDay(from, i18n.language)} - ${formatPortalDay(to, i18n.language)}`;
  const money = (cents, code) => formatMinorUnits(cents, code || currency, i18n.language);

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
      ) : (
        <>
          {(tips?.currencies || []).length === 0 ? (
            <p className="ep-empty">{t('food.employeePortal.myTips.noTips')}</p>
          ) : (
            (tips.currencies || []).map((bucket) => (
              <section className="ep-section" key={bucket.currency} aria-label={bucket.currency}>
                <h2>{bucket.currency}</h2>
                <EpRow label={t('food.employeePortal.myTips.grossTips')} value={money(bucket.gross_tips_cents, bucket.currency)} />
                <EpRow label={t('food.employeePortal.myTips.tipOut')} value={money(bucket.tip_out_cents, bucket.currency)} />
                <EpRow label={t('food.employeePortal.myTips.tipIn')} value={money(bucket.tip_in_cents, bucket.currency)} />
                <EpRow label={t('food.employeePortal.myTips.netTips')} value={money(bucket.net_tips_cents, bucket.currency)} strong />
              </section>
            ))
          )}

          <section className="ep-section">
            <h2>{t('food.employeePortal.myTips.declaredCashTips')}</h2>
            {(tips?.cash_tips || []).length === 0 ? (
              <p className="ep-empty">{t('food.employeePortal.myTips.noDeclaredCashTips')}</p>
            ) : (
              <ul className="ep-list">
                {(tips.cash_tips || []).map((declaration) => (
                  <li key={declaration.id} className="ep-list-row">
                    <span>{formatPortalDay(declaration.business_date, i18n.language)}</span>
                    <span>{money(declaration.amount_cents, currency)}</span>
                    <span className={`ep-status ep-status-${declaration.status}`}>
                      {t(`food.employeePortal.myTips.status.${declaration.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {((tips?.cash_tips || []).some((d) => d.status === 'pending')) && (
              <p className="ep-note">{t('food.employeePortal.myTips.pendingReview')}</p>
            )}
          </section>

          <section className="ep-section">
            <h2>{t('food.employeePortal.myTips.declareTitle')}</h2>
            <form onSubmit={submitDeclaration} className="ep-form">
              <label className="ep-field">
                <span>{t('food.employeePortal.myTips.amount')} ({currency})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step={minorUnitDecimals(currency) === 0 ? '1' : '0.01'}
                  value={form.amount}
                  onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
                  required
                />
              </label>
              <label className="ep-field">
                <span>{t('food.employeePortal.myTips.date')}</span>
                <input
                  type="date"
                  value={form.date}
                  max={todayIso()}
                  onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                  required
                />
              </label>
              <label className="ep-field">
                <span>{t('food.employeePortal.myTips.note')}</span>
                <input
                  type="text"
                  value={form.note}
                  maxLength={500}
                  onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                />
              </label>
              <button type="submit" className="fd-btn" disabled={submitting}>
                {t('food.employeePortal.myTips.declareSubmit')}
              </button>
            </form>
            {notice && <p className="ep-notice" role="status">{notice}</p>}
          </section>
        </>
      )}
      <EmployedByRestaurant restaurantName={restaurant?.display_name} />
    </div>
  );
}
