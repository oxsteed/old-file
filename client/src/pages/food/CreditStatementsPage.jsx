import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, FileText, LockKeyhole } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { listOxsteedCreditAccounts } from '../../api/oxsteedCredit';
import { listMyFoodRestaurantWallets } from '../../api/food';
import {
  getCreditStatement, downloadCreditStatement, previousStatementMonth,
  validStatementPeriod, isCompleteCreditStatement, STATEMENT_PAGE_SIZE,
} from '../../api/creditStatements';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { localizeCreditTransactionType } from '../../lib/creditStatus';
import SavedViews from '../../components/statements/SavedViews';
import PeriodTrends from '../../components/statements/PeriodTrends';
import './CreditStatementsPage.css';

// Complete five-locale catalogs are authoritative; English defaults provide
// a readable fallback if an optional locale chunk cannot be loaded.
export const STATEMENT_STRINGS = Object.freeze({
  title: 'Account statements',
  description: 'Review balances and posted activity, and download PDF or CSV statements.',
  link: 'Statements',
  archiveLink: 'Statement archive',
  back: 'Back to statement center',
  oxsteedProduct: 'OxSteed Credit',
  restaurantProduct: 'Restaurant Credit',
  scope: 'Each product and currency has its own statement. These are credit-account records, not bank deposit statements.',
  account: 'Account',
  accountOption: '{{name}} · {{currency}}',
  from: 'From',
  to: 'To',
  apply: 'Apply',
  periodHelp: 'Dates use UTC. Closed calendar months create immutable monthly documents on demand. Current or custom periods are interim reports.',
  invalidPeriod: 'Choose valid dates, with the end on or after the start and no later than today.',
  loadingAccounts: 'Loading credit accounts…',
  accountsError: 'Your credit accounts could not be loaded. Please try again.',
  retry: 'Try again',
  noAccounts: 'No credit accounts available',
  noAccountsBody: 'There are no accounts for this credit product to create a statement from.',
  ready: 'Choose an account and statement period',
  readyBody: 'Select Apply to generate or retrieve your statement.',
  loadingStatement: 'Preparing your statement…',
  statementError: 'The statement could not be loaded. Please try again or contact support.',
  unavailable: 'Statements are temporarily unavailable. Please try again later.',
  incomplete: 'This report is incomplete or too large to display safely. Choose a shorter period or contact support.',
  accountNotFound: 'This credit account is no longer available. Select another account or contact support.',
  beforeAccount: 'This period ends before your account was opened. Choose a more recent period, such as the current month.',
  integrityFailed: 'This statement could not be verified. It cannot be displayed or downloaded. Please contact support.',
  currentMonth: 'Use current month',
  support: 'Contact support',
  monthly: 'Monthly statement',
  interim: 'Interim report',
  monthlyNote: 'This closed-month document is immutable. Downloading it again retrieves the same statement.',
  interimNote: 'This current or custom-period report is provisional. Its contents may change as activity is posted.',
  period: '{{from}} – {{to}}',
  owner: 'Account holder',
  reference: 'Account reference',
  documentId: 'Statement ID',
  generated: 'Generated {{date}}',
  opening: 'Opening balance',
  credits: 'Total credits',
  debits: 'Total debits',
  closing: 'Closing balance',
  pdf: 'Download PDF',
  csv: 'Download CSV',
  downloading: 'Preparing download…',
  downloadError: 'The download failed. Try again, choose CSV, or contact support.',
  downloaded: 'Your statement download is ready.',
  activity: 'Posted activity',
  activityCount: '{{count}} transactions',
  noActivity: 'No posted activity in this period',
  date: 'Date (UTC)',
  transaction: 'Transaction',
  debit: 'Debit',
  credit: 'Credit',
  balance: 'Balance after',
  pagination: 'Statement transaction pages',
  page: 'Page {{page}} of {{pages}}',
  previous: 'Previous',
  next: 'Next',
  holds: 'Current pending holds',
  holdsNote: 'These are current pending holds, not historical holds for the statement period. They are not completed charges and do not change the statement closing balance.',
  holdsAsOf: 'Pending holds as of {{date}}',
  heldTotal: 'Currently held',
  noHolds: 'No current pending holds',
  expires: 'Expires {{date}}',
  notAvailable: 'Not available',
  contentHash: 'Document content hash',
});

