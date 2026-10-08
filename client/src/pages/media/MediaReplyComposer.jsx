import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { createPost } from '../../api/media';

export default function MediaReplyComposer({ parentId, onReply }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    if (!user) {
      navigate('/login', { state: { from: window.location.pathname } });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await createPost({ body: body.trim(), parent_id: parentId });
      setBody('');
      if (onReply) onReply(data.post);
    } catch (err) {
      setError(err.response?.data?.error || t('media.reply.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="media-reply-composer">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={t('media.reply.placeholder')}
        maxLength={2000}
        rows={2}
      />
      {error && <p className="media-error">{error}</p>}
      <button type="submit" disabled={submitting || !body.trim()}>
        {submitting ? t('media.reply.posting') : t('media.reply.submit')}
      </button>
    </form>
  );
}
