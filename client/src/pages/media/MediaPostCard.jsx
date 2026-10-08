import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { toggleLike, toggleBookmark, toggleRepost } from '../../api/media';

function VerifiedBadge({ kind, label }) {
  if (!kind || kind === 'none') return null;
  return <span className="media-verified" title={`${label}: ${kind}`}>✓</span>;
}

function formatCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(date, language) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(language || 'en', { numeric: 'always' });
  if (s < 60) return formatter.format(-s, 'second');
  if (s < 3600) return formatter.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return formatter.format(-Math.floor(s / 3600), 'hour');
  return formatter.format(-Math.floor(s / 86400), 'day');
}

function MediaVideo({ asset, label, mutedLabel, unmutedLabel }) {
  const [muted, setMuted] = useState(true);
  return (
    <div className="media-video-frame">
      <video src={asset.url} poster={asset.thumbnail_url || undefined} controls muted={muted} playsInline preload="metadata" />
      <button type="button" className="media-video-mute" onClick={() => setMuted((value) => !value)}>
        {muted ? mutedLabel : unmutedLabel}
        <span className="sr-only">{label}</span>
      </button>
    </div>
  );
}

function QuotedMedia({ assets, label }) {
  const asset = assets?.find((candidate) => candidate?.url || candidate?.external_url);
  if (!asset) return null;
  if (asset.asset_type === 'image' && asset.url) {
    return <img className="media-quoted-media" src={asset.url} alt={label} loading="lazy" />;
  }
  if (asset.asset_type === 'video' && asset.thumbnail_url) {
    return <img className="media-quoted-media" src={asset.thumbnail_url} alt={label} loading="lazy" />;
  }
  if (asset.asset_type === 'video_link' && asset.external_url) {
    return <span className="media-quoted-video-link">▶ {label}</span>;
  }
  return null;
}

