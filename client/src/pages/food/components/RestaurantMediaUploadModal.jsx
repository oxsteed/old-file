// Restaurant Media post modal with three tabs: Link | Photo | Video.
//
// Link: the existing YouTube/Vimeo URL flow (unchanged behavior).
// Photo/Video: device file uploads. Photos POST to /media/photo-uploads
// (201, ready immediately); videos POST to /media/video-uploads (202,
// quarantine) and the uploader gets a processing notice in the feed.
// Uploads use raw XMLHttpRequest (see utils/restaurantMediaUpload) because
// fetch cannot report upload progress. Client-side pre-checks (size caps
// 10 MB photo / 200 MB video + MIME allowlist) run before anything is sent.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MEDIA_UPLOAD_TABS,
  validateUploadFile,
  formatFileSize,
} from '../../../utils/restaurantMediaUpload';
import { detectVideoProvider } from '../../../utils/videoEmbed';
import { mediaErrorCode } from '../../../api/restaurantMedia';

const CAPTION_MAX = 280;

const tabStyle = (active) => ({
  flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, fontSize: 14,
  fontWeight: 700, cursor: 'pointer',
  background: active ? '#f97316' : 'var(--color-surface-2, #f1f5f9)',
  color: active ? '#fff' : 'var(--color-text-muted, #64748b)',
});

