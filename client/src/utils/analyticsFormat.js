import { moneyMinor } from '../lib/moneyExact.js';

export function formatAnalyticsCell(key, value, row = {}, locale = 'en') {
  if (value == null) return '—';
  if (key.endsWith('_cents')) return moneyMinor(value, row.currency_code || row.currency, locale);
  if (key === 'bucket' && !Number.isNaN(new Date(value).getTime())) return new Date(value).toLocaleString(locale);
  if (key === 'repeat_order_rate') return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(Number(value));
  if (key.endsWith('_pct')) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value))}%`;
  return String(value);
}

export function analyticsCsv(rows, columns) {
  const escape = value => {
    let s = value == null ? '' : String(value);
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(escape).join(','), ...rows.map(row => columns.map(c => escape(row[c])).join(','))].join('\r\n');
}
