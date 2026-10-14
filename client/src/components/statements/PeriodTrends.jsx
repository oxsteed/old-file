import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { getStatementTrends } from '../../api/statementSearch';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import { localizeCreditTransactionType } from '../../lib/creditStatus';
import './PeriodTrends.css';

// Current vs previous period comparison for an OxSteed Credit or Restaurant
// Credit statement account.
//
// Props:
//   product   'oxsteed' | 'restaurant'
//   accountId the numeric account id, the OxSteed currency code ("USD"), or
//             the restaurant wallet key ("<restaurantId>:USD") used by the
//             statement page.
//   period    optional "YYYY-MM"; defaults to the current UTC month.
//
// Mounted below the interactive statement table (CreditStatementsPage) by
// Group B. All amounts are per-currency; currencies are never combined.
// The trends endpoint must return the full comparison shape the render below
// consumes. Anything else (an error payload, a deploy-skewed response, a
// proxy page parsed as JSON) renders the error state instead of crashing the
// whole statement page.
function isUsableTrends(data) {
  const totals = data?.current?.totals;
  return !!(
    data &&
    totals && typeof totals.currencyCode === 'string' &&
    data.current?.period && data.previous?.period &&
    data.change &&
    Array.isArray(data.drivers) &&
    Array.isArray(data.breakdown)
  );
}

export default function PeriodTrends({ product, accountId, period }) {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options = {}) => t(`statements.${key}`, options);
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const [trends, setTrends] = useState(null);
  const [status, setStatus] = useState('loading');
  const requestRef = useRef(null);

  useEffect(() => {
    requestRef.current?.abort();
    if (!product || !accountId) {
      setStatus('idle');
      return undefined;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('loading');
    setTrends(null);
    getStatementTrends(product, accountId, { period, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!isUsableTrends(data)) {
          setStatus('error');
          return;
        }
        setTrends(data);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [product, accountId, period]);

  const money = (amount, currency) => formatStatementMoney(amount, currency, language);
  const signedMoney = (amount, currency) => `${amount > 0 ? '+' : ''}${money(amount, currency)}`;
  const typeLabel = (type) => localizeCreditTransactionType(type, t);

  if (status === 'idle' || status === 'loading') {
    return (
      <section className="stmt-trends" aria-labelledby="stmt-trends-heading">
        <h2 id="stmt-trends-heading">{text('trends.title')}</h2>
        {status === 'loading' && <p role="status">{text('trends.loading')}</p>}
      </section>
    );
  }
  if (status === 'error' || !trends) {
    return (
      <section className="stmt-trends" aria-labelledby="stmt-trends-heading">
        <h2 id="stmt-trends-heading">{text('trends.title')}</h2>
        <p role="alert" className="stmt-trends-error">{text('trends.error')}</p>
      </section>
    );
  }

  const { current, previous, change, drivers, breakdown, account } = trends;
  const currency = current.totals.currencyCode;
  const maxDriver = Math.max(1, ...drivers.map((d) => Math.abs(d.deltaCents)));
  const summaryId = 'stmt-trends-summary';
  const netDirection = change.netDeltaCents > 0 ? text('trends.increase') : change.netDeltaCents < 0 ? text('trends.decrease') : text('trends.noChange');

  return (
    <section className="stmt-trends" aria-labelledby="stmt-trends-heading" aria-describedby={summaryId}>
      <h2 id="stmt-trends-heading">{text('trends.title')}</h2>
      <p id={summaryId}>
        {text('trends.summary', {
          account: account.label,
          net: money(current.totals.netCents, currency),
          period: `${current.period.from} – ${current.period.to}`,
          direction: netDirection,
          amount: money(Math.abs(change.netDeltaCents), currency),
          previousPeriod: `${previous.period.from} – ${previous.period.to}`,
          credits: money(current.totals.creditsCents, currency),
          debits: money(current.totals.debitsCents, currency),
          count: current.totals.transactionCount,
        })}
      </p>

      <dl className="stmt-trends-grid" aria-label={text('trends.changeVsPrevious')}>
        {[
          { key: 'credits', value: current.totals.creditsCents, delta: change.creditsDeltaCents },
          { key: 'debits', value: current.totals.debitsCents, delta: change.debitsDeltaCents },
          { key: 'net', value: current.totals.netCents, delta: change.netDeltaCents },
        ].map(({ key, value, delta }) => (
          <div key={key} className="stmt-trend-card">
            <dt>{text(`trends.${key}`)}</dt>
            <dd className="stmt-trend-value"><bdi>{money(value, currency)}</bdi></dd>
            <dd className={`stmt-trend-delta ${delta > 0 ? 'stmt-trend-up' : delta < 0 ? 'stmt-trend-down' : ''}`}>
              {delta !== 0 && (delta > 0
                ? <TrendingUp size={14} aria-hidden="true" />
                : <TrendingDown size={14} aria-hidden="true" />)}
              <bdi>{signedMoney(delta, currency)}</bdi>
            </dd>
          </div>
        ))}
        <div className="stmt-trend-card">
          <dt>{text('trends.transactions')}</dt>
          <dd className="stmt-trend-value"><bdi>{current.totals.transactionCount}</bdi></dd>
          <dd className="stmt-trend-delta"><bdi>{`${change.countDelta > 0 ? '+' : ''}${change.countDelta}`}</bdi></dd>
        </div>
      </dl>

      {drivers.length > 0 && (
        <div className="stmt-trends-drivers">
          <h3>{text('trends.topDrivers')}</h3>
          <p className="stmt-trends-note">{text('trends.chartNote')}</p>
          <ul aria-label={text('trends.topDrivers')}>
            {drivers.map((driver) => (
              <li key={driver.type}>
                <span className="stmt-driver-label"><bdi>{typeLabel(driver.type)}</bdi></span>
                <span
                  className={`stmt-driver-bar ${driver.deltaCents < 0 ? 'stmt-driver-negative' : ''}`}
                  style={{ width: `${Math.max(2, (Math.abs(driver.deltaCents) / maxDriver) * 100)}%` }}
                  aria-hidden="true"
                />
                <span className="stmt-driver-value"><bdi>{signedMoney(driver.deltaCents, driver.currencyCode)}</bdi></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {breakdown.length > 0 ? (
        <div className="stmt-trends-breakdown">
          <h3>{text('trends.breakdown')}</h3>
          <div className="stmt-table-scroll" role="region" aria-label={text('trends.breakdown')} tabIndex={0}>
            <table>
              <caption className="stmt-sr-only">{text('trends.breakdown')}</caption>
              <thead>
                <tr>
                  <th scope="col">{text('trends.type')}</th>
                  <th scope="col">{text('trends.credits')}</th>
                  <th scope="col">{text('trends.debits')}</th>
                  <th scope="col">{text('trends.net')}</th>
                  <th scope="col">{text('trends.count')}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.type}>
                    <th scope="row">{typeLabel(row.type)}</th>
                    <td><bdi>{money(row.creditsCents, row.currencyCode)}</bdi></td>
                    <td><bdi>{money(row.debitsCents, row.currencyCode)}</bdi></td>
                    <td><bdi>{money(row.netCents, row.currencyCode)}</bdi></td>
                    <td><bdi>{row.transactionCount}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p>{text('trends.empty')}</p>
      )}
    </section>
  );
}