function DishPicker({ liveDishes, selected, onToggle, t }) {
  return (
    <>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text, #0f172a)', margin: '10px 0 6px' }}>
        {t('food.restaurant.media.postModal.dishesLabel')}
      </p>
      {liveDishes.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted, #64748b)' }}>
          {t('food.restaurant.media.postModal.noDishes')}
        </p>
      ) : (
        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 10 }}>
          {liveDishes.map((d) => {
            const on = selected.includes(d.id);
            return (
              <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 14, cursor: 'pointer', borderBottom: '1px solid var(--color-border, #f1f5f9)', color: 'var(--color-text, #0f172a)' }}>
                <input type="checkbox" checked={on} onChange={() => onToggle(d.id)} style={{ width: 17, height: 17, accentColor: '#f97316' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                <span style={{ fontWeight: 700, color: '#f97316', whiteSpace: 'nowrap' }}>{d.priceStr}</span>
              </label>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function RestaurantMediaUploadModal({ liveDishes, onClose, onPostLink, onUploadFile, t }) {
  const [tab, setTab] = useState('link');
  // Link tab
  const [url, setUrl] = useState('');
  // Shared
  const [caption, setCaption] = useState('');
  const [selected, setSelected] = useState([]);
  const [posting, setPosting] = useState(false);
  // Upload tabs
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const isUploadTab = tab === 'photo' || tab === 'video';
  const accept = tab === 'video' ? 'video/*' : 'image/*';

  const detected = useMemo(() => detectVideoProvider(url), [url]);
  const urlTouched = url.trim().length > 0;
  const urlValid = Boolean(detected);

  const toggleDish = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const switchTab = (next) => {
    if (posting) return;
    setTab(next);
    setFile(null);
    setFileError('');
    setProgress(0);
  };

  const onFileChosen = (e) => {
    const picked = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!picked) return;
    const check = validateUploadFile(picked, tab);
    if (!check.ok) {
      setFile(null);
      setFileError(t(`food.restaurant.media.upload.${check.error}`));
      return;
    }
    setFileError('');
    setProgress(0);
    setFile(picked);
  };

  const submitLink = async () => {
    if (!urlValid || posting) return;
    setPosting(true);
    try {
      await onPostLink({
        video_url: url.trim(),
        caption: caption.trim().slice(0, CAPTION_MAX),
        dish_ids: selected,
      });
    } finally {
      setPosting(false);
    }
  };

  const submitUpload = async () => {
    if (!file || posting) return;
    // Re-validate at submit time in case the file changed underneath us.
    const check = validateUploadFile(file, tab);
    if (!check.ok) {
      setFileError(t(`food.restaurant.media.upload.${check.error}`));
      return;
    }
    setPosting(true);
    setFileError('');
    setProgress(0);
    try {
      await onUploadFile(
        {
          kind: tab,
          file,
          caption: caption.trim().slice(0, CAPTION_MAX),
          dishIds: selected,
        },
        (fraction) => setProgress(Math.min(1, Math.max(0, fraction))),
      );
    } catch (err) {
      const code = mediaErrorCode(err);
      setFileError(
        code === 'network'
          ? t('food.restaurant.media.errors.network')
          : t('food.restaurant.media.upload.uploadFailed'),
      );
    } finally {
      setPosting(false);
    }
  };

  const submitLabel = tab === 'link'
    ? t('food.restaurant.media.postModal.submit')
    : t('food.restaurant.media.upload.submitFile');
  const submitDisabled = posting || (tab === 'link' ? !urlValid : !file);
  const handleSubmit = tab === 'link' ? submitLink : submitUpload;

  return (
    <div
      role="dialog" aria-modal="true" aria-label={t('food.restaurant.media.postModal.title')}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface, #fff)', width: '100%', maxWidth: 560, maxHeight: '92vh',
          overflowY: 'auto', borderRadius: '18px 18px 0 0', padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text, #0f172a)' }}>
            {t('food.restaurant.media.postModal.title')}
          </h3>
          <button onClick={onClose} aria-label={t('food.restaurant.media.cancel')}
            style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--color-surface-2, #f1f5f9)', fontSize: 18, cursor: 'pointer', color: 'var(--color-text-muted, #64748b)' }}>×</button>
        </div>

        <div role="tablist" aria-label={t('food.restaurant.media.postModal.title')} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {MEDIA_UPLOAD_TABS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => switchTab(key)}
              style={tabStyle(tab === key)}
            >
              {t(`food.restaurant.media.upload.tabs.${key}`)}
            </button>
          ))}
        </div>

        {tab === 'link' && (
          <>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--color-text, #0f172a)', marginBottom: 6 }}>
              {t('food.restaurant.media.postModal.urlLabel')}
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('food.restaurant.media.postModal.urlPlaceholder')}
              inputMode="url"
              dir="ltr"
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 10, fontSize: 14,
                border: `1.5px solid ${urlTouched ? (urlValid ? '#16a34a' : '#dc2626') : 'var(--color-border, #e2e8f0)'}`,
                background: 'var(--color-surface, #fff)', color: 'var(--color-text, #0f172a)',
              }}
            />
            <p style={{ fontSize: 12, marginTop: 6, minHeight: 18, color: urlTouched ? (urlValid ? '#16a34a' : '#dc2626') : 'var(--color-text-muted, #64748b)' }}>
              {urlTouched
                ? (urlValid
                  ? t(`food.restaurant.media.postModal.urlDetect.${detected}`)
                  : t('food.restaurant.media.postModal.urlDetect.invalid'))
                : t('food.restaurant.media.postModal.urlHint')}
            </p>
          </>
        )}

        {isUploadTab && (
          <>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text, #0f172a)', marginBottom: 6 }}>
              {t(`food.restaurant.media.upload.${tab}Label`)}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={onFileChosen}
              style={{ display: 'none' }}
              aria-label={t(`food.restaurant.media.upload.${tab}Label`)}
            />
            {!file ? (
              <button
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                style={{
                  width: '100%', padding: '26px 12px', borderRadius: 12, cursor: 'pointer',
                  border: '1.5px dashed var(--color-border, #e2e8f0)', background: 'var(--color-surface-2, #f8fafc)',
                  color: 'var(--color-text, #0f172a)', fontSize: 14, fontWeight: 600,
                }}
              >
                <span style={{ fontSize: 26, display: 'block', marginBottom: 6 }} aria-hidden="true">
                  {tab === 'video' ? '🎬' : '📷'}
                </span>
                {t('food.restaurant.media.upload.chooseFile')}
              </button>
            ) : (
              <div style={{ border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 12, overflow: 'hidden' }}>
                {tab === 'photo' && previewUrl ? (
                  <img src={previewUrl} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block' }} />
                ) : tab === 'video' && previewUrl ? (
                  <video src={previewUrl} muted playsInline preload="metadata" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block', background: '#0b0f16' }} />
                ) : null}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text, #0f172a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name} · {formatFileSize(file.size)}
                  </span>
                  <button
                    onClick={() => { setFile(null); setFileError(''); setProgress(0); }}
                    disabled={posting}
                    style={{ border: 'none', background: 'none', color: '#f97316', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {t('food.restaurant.media.upload.changeFile')}
                  </button>
                </div>
                {posting && (
                  <div style={{ padding: '0 12px 12px' }}>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress * 100)}
                      aria-label={t('food.restaurant.media.upload.uploading')}
                      style={{ height: 8, borderRadius: 9999, background: 'var(--color-surface-2, #e2e8f0)', overflow: 'hidden' }}
                    >
                      <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: '#f97316', transition: 'width 150ms linear' }} />
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted, #64748b)', marginTop: 6 }}>
                      {t('food.restaurant.media.upload.uploading')} {Math.round(progress * 100)}%
                    </p>
                  </div>
                )}
              </div>
            )}
            {fileError ? (
              <p role="alert" style={{ fontSize: 13, color: '#dc2626', marginTop: 8, fontWeight: 600 }}>{fileError}</p>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted, #64748b)', marginTop: 8 }}>
                {tab === 'video'
                  ? t('food.restaurant.media.upload.videoHint')
                  : t('food.restaurant.media.upload.photoHint')}
              </p>
            )}
          </>
        )}

        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--color-text, #0f172a)', margin: '10px 0 6px' }}>
          {t('food.restaurant.media.postModal.captionLabel')}
        </label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
          rows={3}
          style={{
            width: '100%', padding: '11px 12px', borderRadius: 10, fontSize: 14, resize: 'vertical',
            border: '1.5px solid var(--color-border, #e2e8f0)', background: 'var(--color-surface, #fff)',
            color: 'var(--color-text, #0f172a)',
          }}
        />
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #64748b)', textAlign: 'right', marginTop: 4 }}>
          {t('food.restaurant.media.postModal.captionCount', { count: caption.length, max: CAPTION_MAX })}
        </p>

        <DishPicker liveDishes={liveDishes} selected={selected} onToggle={toggleDish} t={t} />

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid var(--color-border, #e2e8f0)', background: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--color-text, #0f172a)' }}>
            {t('food.restaurant.media.cancel')}
          </button>
          <button onClick={handleSubmit} disabled={submitDisabled}
            style={{
              flex: 2, padding: '12px 0', borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 700,
              cursor: !submitDisabled ? 'pointer' : 'not-allowed', background: '#f97316', color: '#fff',
              opacity: !submitDisabled ? 1 : 0.55,
            }}>
            {posting ? t('food.restaurant.media.upload.uploading') : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
