import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getActor } from '../../api/media';
import MediaPostCard from '../../pages/media/MediaPostCard';
import '../../pages/media/MediaStyles.css';

/** A public-safe Media window for helper and business profiles. */
export default function MediaProfilePreview({ handle }) {
  const { t } = useTranslation();
  const [actor, setActor] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(Boolean(handle));

  const load = useCallback(async () => {
    if (!handle) return;
    setLoading(true);
    try {
      const data = await getActor(handle);
      setActor(data?.actor || null);
      setPosts(Array.isArray(data?.posts) ? data.posts.slice(0, 3) : []);
    } catch (_) {
      // Media is an enhancement to the profile; keep the primary profile usable
      // when the optional feed request is unavailable.
      setActor(null);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => { load(); }, [load]);

  if (!handle || (!loading && !actor)) return null;

  return (
    <section className="media-profile-preview" aria-labelledby="media-profile-preview-title">
      <div className="media-profile-preview-header">
        <div>
          <h2 id="media-profile-preview-title">{t('media.feed.title')}</h2>
          <p>{t('media.feed.subtitleShort')}</p>
        </div>
        <Link className="media-secondary-button" to={`/media/@${encodeURIComponent(handle)}`}>
          {t('media.feed.title')}
        </Link>
      </div>
      {loading ? (
        <p className="media-profile-preview-status" role="status">{t('media.actor.loading')}</p>
      ) : posts.length ? (
        <div className="media-profile-preview-posts">
          {posts.map((post) => <MediaPostCard key={post.id} post={post} onUpdate={load} />)}
        </div>
      ) : (
        <p className="media-profile-preview-status">{t('media.actor.noPosts')}</p>
      )}
    </section>
  );
}
