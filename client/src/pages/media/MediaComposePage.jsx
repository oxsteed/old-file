import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPost } from '../../api/media';

const LINK_TYPES = ['restaurant', 'food_item', 'helper', 'business', 'job'];

export default function MediaComposePage() {
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [links, setLinks] = useState([]);
  const [linkType, setLinkType] = useState('restaurant');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkName, setLinkName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const addLink = () => {
    if (links.length >= 5) {
      setError('Max 5 links per post');
      return;
    }
    if (!linkTarget.trim() || !linkName.trim()) {
      setError('Link target and name are required');
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
      setError('Post body is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await createPost({ body: body.trim(), links });
      navigate(`/media/post/${data.post.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create post');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="media-compose">
      <h1>New Post</h1>
      <form onSubmit={handleSubmit}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What's happening in your local economy?"
          maxLength={2000}
          rows={4}
        />
        <div className="media-compose-links">
          <h3>Linked on OxSteed ({links.length}/5)</h3>
          {links.map((link, idx) => (
            <div key={idx} className="media-compose-link">
              <span>{link.link_type}: {link.name_snapshot}</span>
              <button type="button" onClick={() => removeLink(idx)}>Remove</button>
            </div>
          ))}
          <div className="media-link-picker">
            <select value={linkType} onChange={e => setLinkType(e.target.value)}>
              {LINK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              value={linkTarget}
              onChange={e => setLinkTarget(e.target.value)}
              placeholder="Target ID"
            />
            <input
              value={linkName}
              onChange={e => setLinkName(e.target.value)}
              placeholder="Display name"
            />
            <button type="button" onClick={addLink}>Add link</button>
          </div>
        </div>
        {error && <p className="media-error">{error}</p>}
        <button type="submit" disabled={submitting} className="media-post-btn">
          {submitting ? 'Posting...' : 'Post'}
        </button>
      </form>
    </div>
  );
}
