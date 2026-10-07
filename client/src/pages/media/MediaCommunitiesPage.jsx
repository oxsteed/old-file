import React, { useEffect, useState } from 'react';
import { getCommunities } from '../../api/media';

export default function MediaCommunitiesPage() {
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCommunities()
      .then(d => setCommunities(d.communities))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div className="media-communities">
      <h1>Spaces</h1>
      <p className="media-subtitle">Local city and category channels</p>
      {communities.map(c => (
        <div key={c.id} className="media-community-card">
          <h3>{c.title}</h3>
          {c.geo_scope && <span className="media-community-geo">{c.geo_scope}</span>}
          {c.category && <span className="media-community-cat">{c.category}</span>}
        </div>
      ))}
      {!communities.length && (
        <p className="media-empty">No spaces yet. Check back soon.</p>
      )}
    </div>
  );
}
