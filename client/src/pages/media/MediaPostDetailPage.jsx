import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPost, getReplies, recordView } from '../../api/media';
import MediaPostCard from './MediaPostCard';

export default function MediaPostDetailPage() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [postData, repliesData] = await Promise.all([
          getPost(id),
          getReplies(id),
        ]);
        setPost(postData.post);
        setReplies(repliesData.replies);
        recordView(id).catch(() => {});
      } catch (err) {
        console.error('Failed to load post', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <p>Loading...</p>;
  if (!post) return <p>Post not found.</p>;

  return (
    <div className="media-post-detail">
      <MediaPostCard post={post} />
      <div className="media-replies-section">
        <h2>Replies ({post.reply_count})</h2>
        <div className="media-reply-sort">
          <span>Latest</span>
        </div>
        {replies.map(reply => (
          <MediaPostCard key={reply.id} post={reply} />
        ))}
        {!replies.length && <p className="media-empty">No replies yet.</p>}
      </div>
    </div>
  );
}
