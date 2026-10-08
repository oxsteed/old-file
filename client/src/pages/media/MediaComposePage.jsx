import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createPost, getCommunities, linkAsset } from '../../api/media';

const LINK_TYPES = ['restaurant', 'food_item', 'helper', 'business', 'job'];

export default function MediaComposePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [links, setLinks] = useState([]);
  const [linkType, setLinkType] = useState('restaurant');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkName, setLinkName] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [communities, setCommunities] = useState([]);
  const [communityId, setCommunityId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getCommunities().then((data) => setCommunities(data.communities || [])).catch(() => {});
  }, []);

  const addLink = () => {
    if (links.length >= 5) {
      setError(t('media.compose.maxLinks'));
      return;
    }
    if (!linkTarget.trim() || !linkName.trim()) {
      setError(t('media.compose.linkRequired'));
      return;
    }
    setLinks([...links, {
      link_type: linkType,
      target_id: linkTarget.trim(),
      name_snapshot: linkName.trim(),
    }]);
    setLinkTarget('');
    setLinkName('');
    setError(null);
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
              <span>{link.link_type}: {link.name_snapshot}</span>
              <button type="button" onClick={() => removeLink(idx)}>{t('media.compose.remove')}</button>
            </div>
          ))}
          <div className="media-link-picker">
            <select value={linkType} onChange={e => setLinkType(e.target.value)}>
              {LINK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              value={linkTarget}
              onChange={e => setLinkTarget(e.target.value)}
              placeholder={t('media.compose.targetId')}
            />
            <input
              value={linkName}
              onChange={e => setLinkName(e.target.value)}
              placeholder={t('media.compose.displayName')}
            />
            <button type="button" onClick={addLink}>{t('media.compose.addLink')}</button>
          </div>
        </div>
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
