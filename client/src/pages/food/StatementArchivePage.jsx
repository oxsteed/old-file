import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, Download, FileText, Link2, LockKeyhole, RefreshCw } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { listOxsteedCreditAccounts } from '../../api/oxsteedCredit';
import { listMyFoodRestaurantWallets } from '../../api/food';
import {
  listArchive, getArchiveDocument, downloadArchiveDocument, getArchiveDownloadLink,
  listStatementScopes,
} from '../../api/creditStatements';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import { STATEMENT_PRODUCTS, statementAccessiblePath } from '../../lib/statementProducts';
import StatementExportPanel from './StatementExportPanel';
import './StatementArchivePage.css';

// Complete five-locale catalogs are authoritative; English defaults provide
// a readable fallback if an optional locale chunk cannot be loaded.
export const ARCHIVE_STRINGS = Object.freeze({
  title: 'Statement archive',
  description: 'Your issued monthly statements. Originals are immutable; download them again at any time.',
  back: 'Back to statements',
  product: 'Product',
  oxsteedProduct: 'OxSteed Credit',
  restaurantProduct: 'Restaurant Credit',
  account: 'Account',
  allAccounts: 'All accounts',
  accountOption: '{{name}} · {{currency}}',
  currency: 'Currency',
  allCurrencies: 'All currencies',
  year: 'Year',
  allYears: 'All years',
  month: 'Month',
  allMonths: 'All months',
  refresh: 'Refresh',
  loading: 'Loading your statement archive…',
  loadError: 'The archive could not be loaded. Please try again.',
  retry: 'Try again',
  empty: 'No statements yet',
  emptyBody: 'Issued monthly statements will appear here. Closed calendar months create immutable documents.',
  original: 'Original',
  corrected: 'Corrected',
  superseded: 'Superseded',
  readinessReady: 'Ready',
  readinessPending: 'Preparing',
  downloadAvailable: 'Available',
  downloadPending: 'Preparing',
  downloadUnavailable: 'Unavailable',
  download: 'Download',
  downloading: 'Preparing download…',
  downloadError: 'The download failed. Please try again.',
  copyLink: 'Copy link',
  linkCopied: 'Link copied. It expires {{date}}.',
  linkError: 'The link could not be created. Please try again.',
  details: 'Details',
  hideDetails: 'Hide details',
  loadingDetails: 'Loading details…',
  detailsError: 'Details could not be loaded.',
  revision: 'Revision {{revision}}',
  revisionLabel: 'Revision',
  issued: 'Issued {{date}}',
  issuedLabel: 'Issued',
  period: '{{from}} – {{to}}',
  contentHash: 'Content hash',
  totals: 'Statement totals',
  opening: 'Opening balance',
  credits: 'Total credits',
  debits: 'Total debits',
  closing: 'Closing balance',
  transactions: '{{count}} transactions',
  transactionsLabel: 'Transactions',
  artifacts: 'Files',
  kind: 'Type',
  kindOriginal: 'Original',
  kindRendition: 'Rendition',
  label: 'Label',
  language: 'Language',
  state: 'State',
  size: 'Size',
  actions: 'Actions',
  stateReady: 'Ready',
  stateStaged: 'Staged',
  stateVerifying: 'Verifying',
  stateFailed: 'Failed',
  notAvailable: 'Not available',
  page: 'Page {{page}} of {{pages}}',
  previous: 'Previous',
  next: 'Next',
  scopeNote: 'Each product, account and currency has its own statements. These are credit-account records, not bank deposit statements.',
});

const MONTH_NAMES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PAGE_SIZE = 20;

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

function localizedDateTime(value, language, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
  }
}