function localizedDate(value, language, fallback) {
  if (!value) return fallback;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  }
}

const accountKey = (entry, product) => product === 'restaurant'
  ? `${entry.restaurantId}:${entry.currencyCode}` : entry.currencyCode;

// ── Advanced transaction filters + sorting (Group B) ─────────────────────
// Filters compose with AND and are reflected in the URL query string so a
// filtered/sorted view is shareable and can be stored as a saved view.
//
// Two of the five dimensions are client-side classifications, documented
// here because the statement entry shape ({id, date, type, description,
// debitCents, creditCents, balanceAfterCents}) carries no per-entry status
// or relationship fields:
// - status "reversed": entry types that represent reversals, refunds, or
//   chargebacks. Every entry on a statement is posted activity, so
//   "posted" matches everything by construction.
// - related: the record family the entry type belongs to (food orders are
//   the debit side of credit purchases; top-ups the credit side of loads).
const FILTER_URL_KEYS = { type: 'fType', minAmount: 'fMin', maxAmount: 'fMax', direction: 'fDir', status: 'fStatus', related: 'fRel' };
const SORT_URL_KEYS = { key: 'fSort', dir: 'fSortDir' };
const FILTER_DIRECTIONS = new Set(['debit', 'credit']);
const FILTER_STATUSES = new Set(['posted', 'reversed']);
const FILTER_RELATED = new Set(['order', 'payment', 'settlement', 'adjustment', 'refund']);
const SORT_KEYS = new Set(['date', 'description', 'debit', 'credit', 'balance']);
const REVERSAL_TYPES = new Set(['refund', 'settlement_reversal', 'sub_bank_load_reversal', 'sub_bank_payout_reversal', 'chargeback']);
const RELATED_TYPE_MAP = {
  purchase: 'order',
  load: 'payment', funding: 'payment', sub_bank_load: 'payment',
  settlement: 'settlement', media_creator_settlement: 'settlement', sub_bank_payout: 'settlement',
  adjustment: 'adjustment', sub_bank_opening_balance: 'adjustment',
  refund: 'refund', sub_bank_refund: 'refund',
};
const EMPTY_FILTERS = Object.freeze({ type: '', minAmount: '', maxAmount: '', direction: '', status: '', related: '' });
const DEFAULT_SORT = Object.freeze({ key: 'date', dir: 'asc' });

function readFiltersFromParams(params) {
  return {
    type: params.get(FILTER_URL_KEYS.type) || '',
    minAmount: params.get(FILTER_URL_KEYS.minAmount) || '',
    maxAmount: params.get(FILTER_URL_KEYS.maxAmount) || '',
    direction: FILTER_DIRECTIONS.has(params.get(FILTER_URL_KEYS.direction)) ? params.get(FILTER_URL_KEYS.direction) : '',
    status: FILTER_STATUSES.has(params.get(FILTER_URL_KEYS.status)) ? params.get(FILTER_URL_KEYS.status) : '',
    related: FILTER_RELATED.has(params.get(FILTER_URL_KEYS.related)) ? params.get(FILTER_URL_KEYS.related) : '',
  };
}

function readSortFromParams(params) {
  return {
    key: SORT_KEYS.has(params.get(SORT_URL_KEYS.key)) ? params.get(SORT_URL_KEYS.key) : DEFAULT_SORT.key,
    dir: params.get(SORT_URL_KEYS.dir) === 'desc' ? 'desc' : 'asc',
  };
}

function filtersActive(filters) {
  return Object.values(filters).some((value) => value !== '');
}

