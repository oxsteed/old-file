import React, { useEffect, useState } from 'react';
import { getFeed } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaFeedPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [before, setBefore] = useState(null);
  const [hasMore, setHasMore] = useState(true);

  const load = async (beforeParam) => {
    setLoading(true);
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
      console.error('Failed to load feed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(null); }, []);

  return (
    <div className="media-feed">
      <h1>OxSteed Media</h1>
      {posts.map(post => (
        <MediaPostCard key={post.id} post={post} />
      ))}
      {loading && <p>Loading...</p>}
      {!loading && hasMore && (
        <button onClick={() => load(before)} className="media-load-more">
          Load more
        </button>
      )}
      {!loading && !posts.length && (
        <p className="media-empty">No posts yet. Be the first to share.</p>
      )}
    </div>
  );
}
