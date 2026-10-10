import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { searchMedia } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaSearchPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requestedQuery = params.get('q') || '';
  const [query, setQuery] = useState(requestedQuery);
  const [results, setResults] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => () => { generation.current += 1; }, []);

  const runSearch = useCallback(async searchQuery => {
    if (!searchQuery.trim()) return;
    const request = ++generation.current;
    setLoading(true); setError(''); setSearched(false);
    setResults([]); setAccounts([]);
    try {
      const data = await searchMedia({ q: searchQuery.trim(), limit: 50 });
      if (request !== generation.current) return;
      setResults(data.posts || []);
      setAccounts(data.actors || []);
      setSearched(true);
    } catch {
      if (request === generation.current) setError(t('media.search.loadError'));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    setQuery(requestedQuery);
    if (requestedQuery.trim()) void runSearch(requestedQuery);
    else {
      generation.current += 1;
      setResults([]); setAccounts([]); setSearched(false); setLoading(false); setError('');
    }
  }, [requestedQuery, runSearch]);
  const handleSearch = event => {
    event.preventDefault();
    if (!query.trim()) return;
    if (requestedQuery === query.trim()) void runSearch(query);
    else setParams({ q: query.trim() });
  };

  return (
    <div className="media-search">
      <h1>{t('media.search.title')}</h1>
      <form onSubmit={handleSearch}>
        <input
          type="search"
          aria-label={t('media.search.placeholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('media.search.placeholder')}
        />
        <button type="submit">{t('media.search.submit')}</button>
      </form>
      {loading && <p role="status">{t('media.search.loading')}</p>}
      {error && <p className="media-error" role="alert">{error}</p>}
      {searched && (
        <div className="media-search-results">
          {accounts.length > 0 && (
            <section className="media-search-accounts">
              <h2>{t('media.search.accounts', { defaultValue: 'Accounts' })}</h2>
              <div className="media-search-account-list">
                {accounts.map((account) => (
                  <Link key={account.id} to={`/media/@${account.handle}`} className="media-search-account">
                    <strong>{account.display_name}</strong>
                    <span>@{account.handle}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {results.length > 0 && <h2>{t('media.search.posts', { defaultValue: 'Posts' })}</h2>}
          {results.map(post => <MediaPostCard key={post.id} post={post} />)}
          {!results.length && !accounts.length && <p>{t('media.search.empty')}</p>}
        </div>
      )}
    </div>
  );
}
