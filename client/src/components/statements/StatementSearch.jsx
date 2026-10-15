import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { searchStatements } from '../../api/statementSearch';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import './StatementSearch.css';

// Unified statement search across all five statement products.
//
// MOUNT POINT (wired by the coordinator): the Statement Center page
// (client/src/pages/food/StatementCenterPage.jsx, owned by Group A), below
// the scope note, e.g. `<StatementSearch />`. The component takes no props:
// it queries GET /api/statements/search, which only returns statements the
// signed-in user is authorized to see.
export default function StatementSearch() {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options = {}) => t(`statements.${key}`, options);
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('idle');
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function runSearch(value) {
    const trimmed = value.trim();
    requestRef.current?.abort();
    if (trimmed.length < 2) {
      setResult(null);
      setStatus(trimmed ? 'idle' : 'idle');
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('searching');
    try {
      const data = await searchStatements({ q: trimmed, signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(data);
      setStatus('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus('error');
    }
  }

  // Debounce typing; the form submit searches immediately.
  useEffect(() => {
    if (!query.trim()) {
      requestRef.current?.abort();
      setResult(null);
      setStatus('idle');
      return undefined;
    }
    const timer = setTimeout(() => runSearch(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  function onSubmit(event) {
    event.preventDefault();
    runSearch(query);
  }

  const money = (amount, currency) => formatStatementMoney(amount, currency, language);
  const groups = result?.groups || [];
  const total = result?.total || 0;

  return (
    <section className="stmt-search" aria-labelledby="stmt-search-heading">
      <h2 id="stmt-search-heading">{text('search.title')}</h2>
      <p>{text('search.description')}</p>
      <form className="stmt-search-form" onSubmit={onSubmit} role="search">
        <label className="stmt-sr-only" htmlFor="stmt-search-input">{text('search.title')}</label>
        <input
          id="stmt-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={text('search.placeholder')}
          autoComplete="off"
          aria-describedby="stmt-search-help"
        />
        <button type="submit" className="stmt-search-submit">
          <Search size={16} aria-hidden="true" />{text('search.submit')}
        </button>
      </form>
      <p id="stmt-search-help" className="stmt-search-help">{text('search.description')}</p>

      {status === 'searching' && <p role="status">{text('search.searching')}</p>}
      {status === 'error' && <p role="alert" className="stmt-search-error">{text('search.error')}</p>}
      {status === 'ready' && (
        <div aria-live="polite">
          <p role="status">{text('search.resultsFor', { query: result.query })}: {text('search.matchingEntries', { count: total })}</p>
          {!total ? <p>{text('search.noResults')}</p> : groups.filter((group) => group.total > 0).map((group) => (
            <div key={group.product} className="stmt-search-group">
              <h3>
                {text('search.productLabel', { product: group.productLabel })}{' '}
                <span className="stmt-search-count">({group.total})</span>
              </h3>
              <ul>
                {group.results.map((entry) => (
                  <li key={`${group.product}:${entry.entryId}`} className="stmt-search-result">
                    <div className="stmt-search-result-main">
                      <strong><bdi>{entry.description || entry.type}</bdi></strong>
                      <span className="stmt-search-meta">
                        <bdi>{entry.accountLabel}</bdi>
                        {entry.date && <time dateTime={entry.date}>{new Date(entry.date).toLocaleDateString(language, { timeZone: 'UTC' })}</time>}
                      </span>
                    </div>
                    <div className="stmt-search-result-side">
                      <bdi className={entry.direction === 'debit' ? 'stmt-debit' : 'stmt-credit'}>
                        {entry.direction === 'debit' ? '−' : '+'}{money(entry.direction === 'debit' ? entry.debitCents : entry.creditCents, entry.currencyCode)}
                      </bdi>
                      <Link to={entry.url}>{text('search.openEntry')}</Link>
                    </div>
                  </li>
                ))}
              </ul>
              <p><Link to={group.archiveUrl}>{text('search.viewArchive')}</Link></p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
