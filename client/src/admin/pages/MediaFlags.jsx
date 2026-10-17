import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { getMediaCreatorWorkReviews, resolveMediaCreatorWorkReview } from '../../api/media';
import ConfirmDialog from '../lib/ConfirmDialog';

// ADM-028: flag decisions (dismiss / remove / DMCA takedown) are destructive
// one-click actions with no confirmation and — for DMCA — no restore path.
// They now go through a confirmation dialog (reason required for remove/DMCA,
// recorded server-side as moderation_reason), and removed/DMCA posts get a
// restore button wired to the new DMCA-aware restore endpoint.
const REVIEW_DIALOG_CONFIG = {
  dismiss: { title: 'Dismiss flag', confirm: 'Dismiss', danger: false, requireReason: false },
  remove: { title: 'Remove post', confirm: 'Remove post', danger: true, requireReason: true },
  dmca: { title: 'DMCA takedown', confirm: 'Issue DMCA takedown', danger: true, requireReason: true },
};

export default function MediaFlagsPage() {
  const { t } = useTranslation();
  const [flags, setFlags] = useState([]);
  const [pendingPosts, setPendingPosts] = useState([]);
  const [approvalReasons, setApprovalReasons] = useState({});
  const [verificationRequests, setVerificationRequests] = useState([]);
  const [verificationNotes, setVerificationNotes] = useState({});
  const [verificationError, setVerificationError] = useState('');
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [workReviews, setWorkReviews] = useState([]);
  const [workReviewReasons, setWorkReviewReasons] = useState({});
  const [workReviewError, setWorkReviewError] = useState('');
  const [workReviewPending, setWorkReviewPending] = useState(null);
  const [csamTakedownUrl, setCsamTakedownUrl] = useState('');
  const [csamTakedownNote, setCsamTakedownNote] = useState('');
  const [csamTakedownMessage, setCsamTakedownMessage] = useState('');
  const [csamTakedownPending, setCsamTakedownPending] = useState(false);
  const [communitySuggestions, setCommunitySuggestions] = useState([]);
  const [communitySuggestionNotes, setCommunitySuggestionNotes] = useState({});
  const [reviewDialog, setReviewDialog] = useState(null); // { flag, action }
  const [restoreDialog, setRestoreDialog] = useState(null); // { flag }
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreCounterNotice, setRestoreCounterNotice] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [restorePending, setRestorePending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data }, pending] = await Promise.all([
        axios.get('/api/admin/media/flags', { params: { status } }),
        axios.get('/api/admin/media/posts/pending'),
      ]);
      setFlags(data.flags);
      setPendingPosts(pending.data.posts || []);
      try {
        const reviews = await getMediaCreatorWorkReviews({ status: 'open' });
        setWorkReviews(reviews.workReviews || []); setWorkReviewError('');
      } catch {
        setWorkReviews([]); setWorkReviewError(t('media.creator.reviewQueueError'));
      }
      try {
        const verification = await axios.get('/api/admin/media/verification-requests', { params: { status: 'submitted' } });
        setVerificationRequests(verification.data.requests || []);
        setVerificationError('');
      } catch (verificationErr) {
        setVerificationRequests([]);
        setVerificationError(verificationErr.response?.data?.error || 'Verification requests require the verify_users permission.');
      }
      try {
        const suggestions = await axios.get('/api/admin/media/community-suggestions', { params: { status: 'pending' } });
        setCommunitySuggestions(suggestions.data.suggestions || []);
      } catch {
        setCommunitySuggestions([]);
      }
    } catch (err) {
      console.error('Failed to load flags', err);
    } finally {
      setLoading(false);
    }
  };

  const resolveWork = async (review, decision) => {
    const reason = String(workReviewReasons[review.id] || '').trim();
    if (reason.length < 3 || workReviewPending) return;
    setWorkReviewPending(review.id); setWorkReviewError('');
    try {
      await resolveMediaCreatorWorkReview(review.id, { decision, reason });
      setWorkReviews(items => items.filter(item => item.id !== review.id));
      setWorkReviewReasons(items => ({ ...items, [review.id]: '' }));
    } catch { setWorkReviewError(t('media.creator.reviewResolveError')); }
    finally { setWorkReviewPending(null); }
  };

  const handleVerificationReview = async (id, status) => {
    const note = String(verificationNotes[id] || '').trim();
    if ((status === 'needs_changes' || status === 'rejected') && note.length < 3) return;
    try {
      await axios.post(`/api/admin/media/verification-requests/${id}/review`, { status, note });
      setVerificationNotes((current) => ({ ...current, [id]: '' }));
      load();
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleApprove = async (id) => {
    const reason = String(approvalReasons[id] || '').trim();
    if (reason.length < 3) return;
    try {
      await axios.post(`/api/admin/media/posts/${id}/approve`, { reason });
      setApprovalReasons((current) => ({ ...current, [id]: '' }));
      load();
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  useEffect(() => { load(); }, [status]);

  const handleCsamTakedown = async (event) => {
    event.preventDefault();
    const url = csamTakedownUrl.trim();
    if (!url || csamTakedownPending) return;
    setCsamTakedownPending(true);
    setCsamTakedownMessage('');
    try {
      await axios.post('/api/admin/media/takedowns/by-url', {
        public_url: url,
        note: csamTakedownNote.trim() || undefined,
      });
      setCsamTakedownUrl('');
      setCsamTakedownNote('');
      setCsamTakedownMessage(t('media.admin.csamTakedownSuccess'));
      load();
    } catch (err) {
      setCsamTakedownMessage(err.response?.data?.error || t('media.admin.csamTakedownError'));
    } finally {
      setCsamTakedownPending(false);
    }
  };

  // ADM-028: destructive flag decisions require confirmation + a recorded
  // reason. The reason is persisted server-side as the post's
  // moderation_reason.
  const handleReviewConfirm = async (reason) => {
    const { flag, action } = reviewDialog;
    try {
      await axios.post(`/api/admin/media/flags/${flag.id}/review`, {
        action,
        takedownReason: reason || undefined,
      });
      setReviewDialog(null);
      load();
    } catch (err) {
      // Rethrow so ConfirmDialog keeps the dialog open and shows the error
      // instead of the decision looking like it landed.
      throw new Error(err.response?.data?.error || err.message);
    }
  };

  // ADM-028: restore path for removed posts, including DMCA takedowns. A DMCA
  // restore requires an explicit counter-notice reference (the server 400s
  // without one) so a legal takedown is never lifted silently.
  const openRestoreDialog = (flag) => {
    setRestoreDialog({ flag });
    setRestoreReason('');
    setRestoreCounterNotice('');
    setRestoreError('');
  };

  const handleRestore = async () => {
    const { flag } = restoreDialog;
    const reason = restoreReason.trim();
    const isDmca = flag.status === 'dmca';
    if (reason.length < 3) {
      setRestoreError('A restore reason is required.');
      return;
    }
    if (isDmca && restoreCounterNotice.trim().length < 10) {
      setRestoreError('A DMCA counter-notice reference (at least 10 characters) is required.');
      return;
    }
    setRestorePending(true);
    setRestoreError('');
    try {
      await axios.post(`/api/admin/media/posts/${flag.post_id}/restore`, {
        reason,
        counterNoticeRef: isDmca ? restoreCounterNotice.trim() : undefined,
      });
      setRestoreDialog(null);
      load();
    } catch (err) {
      setRestoreError(err.response?.data?.error || err.message);
    } finally {
      setRestorePending(false);
    }
  };

  const handleCommunitySuggestionReview = async (id, decision) => {
    const note = String(communitySuggestionNotes[id] || '').trim();
    if (note.length < 3) return;
    try {
      await axios.post(`/api/admin/media/community-suggestions/${id}/review`, { status: decision, note });
      setCommunitySuggestionNotes((current) => ({ ...current, [id]: '' }));
      load();
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="admin-page">
      <h1>Media Flags</h1>
      <section aria-labelledby="media-admin-csam-takedown-title">
        <h2 id="media-admin-csam-takedown-title">{t('media.admin.csamTakedownTitle')}</h2>
        <p>{t('media.admin.csamTakedownHint')}</p>
        <form className="admin-card" onSubmit={handleCsamTakedown}>
          <label htmlFor="media-csam-takedown-url">{t('media.admin.csamTakedownUrl')}</label>
          <input id="media-csam-takedown-url" type="url" required value={csamTakedownUrl} onChange={(event) => setCsamTakedownUrl(event.target.value)} />
          <label htmlFor="media-csam-takedown-note">{t('media.admin.csamTakedownNote')}</label>
          <textarea id="media-csam-takedown-note" rows={2} value={csamTakedownNote} onChange={(event) => setCsamTakedownNote(event.target.value)} />
          <button type="submit" disabled={csamTakedownPending || !csamTakedownUrl.trim()}>{t('media.admin.csamTakedownSubmit')}</button>
          {csamTakedownMessage && <p role="status">{csamTakedownMessage}</p>}
        </form>
      </section>
      <section aria-labelledby="media-admin-work-reviews-title">
        <h2 id="media-admin-work-reviews-title">{t('media.creator.workReviews')}</h2>
        <p>{t('media.creator.adminReviewHint')}</p>
        {workReviewError && <p role="alert">{workReviewError}</p>}
        {!workReviewError && !workReviews.length && <p>{t('media.creator.noWorkReviews')}</p>}
        {workReviews.map(review => <article key={review.id} className="admin-card">
          <h3>{t(`media.creator.reviewKinds.${review.kind}`)} · {review.reference_id}</h3>
          <p>{review.reason}</p>
          <label htmlFor={`media-review-reason-${review.id}`}>{t('media.creator.reviewDecisionReason')}</label>
          <textarea id={`media-review-reason-${review.id}`} maxLength={4000} value={workReviewReasons[review.id] || ''} onChange={event => setWorkReviewReasons(items => ({ ...items, [review.id]: event.target.value }))} />
          <div className="admin-actions">
            <button type="button" onClick={() => resolveWork(review, 'resume')} disabled={Boolean(workReviewPending) || (workReviewReasons[review.id] || '').trim().length < 3}>{t('media.creator.resumeWork')}</button>
            <button type="button" onClick={() => resolveWork(review, 'release')} disabled={Boolean(workReviewPending) || (workReviewReasons[review.id] || '').trim().length < 3}>{t('media.creator.releaseWork')}</button>
          </div>
        </article>)}
      </section>
      <section>
        <h2>Publisher verification requests</h2>
        {verificationError && <p>{verificationError}</p>}
        {!verificationError && !verificationRequests.length ? <p>No pending publisher verification requests.</p> : (
          <table className="admin-table">
            <thead><tr><th>Entity</th><th>Requester</th><th>Details</th><th>Review note</th><th>Actions</th></tr></thead>
            <tbody>
              {verificationRequests.map((request) => (
                <tr key={request.id}>
                  <td>{request.entity_type}: {request.entity_name || request.entity_id}</td>
                  <td>{request.requester_name || request.requester_email}</td>
                  <td>{request.details?.notes || '—'}</td>
                  <td><input value={verificationNotes[request.id] || ''} onChange={(event) => setVerificationNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Add a note for changes or rejection" /></td>
                  <td>
                    <button type="button" onClick={() => handleVerificationReview(request.id, 'approved')}>Approve</button>
                    <button type="button" onClick={() => handleVerificationReview(request.id, 'needs_changes')} disabled={(verificationNotes[request.id] || '').trim().length < 3}>Needs changes</button>
                    <button type="button" onClick={() => handleVerificationReview(request.id, 'rejected')} disabled={(verificationNotes[request.id] || '').trim().length < 3}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2>Space suggestions</h2>
        {!communitySuggestions.length ? <p>No pending Space suggestions.</p> : (
          communitySuggestions.map((item) => (
            <article key={item.id} className="admin-card">
              <h3>{item.title}</h3>
              <p><strong>{item.geo_scope}</strong> · {item.category} · requested by {item.requester_name || item.requester_email}</p>
              {item.description && <p>{item.description}</p>}
              <label htmlFor={`media-space-suggestion-note-${item.id}`}>Review note</label>
              <textarea id={`media-space-suggestion-note-${item.id}`} rows={2} maxLength={2000} value={communitySuggestionNotes[item.id] || ''} onChange={(event) => setCommunitySuggestionNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Explain the approval or rejection" />
              <div className="admin-actions">
                <button type="button" onClick={() => handleCommunitySuggestionReview(item.id, 'approved')} disabled={(communitySuggestionNotes[item.id] || '').trim().length < 3}>Approve and publish Space</button>
                <button type="button" onClick={() => handleCommunitySuggestionReview(item.id, 'rejected')} disabled={(communitySuggestionNotes[item.id] || '').trim().length < 3}>Reject</button>
              </div>
            </article>
          ))
        )}
      </section>
      <section>
        <h2>Pending Media Approval</h2>
        {!pendingPosts.length ? <p>No pending Media posts.</p> : (
          <table className="admin-table">
            <thead><tr><th>Post</th><th>Actor</th><th>Safety state</th><th>Approval reason</th><th>Action</th></tr></thead>
            <tbody>
              {pendingPosts.map((post) => (
                <tr key={post.id}>
                  <td>{post.body?.slice(0, 80)}...</td>
                  <td>@{post.actor_handle}</td>
                  <td>{post.processing_status} / {post.csam_status}</td>
                  <td>
                    <input
                      value={approvalReasons[post.id] || ''}
                      onChange={(event) => setApprovalReasons((current) => ({ ...current, [post.id]: event.target.value }))}
                      placeholder="Why is this safe to publish?"
                    />
                  </td>
                  <td><button type="button" disabled={(approvalReasons[post.id] || '').trim().length < 3} onClick={() => handleApprove(post.id)}>Approve and publish</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="admin-filters">
        {['open', 'dismissed', 'removed', 'dmca'].map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={status === s ? 'active' : ''}
          >
            {s}
          </button>
        ))}
      </div>
      {loading ? <p>Loading...</p> : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Post</th>
              <th>Actor</th>
              <th>Reason</th>
              <th>Note</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {flags.map(f => (
              <tr key={f.id}>
                <td>{f.post_body?.slice(0, 80)}...</td>
                <td>@{f.actor_handle}</td>
                <td>{f.reason}</td>
                <td>{f.note}</td>
                <td>{new Date(f.created_at).toLocaleString()}</td>
                <td>
                  {f.status === 'open' && (
                    <>
                      <button onClick={() => setReviewDialog({ flag: f, action: 'dismiss' })}>Dismiss</button>
                      <button onClick={() => setReviewDialog({ flag: f, action: 'remove' })}>Remove</button>
                      <button onClick={() => setReviewDialog({ flag: f, action: 'dmca' })}>DMCA</button>
                    </>
                  )}
                  {(f.status === 'removed' || f.status === 'dmca') && (
                    <button onClick={() => openRestoreDialog(f)}>Restore</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !flags.length && <p>No flags.</p>}

      {reviewDialog && (
        <ConfirmDialog
          open
          title={REVIEW_DIALOG_CONFIG[reviewDialog.action].title}
          message={
            <>
              <p>@{reviewDialog.flag.actor_handle}: {reviewDialog.flag.post_body?.slice(0, 140)}{reviewDialog.flag.post_body?.length > 140 ? '…' : ''}</p>
              <p className="mt-1 text-gray-600 dark:text-gray-400">Reason reported: {reviewDialog.flag.reason}</p>
            </>
          }
          confirmLabel={REVIEW_DIALOG_CONFIG[reviewDialog.action].confirm}
          danger={REVIEW_DIALOG_CONFIG[reviewDialog.action].danger}
          requireReason={REVIEW_DIALOG_CONFIG[reviewDialog.action].requireReason}
          reasonLabel="Decision reason"
          reasonPlaceholder={reviewDialog.action === 'dmca'
            ? 'DMCA notice reference and reason for the takedown'
            : 'Why is this post being removed?'}
          onConfirm={handleReviewConfirm}
          onClose={() => setReviewDialog(null)}
        />
      )}

      {restoreDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!restorePending) setRestoreDialog(null); }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {restoreDialog.flag.status === 'dmca' ? 'Restore DMCA-taken-down post' : 'Restore removed post'}
            </h2>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              @{restoreDialog.flag.actor_handle}: {restoreDialog.flag.post_body?.slice(0, 140)}{restoreDialog.flag.post_body?.length > 140 ? '…' : ''}
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Restore reason <span className="text-red-400">*</span>
              </label>
              <textarea
                value={restoreReason}
                onChange={(e) => setRestoreReason(e.target.value)}
                rows={3}
                placeholder="Why is this post being restored?"
                className="w-full rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm p-2 focus:outline-none focus:border-blue-500"
              />
            </div>
            {restoreDialog.flag.status === 'dmca' && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  DMCA counter-notice reference <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={restoreCounterNotice}
                  onChange={(e) => setRestoreCounterNotice(e.target.value)}
                  placeholder="Reference to the counter-notice or release authorization"
                  className="w-full rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm p-2 focus:outline-none focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  Lifting a DMCA takedown requires a recorded counter-notice. This is stored in the audit log.
                </p>
              </div>
            )}
            {restoreError && (
              <div className="mt-3 text-sm text-red-400" role="alert">{restoreError}</div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRestoreDialog(null)}
                disabled={restorePending}
                className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestore}
                disabled={restorePending}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
              >
                {restorePending ? 'Restoring…' : 'Restore post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