function monthName(month, language) {
  try {
    return new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2026, month - 1, 1)));
  } catch {
    return String(month);
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function StatementArchivePage({ product: productProp = 'oxsteed' }) {
  const { t, i18n } = useTranslation('credit');
  const [searchParams, setSearchParams] = useSearchParams();
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const text = (key, options = {}) => t(`${ARCHIVE_STRINGS[key] ? 'archive' : 'statementCenter'}.${key}`, { defaultValue: ARCHIVE_STRINGS[key], ...options });

  const product = Object.hasOwn(STATEMENT_PRODUCTS, searchParams.get('product'))
    ? searchParams.get('product') : (Object.hasOwn(STATEMENT_PRODUCTS, productProp) ? productProp : 'oxsteed');
  const filters = {
    product,
    accountId: searchParams.get('accountId') || undefined,
    currency: searchParams.get('currency') || undefined,
    year: searchParams.get('year') || undefined,
    month: searchParams.get('month') || undefined,
    page: Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1),
    perPage: PAGE_SIZE,
  };

  const [accounts, setAccounts] = useState([]);
  const [archive, setArchive] = useState({ status: 'loading', items: [], page: 1, totalPages: 1, total: 0 });
  const [refreshTick, setRefreshTick] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [downloadState, setDownloadState] = useState({});
  const [linkState, setLinkState] = useState({});
  const requestRef = useRef(null);

  const root = STATEMENT_PRODUCTS[product].root;
  const settlement = STATEMENT_PRODUCTS[product].settlement;

  function updateFilters(next) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === null || value === '') params.delete(key);
      else params.set(key, String(value));
    }
    if (!('page' in next)) params.delete('page');
    setSearchParams(params);
  }

  useEffect(() => {
    let active = true;
    setAccounts([]);
    const list = settlement ? () => listStatementScopes(product)
      : product === 'restaurant' ? listMyFoodRestaurantWallets : listOxsteedCreditAccounts;
    list().then(result => {
      if (!active) return;
      setAccounts(Array.isArray(result) ? result : []);
    }).catch(() => { if (active) setAccounts([]); });
    return () => { active = false; };
  }, [product, settlement]);

  const loadArchive = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setArchive(current => ({ ...current, status: 'loading' }));
    try {
      const result = await listArchive(filters, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setArchive({
        status: 'ready',
        items: Array.isArray(result?.items) ? result.items : [],
        page: Number(result?.page) || 1,
        perPage: Number(result?.perPage) || PAGE_SIZE,
        totalPages: Math.max(1, Number(result?.totalPages) || 1),
        total: Number(result?.total) || 0,
      });
    } catch (failure) {
      if (controller.signal.aborted) return;
      setArchive(current => ({ ...current, status: 'error' }));
    }
  }, [searchParams, product, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadArchive();
    return () => requestRef.current?.abort();
  }, [loadArchive]);

  async function toggleDetails(item) {
    const id = item.id;
    if (expanded[id]?.open && expanded[id]?.status !== 'error') {
      setExpanded(current => ({ ...current, [id]: { ...current[id], open: false } }));
      return;
    }
    setExpanded(current => ({ ...current, [id]: { open: true, status: 'loading' } }));
    try {
      const document = await getArchiveDocument(id);
      setExpanded(current => ({ ...current, [id]: { open: true, status: 'ready', document } }));
    } catch {
      setExpanded(current => ({ ...current, [id]: { open: true, status: 'error' } }));
    }
  }

  async function downloadItem(item, artifact) {
    const key = `${item.id}:${artifact.id}`;
    if (downloadState[key] === 'busy') return;
    setDownloadState(current => ({ ...current, [key]: 'busy' }));
    try {
      const response = await downloadArchiveDocument(item.id, {
        language: artifact.language,
        kind: artifact.kind,
        label: artifact.label || undefined,
      });
      const blob = response.data;
      if (!(blob instanceof Blob) || !blob.size) throw new Error('Invalid download');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `credit-statement-${item.period.from}-${item.period.to}-${artifact.language}.pdf`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setDownloadState(current => ({ ...current, [key]: 'done' }));
    } catch {
      setDownloadState(current => ({ ...current, [key]: 'error' }));
    }
  }

  async function copyLink(item, artifact) {
    const key = `${item.id}:${artifact.id}`;
    if (linkState[key] === 'busy') return;
    setLinkState(current => ({ ...current, [key]: 'busy' }));
    try {
      const link = await getArchiveDownloadLink(item.id, {
        language: artifact.language,
        kind: artifact.kind,
        label: artifact.label || undefined,
      });
      if (!link?.url) throw new Error('Invalid link');
      await navigator.clipboard.writeText(link.url);
      setLinkState(current => ({ ...current, [key]: { url: link.url, expiresAt: link.expiresAt } }));
    } catch {
      setLinkState(current => ({ ...current, [key]: 'error' }));
    }
  }

  const accountName = entry => entry.name || entry.restaurantName || text(STATEMENT_PRODUCTS[product].label);
  const currencies = [...new Set(accounts.map(entry => entry.currencyCode).filter(code => /^[A-Z]{3}$/.test(code || '')))].sort();
  const currentYear = new Date().getUTCFullYear();
  const years = Array.from({ length: currentYear - 2019 }, (_, index) => currentYear - index);

  const date = value => localizedDate(value, language, text('notAvailable'));
  const dateTime = value => localizedDateTime(value, language, text('notAvailable'));
  const money = (amount, currency) => formatStatementMoney(amount, currency, language);

  function statusBadge(item) {
    if (item.superseded) return <span className="sa-badge sa-badge-muted">{text('superseded')}</span>;
    if (item.corrected) return <span className="sa-badge sa-badge-warn">{text('corrected')}</span>;
    return <span className="sa-badge"><LockKeyhole size={13} aria-hidden="true" />{text('original')}</span>;
  }

  function readinessBadge(item) {
    if (item.readiness === 'ready') return <span className="sa-pill sa-pill-ready">{text('readinessReady')}</span>;
    return <span className="sa-pill">{text('readinessPending')}</span>;
  }

  function downloadBadge(item) {
    if (item.downloadStatus === 'available') return <span className="sa-pill sa-pill-ready">{text('downloadAvailable')}</span>;
    if (item.downloadStatus === 'pending') return <span className="sa-pill">{text('downloadPending')}</span>;
    return <span className="sa-pill sa-pill-muted">{text('downloadUnavailable')}</span>;
  }

  function renderArtifactRow(item, artifact) {
    const key = `${item.id}:${artifact.id}`;
    const busy = downloadState[key] === 'busy' || linkState[key] === 'busy';
    const link = linkState[key] && typeof linkState[key] === 'object' ? linkState[key] : null;
    return <tr key={artifact.id}>
      <td>{artifact.kind === 'original' ? text('kindOriginal') : text('kindRendition')}</td>
      <td>{artifact.label || '–'}</td>
      <td>{artifact.language}</td>
      <td>{text(`state${artifact.state[0].toUpperCase()}${artifact.state.slice(1)}`, { defaultValue: artifact.state })}</td>
      <td>{formatBytes(artifact.byteLength)}</td>
      <td><div className="sa-row-actions">
        <button type="button" disabled={busy || artifact.state !== 'ready'} onClick={() => downloadItem(item, artifact)}>
          <Download size={15} aria-hidden="true" />{text(downloadState[key] === 'busy' ? 'downloading' : 'download')}
        </button>
        <button type="button" disabled={busy || artifact.state !== 'ready'} onClick={() => copyLink(item, artifact)}>
          <Link2 size={15} aria-hidden="true" />{text('copyLink')}
        </button>
      </div>
      {downloadState[key] === 'error' && <p className="sa-inline-error" role="alert">{text('downloadError')}</p>}
      {linkState[key] === 'error' && <p className="sa-inline-error" role="alert">{text('linkError')}</p>}
      {link && <p className="sa-inline-note" role="status">{text('linkCopied', { date: dateTime(link.expiresAt) })}</p>}
      </td>
    </tr>;
  }

  function renderDetails(item) {
    const detail = expanded[item.id];
    if (!detail?.open) return null;
    if (detail.status === 'loading') return <div className="sa-details" role="status">{text('loadingDetails')}</div>;
    if (detail.status === 'error' || !detail.document) {
      return <div className="sa-details"><p role="alert">{text('detailsError')}</p>
        <button type="button" onClick={() => toggleDetails(item)}>{text('retry')}</button></div>;
    }
    const document = detail.document;
    const artifacts = document.kind === 'amendment' ? [document.amendment?.artifact].filter(Boolean)
      : [...(document.artifacts?.originals || []), ...(document.artifacts?.renditions || [])];
    return <div className="sa-details">
      <dl className="sa-meta">
        <div><dt>{text('revisionLabel')}</dt><dd>{document.revision}</dd></div>
        <div><dt>{text('issuedLabel')}</dt><dd>{dateTime(document.issuedAt)}</dd></div>
        <div><dt>{text('transactionsLabel')}</dt><dd>{document.totals?.transactionCount ?? text('notAvailable')}</dd></div>
      </dl>
      {(document.totals?.openingMinor != null) && <dl className="sa-balances">
        {[['opening', document.totals.openingMinor], ['credits', document.totals.creditsMinor],
          ['debits', document.totals.debitsMinor], ['closing', document.totals.closingMinor]]
          .map(([key, amount]) => amount != null && <div key={key}><dt>{text(key)}</dt><dd><bdi>{money(amount, document.currency)}</bdi></dd></div>)}
      </dl>}
      {document.contentHash && <details className="sa-hash"><summary>{text('contentHash')}</summary><code dir="ltr">{document.contentHash}</code></details>}
      {document.amendment?.reason && <p>{document.amendment.reason}</p>}
      <h3>{text('artifacts')}</h3>
      {!artifacts.length ? <p>{text('downloadUnavailable')}</p> : <div className="sa-table-scroll" role="region" tabIndex={0}>
        <table><thead><tr>{['kind', 'label', 'language', 'state', 'size', 'actions'].map(key =>
          <th key={key} scope="col">{text(key)}</th>)}</tr></thead>
          <tbody>{artifacts.map(artifact => renderArtifactRow(item, artifact))}</tbody></table>
      </div>}
    </div>;
  }

  return <div className="statement-archive-shell" dir={i18n.dir(language)}>
    <PageMeta title={text('title')} description={text('description')} noIndex />
    <Navbar />
    <main className="statement-archive-page">
      <Link to={settlement ? (product === 'helper_earnings' ? '/dashboard' : '/business-hub') : `${root}/statements`} className="sa-back"><ArrowLeft size={16} aria-hidden="true" />{text('back')}</Link>
      <header className="sa-header"><FileText size={30} aria-hidden="true" /><div><h1>{text('title')}</h1><p>{text('description')}</p></div></header>
      <nav className="sa-products" aria-label={text('product')}>
        {Object.entries(STATEMENT_PRODUCTS).map(([key, config]) => <Link key={key}
          to={`${config.root}/statements${config.settlement ? '' : '/archive'}`}
          aria-current={product === key ? 'page' : undefined}>{text(config.label)}</Link>)}
      </nav>
      <p className="sa-scope">{text(settlement ? 'settlementScopeNote' : 'scopeNote')}</p>
      <StatementExportPanel product={product} accounts={accounts} />

      <form className="sa-filters" onSubmit={event => event.preventDefault()}>
        <div className="sa-field"><label htmlFor="archive-account">{text('account')}</label>
          <select id="archive-account" value={filters.accountId || ''} onChange={event => updateFilters({ accountId: event.target.value || undefined })}>
            <option value="">{text('allAccounts')}</option>
            {accounts.map(entry => entry.accountId && <option key={entry.accountId} value={entry.accountId}>
              {text('accountOption', { name: accountName(entry), currency: entry.currencyCode })}
            </option>)}
          </select></div>
        <div className="sa-field"><label htmlFor="archive-currency">{text('currency')}</label>
          <input id="archive-currency" list="archive-currencies" value={filters.currency || ''} maxLength={3}
            placeholder={text('allCurrencies')} onChange={event => updateFilters({ currency: event.target.value.toUpperCase() || undefined })} />
          <datalist id="archive-currencies">{currencies.map(code => <option key={code} value={code} />)}</datalist></div>
        <div className="sa-field"><label htmlFor="archive-year">{text('year')}</label>
          <select id="archive-year" value={filters.year || ''} onChange={event => updateFilters({ year: event.target.value || undefined })}>
            <option value="">{text('allYears')}</option>
            {years.map(value => <option key={value} value={value}>{value}</option>)}
          </select></div>
        <div className="sa-field"><label htmlFor="archive-month">{text('month')}</label>
          <select id="archive-month" value={filters.month || ''} onChange={event => updateFilters({ month: event.target.value || undefined })}>
            <option value="">{text('allMonths')}</option>
            {MONTH_NAMES.map(value => <option key={value} value={value}>{monthName(value, language)}</option>)}
          </select></div>
        <button type="button" className="sa-refresh" onClick={() => setRefreshTick(tick => tick + 1)} disabled={archive.status === 'loading'}>
          <RefreshCw size={16} aria-hidden="true" />{text('refresh')}
        </button>
      </form>

      {archive.status === 'loading' ? <div className="sa-state" role="status">{text('loading')}</div>
        : archive.status === 'error' ? <div className="sa-state" role="alert"><p>{text('loadError')}</p>
          <button type="button" onClick={() => setRefreshTick(tick => tick + 1)}>{text('retry')}</button></div>
          : !archive.items.length ? <div className="sa-state" role="status"><h2>{text('empty')}</h2><p>{text('emptyBody')}</p></div>
            : <>
              <ul className="sa-list">
                {archive.items.map(item => <li key={item.id} className="sa-item">
                  <div className="sa-item-main">
                    <div>
                      <div className="sa-item-badges">{statusBadge(item)}{readinessBadge(item)}{downloadBadge(item)}</div>
                      <h2>{text('period', { from: date(item.period.from), to: date(item.period.to) })}</h2>
                      <p>{text('issued', { date: date(item.issuedAt) })} · {text('revision', { revision: item.revision })}</p>
                      <p className="sa-item-meta">{item.currency}{item.languages.length ? ` · ${item.languages.join(', ').toUpperCase()}` : ''}</p>
                    </div>
                    <div className="sa-item-actions">
                      <Link to={statementAccessiblePath(item)}>{text('accessible')}</Link>
                      <button type="button" onClick={() => toggleDetails(item)} aria-expanded={Boolean(expanded[item.id]?.open)}>
                        {text(expanded[item.id]?.open ? 'hideDetails' : 'details')}<ChevronDown size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {renderDetails(item)}
                  {item.versions?.length > 0 && <section aria-label={text('versions')}>
                    <h3>{text('versions')}</h3>
                    <ul className="sa-list">{item.versions.map(version => <li key={version.id} className="sa-item">
                      <p>{text('revision', { revision: version.revision })} · {text('issued', { date: date(version.issuedAt) })}</p>
                      <p>{version.amendment?.reason}</p>
                      <div className="sa-item-actions">
                        <Link to={statementAccessiblePath(version)}>{text('accessible')}</Link>
                        <button type="button" onClick={() => toggleDetails(version)} aria-expanded={Boolean(expanded[version.id]?.open)}>{text('details')}</button>
                      </div>
                      {renderDetails(version)}
                    </li>)}</ul>
                  </section>}
                </li>)}
              </ul>
              <nav className="sa-pagination" aria-label={text('page', { page: archive.page, pages: archive.totalPages })}>
                <button type="button" disabled={archive.page <= 1} onClick={() => updateFilters({ page: archive.page - 1 })}>{text('previous')}</button>
                <span aria-live="polite" aria-atomic="true">{text('page', { page: archive.page, pages: archive.totalPages })}</span>
                <button type="button" disabled={archive.page >= archive.totalPages} onClick={() => updateFilters({ page: archive.page + 1 })}>{text('next')}</button>
              </nav>
            </>}
    </main>
    <Footer />
  </div>;
}
