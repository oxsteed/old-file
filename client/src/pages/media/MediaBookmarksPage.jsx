import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBookmarks } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaBookmarksPage() {
  const { t } = useTranslation();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleBookmarkChange = (postId, bookmarked) => {
    if (bookmarked) return;
    setPosts((current) => current.filter((post) => String(post.id) !== String(postId)));
  };

  useEffect(() => {
    getBookmarks()
      .then((data) => setPosts(data.posts || []))
      .catch(() => setError(t('media.bookmarks.loadError', { defaultValue: 'Could not load saved posts.' })))
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <section className="media-feed media-bookmarks-page">
      <header className="media-timeline-header">
        <h1>{t('media.bookmarks.title', { defaultValue: 'Saved posts' })}</h1>
      </header>
      {loading && <div className="media-skeleton"><div className="skeleton-line" /><div className="skeleton-line" /></div>}
      {error && <p className="media-error" role="alert">{error}</p>}
      {!loading && !error && posts.map((post) => (
        <MediaPostCard key={post.id} post={post} onBookmarkChange={handleBookmarkChange} />
      ))}
      {!loading && !error && !posts.length && <p className="media-empty">{t('media.bookmarks.empty', { defaultValue: 'Posts you save will appear here.' })}</p>}
    </section>
  );
}
