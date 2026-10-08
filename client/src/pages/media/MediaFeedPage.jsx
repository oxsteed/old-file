import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getFeed } from '../../api/media';
import { MapPin, MessageCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './MediaStyles.css';
import MediaPostCard from './MediaPostCard';
import { Link } from 'react-router-dom';
import PageMeta from '../../components/PageMeta';

export default function MediaFeedPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
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
      setHasMore(data.has_more === true && Boolean(data.next_before));
    } catch (err) {
      setError(t('media.feed.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(null); }, [load]);

  return (
      <div className="media-feed media-feed-page">
        <PageMeta title={t('media.feed.metaTitle')} description={t('media.feed.metaDescription')} />
        <header className="media-timeline-header">
          <div>
            <h1>{t('media.shell.home')}</h1>
            <p><MapPin size={13} aria-hidden="true" />{t('media.shell.railNote')}</p>
          </div>
          <button type="button" className="media-icon-button" disabled={loading}
            onClick={() => load(null)} aria-label={t('media.feed.refresh')}>
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </header>
        <Link className="media-composer-prompt" to="/media/compose">
          <span className="media-composer-avatar" aria-hidden="true">
            {user?.profile_photo_url ? <img src={user.profile_photo_url} alt="" /> : <MessageCircle size={20} />}
          </span>
          <span>{t('media.feed.prompt')}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <div className="media-feed-toolbar">
          <span className="media-feed-tab">{t('media.feed.latest')}</span>
        </div>
        {error && (
          <div className="media-error" role="alert">
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
          <div className="media-feed-empty">
            <div className="media-empty-illustration" aria-hidden="true">
              <span className="media-empty-bubble"><MessageCircle size={27} /></span>
              <span className="media-empty-pin"><MapPin size={21} /></span>
            </div>
            <h2>{t('media.feed.emptyHeading')}</h2>
            <p>{t('media.feed.emptyDescription')}</p>
            <Link className="media-text-link" to="/restaurants">{t('media.feed.explore')}<ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        )}
      </div>
  );
}
