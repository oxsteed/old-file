import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../lib/adminApi';

// D21: Amazon Associates operations. Search the Product Advertising API,
// pin a draft Amazon offer to one ASIN (the server re-reads the item; the
// browser value is never trusted), and import tracking-ID reports. Amazon
// offers go out in-app and by push only, never by email.
const input =
  'w-full rounded border border-gray-300 bg-white p-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const button = 'rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50';

export default function AmazonAssociatesPanel({ canPartners }) {
  const { t } = useTranslation();
  const label = (key, opts) => t(`growthInsights.amazon.${key}`, opts);
  const [status, setStatus] = useState(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [offerId, setOfferId] = useState('');
  const [report, setReport] = useState({ report_ref: '', period_start: '', period_end: '', currency: 'USD', csv: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/growth/amazon/status').then((r) => setStatus(r.data)).catch(() => setStatus({ configured: false, partners: [] }));
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e?.response?.data?.code || e?.response?.data?.error || 'error');
    } finally {
      setBusy(false);
    }
  };

  const search = () => run(async () => {
    const { data } = await api.get('/admin/growth/amazon/search', { params: { q: query } });
    setItems(data.items || []);
  });
  const pin = (asin) => run(async () => {
    const { data } = await api.post(`/admin/growth/amazon/offers/${encodeURIComponent(offerId)}/item`, { asin });
    setMessage(label('pinned', { asin: data.asin, offer: data.offer_id }));
  });
  const importReport = () => run(async () => {
    const { data } = await api.post('/admin/growth/amazon/reports', {
      ...report,
      period_start: report.period_start || null,
      period_end: report.period_end || null,
    });
    setMessage(data.duplicate ? label('reportDuplicate') : label('reportImported', { tags: data.tags, mapped: data.mapped }));
  });
  const readFile = (file) => {
    if (!file) return;
    file.text().then((text) => setReport((r) => ({ ...r, csv: text })));
  };

  if (!status) return <p role="status">{t('growthInsights.loading')}</p>;
  return (
    <section className="space-y-4" aria-labelledby="amazon-associates-heading">
      <h2 id="amazon-associates-heading" className="text-lg font-medium">{label('title')}</h2>
      <p className="text-sm">{label('channelsNote')}</p>
      {!status.configured && <p role="status">{label('notConfigured')}</p>}
      {status.disclosure && <p className="text-sm italic">{label('disclosureHint', { text: status.disclosure })}</p>}
      {error && <p role="alert">{label('error', { code: error })}</p>}
      {message && <p role="status">{message}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1">
          <span className="block text-sm">{label('search')}</span>
          <input className={input} value={query} maxLength={120} onChange={(e) => setQuery(e.target.value)} data-track="growth_amazon_search_input" />
        </label>
        <button type="button" className={button} disabled={busy || !status.configured || !query.trim()} onClick={search} data-track="growth_amazon_search">
          {label('searchButton')}
        </button>
      </div>
      <label className="block max-w-xs">
        <span className="block text-sm">{label('draftOffer')}</span>
        <input className={input} inputMode="numeric" value={offerId} onChange={(e) => setOfferId(e.target.value.replace(/\D/g, ''))} data-track="growth_amazon_offer_id" />
      </label>
      {items.length > 0 && (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {items.map((item) => (
            <li key={item.asin} className="flex flex-wrap items-center gap-3 py-2">
              <span className="flex-1"><bdi>{item.title}</bdi> <span className="text-sm text-gray-600 dark:text-gray-400">({item.asin}{item.price != null ? ` · ${item.price} ${item.currency || ''}` : ''})</span></span>
              <button type="button" className={button} disabled={busy || !offerId} onClick={() => pin(item.asin)} data-track="growth_amazon_pin">
                {label('pin')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {canPartners && (
        <div className="space-y-3">
          <h3 className="font-medium">{label('reportTitle')}</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <label><span className="block text-sm">{label('reportRef')}</span>
              <input className={input} value={report.report_ref} onChange={(e) => setReport({ ...report, report_ref: e.target.value })} data-track="growth_amazon_report_ref" /></label>
            <label><span className="block text-sm">{label('periodStart')}</span>
              <input type="date" className={input} value={report.period_start} onChange={(e) => setReport({ ...report, period_start: e.target.value })} data-track="growth_amazon_report_start" /></label>
            <label><span className="block text-sm">{label('periodEnd')}</span>
              <input type="date" className={input} value={report.period_end} onChange={(e) => setReport({ ...report, period_end: e.target.value })} data-track="growth_amazon_report_end" /></label>
            <label><span className="block text-sm">{label('currency')}</span>
              <input className={input} maxLength={3} value={report.currency} onChange={(e) => setReport({ ...report, currency: e.target.value.toUpperCase() })} data-track="growth_amazon_report_currency" /></label>
          </div>
          <label className="block"><span className="block text-sm">{label('reportFile')}</span>
            <input type="file" accept=".txt,.tsv,.csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} data-track="growth_amazon_report_file" /></label>
          <button type="button" className={button} disabled={busy || !report.csv || !report.report_ref} onClick={importReport} data-track="growth_amazon_report_import">
            {label('importReport')}
          </button>
        </div>
      )}
    </section>
  );
}
