import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getActor, toggleFollow } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaActorPage() {
  const { handle } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [actor, setActor] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await getActor(handle);
        setActor(data.actor);
        setPosts(data.posts);
      } catch (err) {
        console.error('Failed to load actor', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [handle]);

  const handleFollow = async () => {
    if (!actor || followLoading) return;
    setFollowLoading(true);
    setFollowError(null);
    try {
      const result = await toggleFollow(actor.id);
      setActor((current) => current ? {
        ...current,
        following: result.following,
        follower_count: result.follower_count,
      } : current);
    } catch (err) {
      setFollowError(err?.response?.data?.error || t('media.actor.followError'));
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) return <p>{t('media.actor.loading')}</p>;
  if (!actor) return <p>{t('media.actor.notFound')}</p>;

  return (
    <div className="media-actor-page">
      <div className="media-actor-header">
        {actor.avatar_url ? (
          <img src={actor.avatar_url} alt={actor.display_name} className="media-actor-avatar" />
        ) : (
          <div className="media-actor-avatar-fallback">{actor.display_name?.[0]}</div>
        )}
        <div>
          <h1>
            {actor.display_name}
            {actor.verified_kind !== 'none' && <span className="media-verified">✓</span>}
          </h1>
          <p className="media-actor-handle">@{actor.handle}</p>
          <p className="media-actor-type">{t(`media.post.linkTypes.${actor.actor_type}`, { defaultValue: actor.actor_type })}</p>
          <p className="media-actor-followers">{t('media.actor.followers', { count: actor.follower_count || 0 })}</p>
        </div>
        {user && String(actor.owner_user_id) !== String(user.id) ? (
          <button type="button" className={`media-primary-button media-actor-follow ${actor.following ? 'is-following' : ''}`}
            onClick={handleFollow} disabled={followLoading} aria-pressed={Boolean(actor.following)}>
            {followLoading ? t('media.actor.followingAction') : actor.following ? t('media.actor.unfollow') : t('media.actor.follow')}
          </button>
        ) : !user ? (
          <Link className="media-secondary-button media-actor-follow" to={`/login?returnTo=${encodeURIComponent(`/media/@${handle}`)}`}>
            {t('media.actor.signInToFollow')}
          </Link>
        ) : null}
      </div>
      {followError && <p className="media-error" role="alert">{followError}</p>}
      <div className="media-actor-posts">
        {posts.map(post => <MediaPostCard key={post.id} post={post} />)}
        {!posts.length && <p className="media-empty">{t('media.actor.noPosts')}</p>}
      </div>
    </div>
  );
}
