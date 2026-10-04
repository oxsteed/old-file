import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

/**
 * PriceGuidance: non-blocking rate hint line.
 * source: 'jobs'    -> "Similar jobs budget $X-$Y/hr" (from hourly job budgets)
 * source: 'helpers' -> "Helpers like you charge $X-$Y/hr" (from helper rates)
 * Renders nothing until the server returns usable stats; any failure stays silent.
 */
export default function PriceGuidance({ source, category, state }) {
  const { t } = useTranslation();
  const [guide, setGuide] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setGuide(null);
    const params = { source };
    if (category) params.category = category;
    if (state) params.state = state;
    api
      .get('/price-guidance', { params })
      .then((r) => {
        if (cancelled) return;
        const g = r && r.data;
        if (g && g.p25 != null && g.p75 != null) setGuide(g);
      })
      .catch(() => {
        // Guidance is advisory only; never surface errors to the user.
      });
    return () => {
      cancelled = true;
    };
  }, [source, category, state]);

  if (!guide) return null;

  const fmt = (v) =>
    Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const key = source === 'jobs' ? 'priceGuide.similarJobs' : 'priceGuide.helperRange';
  const line = t(key, {
    lo: fmt(guide.p25),
    hi: fmt(guide.p75),
    defaultValue:
      source === 'jobs'
        ? `Similar jobs budget $${fmt(guide.p25)}-$${fmt(guide.p75)}/hr`
        : `Helpers like you charge $${fmt(guide.p25)}-$${fmt(guide.p75)}/hr`,
  });
  const note = t('priceGuide.sampleNote', {
    n: guide.n,
    defaultValue: `Based on ${guide.n} recent rates`,
  });

  return (
    <p
      className="pg-hint"
      style={{
        fontSize: '0.8rem',
        opacity: 0.78,
        margin: '6px 0 0',
        display: 'flex',
        gap: 6,
        alignItems: 'baseline',
        flexWrap: 'wrap',
      }}
      role="note"
      aria-label={line}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
        style={{ flexShrink: 0, transform: 'translateY(2px)' }}
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>
        {line}
        <span style={{ opacity: 0.75 }}> · {note}</span>
      </span>
    </p>
  );
}
