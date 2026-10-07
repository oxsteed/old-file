import React, { useState } from 'react';
import { createPost } from '../../api/media';

export default function MediaReplyComposer({ parentId, onReply }) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await createPost({ body: body.trim(), parent_id: parentId });
      setBody('');
      if (onReply) onReply(data.post);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to post reply');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="media-reply-composer">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Post your reply"
        maxLength={2000}
        rows={2}
      />
      {error && <p className="media-error">{error}</p>}
      <button type="submit" disabled={submitting || !body.trim()}>
        {submitting ? 'Posting...' : 'Reply'}
      </button>
    </form>
  );
}
