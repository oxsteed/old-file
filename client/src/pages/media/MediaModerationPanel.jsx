import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMediaAppeal, getModerationStatus } from '../../api/media';

// P1-287: when the author's own post is hidden by moderation, show its
// status and an appeal form instead of a bare "not found". Renders nothing
// for anyone who doesn't own the post (the endpoint 404s for them).
export default function MediaModerationPanel({ postId, onUnavailable }) {
  const { t } = useTranslation();
  const [moderation, setModeration] = useState(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getModerationStatus(postId)
      .then((data) => { if (!cancelled) setModeration(data?.moderation || null); })
      .catch(() => { if (!cancelled) onUnavailable?.(); });
    return () => { cancelled = true; };
  }, [postId, onUnavailable]);

  if (!moderation) return null;
  const appeal = moderation.appeal;
  const canAppeal = ['report_hold', 'admin_removed'].includes(moderation.moderation_state)
    && !(appeal && ['open', 'under_review'].includes(appeal.status));

  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) { setError(t('media.moderation.reasonRequired')); return; }
    setSending(true); setError('');
    try {
      const data = await createMediaAppeal(postId, reason.trim());
      setModeration((m) => ({ ...m, appeal: data?.appeal || { status: 'open' } }));
      setReason('');
    } catch (err) {
      setError(err?.response?.data?.code === 'media_appeal_exists' ? t('media.moderation.appealExists') : t('media.moderation.appealFailed'));
    } finally {
      setSending(false);
    }
  };

  const stateKey = moderation.moderation_state === 'admin_removed' ? 'removed' : moderation.moderation_state === 'report_hold' ? 'held' : 'other';

  return (
    <section className="media-empty-state" role="status" aria-live="polite">
      <h2>{t(`media.moderation.${stateKey}Title`)}</h2>
      <p>{t(`media.moderation.${stateKey}Body`)}</p>
      {appeal && <p>{t(`media.moderation.appealStatus.${appeal.status}`, { defaultValue: appeal.status })}</p>}
      {appeal?.review_note && <p>{appeal.review_note}</p>}
      {canAppeal && (
        <form onSubmit={submit} className="media-moderation-appeal" data-track="ui.23552ab6dc.1">
          <label htmlFor="media-appeal-reason">{t('media.moderation.appealLabel')}</label>
          <textarea id="media-appeal-reason" value={reason} maxLength={2000} rows={4}
            onChange={(e) => setReason(e.target.value)} />
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={sending} data-track="ui.23552ab6dc.2">{t('media.moderation.appealSubmit')}</button>
        </form>
      )}
    </section>
  );
}
