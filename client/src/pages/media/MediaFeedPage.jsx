import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getFeed } from '../../api/media';
import PageShell from '../../components/PageShell';
import './MediaStyles.css';
import MediaPostCard from './MediaPostCard';

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
      <div className="media-feed">
        <h1>{t('media.feed.title')}</h1>
        {error && (
          <div className="media-error">
            <p>{error}</p>
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
          <p className="media-empty">{t('media.feed.empty')}</p>
        )}
      </div>
    </PageShell>
  );
}
