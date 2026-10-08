import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchMedia } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaSearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    const data = await searchMedia({ q: query.trim(), limit: 50 });
    setResults(data.posts || []);
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
          {results.map(post => <MediaPostCard key={post.id} post={post} />)}
          {!results.length && <p>{t('media.search.empty')}</p>}
        </div>
      )}
    </div>
  );
}
