import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toggleLike, toggleBookmark, toggleRepost } from '../../api/media';

function VerifiedBadge({ kind }) {
  if (!kind || kind === 'none') return null;
  return <span className="media-verified" title={`Verified: ${kind}`}>✓</span>;
}

function formatCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function MediaPostCard({ post, onUpdate }) {
  const [liked, setLiked] = useState(post.liked);
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [bookmarkCount, setBookmarkCount] = useState(post.bookmark_count);
  const [repostCount, setRepostCount] = useState(post.repost_count);

  const handleLike = async (e) => {
    e.preventDefault();
    const r = await toggleLike(post.id);
    setLiked(r.liked);
    setLikeCount(c => c + (r.liked ? 1 : -1));
  };

  const handleBookmark = async (e) => {
    e.preventDefault();
    const r = await toggleBookmark(post.id);
    setBookmarked(r.bookmarked);
    setBookmarkCount(c => c + (r.bookmarked ? 1 : -1));
  };

  const handleRepost = async (e) => {
    e.preventDefault();
    const r = await toggleRepost(post.id);
    setRepostCount(c => c + (r.reposted ? 1 : -1));
  };

  return (
    <article className="media-post-card">
      <Link to={`/media/@${post.handle}`} className="media-post-avatar">
        {post.avatar_url ? (
          <img src={post.avatar_url} alt={post.display_name} />
        ) : (
          <div className="media-avatar-fallback">{post.display_name?.[0]}</div>
        )}
      </Link>
      <div className="media-post-body">
        <div className="media-post-header">
          <Link to={`/media/@${post.handle}`} className="media-post-name">
            {post.display_name}
          </Link>
          <VerifiedBadge kind={post.verified_kind} />
          <span className="media-post-handle">@{post.handle}</span>
          <span className="media-post-time">· {timeAgo(post.created_at)}</span>
        </div>
        <Link to={`/media/post/${post.id}`} className="media-post-text">
          {post.body}
        </Link>
        {post.quoted && (
          <div className="media-quoted-embed">
            <div className="media-post-header">
              <span className="media-post-name">{post.quoted.display_name}</span>
              <VerifiedBadge kind={post.quoted.verified_kind} />
              <span className="media-post-handle">@{post.quoted.handle}</span>
            </div>
            <p>{post.quoted.body}</p>
          </div>
        )}
        {post.links && post.links.length > 0 && (
          <div className="media-linked-entities">
            <div className="media-linked-label">Linked on OxSteed</div>
            <div className="media-linked-row">
              {post.links.map(link => (
                <div key={link.id} className="media-link-chip">
                  <span className="media-link-type">{link.link_type}</span>
                  <span className="media-link-name">{link.name_snapshot}</span>
                  {link.price_snapshot_cents != null && (
                    <span className="media-link-price">
                      ${(link.price_snapshot_cents / 100).toFixed(2)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="media-action-row">
          <Link to={`/media/post/${post.id}`} className="media-action">
            💬 {formatCount(post.reply_count)}
          </Link>
          <button onClick={handleRepost} className="media-action">
            🔁 {formatCount(repostCount)}
          </button>
          <button onClick={handleLike} className={`media-action ${liked ? 'active' : ''}`}>
            {liked ? '❤️' : '🤍'} {formatCount(likeCount)}
          </button>
          <span className="media-action">👁️ {formatCount(post.view_count)}</span>
          <button onClick={handleBookmark} className={`media-action ${bookmarked ? 'active' : ''}`}>
            {bookmarked ? '🔖' : '📑'} {formatCount(bookmarkCount)}
          </button>
        </div>
      </div>
    </article>
  );
}
