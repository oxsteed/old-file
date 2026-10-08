import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getFeed } from '../../api/media';
import PageShell from '../../components/PageShell';
import './MediaStyles.css';
import MediaPostCard from './MediaPostCard';
import { Link } from 'react-router-dom';

export default function MediaFeedPage() {
  const { t } = useTranslation();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [before, setBefore] = useState(null);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (beforeParam) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFeed({ before: beforeParam, limit: 20 });
      if (beforeParam) {
        setPosts(p => [...p, ...data.posts]);
      } else {
        setPosts(data.posts);
      }
      setBefore(data.next_before);
      setHasMore(data.posts.length > 0);
    } catch (err) {
      setError(err.response?.data?.error || t('media.feed.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(null); }, [load]);

  return (
    <PageShell>
      <div className="media-feed media-feed-page">
        <header className="media-feed-hero">
          <div>
            <span className="media-feed-eyebrow">OxSteed · {t('media.feed.title')}</span>
            <h1>{t('media.feed.title')}</h1>
            <p>{t('media.feed.subtitle')}</p>
          </div>
          <Link className="media-compose-cta" to="/media/compose">
            <span aria-hidden="true">＋</span> {t('media.feed.compose')}
          </Link>
        </header>
        <div className="media-feed-toolbar">
          <span>{t('media.feed.latest')}</span>
          <span className="media-feed-toolbar__dot" aria-hidden="true">•</span>
          <span>{t('media.feed.subtitleShort')}</span>
        </div>
        {error && (
          <div className="media-error" role="alert">
            <div className="media-error-icon" aria-hidden="true">!</div>
            <div>
              <strong>{t('media.feed.loadError')}</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => load(null)}>{t('common.retry', 'Retry')}</button>
          </div>
        )}
        {posts.map(post => (
          <MediaPostCard key={post.id} post={post} />
        ))}
        {loading && (
          <div className="media-skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        )}
        {!loading && !error && hasMore && posts.length > 0 && (
          <button onClick={() => load(before)} className="media-load-more">
            {t('media.feed.loadMore')}
          </button>
        )}
        {!loading && !error && !posts.length && (
          <div className="media-empty media-empty-card">
            <div className="media-empty-icon" aria-hidden="true">✦</div>
            <h2>{t('media.feed.emptyTitle')}</h2>
            <p>{t('media.feed.empty')}</p>
            <Link className="media-empty-cta" to="/media/compose">{t('media.feed.compose')}</Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}
