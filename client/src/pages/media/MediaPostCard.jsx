import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { createCreatorBoost, flagPost, recordShare, settleCreatorBoost, toggleLike, toggleBookmark, toggleRepost } from '../../api/media';
import useMediaPostRealtime from '../../hooks/useMediaPostRealtime';

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
      <video src={asset.url} poster={asset.thumbnail_url || undefined} controls muted={muted} playsInline preload="metadata" aria-label={label} />
      <button type="button" className="media-video-mute" aria-label={muted ? mutedLabel : unmutedLabel} onClick={() => setMuted((value) => !value)}>
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
  const [shareCount, setShareCount] = useState(post.share_count);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [bookmarkCount, setBookmarkCount] = useState(post.bookmark_count);
  const [repostCount, setRepostCount] = useState(post.repost_count);
  const [replyCount, setReplyCount] = useState(post.reply_count);
  const [viewCount, setViewCount] = useState(post.view_count);
  const [reportReason, setReportReason] = useState('spam');
  const [reporting, setReporting] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [boostOpen, setBoostOpen] = useState(false);
  const [boostAmount, setBoostAmount] = useState('');
  const [boostIdempotencyKey, setBoostIdempotencyKey] = useState('');
  const [boosting, setBoosting] = useState(false);
  const [boostMessage, setBoostMessage] = useState('');

  // Feed refreshes and route transitions can reuse a card instance. Reconcile
  // the server's viewer-specific action state whenever the post payload is
  // replaced so a previous viewer/post state cannot leak into the new card.
  useEffect(() => {
    setLiked(Boolean(post.liked));
    setBookmarked(Boolean(post.bookmarked));
    setReposted(Boolean(post.reposted));
    setShareCount(Number(post.share_count) || 0);
    setLikeCount(Number(post.like_count) || 0);
    setBookmarkCount(Number(post.bookmark_count) || 0);
    setRepostCount(Number(post.repost_count) || 0);
    setReplyCount(Number(post.reply_count) || 0);
    setViewCount(Number(post.view_count) || 0);
  }, [post.id, post.liked, post.bookmarked, post.reposted, post.like_count, post.bookmark_count, post.repost_count, post.share_count, post.reply_count, post.view_count]);

  const applyLiveCounts = useCallback((payload) => {
    const next = {};
    if (Number.isFinite(Number(payload?.like_count))) { setLikeCount(Number(payload.like_count)); next.like_count = Number(payload.like_count); }
    if (Number.isFinite(Number(payload?.bookmark_count))) { setBookmarkCount(Number(payload.bookmark_count)); next.bookmark_count = Number(payload.bookmark_count); }
    if (Number.isFinite(Number(payload?.repost_count))) { setRepostCount(Number(payload.repost_count)); next.repost_count = Number(payload.repost_count); }
    if (Number.isFinite(Number(payload?.share_count))) { setShareCount(Number(payload.share_count)); next.share_count = Number(payload.share_count); }
    if (Number.isFinite(Number(payload?.reply_count))) { setReplyCount(Number(payload.reply_count)); next.reply_count = Number(payload.reply_count); }
    if (Number.isFinite(Number(payload?.view_count))) { setViewCount(Number(payload.view_count)); next.view_count = Number(payload.view_count); }
    if (Object.keys(next).length) onUpdate?.(current => ({ ...current, ...next }));
  }, [onUpdate]);

  useMediaPostRealtime(post.id, applyLiveCounts);

  const handleLike = async (e) => {
    e.preventDefault();
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    try {
      const r = await toggleLike(post.id);
      setLiked(r.liked);
      if (Number.isFinite(Number(r.like_count))) setLikeCount(Number(r.like_count));
      else setLikeCount(c => Math.max(0, c + (r.liked ? 1 : -1)));
    } catch { /* keep the server state when the request fails */ }
  };

  const handleBookmark = async (e) => {
    e.preventDefault();
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    try {
      const r = await toggleBookmark(post.id);
      setBookmarked(r.bookmarked);
      if (Number.isFinite(Number(r.bookmark_count))) setBookmarkCount(Number(r.bookmark_count));
      else setBookmarkCount(c => Math.max(0, c + (r.bookmarked ? 1 : -1)));
    } catch { /* keep the server state when the request fails */ }
  };

  const handleRepost = async (e) => {
    e.preventDefault();
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    try {
      const r = await toggleRepost(post.id);
      setReposted(r.reposted);
      if (Number.isFinite(Number(r.repost_count))) setRepostCount(Number(r.repost_count));
      else setRepostCount(c => Math.max(0, c + (r.reposted ? 1 : -1)));
    } catch { /* keep the server state when the request fails */ }
  };

  const handleShare = async (e) => {
    e.preventDefault();
    const url = `${window.location.origin}/media/post/${post.id}`;
    try {
      let shared = false;
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: post.display_name, text: post.body, url });
        shared = true;
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        shared = true;
      }
      if (shared) {
        const result = await recordShare(post.id);
        if (Number.isFinite(Number(result.share_count))) setShareCount(Number(result.share_count));
      }
    } catch { /* sharing can be cancelled by the user */ }
  };

  const handleReport = async () => {
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    setReporting(true);
    setReportMessage('');
    try {
      await flagPost(post.id, { reason: reportReason });
      setReportMessage(t('media.post.reportSent', { defaultValue: 'Report sent. Thank you.' }));
    } catch (err) {
      setReportMessage(err.response?.data?.error || t('media.post.reportError', { defaultValue: 'Could not send report.' }));
    } finally {
      setReporting(false);
    }
  };

  const handleBoost = async (event) => {
    event.preventDefault();
    if (!user) return navigate('/login', { state: { from: window.location.pathname } });
    setBoosting(true); setBoostMessage('');
    try {
      const created = await createCreatorBoost(post.id, {
        amountCents: Number(boostAmount),
        idempotencyKey: boostIdempotencyKey,
      });
      await settleCreatorBoost(created.boost.id);
      setBoostMessage(t('media.post.boostSent'));
    } catch (err) {
      setBoostMessage(err.response?.data?.error || t('media.post.boostError'));
    } finally { setBoosting(false); }
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
          {post.is_sponsored && <span className="media-post-sponsored">{t('media.post.sponsored')}</span>}
          <VerifiedBadge kind={post.verified_kind} label={t('media.post.verified')} />
          <span className="media-post-handle">@{post.handle}</span>
          <span className="media-post-time">· {timeAgo(post.created_at, i18n.language)}</span>
          <span className="media-post-views">· {formatCount(viewCount)} {t('media.post.views')}</span>
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
            {post.quoted.links?.length > 0 && (
              <div className="media-quoted-links">
                <span className="media-linked-label">{t('media.post.linkedOn')}</span>
                {post.quoted.links.map((link) => link.available && link.canonical_url ? (
                  <Link key={link.id} to={link.canonical_url} className="media-link-chip">
                    <span className="media-link-name">{link.name || link.name_snapshot}</span>
                  </Link>
                ) : (
                  <span key={link.id} className="media-link-chip unavailable">{link.name || link.name_snapshot}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {post.links && post.links.length > 0 && (
          <div className="media-linked-entities">
            <div className="media-linked-label">{t('media.post.linkedOn')}</div>
            <div className="media-linked-row">
              {post.links.map(link => (
                link.available && link.canonical_url ? (
                  <Link key={link.id} to={link.canonical_url} className="media-link-chip">
                    <span className="media-link-type">{t(`media.post.linkTypes.${link.link_type}`, { defaultValue: link.link_type })}</span>
                    <span className="media-link-name">{link.name || link.label || link.name_snapshot}</span>
                    {(link.price_cents ?? link.price_snapshot_cents) != null && (
                      <span className="media-link-price">
                        ${(Number(link.price_cents ?? link.price_snapshot_cents) / 100).toFixed(2)}
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
          <Link to={`/media/post/${post.id}`} className="media-action" aria-label={t('media.post.reply', { defaultValue: 'Reply' })}>
            💬 {formatCount(replyCount)}
          </Link>
          <button onClick={handleRepost} className={`media-action ${reposted ? 'active' : ''}`} aria-label={t('media.post.repost')} aria-pressed={reposted}>
            🔁 {formatCount(repostCount)}
          </button>
          <button onClick={handleLike} className={`media-action ${liked ? 'active' : ''}`} aria-label={t('media.post.like', { defaultValue: 'Like' })} aria-pressed={liked}>
            {liked ? '❤️' : '🤍'} {formatCount(likeCount)}
          </button>
          <button onClick={handleBookmark} className={`media-action ${bookmarked ? 'active' : ''}`} aria-label={t('media.post.bookmark', { defaultValue: 'Bookmark' })} aria-pressed={bookmarked}>
            {bookmarked ? '🔖' : '📑'} {formatCount(bookmarkCount)}
          </button>
          <button onClick={handleShare} className="media-action" aria-label={t('media.post.share')}>
            ↗️ {t('media.post.share')} {formatCount(shareCount)}
          </button>
          {user && String(post.owner_user_id) === String(user.id) && post.visibility === 'public' && (
            <button type="button" onClick={() => { setBoostAmount(''); setBoostMessage(''); setBoostIdempotencyKey(`media-boost-${post.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`); setBoostOpen(true); }} className="media-action" aria-label={t('media.post.boost')}>
              ✨ {t('media.post.boost')}
            </button>
          )}
          <details className="media-report-menu">
            <summary className="media-action" aria-label={t('media.post.report', { defaultValue: 'Report post' })}>•••</summary>
            <div className="media-report-panel">
              <label htmlFor={`media-report-${post.id}`}>{t('media.post.reportReason', { defaultValue: 'Why are you reporting this?' })}</label>
              <select id={`media-report-${post.id}`} value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                <option value="spam">{t('media.post.reportSpam', { defaultValue: 'Spam' })}</option>
                <option value="harassment">{t('media.post.reportHarassment', { defaultValue: 'Harassment' })}</option>
                <option value="unsafe">{t('media.post.reportUnsafe', { defaultValue: 'Unsafe content' })}</option>
                <option value="copyright">{t('media.post.reportCopyright', { defaultValue: 'Copyright' })}</option>
              </select>
              <button type="button" onClick={handleReport} disabled={reporting}>{reporting ? t('media.post.reporting', { defaultValue: 'Sending…' }) : t('media.post.reportSubmit', { defaultValue: 'Report' })}</button>
              {reportMessage && <span role="status">{reportMessage}</span>}
            </div>
          </details>
        </div>
      </div>
      {boostOpen && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBoostOpen(false); }}>
        <form className="media-verification-form" onSubmit={handleBoost} role="dialog" aria-modal="true" aria-labelledby={`media-boost-title-${post.id}`}>
          <button type="button" className="media-dialog-close" onClick={() => setBoostOpen(false)} aria-label={t('media.shell.close')}><span aria-hidden="true">×</span></button>
          <h2 id={`media-boost-title-${post.id}`}>{t('media.post.boost')}</h2>
          {boostMessage ? <p role="status">{boostMessage}</p> : <>
            <label htmlFor={`media-boost-amount-${post.id}`}>{t('media.post.boostAmount')}</label>
            <input id={`media-boost-amount-${post.id}`} type="number" min="1" step="1" value={boostAmount} onChange={(event) => setBoostAmount(event.target.value)} required />
            <p className="media-form-hint">{t('media.post.boostNotice')}</p>
            <button type="submit" className="media-primary-button" disabled={boosting}>{boosting ? t('media.compose.posting') : t('media.post.boostConfirm')}</button>
          </>}
        </form>
      </div>}
    </article>
  );
}