// Major-unit input ("25.50") to integer minor units. Returns null for
// invalid input so bad values never silently filter to zero.
function toMinorUnits(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0 || !/^\d+(\.\d{1,2})?$/.test(String(value).trim())) return null;
  return Math.round(parsed * 100);
}

function entryMatchesFilters(entry, filters) {
  if (filters.type && entry.type !== filters.type) return false;
  if (filters.direction === 'debit' && !(entry.debitCents > 0)) return false;
  if (filters.direction === 'credit' && !(entry.creditCents > 0)) return false;
  if (filters.status === 'reversed' && !REVERSAL_TYPES.has(entry.type)) return false;
  if (filters.related && RELATED_TYPE_MAP[entry.type] !== filters.related) return false;
  const amount = Math.max(Number(entry.debitCents) || 0, Number(entry.creditCents) || 0);
  const min = toMinorUnits(filters.minAmount);
  const max = toMinorUnits(filters.maxAmount);
  if (min !== null && amount < min) return false;
  if (max !== null && amount > max) return false;
  return true;
}

function compareEntries(a, b, key, dir) {
  let result = 0;
  if (key === 'date') result = Date.parse(a.date) - Date.parse(b.date);
  else if (key === 'description') result = String(a.description || '').localeCompare(String(b.description || ''));
  else if (key === 'debit') result = (a.debitCents || 0) - (b.debitCents || 0);
  else if (key === 'credit') result = (a.creditCents || 0) - (b.creditCents || 0);
  else result = (a.balanceAfterCents || 0) - (b.balanceAfterCents || 0);
  if (result === 0) result = String(a.id).localeCompare(String(b.id));
  return dir === 'desc' ? -result : result;
}

