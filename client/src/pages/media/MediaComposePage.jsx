import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createPost, getCommunities, getDrafts, linkAsset, publishPost, searchMediaEntities, uploadPhoto, uploadVideo } from '../../api/media';

const LINK_TYPES = ['restaurant', 'food_item', 'helper', 'business', 'job'];
const DRAFT_STORAGE_KEY = 'oxsteed.media.compose.draft';

export default function MediaComposePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [links, setLinks] = useState([]);
  const [linkType, setLinkType] = useState('restaurant');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkPrice, setLinkPrice] = useState('');
  const [entitySuggestions, setEntitySuggestions] = useState([]);
  const [searchingEntities, setSearchingEntities] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [mediaFile, setMediaFile] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [communityId, setCommunityId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftId, setDraftId] = useState(() => window.localStorage.getItem(DRAFT_STORAGE_KEY) || '');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attachedAsset, setAttachedAsset] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    getCommunities().then((data) => setCommunities(data.communities || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const storedDraftId = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!storedDraftId) return;
    getDrafts().then((data) => {
      const draft = (data.drafts || []).find((item) => item.id === storedDraftId);
      if (!draft) {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
        setDraftId('');
        return;
      }
      setDraftId(draft.id);
      setBody(draft.body || '');
      setLinks(draft.links || []);
      setCommunityId(draft.community_id || '');
      setAttachedAsset((draft.assets || []).length > 0);
      setStatus(t('media.compose.draftRestored', { defaultValue: 'Draft restored. Select the file again to retry an interrupted upload.' }));
    }).catch(() => {});
  }, [t]);

  useEffect(() => {
    if (!mediaFile) {
      setPreviewUrl('');
      return undefined;
    }
    const nextUrl = URL.createObjectURL(mediaFile);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [mediaFile]);

  useEffect(() => {
    let cancelled = false;
    const query = linkName.trim();
    if (!query) {
      setEntitySuggestions([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSearchingEntities(true);
      searchMediaEntities({ type: linkType, q: query })
        .then((data) => { if (!cancelled) setEntitySuggestions(data.entities || []); })
        .catch(() => { if (!cancelled) setEntitySuggestions([]); })
        .finally(() => { if (!cancelled) setSearchingEntities(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [linkName, linkType]);

  const addLink = () => {
    if (links.length >= 5) {
      setError(t('media.compose.maxLinks'));
      return;
    }
    if (!linkTarget.trim() || !linkName.trim()) {
      setError(t('media.compose.linkRequired'));
      return;
    }
    const parsedPrice = linkPrice.trim() ? Number(linkPrice) : null;
    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setError(t('media.compose.priceInvalid'));
      return;
    }
    setLinks([...links, {
      link_type: linkType,
      target_id: linkTarget.trim(),
      name_snapshot: linkName.trim(),
      price_snapshot_cents: parsedPrice == null ? null : Math.round(parsedPrice * 100),
    }]);
    setLinkTarget('');
    setLinkName('');
    setLinkPrice('');
    setEntitySuggestions([]);
    setError(null);
  };

  const chooseEntity = (entity) => {
    setLinkTarget(entity.target_id);
    setLinkName(entity.name);
    setLinkPrice(entity.price_snapshot_cents != null ? (Number(entity.price_snapshot_cents) / 100).toFixed(2) : '');
    setEntitySuggestions([]);
  };

  const removeLink = (idx) => {
    setLinks(links.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!body.trim()) {
      setError(t('media.compose.bodyRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    setStatus('');
    setUploadProgress(0);
    try {
      let postId = draftId;
      if (!postId) {
        const data = await createPost({ body: body.trim(), links, community_id: communityId || undefined, draft: true });
        postId = data.post.id;
        setDraftId(postId);
        window.localStorage.setItem(DRAFT_STORAGE_KEY, postId);
      }
      let hasAttachedAsset = attachedAsset;
      if (externalUrl.trim() && !hasAttachedAsset) {
        setStatus(t('media.compose.attaching', { defaultValue: 'Attaching media…' }));
        await linkAsset(postId, externalUrl.trim());
        hasAttachedAsset = true;
        setAttachedAsset(true);
      }
      if (mediaFile && !hasAttachedAsset) {
        setStatus(t('media.compose.uploading', { defaultValue: 'Uploading and checking your media…' }));
        const onUploadProgress = (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        };
        if (mediaFile.type.startsWith('video/')) await uploadVideo(postId, mediaFile, onUploadProgress);
        else await uploadPhoto(postId, mediaFile, onUploadProgress);
        hasAttachedAsset = true;
        setAttachedAsset(true);
      }
      setStatus(t('media.compose.publishing', { defaultValue: 'Publishing when safety checks are complete…' }));
      const published = await publishPost(postId);
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      setDraftId('');
      navigate(`/media/post/${published.post.id}`);
    } catch (err) {
      setError(err.response?.data?.error || t('media.compose.createError'));
      setStatus(t('media.compose.draftSaved', { defaultValue: 'Your draft is saved. Fix the issue and try again.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="media-compose">
      <h1>{t('media.compose.title')}</h1>
      <form onSubmit={handleSubmit}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={t('media.compose.placeholder')}
          maxLength={2000}
          rows={4}
        />
        <div className="media-compose-links">
          <h3>{t('media.compose.linkedOn')} ({links.length}/5)</h3>
          {links.map((link, idx) => (
            <div key={idx} className="media-compose-link">
              <span>{t(`media.compose.linkTypes.${link.link_type}`, { defaultValue: link.link_type })}: {link.name_snapshot}</span>
              <button type="button" onClick={() => removeLink(idx)}>{t('media.compose.remove')}</button>
            </div>
          ))}
          <div className="media-link-picker">
            <select value={linkType} onChange={e => setLinkType(e.target.value)}>
              {LINK_TYPES.map(type => <option key={type} value={type}>{t(`media.compose.linkTypes.${type}`, { defaultValue: type })}</option>)}
            </select>
            <input
              value={linkTarget}
              readOnly
              aria-label={t('media.compose.targetId')}
              placeholder={t('media.compose.targetId')}
            />
            <input
              value={linkName}
              onChange={e => setLinkName(e.target.value)}
              placeholder={t('media.compose.entitySearchPlaceholder')}
            />
            <input
              value={linkPrice}
              onChange={e => setLinkPrice(e.target.value)}
              placeholder={t('media.compose.pricePlaceholder')}
              inputMode="decimal"
              type="number"
              min="0"
              step="0.01"
            />
            <button type="button" onClick={addLink}>{t('media.compose.addLink')}</button>
          </div>
          {(searchingEntities || entitySuggestions.length > 0) && (
            <div className="media-entity-suggestions" role="listbox" aria-label={t('media.compose.entitySearchHint')}>
              {searchingEntities && <span className="media-entity-suggestion-status">{t('media.compose.searchingEntities')}</span>}
              {entitySuggestions.map((entity) => (
                <button type="button" key={entity.target_id} className="media-entity-suggestion" onClick={() => chooseEntity(entity)}>
                  <span>{entity.name}</span>
                  {entity.price_snapshot_cents != null && <small>${(Number(entity.price_snapshot_cents) / 100).toFixed(2)}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="media-compose-field">
          <span>{t('media.compose.uploadLabel')}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
          />
          <small>{t('media.compose.uploadHint')}</small>
          {previewUrl && mediaFile?.type.startsWith('video/') && <video className="media-compose-preview" src={previewUrl} controls muted />}
          {previewUrl && mediaFile && !mediaFile.type.startsWith('video/') && <img className="media-compose-preview" src={previewUrl} alt={t('media.compose.previewAlt', { defaultValue: 'Selected media preview' })} />}
          {uploadProgress > 0 && uploadProgress < 100 && <progress value={uploadProgress} max="100" aria-label={t('media.compose.uploadProgress', { defaultValue: 'Upload progress' })}>{uploadProgress}%</progress>}
        </label>
        <label className="media-compose-field">
          <span>{t('media.compose.spaceLabel')}</span>
          <select value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
            <option value="">{t('media.compose.noSpace')}</option>
            {communities.map((community) => <option key={community.id} value={community.id}>{community.title}</option>)}
          </select>
        </label>
        <label className="media-compose-field">
          <span>{t('media.compose.videoLabel')}</span>
          <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder={t('media.compose.videoPlaceholder')} type="url" />
          <small>{t('media.compose.videoHint')}</small>
        </label>
        {status && <p className="media-status" role="status">{status}</p>}
        {error && <p className="media-error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting} className="media-post-btn">
          {submitting ? t('media.compose.posting') : t('media.compose.post')}
        </button>
      </form>
    </div>
  );
}
