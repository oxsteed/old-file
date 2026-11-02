import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, RotateCcw } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { formatCreditDateTime } from '../../../lib/creditDateTime';
import { formatCreditMinorUnits } from '../../../lib/creditCurrency';
import { safeCreditErrorMessage } from '../../../lib/creditErrors';

const PAGE_LIMIT = 100;

function money(cents, currency) {
  return formatCreditMinorUnits(cents, currency || 'USD');
}

function dateTime(value, t) {
  return formatCreditDateTime(value, value ? t('adminCreditBackfill.unknownDate') : t('adminCreditBackfill.notAvailable'), t.lng);
}

export default function OxsteedCreditBackfill({ busy = false }) {
  const { t } = useTranslation('credit');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [confirmMode, setConfirmMode] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/backfill/parked', { params: { limit: PAGE_LIMIT } });
      setRows(response.data?.rows || []);
      setSelected(new Set());
      setConfirmMode(null);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCreditBackfill.loadError')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === rows.length && rows.length > 0) return new Set();
      return new Set(rows.map((row) => String(row.id)));
    });
  };

  const confirmRequeue = async () => {
    if (!confirmMode) return;
    const ids = confirmMode === 'selected' ? [...selected] : null;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/backfill/requeue', { ids });
      const requeued = response.data?.requeued ?? 0;
      setNotice(t('adminCreditBackfill.requeued', { count: requeued }));
      setConfirmMode(null);
      await load();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCreditBackfill.requeueError')));
    } finally {
      setSaving(false);
    }
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return <div className="space-y-6">
    {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
    {notice && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>}

    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111318] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminCreditBackfill.eyebrow')}</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{t('adminCreditBackfill.title')}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{t('adminCreditBackfill.description')}</p>
        </div>
        <button type="button" onClick={load} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />{t('adminCreditBackfill.refresh')}</button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setConfirmMode('selected')} disabled={loading || saving || busy || selected.size === 0} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{t('adminCreditBackfill.requeueSelected', { count: selected.size })}</button>
        <button type="button" onClick={() => setConfirmMode('all')} disabled={loading || saving || busy || rows.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{t('adminCreditBackfill.requeueAll')}</button>
        <span className="text-xs text-gray-500">{t('adminCreditBackfill.selectedCount', { selected: selected.size, total: rows.length })}</span>
      </div>

      {confirmMode && <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
        <p className="text-xs text-amber-200">{confirmMode === 'selected' ? t('adminCreditBackfill.confirmSelected', { count: selected.size }) : t('adminCreditBackfill.confirmAll', { count: rows.length })}</p>
        <p className="mt-1 text-[11px] leading-4 text-gray-500">{t('adminCreditBackfill.confirmDetail')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={confirmRequeue} disabled={saving || busy} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{t('adminCreditBackfill.confirmRequeue')}</button>
          <button type="button" onClick={() => setConfirmMode(null)} disabled={saving || busy} className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">{t('adminCreditBackfill.cancel')}</button>
        </div>
      </div>}

      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        {loading ? <div className="py-14 text-center text-sm text-gray-500">{t('adminCreditBackfill.loading')}</div> : (
          <table className="min-w-[1080px] w-full text-left text-xs">
            <thead className="bg-gray-50/70 dark:bg-gray-950/70 text-gray-500">
              <tr>
                <th className="px-3 py-3 font-medium"><input type="checkbox" aria-label={t('adminCreditBackfill.selectAll')} checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} className="h-4 w-4 accent-emerald-600" /></th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.rowId')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.ledgerEntry')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.restaurant')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.entryType')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.referenceType')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.amount')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.attempts')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.lastError')}</th>
                <th className="px-3 py-3 font-medium">{t('adminCreditBackfill.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {!rows.length ? <tr><td colSpan="10" className="px-3 py-10 text-center text-gray-500">{t('adminCreditBackfill.noRows')}</td></tr> :
                rows.map((row) => {
                  const key = String(row.id);
                  return <tr key={key}>
                    <td className="px-3 py-3"><input type="checkbox" aria-label={t('adminCreditBackfill.selectRow', { id: key })} checked={selected.has(key)} onChange={() => toggleRow(row.id)} className="h-4 w-4 accent-emerald-600" /></td>
                    <td className="px-3 py-3 font-mono text-[10px] text-gray-600">{key}</td>
                    <td className="px-3 py-3 font-mono text-[10px] text-gray-600">{row.ledger_entry_id || row.ledgerEntryId || t('adminCreditBackfill.notAvailable')}</td>
                    <td className="px-3 py-3 font-mono text-[10px] text-gray-600">{row.restaurant_id || row.restaurantId || t('adminCreditBackfill.notAvailable')}</td>
                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{row.entry_type || row.entryType || t('adminCreditBackfill.notAvailable')}</td>
                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{row.reference_type || row.referenceType || t('adminCreditBackfill.notAvailable')}</td>
                    <td className="px-3 py-3 font-semibold text-gray-900 dark:text-white">{money(row.amount_cents ?? row.amountCents, row.currency_code || row.currencyCode)}</td>
                    <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{row.attempts ?? 0}</td>
                    <td className="max-w-[320px] px-3 py-3 text-[11px] leading-4 text-red-300">{row.last_error || row.lastError || t('adminCreditBackfill.notAvailable')}</td>
                    <td className="px-3 py-3 text-gray-500">{dateTime(row.created_at || row.createdAt, t)}</td>
                  </tr>;
                })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  </div>;
}
