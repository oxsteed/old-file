import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createPost, getCommunities, linkAsset, searchMediaEntities, uploadPhoto, uploadVideo } from '../../api/media';

const LINK_TYPES = ['restaurant', 'food_item', 'helper', 'business', 'job'];

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
  const [error, setError] = useState(null);

  useEffect(() => {
    getCommunities().then((data) => setCommunities(data.communities || [])).catch(() => {});
  }, []);

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
    try {
      const data = await createPost({ body: body.trim(), links, community_id: communityId || undefined });
      if (externalUrl.trim()) await linkAsset(data.post.id, externalUrl.trim());
      if (mediaFile) {
        if (mediaFile.type.startsWith('video/')) await uploadVideo(data.post.id, mediaFile);
        else await uploadPhoto(data.post.id, mediaFile);
      }
      navigate(`/media/post/${data.post.id}`);
    } catch (err) {
      setError(err.response?.data?.error || t('media.compose.createError'));
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
              onChange={e => setLinkTarget(e.target.value)}
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
        {error && <p className="media-error">{error}</p>}
        <button type="submit" disabled={submitting} className="media-post-btn">
          {submitting ? t('media.compose.posting') : t('media.compose.post')}
        </button>
      </form>
    </div>
  );
}
