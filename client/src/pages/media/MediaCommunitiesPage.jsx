import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCommunities } from '../../api/media';

export default function MediaCommunitiesPage() {
  const { t } = useTranslation();
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCommunities()
      .then(d => setCommunities(d.communities))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="media-empty-state"><p>{t('media.spaces.loading')}</p></div>;

  return (
    <div className="media-communities">
      <h1>{t('media.shell.spaces')}</h1>
      <p className="media-subtitle">{t('media.spaces.description')}</p>
      {communities.map(c => (
        <Link key={c.id} to={`/media/communities/${encodeURIComponent(c.slug)}`} className="media-community-card">
          <span className="media-community-card-icon"><Users size={19} aria-hidden="true" /></span>
          <span className="media-community-card-body"><strong>{c.title}</strong><small>{[c.geo_scope, c.category].filter(Boolean).join(' · ') || t('media.spaces.local')}</small></span>
          <span className="media-community-card-count">
            <span aria-label={t('media.spaces.posts', { count: c.post_count || 0 })}><MapPin size={14} aria-hidden="true" />{c.post_count || 0}</span>
            <span aria-label={t('media.spaces.members', { count: c.member_count || 0 })}><Users size={14} aria-hidden="true" />{c.member_count || 0}</span>
          </span>
        </Link>
      ))}
      {!communities.length && (
        <p className="media-empty">{t('media.spaces.emptyHeading')}</p>
      )}
    </div>
  );
}
