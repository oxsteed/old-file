import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchMedia } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaSearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    const data = await searchMedia({ q: query.trim(), limit: 50 });
    setResults(data.posts || []);
    setAccounts(data.actors || []);
    setSearched(true);
  };

  return (
    <div className="media-search">
      <h1>{t('media.search.title')}</h1>
      <form onSubmit={handleSearch}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('media.search.placeholder')}
        />
        <button type="submit">{t('media.search.submit')}</button>
      </form>
      {searched && (
        <div className="media-search-results">
          {accounts.length > 0 && (
            <section className="media-search-accounts">
              <h2>{t('media.search.accounts', { defaultValue: 'Accounts' })}</h2>
              <div className="media-search-account-list">
                {accounts.map((account) => (
                  <a key={account.id} href={`/media/@${account.handle}`} className="media-search-account">
                    <strong>{account.display_name}</strong>
                    <span>@{account.handle}</span>
                  </a>
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
