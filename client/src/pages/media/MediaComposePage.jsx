import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createPost, getCommunities, getDraft, getDrafts, getMediaVerification, linkAsset, publishPost, searchMediaEntities, updateDraft, uploadPhoto, uploadVideo } from '../../api/media';

const LINK_TYPES = [
  'restaurant', 'food_item', 'helper', 'business', 'job',
  'tool_rental', 'direct_catalog', 'logistics_campaign',
];
const DRAFT_STORAGE_KEY = 'oxsteed.media.compose.draft';

export default function MediaComposePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [links, setLinks] = useState([]);
  const [linkType, setLinkType] = useState('restaurant');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkName, setLinkName] = useState('');
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [linkPrice, setLinkPrice] = useState('');
  const [entitySuggestions, setEntitySuggestions] = useState([]);
  const [searchingEntities, setSearchingEntities] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [mediaFile, setMediaFile] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [communityId, setCommunityId] = useState('');
  const [publishers, setPublishers] = useState([]);
  const [publisherKey, setPublisherKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftId, setDraftId] = useState(() => window.localStorage.getItem(DRAFT_STORAGE_KEY) || '');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attachedAsset, setAttachedAsset] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [status, setStatus] = useState('');
  const [processingStatus, setProcessingStatus] = useState('');
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState('');

  useEffect(() => {
    getCommunities().then((data) => setCommunities(data.communities || [])).catch(() => {});
    getMediaVerification().then((data) => {
      const options = [];
      if (data.helper?.is_verified) options.push({ key: 'helper', type: 'helper', label: t('media.compose.publisherHelper', { defaultValue: 'My helper profile' }) });
      for (const entity of data.businesses || []) {
        if (entity.is_verified) options.push({ key: `business:${entity.id}`, type: 'business', id: entity.id, label: entity.business_name });
      }
      for (const entity of data.restaurants || []) {
        if (entity.is_verified) options.push({ key: `restaurant:${entity.id}`, type: 'restaurant', id: entity.id, label: entity.display_name });
      }
      setPublishers(options);
      setPublisherKey((current) => current && options.some((option) => option.key === current) ? current : (options[0]?.key || ''));
    }).catch(() => {});
  }, [t]);

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
      setProcessingStatus(draft.processing_status || 'draft');
      if (draft.processing_status === 'quarantine' || (draft.assets || []).some((asset) => asset.processing_status === 'quarantine' || asset.csam_status === 'pending')) {
        setStatus(t('media.compose.processing', { defaultValue: 'Your media is being checked. This draft stays private until it is ready.' }));
      } else if (draft.processing_status === 'failed' || draft.processing_status === 'blocked') {
        setStatus(t('media.compose.processingFailed', { defaultValue: 'Media processing did not finish. Replace the file and try again.' }));
      } else {
        setStatus(t('media.compose.draftRestored', { defaultValue: 'Draft restored. Select the file again to retry an interrupted upload.' }));
      }
    }).catch(() => {});
  }, [t]);

  useEffect(() => {
    if (!draftId || !attachedAsset || !['quarantine', 'processing'].includes(processingStatus)) return undefined;
    let cancelled = false;
    let pollCount = 0;
    let timer;
    const refreshProcessingDraft = async () => {
      pollCount += 1;
      if (pollCount > 90) {
        setStatus(t('media.compose.processingDelayed'));
        window.clearInterval(timer);
        return;
      }
      try {
        const { draft } = await getDraft(draftId);
        if (cancelled || !draft) return;
        const nextStatus = draft.processing_status || 'draft';
        setAttachedAsset((draft.assets || []).length > 0);
        setProcessingStatus(nextStatus);
        if (nextStatus === 'ready') {
          setStatus(t('media.compose.processingReady'));
          window.clearInterval(timer);
        } else if (nextStatus === 'failed' || nextStatus === 'blocked') {
          setStatus(t('media.compose.processingFailed'));
          window.clearInterval(timer);
        }
      } catch {
        // Keep the current private-draft status visible through transient polls.
      }
    };
    timer = window.setInterval(refreshProcessingDraft, 4000);
    refreshProcessingDraft();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [attachedAsset, draftId, processingStatus, t]);

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
      setErrorCode('');
      return;
    }
    if (!selectedEntity || !linkTarget.trim()) {
      setError(t('media.compose.entityRequired'));
      setErrorCode('');
      return;
    }
    const parsedPrice = linkPrice.trim() ? Number(linkPrice) : null;
    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setError(t('media.compose.priceInvalid'));
      setErrorCode('');
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
    setSelectedEntity(null);
    setLinkPrice('');
    setEntitySuggestions([]);
    setError(null);
    setErrorCode('');
  };

  const chooseEntity = (entity) => {
    setLinkTarget(entity.target_id);
    setLinkName(entity.name);
    setSelectedEntity(entity);
    setLinkPrice(entity.price_snapshot_cents != null ? (Number(entity.price_snapshot_cents) / 100).toFixed(2) : '');
    setEntitySuggestions([]);
  };

  const handleMediaFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setMediaFile(nextFile);
    if (nextFile) {
      // A replacement file must be uploaded even when this draft restored a
      // failed or quarantined asset from a previous session.
      setExternalUrl('');
      setAttachedAsset(false);
      setUploadProgress(0);
      setProcessingStatus('draft');
    }
  };

  const handleExternalUrlChange = (event) => {
    const nextUrl = event.target.value;
    setExternalUrl(nextUrl);
    if (nextUrl.trim()) {
      setMediaFile(null);
      setAttachedAsset(false);
      setProcessingStatus('draft');
    }
  };

  const removeLink = (idx) => {
    setLinks(links.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!body.trim()) {
      setError(t('media.compose.bodyRequired'));
      setErrorCode('');
      return;
    }
    setSubmitting(true);
    setError(null);
    setErrorCode('');
    setStatus('');
    setUploadProgress(0);
    let postId = draftId;
    try {
      if (!postId) {
        const publisher = publishers.find((option) => option.key === publisherKey);
        const publisherPayload = publisher?.type === 'business'
          ? { business_id: publisher.id }
          : publisher?.type === 'restaurant'
            ? { restaurant_id: publisher.id }
            : {};
        const data = await createPost({ body: body.trim(), links, community_id: communityId || undefined, draft: true, ...publisherPayload });
        postId = data.post.id;
        setDraftId(postId);
        window.localStorage.setItem(DRAFT_STORAGE_KEY, postId);
      } else {
        // Keep edits made after a failed upload durable before retrying. This
        // also makes entity and Space changes survive a page refresh.
        await updateDraft(postId, { body: body.trim(), links, community_id: communityId || null });
      }
      let hasAttachedAsset = attachedAsset;
      if (externalUrl.trim() && !hasAttachedAsset) {
        setStatus(t('media.compose.attaching', { defaultValue: 'Attaching media…' }));
        await linkAsset(postId, externalUrl.trim(), true);
        hasAttachedAsset = true;
        setAttachedAsset(true);
      }
      if (mediaFile && !hasAttachedAsset) {
        setStatus(t('media.compose.uploading', { defaultValue: 'Uploading and checking your media…' }));
        const onUploadProgress = (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        };
        if (mediaFile.type.startsWith('video/')) await uploadVideo(postId, mediaFile, onUploadProgress, true);
        else await uploadPhoto(postId, mediaFile, onUploadProgress, true);
        hasAttachedAsset = true;
        setAttachedAsset(true);
      }
      setStatus(t('media.compose.publishing', { defaultValue: 'Publishing when safety checks are complete…' }));
      const published = await publishPost(postId);
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      setDraftId('');
      setProcessingStatus('ready');
      navigate(`/media/post/${published.post.id}`);
    } catch (err) {
      const details = err.response?.data || {};
      if (details.code === 'media_safety_pending' && postId) {
        setProcessingStatus(details.processing_status || 'quarantine');
        setStatus(t('media.compose.processing', { defaultValue: 'Your media is being checked. This draft stays private until it is ready.' }));
        // Refresh the durable draft so a retry after a worker transition does
        // not depend on stale in-memory state or a previous page session.
        getDraft(postId).then(({ draft }) => {
          if (!draft) return;
          setAttachedAsset((draft.assets || []).length > 0);
          setProcessingStatus(draft.processing_status || 'draft');
        }).catch(() => {});
      } else {
        setStatus(t('media.compose.draftSaved', { defaultValue: 'Your draft is saved. Fix the issue and try again.' }));
      }
      setError(details.error || t('media.compose.createError'));
      setErrorCode(details.code || '');
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
            <select value={linkType} onChange={e => {
              setLinkType(e.target.value);
              setLinkName('');
              setLinkTarget('');
              setSelectedEntity(null);
            }}>
              {LINK_TYPES.map(type => <option key={type} value={type}>{t(`media.compose.linkTypes.${type}`, { defaultValue: type })}</option>)}
            </select>
            <input
              value={linkName}
              onChange={e => {
                setLinkName(e.target.value);
                setSelectedEntity(null);
                setLinkTarget('');
              }}
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
          {selectedEntity && (
            <p className="media-selected-entity" role="status">
              {t('media.compose.selectedEntity', { name: selectedEntity.name })}
            </p>
          )}
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
            onChange={handleMediaFileChange}
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
        {publishers.length > 0 && (
          <label className="media-compose-field">
            <span>{t('media.compose.publisherLabel', { defaultValue: 'Post as' })}</span>
            <select value={publisherKey} onChange={(event) => setPublisherKey(event.target.value)} disabled={Boolean(draftId)}>
              {publishers.map((publisher) => <option key={publisher.key} value={publisher.key}>{publisher.label}</option>)}
            </select>
            {draftId && <small>{t('media.compose.publisherLocked', { defaultValue: 'The publishing identity is fixed for this draft.' })}</small>}
          </label>
        )}
        <label className="media-compose-field">
          <span>{t('media.compose.videoLabel')}</span>
          <input value={externalUrl} onChange={handleExternalUrlChange} placeholder={t('media.compose.videoPlaceholder')} type="url" />
          <small>{t('media.compose.videoHint')}</small>
        </label>
        {status && <p className="media-status" role="status" data-processing-status={processingStatus || undefined}>{status}</p>}
        {error && <div className="media-error" role="alert"><p>{error}</p>{(errorCode === 'media_video_didit_required' || errorCode === 'media_not_verified_poster') && <Link className="media-error-action" to="/media/verification?returnTo=/media/compose">{t(errorCode === 'media_video_didit_required' ? 'media.verification.verifyIdentity' : 'media.verification.request', { defaultValue: errorCode === 'media_video_didit_required' ? 'Verify identity' : 'Request verification' })}</Link>}</div>}
        <button type="submit" disabled={submitting} className="media-post-btn">
          {submitting ? t('media.compose.posting') : t('media.compose.post')}
        </button>
      </form>
    </div>
  );
}
