import React, { useState } from 'react';
import { getFeed } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    // MVP: search posts by body text via feed endpoint filter.
    // TODO: dedicated /api/media/search endpoint.
    const data = await getFeed({ limit: 50 });
    const filtered = data.posts.filter(p =>
      p.body.toLowerCase().includes(query.toLowerCase())
    );
    setResults(filtered);
    setSearched(true);
  };

  return (
    <div className="media-search">
      <h1>Search Media</h1>
      <form onSubmit={handleSearch}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search posts..."
        />
        <button type="submit">Search</button>
      </form>
      {searched && (
        <div className="media-search-results">
          {results.map(post => <MediaPostCard key={post.id} post={post} />)}
          {!results.length && <p>No results found.</p>}
        </div>
      )}
    </div>
  );
}
