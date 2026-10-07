import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getActor } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaActorPage() {
  const { handle } = useParams();
  const [actor, setActor] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <p>Loading...</p>;
  if (!actor) return <p>Profile not found.</p>;

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
          <p className="media-actor-type">{actor.actor_type}</p>
        </div>
      </div>
      <div className="media-actor-posts">
        {posts.map(post => <MediaPostCard key={post.id} post={post} />)}
        {!posts.length && <p className="media-empty">No posts yet.</p>}
      </div>
    </div>
  );
}
