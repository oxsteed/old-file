import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { moneyMinor } from '../lib/moneyExact';
import './HelperJobBreakdown.css';

// Group 4 rest, items 186 (job earnings summary) and 189 (adjustment
// explanation). Loads GET /helpers/me/jobs/:jobId/earnings on demand; the
// server only answers the job's assigned helper.
export default function HelperJobBreakdown({ jobId }) {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.breakdown.${key}`, opts);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: false, data: null });

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || state.data || state.loading) return;
    setState({ loading: true, error: false, data: null });
    try {
      const { data } = await api.get(`/helpers/me/jobs/${encodeURIComponent(jobId)}/earnings`);
      setState({ loading: false, error: false, data });
    } catch {
      setState({ loading: false, error: true, data: null });
    }
  }

  const data = state.data;
  const money = (v) => (v == null ? c('notRecorded') : moneyMinor(v, data?.currencyCode, i18n.language));
  const id = `helper-breakdown-${jobId}`;
  return <div className="helper-job-breakdown">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={toggle} data-track="ui.helperG4.breakdown.toggle">
      {open ? c('hide') : c('show')}
    </button>
    {open && <div id={id}>
      {state.loading && <p role="status">{c('loading')}</p>}
      {state.error && <p role="alert">{c('loadFailed')}</p>}
      {data && <>
        <dl>
          <div><dt>{c('jobValue')}</dt><dd>{money(data.breakdown.jobValueCents)}</dd></div>
          <div><dt>{c('yourPayout')}</dt><dd>{money(data.breakdown.helperPayoutCents)}</dd></div>
        </dl>
        <h4>{c('why')}</h4>
        {data.adjustments.length === 0
          ? <p>{c('none')}</p>
          : <ul>{data.adjustments.map((a, i) => <li key={`${a.code}-${a.reference || i}`}>
              <span>{c(`code.${a.code}`)}{a.reason ? ` — ${a.reason}` : ''}</span>
              {a.code !== 'not_priced' && <strong dir="ltr">{a.amountCents > 0 ? '+' : ''}{moneyMinor(a.amountCents, data.currencyCode, i18n.language)}</strong>}
            </li>)}</ul>}
      </>}
    </div>}
  </div>;
}
