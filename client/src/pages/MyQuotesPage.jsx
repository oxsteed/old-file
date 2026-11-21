import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import './MyQuotesPage.css';

/**
 * Group 1 (Customer), items 8/9/10 — My quotes.
 *
 * The customer's own quote requests: status, quoted amount when one
 * exists, the response deadline they set (with a passed badge once it
 * lapses), and the itemized service lines each request covers.
 * Selecting two or three requests opens a side-by-side comparison
 * (services, amount, deadline, status) so the customer can compare
 * quotes instead of opening each request in turn.
 */
function fmtMoney(cents, currency) {
  if (cents == null || Number.isNaN(Number(cents))) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(Number(cents) / 100);
  } catch {
    return `${(Number(cents) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function fmtDate(value, locale) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MyQuotesPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/quote-requests/my')
      .then((r) => {
        if (!cancelled) setRequests(Array.isArray(r.data?.requests) ? r.data.requests : []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const compared = useMemo(
    () => requests.filter((r) => selected.includes(r.id)),
    [requests, selected],
  );

  return (
    <div className="min-h-screen flex flex-col mq-page">
      <Navbar />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        <PageMeta title={t('myQuotes.pageTitle')} description={t('myQuotes.pageDescription')} />
        <h1 className="text-3xl font-bold tracking-tight">{t('myQuotes.title')}</h1>
        <p className="text-sm mt-1 text-muted">
          {t('myQuotes.intro')}
        </p>

        {loading ? (
          <p className="text-sm mt-6">{t('common.loading')}</p>
        ) : failed ? (
          <p role="alert" className="text-sm mt-6 text-red-300">{t('myQuotes.loadFailed')}</p>
        ) : requests.length === 0 ? (
          <div className="mt-6">
            <p className="text-sm text-muted">{t('myQuotes.empty')}</p>
            <Link to="/request-quote" className="text-sm text-orange-400 underline mt-2 inline-block">
              {t('myQuotes.requestQuote')}
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mt-6 mb-3">
              <button
                type="button"
                className="text-sm font-semibold px-3 py-2 rounded-lg border disabled:opacity-50"
                disabled={selected.length < 2 || comparing}
                onClick={() => setComparing(true)}
              >
                {t('myQuotes.compare', { count: selected.length })}
              </button>
              {comparing && (
                <button
                  type="button"
                  className="text-sm px-3 py-2 rounded-lg border"
                  onClick={() => { setComparing(false); setSelected([]); }}
                >
                  {t('myQuotes.clearComparison')}
                </button>
              )}
              <span className="text-xs text-muted">
                {t('myQuotes.selectHint')}
              </span>
            </div>

            {comparing && compared.length >= 2 ? (
              <section aria-label={t('myQuotes.comparisonTitle')} className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="mq-row">
                      <th className="text-left p-3 font-semibold">{t('myQuotes.compareField')}</th>
                      {compared.map((r) => (
                        <th key={r.id} className="text-left p-3 font-semibold">
                          {r.service_category || t('myQuotes.untitledRequest')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="mq-row">
                      <td className="p-3 text-muted">{t('myQuotes.services')}</td>
                      {compared.map((r) => (
                        <td key={r.id} className="p-3">
                          {(r.services || []).length
                            ? r.services.map((s) => s.serviceName).join(', ')
                            : (r.metadata?.catalogServices || []).map((s) => s.name).join(', ') || '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="mq-row">
                      <td className="p-3 text-muted">{t('myQuotes.amount')}</td>
                      {compared.map((r) => (
                        <td key={r.id} className="p-3 font-semibold">{fmtMoney(r.quote_amount_cents, r.quote_currency_code)}</td>
                      ))}
                    </tr>
                    <tr className="mq-row">
                      <td className="p-3 text-muted">{t('myQuotes.deadline')}</td>
                      {compared.map((r) => (
                        <td key={r.id} className="p-3">
                          {fmtDate(r.response_deadline, locale)}
                          {r.deadline_passed ? ` (${t('myQuotes.deadlinePassed')})` : ''}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="p-3 text-muted">{t('myQuotes.status')}</td>
                      {compared.map((r) => (
                        <td key={r.id} className="p-3">{r.status}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </section>
            ) : null}

            <ul className="space-y-3 mt-2">
              {requests.map((r) => (
                <li key={r.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={t('myQuotes.selectForComparison')}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{r.service_category || t('myQuotes.untitledRequest')}</h2>
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{r.status}</span>
                        {r.deadline_passed && (
                          <span className="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-300">
                            {t('myQuotes.deadlinePassed')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-1 text-muted">
                        {r.service_location} · {fmtDate(r.created_at, locale)}
                      </p>
                      {(r.services || []).length > 0 && (
                        <p className="text-sm mt-2">
                          {t('myQuotes.services')}: {r.services.map((s) => s.serviceName).join(', ')}
                        </p>
                      )}
                      <p className="text-sm mt-1">
                        {t('myQuotes.amount')}: <strong>{fmtMoney(r.quote_amount_cents, r.quote_currency_code)}</strong>
                        {' · '}{t('myQuotes.deadline')}: {fmtDate(r.response_deadline, locale)}
                      </p>
                    </div>
                    <Link
                      to={`/direct/quotes/${r.id}`}
                      className="text-sm text-orange-400 underline shrink-0"
                    >
                      {t('myQuotes.view')}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
