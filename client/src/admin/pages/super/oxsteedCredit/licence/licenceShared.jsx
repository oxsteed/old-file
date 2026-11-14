// Building blocks for the Credit licence-readiness admin page
// (/api/admin/super/credit-licence). Every state change that matters is a
// two-administrator oversight action: one admin requests it here, a
// different admin approves it with a fresh step-up code.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../../lib/creditErrors';
import { formatCreditMinorUnits } from '../../../../../lib/creditCurrency';
import { dateTime } from '../shared';

export const LICENCE_API = '/admin/super/credit-licence';

export function newKey() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

/** GET a licence endpoint; reload() refetches. Late responses are dropped. */
export function useLicenceGet(path, params) {
  const { t } = useTranslation('credit');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const paramsKey = JSON.stringify(params || {});
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const { data: body } = await adminApi.get(`${LICENCE_API}${path}`, { params: JSON.parse(paramsKey) });
      if (mine === seq.current) { setData(body); setError(''); }
    } catch (err) {
      if (mine === seq.current) setError(safeCreditErrorMessage(err, t('adminLicence.loadFailed')));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path, paramsKey, t]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

/** Shared notice/error state plus a guarded runner for mutations. */
export function useLicenceAction() {
  const { t } = useTranslation('credit');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const run = useCallback(async (fn, successKey) => {
    setBusy(true); setNotice(''); setError('');
    try {
      const result = await fn();
      if (successKey) setNotice(t(successKey));
      return result;
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminLicence.actionFailed')));
      return null;
    } finally { setBusy(false); }
  }, [t]);
  return { busy, notice, error, setNotice, setError, run };
}

/** Request a two-admin oversight action. A different admin approves it. */
export async function requestOversight(actionType, payload) {
  const { data } = await adminApi.post(`${LICENCE_API}/oversight-actions`, { actionType, payload }, { headers: { 'Idempotency-Key': newKey() } });
  return data;
}

export async function downloadLicenceFile(path, filename, params) {
  const response = await adminApi.get(`${LICENCE_API}${path}`, { params, responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Notices({ notice, error }) {
  return (
    <>
      {notice && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
    </>
  );
}

export function Panel({ title, detail, actions, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111318] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          {detail && <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export function ActionButton({ onClick, disabled, children, tone = 'default', type = 'button' }) {
  const tones = {
    default: 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800',
    primary: 'border-transparent bg-orange-600 text-white hover:bg-orange-500',
    danger: 'border-red-500/40 text-red-300 hover:bg-red-500/10',
  };
  return <button type={type} onClick={onClick} disabled={disabled} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${tones[tone]}`}>{children}</button>;
}

export function Field({ label, children }) {
  return <label className="block text-xs font-semibold text-gray-500"><span className="mb-1 block">{label}</span>{children}</label>;
}

export const inputClass = 'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white';

/** Render one cell value safely: dates, money, booleans, arrays, objects. */
export function cellValue(value, column, row) {
  if (column.render) return column.render(value, row);
  if (value === null || value === undefined || value === '') return '—';
  if (column.kind === 'date') return dateTime(value);
  if (column.kind === 'money') return formatCreditMinorUnits(Number(value), row[column.currencyKey || 'currency'] || row.currency_code || 'USD');
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * A table with translated column headings (adminLicence.col.*). Cells are
 * text only: identifiers and codes render LTR inside RTL layouts.
 * Domain 7 #13: never show the empty text while a load is in flight or after
 * a failed load. While loading, show a loading state; on error, show the
 * error; the empty text renders only once loading is done with no error.
 */
export function LicenceTable({ rows, columns, actions, empty, loading, error }) {
  const { t } = useTranslation('credit');
  if (loading) return <p role="status" className="text-sm text-gray-500">{t('adminLoading')}</p>;
  if (error) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (!rows || rows.length === 0) return <p className="text-sm text-gray-500">{empty || t('adminLicence.empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-start text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500">
            {columns.map((c) => <th key={c.key} scope="col" className="px-2 py-2 text-start font-semibold">{t(`adminLicence.col.${c.label || c.key}`)}</th>)}
            {actions && <th scope="col" className="px-2 py-2 text-start font-semibold">{t('adminLicence.col.actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || `${index}`} className="border-b border-gray-100 dark:border-gray-900 align-top text-gray-800 dark:text-gray-200">
              {columns.map((c) => <td key={c.key} className="px-2 py-2"><bdi>{cellValue(row[c.key], c, row)}</bdi></td>)}
              {actions && <td className="px-2 py-2"><div className="flex flex-wrap gap-1.5">{actions(row)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
