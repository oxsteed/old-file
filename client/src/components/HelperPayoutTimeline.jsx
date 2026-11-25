import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { moneyMinor } from '../lib/moneyExact';
import { formatDate } from '../lib/format';
import './HelperPayoutTimeline.css';

// Group 4 rest, item 187: payout timeline. Reads the existing
// GET /main-app/payouts/summary (the caller's own requests only).
export default function HelperPayoutTimeline() {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.payoutTimeline.${key}`, opts);
  const [state, setState] = useState({ loading: true, error: false, data: null });
  useEffect(() => {
    const controller = new AbortController();
    api.get('/main-app/payouts/summary', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ loading: false, error: false, data }); })
      .catch(() => { if (!controller.signal.aborted) setState({ loading: false, error: true, data: null }); });
    return () => controller.abort();
  }, []);
  const data = state.data;
  const cur = data?.summary?.currencyCode;
  const money = (v, code) => moneyMinor(v, code || cur, i18n.language);
  const date = (v) => (v ? formatDate(v, { locale: i18n.language }) : null);
  return <section className="helper-payout-timeline" aria-labelledby="helper-payout-timeline-title" aria-busy={state.loading}>
    <h2 id="helper-payout-timeline-title">{c('title')}</h2>
    {state.loading && <p role="status">{c('loading')}</p>}
    {state.error && <p role="alert">{c('loadFailed')}</p>}
    {data && <>
      <dl className="helper-payout-timeline-totals">
        <div><dt>{c('available')}</dt><dd>{money(data.summary.availableCents)}</dd></div>
        <div><dt>{c('pending')}</dt><dd>{money(data.summary.pendingCents)}</dd></div>
        <div><dt>{c('paid')}</dt><dd>{money(data.summary.paidCents)}</dd></div>
      </dl>
      <p>{c('settlementNote')}</p>
      {data.requests.length === 0 ? <p>{c('empty')}</p> : <ol className="helper-payout-timeline-list">
        {data.requests.map((r) => <li key={r.id} data-status={r.status}>
          <header><strong>{money(r.amountCents, r.currencyCode)}</strong> <span>{c(`status.${r.status}`, { defaultValue: r.status })}</span></header>
          <ol className="helper-payout-timeline-steps">
            <li><span>{c('requested')}</span> <time dateTime={r.requestedAt}>{date(r.requestedAt)}</time></li>
            {r.processedAt && <li><span>{c('processed')}</span> <time dateTime={r.processedAt}>{date(r.processedAt)}</time></li>}
            {r.cancelledAt && <li><span>{c('cancelled')}</span> <time dateTime={r.cancelledAt}>{date(r.cancelledAt)}</time></li>}
          </ol>
        </li>)}
      </ol>}
    </>}
  </section>;
}