export default function CreditStatementsPage({ product = 'oxsteed' }) {
  const { t, i18n } = useTranslation('credit');
  const [searchParams, setSearchParams] = useSearchParams();
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const text = (key, options = {}) => t(`statements.${key}`, { defaultValue: STATEMENT_STRINGS[key], ...options });
  const [accounts, setAccounts] = useState({ product: null, entries: [], status: 'loading' });
  const [accountRetry, setAccountRetry] = useState(0);
  const [dates, setDates] = useState(previousStatementMonth);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [downloadState, setDownloadState] = useState(null);
  const [filters, setFilters] = useState(() => readFiltersFromParams(searchParams));
  const [sort, setSort] = useState(() => readSortFromParams(searchParams));
  const [draft, setDraft] = useState(() => readFiltersFromParams(searchParams));
  const [filterError, setFilterError] = useState(null);
  const requestRef = useRef(null);
  const downloadRef = useRef(null);
  const entries = accounts.product === product ? accounts.entries : [];
  const accountsLoading = accounts.product !== product || accounts.status === 'loading';
  const accountsFailed = accounts.product === product && accounts.status === 'error';
  const selected = entries.find(entry => (!searchParams.get('currencyCode') || entry.currencyCode === searchParams.get('currencyCode'))
    && (product !== 'restaurant' || !searchParams.get('restaurantId') || String(entry.restaurantId) === searchParams.get('restaurantId')))
    || entries[0];
  const identity = `${product}/${selected ? accountKey(selected, product) : ''}/${language}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const statement = report?.identity === identity ? report.statement : null;
  const root = product === 'restaurant' ? '/restaurant-credit' : '/oxsteed-credit';

  useEffect(() => {
    let active = true;
    setAccounts({ product, entries: [], status: 'loading' });
    const list = product === 'restaurant' ? listMyFoodRestaurantWallets : listOxsteedCreditAccounts;
    list().then(result => {
      if (!active) return;
      if (!Array.isArray(result)) throw new Error('Invalid account response');
      const seen = new Set();
      const valid = result.filter(entry => {
        if (!entry || !/^[A-Z]{3}$/.test(entry.currencyCode || '') || (product === 'restaurant' && !entry.restaurantId)) return false;
        const key = accountKey(entry, product);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setAccounts({ product, entries: valid, status: 'ready' });
    }).catch(() => { if (active) setAccounts({ product, entries: [], status: 'error' }); });
    return () => { active = false; };
  }, [product, accountRetry]);

  // The render identity also hides stale records before this effect runs.
  useEffect(() => {
    requestRef.current?.abort();
    downloadRef.current?.abort();
    setReport(null);
    setLoading(false);
    setError(null);
    setDownloadState(null);
    setPage(0);
    return () => {
      requestRef.current?.abort();
      downloadRef.current?.abort();
    };
  }, [identity]);

  // Keep filter/sort state in sync with the URL so views are shareable and
  // the browser back/forward buttons restore them.
  useEffect(() => {
    setFilters(readFiltersFromParams(searchParams));
    setSort(readSortFromParams(searchParams));
    setDraft(readFiltersFromParams(searchParams));
    setFilterError(null);
    setPage(0);
  }, [searchParams]);

  function writeViewToUrl(nextFilters, nextSort) {
    const next = new URLSearchParams(searchParams);
    const entries = [
      [FILTER_URL_KEYS.type, nextFilters.type],
      [FILTER_URL_KEYS.minAmount, nextFilters.minAmount],
      [FILTER_URL_KEYS.maxAmount, nextFilters.maxAmount],
      [FILTER_URL_KEYS.direction, nextFilters.direction],
      [FILTER_URL_KEYS.status, nextFilters.status],
      [FILTER_URL_KEYS.related, nextFilters.related],
      [SORT_URL_KEYS.key, nextSort.key],
      [SORT_URL_KEYS.dir, nextSort.dir],
    ];
    for (const [key, value] of entries) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setSearchParams(next);
  }

  function applyDraft(event) {
    event?.preventDefault();
    const invalid = (draft.minAmount !== '' && toMinorUnits(draft.minAmount) === null)
      || (draft.maxAmount !== '' && toMinorUnits(draft.maxAmount) === null);
    if (invalid) {
      setFilterError('filters.invalidAmount');
      return;
    }
    setFilterError(null);
    setFilters(draft);
    writeViewToUrl(draft, sort);
    setPage(0);
  }

  function clearFilters() {
    setDraft({ ...EMPTY_FILTERS });
    setFilters({ ...EMPTY_FILTERS });
    setFilterError(null);
    writeViewToUrl(EMPTY_FILTERS, sort);
    setPage(0);
  }

  function toggleSort(key) {
    const next = sort.key === key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' };
    setSort(next);
    writeViewToUrl(filters, next);
    setPage(0);
  }

  function applySavedView(view) {
    const nextFilters = { ...EMPTY_FILTERS, ...(view.filters || {}) };
    const clean = readFiltersFromParams(new URLSearchParams(Object.entries(nextFilters)
      .filter(([, value]) => value !== '' && value != null)
      .map(([filterKey, value]) => [FILTER_URL_KEYS[filterKey] || filterKey, String(value)])));
    const nextSort = {
      key: SORT_KEYS.has(view.sort?.key) ? view.sort.key : DEFAULT_SORT.key,
      dir: view.sort?.dir === 'desc' ? 'desc' : 'asc',
    };
    setFilters(clean);
    setDraft(clean);
    setSort(nextSort);
    setFilterError(null);
    writeViewToUrl(clean, nextSort);
    setPage(0);
  }

  function changeAccount(event) {
    requestRef.current?.abort();
    downloadRef.current?.abort();
    const entry = entries.find(item => accountKey(item, product) === event.target.value);
    if (!entry) return;
    setReport(null);
    const next = new URLSearchParams(searchParams);
    next.set('currencyCode', entry.currencyCode);
    if (product === 'restaurant') next.set('restaurantId', String(entry.restaurantId));
    else next.delete('restaurantId');
    setSearchParams(next);
  }

  async function apply(event) {
    event?.preventDefault();
    if (!selected) return;
    if (!validStatementPeriod(dates.from, dates.to)) {
      setError('invalidPeriod');
      return;
    }
    requestRef.current?.abort();
    downloadRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestIdentity = identity;
    const current = () => !controller.signal.aborted && identityRef.current === requestIdentity && requestRef.current === controller;
    const params = { ...dates, currencyCode: selected.currencyCode, language };
    setLoading(true);
    setReport(null);
    setError(null);
    setDownloadState(null);
    setPage(0);
    try {
      const result = await getCreditStatement(product, selected.restaurantId, params, { signal: controller.signal });
      if (!current()) return;
      if (!isCompleteCreditStatement(result, params, product)) {
        setError('incomplete');
        return;
      }
      setReport({ identity: requestIdentity, statement: result, params });
    } catch (failure) {
      if (current()) {
        const code = failure.response?.data?.error?.code || failure.response?.data?.code;
        const mapped = {
          statement_invalid_period: 'invalidPeriod',
          statement_account_not_found: 'accountNotFound',
          statement_before_account: 'beforeAccount',
          statement_integrity_failed: 'integrityFailed',
          statement_export_too_large: 'incomplete',
        }[code];
        setError(mapped || ([404, 501, 503].includes(failure.response?.status) ? 'unavailable' : 'statementError'));
      }
    } finally {
      if (current()) setLoading(false);
    }
  }

  async function download(format) {
    if (!statement || !selected || downloadRef.current && !downloadRef.current.signal.aborted && downloadState === 'busy') return;
    const controller = new AbortController();
    downloadRef.current = controller;
    const requestIdentity = identity;
    const current = () => !controller.signal.aborted && identityRef.current === requestIdentity && downloadRef.current === controller;
    setDownloadState('busy');
    try {
      // Applied dates, never the unsubmitted form values, identify this report.
      const response = await downloadCreditStatement(product, selected.restaurantId, format, report.params, { signal: controller.signal });
      if (!current()) return;
      const blob = response.data;
      const contentType = String(response.headers?.['content-type'] || blob?.type || '').split(';')[0].trim().toLowerCase();
      if (!(blob instanceof Blob) || !blob.size || (format === 'pdf' ? contentType !== 'application/pdf' : !['text/csv', 'application/csv'].includes(contentType))) {
        throw new Error('Invalid statement download');
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${product}-statement-${report.params.from}-${report.params.to}-${statement.currencyCode}.${format}`;
      document.body.appendChild(link);
      try { link.click(); } finally {
        link.remove();
        // Give the browser time to consume the local URL, then release it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setDownloadState('done');
    } catch {
      if (current()) setDownloadState('error');
    }
  }

  const money = amount => formatStatementMoney(amount, statement?.currencyCode || selected?.currencyCode, language);
  const date = value => localizedDate(value, language, text('notAvailable'));
  const timestamp = value => formatCreditDateTime(value, text('notAvailable'), language);
  const activeFilter = filtersActive(filters);
  const filteredTransactions = (statement?.transactions || []).filter(entry => entryMatchesFilters(entry, filters));
  const sortedTransactions = [...filteredTransactions].sort((a, b) => compareEntries(a, b, sort.key, sort.dir));
  const pageCount = Math.max(1, Math.ceil(sortedTransactions.length / STATEMENT_PAGE_SIZE));
  const rows = sortedTransactions.slice(page * STATEMENT_PAGE_SIZE, (page + 1) * STATEMENT_PAGE_SIZE) || [];
  const availableTypes = [...new Set((statement?.transactions || []).map(entry => entry.type))].sort();
  const sortColumns = [
    { key: 'date', label: text('date') },
    { key: 'description', label: text('transaction') },
    { key: 'debit', label: text('debit') },
    { key: 'credit', label: text('credit') },
    { key: 'balance', label: text('balance') },
  ];

  return <div className="credit-statements-shell" dir={i18n.dir(language)}>
    <PageMeta title={text('title')} description={text('description')} noIndex />
    <Navbar />
    <main className="credit-statements-page">
      <Link to="/statements" className="cs-back"><ArrowLeft size={16} aria-hidden="true" />{text('back')}</Link>
      <header className="cs-header"><FileText size={30} aria-hidden="true" /><div><h1>{text('title')}</h1><p>{text('description')}</p></div></header>
      <p className="cs-scope">{text('scope')}</p>
      <p className="cs-archive-link"><Link to={`${root}/statements/archive`}>{text('archiveLink')}</Link></p>
      {accountsLoading ? <div className="cs-state" role="status">{text('loadingAccounts')}</div>
        : accountsFailed ? <div className="cs-state" role="alert"><p>{text('accountsError')}</p><button type="button" onClick={() => setAccountRetry(value => value + 1)}>{text('retry')}</button></div>
          : !entries.length ? <div className="cs-state" role="status"><h2>{text('noAccounts')}</h2><p>{text('noAccountsBody')}</p><Link to="/statements">{text('back')}</Link></div>
            : <>
              <form className="cs-filters" onSubmit={apply}>
                <div className="cs-field"><label htmlFor="statement-account">{text('account')}</label><select id="statement-account" value={accountKey(selected, product)} onChange={changeAccount}>
                  {entries.map(entry => <option key={accountKey(entry, product)} value={accountKey(entry, product)}>{text('accountOption', { name: product === 'restaurant' ? entry.restaurantName || text('restaurantProduct') : text('oxsteedProduct'), currency: entry.currencyCode })}</option>)}
                </select></div>
                <div className="cs-field"><label htmlFor="statement-from">{text('from')}</label><input id="statement-from" type="date" value={dates.from} onChange={event => setDates(current => ({ ...current, from: event.target.value }))} max={new Date().toISOString().slice(0, 10)} required aria-describedby="statement-period-help" /></div>
                <div className="cs-field"><label htmlFor="statement-to">{text('to')}</label><input id="statement-to" type="date" value={dates.to} onChange={event => setDates(current => ({ ...current, to: event.target.value }))} max={new Date().toISOString().slice(0, 10)} required aria-describedby="statement-period-help" /></div>
                <button type="submit" className="cs-primary" disabled={loading}>{text('apply')}</button>
                <p id="statement-period-help">{text('periodHelp')}</p>
                <button type="button" onClick={() => { const today = new Date().toISOString().slice(0, 10); setDates({ from: `${today.slice(0, 7)}-01`, to: today }); }}>{text('currentMonth')}</button>
              </form>
              {error && <div className="cs-error" role="alert"><p>{text(error)}</p>{error !== 'invalidPeriod' && <button type="button" onClick={apply} disabled={loading}>{text('retry')}</button>}<Link to="/support/escalation">{text('support')}</Link></div>}
              <div aria-busy={loading}>
                {loading ? <div className="cs-state" role="status">{text('loadingStatement')}</div>
                  : !statement ? !error && <div className="cs-state" role="status"><h2>{text('ready')}</h2><p>{text('readyBody')}</p></div>
                    : <>
                      <section className="cs-document" aria-labelledby="statement-document-heading">
                        <div className="cs-document-header"><div><span className="cs-kind">{statement.kind === 'monthly' && <LockKeyhole size={14} aria-hidden="true" />}{text(statement.kind)}</span><h2 id="statement-document-heading">{statement.accountLabel || text(product === 'restaurant' ? 'restaurantProduct' : 'oxsteedProduct')}</h2><p>{text('period', { from: date(statement.period.from), to: date(statement.period.to) })}</p></div>
                          <div className="cs-downloads"><button type="button" onClick={() => download('pdf')} disabled={downloadState === 'busy'}><Download size={16} aria-hidden="true" />{text('pdf')}</button><button type="button" onClick={() => download('csv')} disabled={downloadState === 'busy'}>{text('csv')}</button></div>
                        </div>
                        <p>{text(statement.kind === 'monthly' ? 'monthlyNote' : 'interimNote')}</p>
                        <dl className="cs-identifiers"><div><dt>{text('owner')}</dt><dd><bdi>{statement.ownerName || text('notAvailable')}</bdi></dd></div><div><dt>{text('reference')}</dt><dd><bdi>{statement.accountReference || text('notAvailable')}</bdi></dd></div><div><dt>{text('documentId')}</dt><dd><bdi>{statement.id}</bdi></dd></div></dl>
                        <p className="cs-meta">{text('generated', { date: timestamp(statement.generatedAt) })}</p>
                        <dl className="cs-balances">{[['opening', statement.openingBalanceCents], ['credits', statement.totalCreditsCents], ['debits', statement.totalDebitsCents], ['closing', statement.closingBalanceCents]].map(([key, amount]) => <div key={key}><dt>{text(key)}</dt><dd><bdi>{money(amount)}</bdi></dd></div>)}</dl>
                        {downloadState && <p role={downloadState === 'error' ? 'alert' : 'status'}>{text(downloadState === 'busy' ? 'downloading' : downloadState === 'error' ? 'downloadError' : 'downloaded')}</p>}
                        {statement.contentHash && <details className="cs-hash"><summary>{text('contentHash')}</summary><code dir="ltr">{statement.contentHash}</code></details>}
                      </section>
                      <section className="cs-activity" aria-labelledby="statement-activity-heading"><h2 id="statement-activity-heading">{text('activity')}</h2><p>{activeFilter ? t('statements.filters.matching', { count: filteredTransactions.length, total: statement.transactionCount }) : text('activityCount', { count: statement.transactionCount })}</p>
                        <SavedViews product={product} getCurrentView={() => ({ filters: { ...filters }, sort: { ...sort } })} onApply={applySavedView} />
                        <form className="cs-advanced-filters" onSubmit={applyDraft}>
                          <h3>{t('statements.filters.title')}</h3>
                          <div className="cs-advanced-grid">
                            <div className="cs-field"><label htmlFor="statement-filter-type">{t('statements.filters.activityType')}</label><select id="statement-filter-type" value={draft.type} onChange={event => setDraft(current => ({ ...current, type: event.target.value }))}>
                              <option value="">{t('statements.filters.allTypes')}</option>
                              {availableTypes.map(type => <option key={type} value={type}>{['debit', 'credit'].includes(type) ? text(type) : localizeCreditTransactionType(type, t)}</option>)}
                            </select></div>
                            <div className="cs-field"><label htmlFor="statement-filter-min">{t('statements.filters.minAmount')}</label><input id="statement-filter-min" type="text" inputMode="decimal" value={draft.minAmount} onChange={event => setDraft(current => ({ ...current, minAmount: event.target.value }))} placeholder="0.00" /></div>
                            <div className="cs-field"><label htmlFor="statement-filter-max">{t('statements.filters.maxAmount')}</label><input id="statement-filter-max" type="text" inputMode="decimal" value={draft.maxAmount} onChange={event => setDraft(current => ({ ...current, maxAmount: event.target.value }))} placeholder="0.00" /></div>
                            <div className="cs-field"><label htmlFor="statement-filter-direction">{t('statements.filters.direction')}</label><select id="statement-filter-direction" value={draft.direction} onChange={event => setDraft(current => ({ ...current, direction: event.target.value }))}>
                              <option value="">{t('statements.filters.allDirections')}</option>
                              <option value="debit">{t('statements.filters.debitsOnly')}</option>
                              <option value="credit">{t('statements.filters.creditsOnly')}</option>
                            </select></div>
                            <div className="cs-field"><label htmlFor="statement-filter-status">{t('statements.filters.status')}</label><select id="statement-filter-status" value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}>
                              <option value="">{t('statements.filters.allStatuses')}</option>
                              <option value="posted">{t('statements.filters.posted')}</option>
                              <option value="reversed">{t('statements.filters.reversed')}</option>
                            </select></div>
                            <div className="cs-field"><label htmlFor="statement-filter-related">{t('statements.filters.related')}</label><select id="statement-filter-related" value={draft.related} onChange={event => setDraft(current => ({ ...current, related: event.target.value }))}>
                              <option value="">{t('statements.filters.allRelated')}</option>
                              <option value="order">{t('statements.filters.relatedOrder')}</option>
                              <option value="payment">{t('statements.filters.relatedPayment')}</option>
                              <option value="settlement">{t('statements.filters.relatedSettlement')}</option>
                              <option value="adjustment">{t('statements.filters.relatedAdjustment')}</option>
                              <option value="refund">{t('statements.filters.relatedRefund')}</option>
                            </select></div>
                          </div>
                          {filterError && <p role="alert" className="cs-filter-error">{t(`statements.${filterError}`)}</p>}
                          <div className="cs-advanced-actions">
                            <button type="submit" className="cs-primary">{t('statements.filters.apply')}</button>
                            <button type="button" onClick={clearFilters}>{t('statements.filters.clear')}</button>
                          </div>
                        </form>
                        {!statement.transactions.length ? <p className="cs-state">{text('noActivity')}</p> : <>
                          <div className="cs-table-scroll" role="region" aria-labelledby="statement-activity-heading" tabIndex={0}>
                            <table><caption className="cs-sr-only">{text('activity')}</caption><thead><tr>{sortColumns.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                              <button
                                type="button"
                                className="cs-sort-th"
                                onClick={() => toggleSort(column.key)}
                                aria-label={`${column.label} (${t(`statements.sort.${sort.key === column.key && sort.dir === 'desc' ? 'ascending' : 'descending'}`)})`}
                              >
                                {column.label}<span aria-hidden="true">{sort.key === column.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                              </button>
                            </th>)}</tr></thead><tbody>{rows.map(entry => <tr key={entry.id}><td><time dateTime={entry.date}>{date(entry.date)}</time></td><td><strong>{['debit', 'credit'].includes(entry.type) ? text(entry.type) : localizeCreditTransactionType(entry.type, t)}</strong>{entry.description && <span><bdi>{entry.description}</bdi></span>}<small><bdi>{entry.id}</bdi></small></td><td><bdi>{money(entry.debitCents)}</bdi></td><td><bdi>{money(entry.creditCents)}</bdi></td><td><bdi>{money(entry.balanceAfterCents)}</bdi></td></tr>)}</tbody></table>
                          </div>
                          <nav className="cs-pagination" aria-label={text('pagination')}><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{text('previous')}</button><span aria-live="polite" aria-atomic="true">{text('page', { page: page + 1, pages: pageCount })}</span><button type="button" disabled={page >= pageCount - 1} onClick={() => setPage(value => value + 1)}>{text('next')}</button></nav>
                        </>}
                      </section>
                      <PeriodTrends product={product} accountId={accountKey(selected, product)} />
                      {statement.holdsAsOf && <section className="cs-holds" aria-labelledby="statement-holds-heading"><h2 id="statement-holds-heading">{text('holds')}</h2><p>{text('holdsNote')}</p><p>{text('holdsAsOf', { date: timestamp(statement.holdsAsOf) })}</p><dl><dt>{text('heldTotal')}</dt><dd><bdi>{money(statement.totalHeldCents)}</bdi></dd></dl>
                        {!statement.holds.length ? <p>{text('noHolds')}</p> : <ul>{statement.holds.map(hold => <li key={hold.id}><bdi>{money(hold.amountCents)}</bdi><span>{text('expires', { date: timestamp(hold.expiresAt) })}</span></li>)}</ul>}
                      </section>}
                    </>}
              </div>
            </>}
    </main>
    <Footer />
  </div>;
}
