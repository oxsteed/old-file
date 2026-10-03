// Restaurant Media tab: TikTok-style vertical video feed.
//
// One video per viewport-height view in a scroll-snap container. The
// in-view video (IntersectionObserver, threshold 0.6) mounts its iframe
// with autoplay+muted params; offscreen slots render a tap-to-play poster
// so embeds never all load at once (and a tap always works even if the
// observer misbehaves). Likes are optimistic with server reconciliation.
// Signed-out visitors are watch-only: like/post CTAs go through the
// login gate.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  toAutoplayEmbedUrl,
  toEmbedUrl,
  detectVideoProvider,
  toPosterImageUrl,
} from '../../../utils/videoEmbed';
import {
  dishLinkState,
  applyLikeToggle,
  MEDIA_FLAG_REASONS,
} from '../../../utils/restaurantMedia';
import {
  isPhotoUpload,
  isVideoUpload,
  uploadedMediaUrl,
} from '../../../utils/restaurantMediaUpload';
import RestaurantMediaUploadModal from './RestaurantMediaUploadModal';
import {
  listRestaurantMedia,
  postRestaurantMedia,
  uploadRestaurantMediaFile,
  getMyRestaurantMedia,
  toggleRestaurantMediaLike,
  deleteRestaurantMedia,
  flagRestaurantMedia,
  mediaErrorCode,
} from '../../../api/restaurantMedia';
import { formatFoodMoney } from '../../../api/food';

const PAGE_SIZE = 10;
const FEED_HEIGHT = 'min(74vh, 780px)';

const errText = (t, code) =>
  t(`food.restaurant.media.errors.${code}`, { defaultValue: t('food.restaurant.media.errors.unknown') });

// ── Dish anchor bar (TikTok-Shop style) ──────────────────────────────────────
function DishBar({ dishes, onDishTap, t }) {
  if (!dishes || dishes.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 10, paddingBottom: 2 }}>
      {dishes.map((d) => {
        const price = formatFoodMoney(Number(d.price_cents) || 0, d.currency_code || 'USD');
        const key = d.menu_item_id ?? d.id ?? d.name;
        if (dishLinkState(d) === 'tappable') {
          return (
            <button
              key={key}
              onClick={(e) => { e.stopPropagation(); onDishTap(d.menu_item_id); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.35)',
                color: '#fff', borderRadius: 9999, padding: '7px 12px', fontSize: 13,
                fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(6px)', whiteSpace: 'nowrap',
              }}
            >
              <span aria-hidden="true">🛒</span>
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
              <span style={{ fontWeight: 800 }}>{price}</span>
            </button>
          );
        }
        // Snapshot only: plain text, not tappable (dish rotated off the menu).
        return (
          <span
            key={key}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)',
              borderRadius: 9999, padding: '7px 12px', fontSize: 13, whiteSpace: 'nowrap',
            }}
            title={t('food.restaurant.media.dishSnapshot')}
          >
            <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
            <span>{price}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── Uploaded video view (media_type 'video_upload') ─────────────────────────
// Ready uploads play muted + looping with the same in-view behavior as the
// link embeds: the active view plays, offscreen views stay paused. The
// source is the 720p-preferred rendition URL.
function UploadVideoView({ media, isActive }) {
  const ref = useRef(null);
  const src = uploadedMediaUrl(media);
  const poster = media.thumbnail_url || undefined;

  useEffect(() => {
    const el = ref.current;
    if (el) el.muted = true;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    if (isActive) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isActive, src]);

  if (!src) {
    return <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#1e293b 0%,#0f172a 60%,#312e81 100%)' }} />;
  }
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#0b0f16' }}
    />
  );
}