export default function MediaPostCard({ post, onUpdate }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [liked, setLiked] = useState(post.liked);
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [reposted, setReposted] = useState(!!post.reposted);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [bookmarkCount, setBookmarkCount] = useState(post.bookmark_count);
  const [repostCount, setRepostCount] = useState(post.repost_count);

  const handleLike = async (e) => {
    e.preventDefault();
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    try {
      const r = await toggleLike(post.id);
      setLiked(r.liked);
      setLikeCount(c => Math.max(0, c + (r.liked ? 1 : -1)));
    } catch { /* keep the server state when the request fails */ }
  };

  const handleBookmark = async (e) => {
    e.preventDefault();
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    try {
      const r = await toggleBookmark(post.id);
      setBookmarked(r.bookmarked);
      setBookmarkCount(c => Math.max(0, c + (r.bookmarked ? 1 : -1)));
    } catch { /* keep the server state when the request fails */ }
  };

  const handleRepost = async (e) => {
    e.preventDefault();
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    try {
      const r = await toggleRepost(post.id);
      setReposted(r.reposted);
      setRepostCount(c => Math.max(0, c + (r.reposted ? 1 : -1)));
    } catch { /* keep the server state when the request fails */ }
  };

  const handleShare = async (e) => {
    e.preventDefault();
    const url = `${window.location.origin}/media/post/${post.id}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: post.display_name, text: post.body, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch { /* sharing can be cancelled by the user */ }
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
          <VerifiedBadge kind={post.verified_kind} label={t('media.post.verified')} />
          <span className="media-post-handle">@{post.handle}</span>
          <span className="media-post-time">· {timeAgo(post.created_at, i18n.language)}</span>
          <span className="media-post-views">· {formatCount(post.view_count || 0)} {t('media.post.views')}</span>
        </div>
        <Link to={`/media/post/${post.id}`} className="media-post-text">
          {post.body}
        </Link>
        {post.assets?.length > 0 && (
          <div className={`media-post-assets media-post-assets-${Math.min(post.assets.length, 4)}`}>
            {post.assets.map((asset) => {
              if (asset.asset_type === 'video_link' && asset.external_url) {
                const embedUrl = asset.provider === 'youtube'
                  ? `https://www.youtube.com/embed/${asset.external_video_id}`
                  : `https://player.vimeo.com/video/${asset.external_video_id}`;
                return <iframe key={asset.id} title={t('media.post.videoEmbed')} src={embedUrl} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />;
              }
              if (asset.asset_type === 'video' && asset.url) {
                return <MediaVideo key={asset.id} asset={asset} label={t('media.post.videoEmbed')} mutedLabel={t('media.post.unmute')} unmutedLabel={t('media.post.mute')} />;
              }
              if (asset.asset_type === 'image' && asset.url) {
                return <img key={asset.id} src={asset.url} alt={t('media.post.photoAlt', { name: post.display_name })} loading="lazy" />;
              }
              return null;
            })}
          </div>
        )}
        {post.quoted && (
          <div className="media-quoted-embed">
            <div className="media-post-header">
              <span className="media-post-name">{post.quoted.display_name}</span>
              <VerifiedBadge kind={post.quoted.verified_kind} label={t('media.post.verified')} />
              <span className="media-post-handle">@{post.quoted.handle}</span>
            </div>
            <p>{post.quoted.body}</p>
            <QuotedMedia assets={post.quoted.assets} label={t('media.post.videoEmbed')} />
          </div>
        )}
        {post.links && post.links.length > 0 && (
          <div className="media-linked-entities">
            <div className="media-linked-label">{t('media.post.linkedOn')}</div>
            <div className="media-linked-row">
              {post.links.map(link => (
                link.available && link.canonical_url ? (
                  <Link key={link.id} to={link.canonical_url} className="media-link-chip" onClick={(event) => {
                    const transactional = ['food_item', 'helper', 'job', 'tool_rental', 'direct_catalog'].includes(link.link_type);
                    if (transactional && !user) {
                      event.preventDefault();
                      navigate('/login', { state: { from: window.location.pathname } });
                    }
                  }}>
                    <span className="media-link-type">{t(`media.post.linkTypes.${link.link_type}`, { defaultValue: link.link_type })}</span>
                    <span className="media-link-name">{link.label || link.name_snapshot}</span>
                    {link.price_snapshot_cents != null && (
                      <span className="media-link-price">
                        ${(link.price_snapshot_cents / 100).toFixed(2)}
                      </span>
                    )}
                    <span className="media-link-cta">{t(`media.post.cta.${link.link_type}`, { defaultValue: link.cta })}</span>
                  </Link>
                ) : (
                  <div key={link.id} className="media-link-chip unavailable">
                    <span className="media-link-type">{t(`media.post.linkTypes.${link.link_type}`, { defaultValue: link.link_type })}</span>
                    <span className="media-link-name">{link.name_snapshot}</span>
                  </div>
                )
              ))}
            </div>
          </div>
        )}
        <div className="media-action-row">
          <Link to={`/media/post/${post.id}`} className="media-action">
            💬 {formatCount(post.reply_count)}
          </Link>
          <button onClick={handleRepost} className={`media-action ${reposted ? 'active' : ''}`} aria-label={t('media.post.repost')}>
            🔁 {formatCount(repostCount)}
          </button>
          <button onClick={handleLike} className={`media-action ${liked ? 'active' : ''}`}>
            {liked ? '❤️' : '🤍'} {formatCount(likeCount)}
          </button>
          <button onClick={handleBookmark} className={`media-action ${bookmarked ? 'active' : ''}`}>
            {bookmarked ? '🔖' : '📑'} {formatCount(bookmarkCount)}
          </button>
          <button onClick={handleShare} className="media-action" aria-label={t('media.post.share')}>
            ↗️ {t('media.post.share')}
          </button>
        </div>
      </div>
    </article>
  );
}