// ── One feed view ────────────────────────────────────────────────────────────
function MediaView({
  media, isActive, onActivate, signedIn, canDelete, confirmDelete,
  onLike, onFlag, onDelete, onDishTap, flagOpen, onToggleFlag, t, i18n,
}) {
  const playUrl = toAutoplayEmbedUrl(media.video_url, media.provider);
  const pausedUrl = toEmbedUrl(media.video_url, media.provider);
  const posterImg = toPosterImageUrl(media.video_url, media.provider);
  const posterName = media.poster?.name || t('food.restaurant.media.guestPoster');
  const created = media.created_at ? new Date(media.created_at).toLocaleDateString(i18n.resolvedLanguage) : '';
  const photoUpload = isPhotoUpload(media);
  const videoUpload = isVideoUpload(media);
  const uploadSrc = photoUpload || videoUpload ? uploadedMediaUrl(media) : null;

  return (
    <div
      data-media-id={media.id}
      style={{
        height: '100%', scrollSnapAlign: 'start', position: 'relative',
        background: '#0b0f16', flexShrink: 0, overflow: 'hidden',
      }}
    >
      {photoUpload ? (
        uploadSrc ? (
          <img
            src={uploadSrc}
            alt={media.caption || posterName}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#1e293b 0%,#0f172a 60%,#312e81 100%)' }} />
        )
      ) : videoUpload ? (
        <UploadVideoView media={media} isActive={isActive} />
      ) : isActive && playUrl ? (
        <iframe
          src={playUrl}
          title={media.caption || posterName}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      ) : (
        <button
          onClick={onActivate}
          aria-label={t('food.restaurant.media.playVideo')}
          style={{
            width: '100%', height: '100%', border: 'none', padding: 0, cursor: 'pointer',
            position: 'relative', display: 'block', background: '#0b0f16',
          }}
        >
          {posterImg ? (
            <img src={posterImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#1e293b 0%,#0f172a 60%,#312e81 100%)' }} />
          )}
          <span style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#0f172a',
          }} aria-hidden="true">▶</span>
          {!pausedUrl && (
            <span style={{ position: 'absolute', bottom: 90, left: 12, right: 12, color: '#fca5a5', fontSize: 13, fontWeight: 600 }}>
              {t('food.restaurant.media.videoUnavailable')}
            </span>
          )}
        </button>
      )}

      {/* Right rail: like / flag / delete */}
      <div style={{ position: 'absolute', right: 10, bottom: 118, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', zIndex: 3 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onLike(media); }}
            aria-label={t('food.restaurant.media.like')}
            style={{
              width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'rgba(0,0,0,0.45)', color: media.liked_by_me ? '#f43f5e' : '#fff',
              fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(6px)',
            }}
          >
            {media.liked_by_me ? '❤️' : '🤍'}
          </button>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
            {Number(media.like_count) || 0}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFlag(media.id); }}
          aria-label={t('food.restaurant.media.flag')}
          style={{
            width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 19,
            display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)',
          }}
        >
          🚩
        </button>
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(media); }}
            aria-label={t('food.restaurant.media.delete')}
            title={confirmDelete ? t('food.restaurant.media.confirmDelete') : t('food.restaurant.media.delete')}
            style={{
              width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: confirmDelete ? '#dc2626' : 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)',
            }}
          >
            {confirmDelete ? '✓' : '🗑️'}
          </button>
        )}
      </div>

      {/* Flag reason popover */}
      {flagOpen && (
        <div style={{
          position: 'absolute', right: 64, bottom: 100, zIndex: 5, background: '#fff',
          borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.35)', padding: 8, minWidth: 220,
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', padding: '6px 10px' }}>
            {t('food.restaurant.media.flagTitle')}
          </p>
          {MEDIA_FLAG_REASONS.map((reason) => (
            <button
              key={reason}
              onClick={(e) => { e.stopPropagation(); onFlag(media, reason); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none',
                padding: '9px 10px', fontSize: 14, color: '#334155', cursor: 'pointer', borderRadius: 8,
              }}
            >
              {t(`food.restaurant.media.flagReasons.${reason}`)}
            </button>
          ))}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFlag(null); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none',
              padding: '9px 10px', fontSize: 14, color: '#94a3b8', cursor: 'pointer', borderRadius: 8,
            }}
          >
            {t('food.restaurant.media.cancel')}
          </button>
        </div>
      )}

      {/* Bottom info overlay */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2,
        padding: '34px 14px 14px', color: '#fff',
        background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
          <span style={{
            width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700,
            flexShrink: 0, backdropFilter: 'blur(6px)',
          }}>
            {(posterName || '?').charAt(0).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{posterName}</span>
              {media.verified_order && (
                <span
                  title={t('food.restaurant.media.verifiedOrder')}
                  style={{ fontSize: 11, fontWeight: 700, background: '#16a34a', borderRadius: 9999, padding: '2px 8px', whiteSpace: 'nowrap' }}
                >
                  ✓ {t('food.restaurant.media.verifiedOrder')}
                </span>
              )}
            </p>
            {created && <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{created}</p>}
          </div>
        </div>
        {media.caption && (
          <p style={{ fontSize: 14, marginTop: 8, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {media.caption}
          </p>
        )}
        <div style={{ pointerEvents: 'auto' }}>
          <DishBar dishes={media.dishes} onDishTap={onDishTap} t={t} />
        </div>
      </div>
    </div>
  );
}

// ── Feed ─────────────────────────────────────────────────────────────────────
export default function RestaurantMediaFeed({
  restaurantId, user, isAdmin, menuItems = [], onDishTap, onRequireLogin,
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [postOpen, setPostOpen] = useState(false);
  const [flagOpenId, setFlagOpenId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  // Own uploads still processing (quarantine/processing/failed). The public
  // list never includes them, so they surface here as dismissible notices.
  const [processingNotices, setProcessingNotices] = useState([]);
  const containerRef = useRef(null);
  const signedIn = Boolean(user);

  const liveDishes = useMemo(
    () => (menuItems || []).filter((d) => d && d.is_available !== false),
    [menuItems],
  );

  // Lazy load: the parent only mounts this component when the Media tab is
  // first activated, so mount == first activation.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listRestaurantMedia(restaurantId, { page: 1, pageSize: PAGE_SIZE })
      .then(({ media, hasMore: more, viewerCanModerate }) => {
        if (cancelled) return;
        setItems(media);
        setHasMore(more);
        setCanModerate(Boolean(viewerCanModerate));
        setPage(1);
      })
      .catch(() => {
        if (!cancelled) toast.error(t('food.restaurant.media.errors.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Best-effort: surface the signed-in user's own non-ready uploads as
    // processing notices. The /mine endpoint is a server follow-up and may
    // not exist yet; getMyRestaurantMedia degrades silently to null.
    if (signedIn) {
      getMyRestaurantMedia(restaurantId).then((mine) => {
        if (cancelled || !Array.isArray(mine) || mine.length === 0) return;
        const pending = mine
          .filter((m) => m && m.processing_status && m.processing_status !== 'ready')
          .map((m) => ({ id: m.id, caption: m.caption || '' }));
        if (pending.length > 0) {
          setProcessingNotices((prev) => {
            const seen = new Set(prev.map((n) => String(n.id)));
            return [...prev, ...pending.filter((n) => !seen.has(String(n.id)))];
          });
        }
      });
    }
    return () => { cancelled = true; };
  }, [restaurantId, t, signedIn]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    listRestaurantMedia(restaurantId, { page: page + 1, pageSize: PAGE_SIZE })
      .then(({ media, hasMore: more }) => {
        setItems((prev) => [...prev, ...media]);
        setHasMore(more);
        setPage((p) => p + 1);
      })
      .catch(() => toast.error(t('food.restaurant.media.errors.loadFailed')))
      .finally(() => setLoadingMore(false));
  }, [restaurantId, page, hasMore, loadingMore, t]);

  // Autoplay: the view crossing the 0.6 visibility threshold inside the
  // feed container becomes the active (autoplaying) video. Offscreen views
  // keep a tap-to-play poster so iframes never all load at once, and a tap
  // always starts a video even if the observer misbehaves.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActiveId(entry.target.dataset.mediaId);
      }
    }, { root, threshold: 0.6 });
    const nodes = root.querySelectorAll('[data-media-id]');
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [items.length, loading]);

  const handleLike = useCallback(async (media) => {
    if (!signedIn) { onRequireLogin(); return; }
    const snapshot = media;
    setItems((prev) => prev.map((m) => (String(m.id) === String(media.id) ? applyLikeToggle(m) : m)));
    try {
      const res = await toggleRestaurantMediaLike(restaurantId, media.id);
      setItems((prev) => prev.map((m) => (String(m.id) === String(media.id)
        ? { ...m, liked_by_me: res.liked, like_count: res.like_count }
        : m)));
    } catch {
      setItems((prev) => prev.map((m) => (String(m.id) === String(media.id) ? snapshot : m)));
      toast.error(t('food.restaurant.media.errors.likeFailed'));
    }
  }, [signedIn, restaurantId, onRequireLogin, t]);

  const handleDelete = useCallback(async (media) => {
    if (confirmDeleteId !== media.id) {
      setConfirmDeleteId(media.id);
      setTimeout(() => setConfirmDeleteId((cur) => (cur === media.id ? null : cur)), 4000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteRestaurantMedia(restaurantId, media.id);
      setItems((prev) => prev.filter((m) => String(m.id) !== String(media.id)));
      toast.success(t('food.restaurant.media.deleted'));
    } catch (err) {
      toast.error(errText(t, mediaErrorCode(err)));
    }
  }, [confirmDeleteId, restaurantId, t]);

  const handleFlag = useCallback(async (media, reason) => {
    setFlagOpenId(null);
    if (!signedIn) { onRequireLogin(); return; }
    try {
      await flagRestaurantMedia(restaurantId, media.id, { reason });
      toast.success(t('food.restaurant.media.flagSuccess'));
    } catch (err) {
      const code = mediaErrorCode(err);
      toast.error(code === 'media_flag_exists'
        ? t('food.restaurant.media.alreadyFlagged')
        : errText(t, code));
    }
  }, [signedIn, restaurantId, onRequireLogin, t]);

  const handlePostLink = useCallback(async ({ video_url, caption, dish_ids }) => {
    try {
      const created = await postRestaurantMedia(restaurantId, { video_url, caption, dish_ids });
      // The created item may come nested or bare; normalize defensively.
      const item = created?.media || created?.item || created;
      if (item && item.id) {
        setItems((prev) => [item, ...prev]);
        setPostOpen(false);
        toast.success(t('food.restaurant.media.postModal.posted'));
        return item;
      }
      // Fall back to a refetch if the shape is unexpected.
      const { media } = await listRestaurantMedia(restaurantId, { page: 1, pageSize: PAGE_SIZE });
      setItems(media);
      setPostOpen(false);
      toast.success(t('food.restaurant.media.postModal.posted'));
      return null;
    } catch (err) {
      toast.error(errText(t, mediaErrorCode(err)));
      return null;
    }
  }, [restaurantId, t]);

  const refreshFeed = useCallback(async () => {
    try {
      const { media, hasMore: more } = await listRestaurantMedia(restaurantId, { page: 1, pageSize: PAGE_SIZE });
      setItems(media);
      setHasMore(more);
      setPage(1);
    } catch {
      toast.error(t('food.restaurant.media.errors.loadFailed'));
    }
  }, [restaurantId, t]);

  // Device upload (photo/video tabs of the modal). Photos land ready (201)
  // and prepend to the feed; videos are accepted into quarantine (202) and
  // never appear in the public list, so the uploader gets a dismissible
  // processing notice instead. Errors are shown inside the modal.
  const handleUploadFile = useCallback(async ({ kind, file, caption, dishIds }, onProgress) => {
    const { status, item } = await uploadRestaurantMediaFile(
      restaurantId,
      { kind, file, caption, dishIds },
      { onProgress },
    );
    const normalized = item?.media || item?.item || item;
    setPostOpen(false);
    if (status === 202) {
      setProcessingNotices((prev) => {
        const id = normalized?.id || `pending-${Date.now()}`;
        if (prev.some((n) => String(n.id) === String(id))) return prev;
        return [{ id, caption: caption || '' }, ...prev];
      });
      return { status, item: normalized };
    }
    if (normalized && normalized.id) {
      setItems((prev) => [normalized, ...prev]);
      toast.success(t('food.restaurant.media.upload.postedPhoto'));
    } else {
      await refreshFeed();
      toast.success(t('food.restaurant.media.upload.postedPhoto'));
    }
    return { status, item: normalized };
  }, [restaurantId, t, refreshFeed]);

  const dismissProcessingNotice = useCallback((id) => {
    setProcessingNotices((prev) => prev.filter((n) => String(n.id) !== String(id)));
  }, []);

  const canDelete = useCallback((m) => {
    if (!signedIn) return false;
    if (isAdmin || canModerate) return true;
    return String(m.poster?.id) === String(user?.id);
  }, [signedIn, isAdmin, canModerate, user]);

  if (loading) {
    return (
      <div style={{ height: FEED_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0f16', borderRadius: 12 }}>
        <p style={{ color: '#94a3b8', fontSize: 14 }}>{t('food.restaurant.media.loading')}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header row: post CTA or login prompt */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text, #0f172a)' }}>
          🎬 {t('food.restaurant.media.title')}
        </p>
        {signedIn ? (
          <button
            onClick={() => setPostOpen(true)}
            style={{ padding: '9px 16px', borderRadius: 9999, border: 'none', background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            ＋ {t('food.restaurant.media.postVideo')}
          </button>
        ) : (
          <button
            onClick={onRequireLogin}
            style={{ padding: '9px 16px', borderRadius: 9999, border: '1.5px solid var(--color-border, #e2e8f0)', background: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text, #0f172a)' }}
          >
            {t('food.restaurant.media.loginToPost')}
          </button>
        )}
      </div>

      {processingNotices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {processingNotices.map((notice) => (
            <div
              key={notice.id}
              role="status"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
                borderRadius: 12, background: 'var(--color-surface-2, #f8fafc)',
                border: '1px solid var(--color-border, #e2e8f0)',
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1.2 }} aria-hidden="true">⏳</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text, #0f172a)', marginBottom: 2 }}>
                  {t('food.restaurant.media.upload.processingNotice.title')}
                </p>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted, #64748b)', lineHeight: 1.45 }}>
                  {t('food.restaurant.media.upload.processingNotice.body')}
                  {' '}
                  {t('food.restaurant.media.upload.processingNotice.failedHint')}
                </p>
                <button
                  onClick={refreshFeed}
                  style={{ marginTop: 8, padding: '7px 14px', borderRadius: 9999, border: 'none', background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  {t('food.restaurant.media.upload.processingNotice.refresh')}
                </button>
              </div>
              <button
                onClick={() => dismissProcessingNotice(notice.id)}
                aria-label={t('food.restaurant.media.upload.processingNotice.dismiss')}
                style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--color-text-muted, #64748b)', padding: 2 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px 20px', background: 'var(--color-surface-2, #f8fafc)', borderRadius: 12 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🎥</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text, #0f172a)', marginBottom: 6 }}>
            {t('food.restaurant.media.emptyTitle')}
          </p>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted, #64748b)', marginBottom: 18 }}>
            {t('food.restaurant.media.emptySubtitle')}
          </p>
          {signedIn ? (
            <button
              onClick={() => setPostOpen(true)}
              style={{ padding: '12px 26px', borderRadius: 9999, border: 'none', background: '#f97316', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              {t('food.restaurant.media.postVideo')}
            </button>
          ) : (
            <button
              onClick={onRequireLogin}
              style={{ padding: '12px 26px', borderRadius: 9999, border: '1.5px solid var(--color-border, #e2e8f0)', background: 'var(--color-surface, #fff)', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text, #0f172a)' }}
            >
              {t('food.restaurant.media.loginButton')}
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            style={{
              height: FEED_HEIGHT, minHeight: 480, overflowY: 'auto', scrollSnapType: 'y mandatory',
              borderRadius: 12, background: '#0b0f16', overscrollBehavior: 'contain',
            }}
          >
            {items.map((m) => (
              <MediaView
                key={m.id}
                media={m}
                isActive={String(activeId) === String(m.id)}
                onActivate={() => setActiveId(String(m.id))}
                signedIn={signedIn}
                canDelete={canDelete(m)}
                confirmDelete={confirmDeleteId === m.id}
                onLike={handleLike}
                onFlag={handleFlag}
                onDelete={handleDelete}
                onDishTap={onDishTap}
                flagOpen={flagOpenId === m.id}
                onToggleFlag={(id) => setFlagOpenId((cur) => (cur === id ? null : id))}
                t={t}
                i18n={i18n}
              />
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{ padding: '10px 24px', borderRadius: 9999, border: '1.5px solid var(--color-border, #e2e8f0)', background: 'var(--color-surface, #fff)', fontSize: 14, fontWeight: 600, cursor: loadingMore ? 'wait' : 'pointer', color: 'var(--color-text, #0f172a)' }}
              >
                {loadingMore ? t('food.restaurant.media.loadingMore') : t('food.restaurant.media.loadMore')}
              </button>
            </div>
          )}
        </>
      )}

      {postOpen && (
        <RestaurantMediaUploadModal
          liveDishes={liveDishes}
          onClose={() => setPostOpen(false)}
          onPostLink={handlePostLink}
          onUploadFile={handleUploadFile}
          t={t}
        />
      )}
    </div>
  );
}
