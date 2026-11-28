import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Group 14 Slice 5d (716-720): the request detail shared by the requester
// page (/statements/audit-requests) and the admin queue page
// (/admin/super/oxsteed-credit/audit-requests). The apiClient prop is the
// caller-appropriate axios instance (api for the requester, adminApi for
// the admin); every permission is enforced server-side, and the component
// only hides controls the API would refuse anyway (driven by
// request.access: owner | admin | auditor).
// Group 14 Slice 5i (741-745): the same detail also carries the
// accountant invitation (inside the shares section), the scope review,
// the correction queue, and the internal annotation thread. Invitations
// and annotations are manager-only: the component never fetches them
// for an auditor.
export default function AuditRequestDetail({ apiClient, requestId, onBack }) {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options = {}) => t(`statements.auditRequests.${key}`, options);
  const [request, setRequest] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [shares, setShares] = useState([]);
  const [messages, setMessages] = useState([]);
  const [receipts, setReceipts] = useState([]);
  // Group 14 Slice 5i (741-745): invitations, scope reviews,
  // corrections, and internal annotations on the same request.
  const [invitations, setInvitations] = useState([]);
  const [scopeReviews, setScopeReviews] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [documentId, setDocumentId] = useState('');
  const [auditorId, setAuditorId] = useState('');
  const [grantTtl, setGrantTtl] = useState('604800');
  const [message, setMessage] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [links, setLinks] = useState({});
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteTtl, setInviteTtl] = useState('604800');
  const [scopeDecision, setScopeDecision] = useState('acknowledged');
  const [scopeNote, setScopeNote] = useState('');
  const [correctionTarget, setCorrectionTarget] = useState('');
  const [correctionRef, setCorrectionRef] = useState('');
  const [correctionDetail, setCorrectionDetail] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [annotationNote, setAnnotationNote] = useState('');

  const readError = (err) => err?.response?.data?.error || err?.message || text('loadError');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      // The detail comes first: invitations and annotations are
      // manager-only, so the rest of the fetch set depends on the
      // access the detail reports.
      const detailRes = await apiClient.get(`/audit-requests/${requestId}`);
      const detail = detailRes.data?.request || null;
      setRequest(detail);
      const isManager = detail && (detail.access === 'owner' || detail.access === 'admin');
      const [evidenceRes, messagesRes, receiptsRes, scopeRes, correctionsRes] = await Promise.all([
        apiClient.get(`/audit-requests/${requestId}/evidence`),
        apiClient.get(`/audit-requests/${requestId}/messages`),
        apiClient.get(`/audit-requests/${requestId}/receipts`),
        apiClient.get(`/audit-requests/${requestId}/scope-review`),
        apiClient.get(`/audit-requests/${requestId}/corrections`),
      ]);
      setEvidence(evidenceRes.data?.evidence || []);
      setMessages(messagesRes.data?.messages || []);
      setReceipts(receiptsRes.data?.receipts || []);
      setScopeReviews(scopeRes.data?.scopeReviews || []);
      setCorrections(correctionsRes.data?.corrections || []);
      // Shares are owner/admin only; auditors get 403 here, which is
      // expected — the section stays hidden for them.
      try {
        const sharesRes = await apiClient.get(`/audit-requests/${requestId}/shares`);
        setShares(sharesRes.data?.shares || []);
      } catch {
        setShares([]);
      }
      // Invitations and annotations are manager-only by design: the
      // client never fetches them for an auditor.
      if (isManager) {
        try {
          const [invRes, annRes] = await Promise.all([
            apiClient.get(`/audit-requests/${requestId}/invitations`),
            apiClient.get(`/audit-requests/${requestId}/annotations`),
          ]);
          setInvitations(invRes.data?.invitations || []);
          setAnnotations(annRes.data?.annotations || []);
        } catch {
          setInvitations([]);
          setAnnotations([]);
        }
      } else {
        setInvitations([]);
        setAnnotations([]);
      }
      setStatus('ready');
    } catch (err) {
      setError(readError(err));
      setStatus('error');
    }
  }, [apiClient, requestId]);

  useEffect(() => { load(); }, [load]);

  const canManage = request && (request.access === 'owner' || request.access === 'admin');
  const isAuditor = request && request.access === 'auditor';

  async function run(action, successKey) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(text(successKey));
      await load();
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  const proposeEvidence = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/evidence`, { documentId: documentId.trim() });
    setDocumentId('');
  }, 'evidenceProposedNotice');
  const decideEvidence = (evidenceId, decision) => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/evidence/${evidenceId}/${decision}`);
  }, decision === 'approve' ? 'evidenceApprovedNotice' : 'evidenceRejectedNotice');
  const mintLink = (docId) => run(async () => {
    const res = await apiClient.get(`/audit-requests/${requestId}/evidence/${docId}/link`);
    setLinks((current) => ({ ...current, [docId]: res.data }));
  }, 'linkReady');
  const grantShare = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/shares`, {
      auditorUserId: auditorId.trim(),
      expiresInSeconds: Number(grantTtl),
    });
    setAuditorId('');
  }, 'shareGranted');
  const revokeShare = (shareId) => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/shares/${shareId}/revoke`);
  }, 'shareRevokedNotice');
  const sendMessage = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/messages`, {
      message: message.trim(),
      idempotencyKey: crypto.randomUUID(),
    });
    setMessage('');
  }, 'messageSent');
  const recordReceipt = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/receipts`, { note: receiptNote.trim() || undefined });
    setReceiptNote('');
  }, 'receiptRecorded');
  const moveStatus = (nextStatus) => run(async () => {
    await apiClient.patch(`/audit-requests/${requestId}/status`, { status: nextStatus });
  }, 'statusUpdated');
  // Group 14 Slice 5i (741-745) actions.
  const inviteAccountant = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/invitations`, {
      email: inviteEmail.trim(),
      expiresInSeconds: Number(inviteTtl),
    });
    setInviteEmail('');
  }, 'inviteSentNotice');
  const revokeInvitation = (invitationId) => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/invitations/${invitationId}/revoke`);
  }, 'invitationRevokedNotice');
  const submitScopeReview = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/scope-review`, {
      decision: scopeDecision,
      note: scopeNote.trim() || undefined,
    });
    setScopeNote('');
  }, 'scopeSubmittedNotice');
  const requestCorrection = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/corrections`, {
      evidenceId: correctionTarget ? correctionTarget : undefined,
      recordRef: correctionTarget ? undefined : correctionRef.trim(),
      detail: correctionDetail.trim(),
    });
    setCorrectionTarget('');
    setCorrectionRef('');
    setCorrectionDetail('');
  }, 'correctionSubmittedNotice');
  const resolveCorrection = (correctionId, resolution) => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/corrections/${correctionId}/resolve`, {
      status: resolution,
      resolutionNote: resolutionNote.trim() || undefined,
    });
    setResolutionNote('');
  }, 'correctionResolvedNotice');
  const addAnnotation = () => run(async () => {
    await apiClient.post(`/audit-requests/${requestId}/annotations`, { note: annotationNote.trim() });
    setAnnotationNote('');
  }, 'annotationAddedNotice');

  const statusLabel = (value) => text(value === 'open' ? 'statusOpen' : value === 'in_review' ? 'statusInReview' : 'statusClosed');
  const formatDate = (value) => {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat(i18n.language || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch {
      return String(value);
    }
  };

  if (status === 'loading') return <p role="status" className="text-sm text-gray-500">{text('loading')}</p>;
  if (status === 'error' || !request) {
    return <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <p>{error || text('loadError')}</p>
      <button type="button" onClick={load} className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold dark:border-gray-700">{text('retry')}</button>
    </div>;
  }

  return <div className="space-y-6" dir={i18n.dir()}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {onBack && <button type="button" onClick={onBack} className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400">{text('back')}</button>}
        <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white"><bdi>{request.title}</bdi></h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400"><bdi>{request.scope}</bdi></p>
        <p className="mt-2 text-xs text-gray-500">
          {text(`type${request.auditType.charAt(0).toUpperCase()}${request.auditType.slice(1)}`)} · {statusLabel(request.status)} · {text('createdAt')} {formatDate(request.createdAt)}
          {request.auditorEmail && <> · <bdi>{request.auditorEmail}</bdi></>}
        </p>
      </div>
      {canManage && request.status !== 'closed' && <div>
        <div className="flex gap-2">
          {request.status === 'open' && <button type="button" disabled={busy} onClick={() => moveStatus('in_review')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('moveToReview')}</button>}
          <button type="button" disabled={busy} onClick={() => moveStatus('closed')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('closeRequest')}</button>
        </div>
        <p className="mt-2 text-xs text-gray-500">{text('closeNotifies')}</p>
      </div>}
    </div>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}

    <section aria-labelledby="audit-evidence-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="audit-evidence-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('evidenceTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('evidenceDescription')}</p>
      {!evidence.length && <p className="mt-3 text-sm text-gray-500">{text('noEvidence')}</p>}
      <ul className="mt-3 space-y-2">
        {evidence.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <span className="font-mono text-xs break-all">{item.documentId}</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">{text(item.status === 'approved' ? 'evidenceApproved' : item.status === 'rejected' ? 'evidenceRejected' : 'evidenceProposed')}</span>
            {item.status === 'approved' && <button type="button" disabled={busy} onClick={() => mintLink(item.documentId)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('getLink')}</button>}
            {canManage && item.status === 'proposed' && <>
              <button type="button" disabled={busy} onClick={() => decideEvidence(item.id, 'approve')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{text('approve')}</button>
              <button type="button" disabled={busy} onClick={() => decideEvidence(item.id, 'reject')} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('reject')}</button></>}
          </span>
          {links[item.documentId] && <p className="w-full text-xs text-gray-600 dark:text-gray-400">
            <span className="break-all">{links[item.documentId].url}</span><br />
            {text('linkExpiresAt', { date: formatDate(links[item.documentId].expiresAt) })}
          </p>}
        </li>)}
      </ul>
      {canManage && <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); proposeEvidence(); }}>
        <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('documentIdLabel')}
          <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} required
            placeholder="00000000-0000-0000-0000-000000000000"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <button type="submit" disabled={busy || !documentId.trim()} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('propose')}</button>
        <p className="w-full text-xs text-gray-500">{text('documentIdHelp')}</p>
      </form>}
    </section>

    {canManage && <section aria-labelledby="audit-shares-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="audit-shares-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('sharesTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('sharesDescription')}</p>
      {!shares.length && <p className="mt-3 text-sm text-gray-500">{text('noShares')}</p>}
      <ul className="mt-3 space-y-2">
        {shares.map((share) => <li key={share.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <span className="font-mono text-xs break-all">{share.auditorUserId}</span>
          <span className="flex items-center gap-2 text-xs text-gray-500">
            <span>{share.active ? text('shareActive') : share.revokedAt ? text('shareRevoked') : text('shareExpired')} · {text('expiresLabel')} {formatDate(share.expiresAt)}</span>
            {share.active && <button type="button" disabled={busy} onClick={() => revokeShare(share.id)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('revoke')}</button>}
          </span>
        </li>)}
      </ul>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); grantShare(); }}>
        <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('auditorIdLabel')}
          <input value={auditorId} onChange={(event) => setAuditorId(event.target.value)} required
            placeholder="00000000-0000-0000-0000-000000000000"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">{text('expiresLabel')}
          <select value={grantTtl} onChange={(event) => setGrantTtl(event.target.value)}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900">
            <option value="3600">{text('expires1Hour')}</option>
            <option value="86400">{text('expires1Day')}</option>
            <option value="604800">{text('expires7Days')}</option>
            <option value="2592000">{text('expires30Days')}</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !auditorId.trim()} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('grant')}</button>
      </form>
      <h3 id="audit-invitations-heading" className="mt-6 text-sm font-bold text-gray-900 dark:text-white">{text('invitationsTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('invitationsDescription')}</p>
      {!invitations.length && <p className="mt-3 text-sm text-gray-500">{text('noInvitations')}</p>}
      <ul className="mt-3 space-y-2">
        {invitations.map((invitation) => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <span><bdi>{invitation.email}</bdi>{' '}<span className="text-xs text-gray-500">{text(invitation.status === 'accepted' ? 'invitationStatusAccepted' : invitation.status === 'revoked' ? 'invitationStatusRevoked' : invitation.status === 'expired' ? 'invitationStatusExpired' : 'invitationStatusPending')}</span></span>
          <span className="flex items-center gap-2 text-xs text-gray-500">
            <span>{text('invitationExpiresAt', { date: formatDate(invitation.expiresAt) })}</span>
            {invitation.status === 'pending' && <button type="button" disabled={busy} onClick={() => revokeInvitation(invitation.id)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('revoke')}</button>}
          </span>
        </li>)}
      </ul>
      {request.status !== 'closed' && <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); inviteAccountant(); }}>
        <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('inviteEmailLabel')}
          <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required type="email"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">{text('expiresLabel')}
          <select value={inviteTtl} onChange={(event) => setInviteTtl(event.target.value)}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900">
            <option value="3600">{text('expires1Hour')}</option>
            <option value="86400">{text('expires1Day')}</option>
            <option value="604800">{text('expires7Days')}</option>
            <option value="2592000">{text('expires30Days')}</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !inviteEmail.trim()} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('invite')}</button>
      </form>}
    </section>}

    <section aria-labelledby="audit-scope-review-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="audit-scope-review-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('scopeReviewTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('scopeReviewDescription')}</p>
      {!scopeReviews.length && <p className="mt-3 text-sm text-gray-500">{text('noScopeReviews')}</p>}
      <ul className="mt-3 space-y-2">
        {[...scopeReviews].reverse().map((review) => <li key={review.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <p>{text(review.decision === 'acknowledged' ? 'scopeAcknowledged' : 'scopeNeedsClarification')}</p>
          {review.note && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400"><bdi>{review.note}</bdi></p>}
          <p className="mt-1 text-xs text-gray-500">{formatDate(review.createdAt)}</p>
        </li>)}
      </ul>
      {isAuditor && request.status !== 'closed' && <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); submitScopeReview(); }}>
        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">{text('scopeDecisionLabel')}
          <select value={scopeDecision} onChange={(event) => setScopeDecision(event.target.value)}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900">
            <option value="acknowledged">{text('scopeAcknowledged')}</option>
            <option value="needs_clarification">{text('scopeNeedsClarification')}</option>
          </select>
        </label>
        <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('noteLabel')}
          <input value={scopeNote} onChange={(event) => setScopeNote(event.target.value)}
            placeholder={text('scopeNotePlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('scopeSubmit')}</button>
      </form>}
    </section>

    <section aria-labelledby="audit-corrections-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="audit-corrections-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('correctionsTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('correctionsDescription')}</p>
      {!corrections.length && <p className="mt-3 text-sm text-gray-500">{text('noCorrections')}</p>}
      <ul className="mt-3 space-y-2">
        {corrections.map((correction) => <li key={correction.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <p><bdi>{correction.detail}</bdi></p>
          <p className="mt-1 text-xs text-gray-500">
            {correction.evidenceId ? <span className="font-mono break-all">{correction.evidenceId}</span> : <bdi>{correction.recordRef}</bdi>}
            {' · '}{text(correction.status === 'addressed' ? 'correctionStatusAddressed' : correction.status === 'declined' ? 'correctionStatusDeclined' : 'correctionStatusRequested')}
            {' · '}{formatDate(correction.createdAt)}
          </p>
          {correction.resolutionNote && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400"><bdi>{correction.resolutionNote}</bdi></p>}
          {canManage && correction.status === 'requested' && <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('correctionResolveNoteLabel')}
              <input value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)}
                placeholder={text('correctionResolveNotePlaceholder')}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
            </label>
            <button type="button" disabled={busy} onClick={() => resolveCorrection(correction.id, 'addressed')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{text('correctionMarkAddressed')}</button>
            <button type="button" disabled={busy} onClick={() => resolveCorrection(correction.id, 'declined')} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('correctionMarkDeclined')}</button>
          </div>}
        </li>)}
      </ul>
      {isAuditor && request.status !== 'closed' && <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); requestCorrection(); }}>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('correctionEvidenceLabel')}
          <select value={correctionTarget} onChange={(event) => setCorrectionTarget(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900">
            <option value="">{text('correctionEvidenceNone')}</option>
            {evidence.filter((item) => item.status === 'approved').map((item) => <option key={item.id} value={item.id}>{item.documentId}</option>)}
          </select>
        </label>
        {correctionTarget === '' && <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('correctionRecordRefLabel')}
          <input value={correctionRef} onChange={(event) => setCorrectionRef(event.target.value)} required
            placeholder={text('correctionRecordRefPlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>}
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('correctionDetailLabel')}
          <textarea value={correctionDetail} onChange={(event) => setCorrectionDetail(event.target.value)} required rows={2}
            placeholder={text('correctionDetailPlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <button type="submit" disabled={busy || !correctionDetail.trim() || (correctionTarget === '' && !correctionRef.trim())} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('correctionSubmit')}</button>
      </form>}
    </section>

    {canManage && <section aria-labelledby="audit-annotations-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="audit-annotations-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('annotationsTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('annotationsDescription')}</p>
      {!annotations.length && <p className="mt-3 text-sm text-gray-500">{text('noAnnotations')}</p>}
      <ul className="mt-3 space-y-2">
        {annotations.map((item) => <li key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <p><bdi>{item.note}</bdi></p>
          <p className="mt-1 text-xs text-gray-500">{item.authorRole} · {formatDate(item.createdAt)}</p>
        </li>)}
      </ul>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); addAnnotation(); }}>
        <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('noteLabel')}
          <textarea value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} required rows={2}
            placeholder={text('annotationNotePlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <button type="submit" disabled={busy || !annotationNote.trim()} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('annotationAdd')}</button>
      </form>
    </section>}

    <section aria-labelledby="audit-messages-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="audit-messages-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('messagesTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('messagesDescription')}</p>
      {!messages.length && <p className="mt-3 text-sm text-gray-500">{text('noMessages')}</p>}
      <ul className="mt-3 space-y-2">
        {messages.map((item) => <li key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <p><bdi>{item.message}</bdi></p>
          <p className="mt-1 text-xs text-gray-500">{item.authorRole} · {formatDate(item.createdAt)}</p>
        </li>)}
      </ul>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
        <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('messagePlaceholder')}
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} required rows={2}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <button type="submit" disabled={busy || !message.trim()} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('send')}</button>
      </form>
    </section>

    <section aria-labelledby="audit-receipts-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="audit-receipts-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('receiptsTitle')}</h3>
      <p className="mt-1 text-xs text-gray-500">{text('receiptsDescription')}</p>
      {!receipts.length && <p className="mt-3 text-sm text-gray-500">{text('noReceipts')}</p>}
      <ul className="mt-3 space-y-2">
        {receipts.map((receipt) => <li key={receipt.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
          <p>{text('receivedBy')} <span className="font-mono text-xs break-all">{receipt.receivedBy}</span> · {text('receivedAt')} {formatDate(receipt.createdAt)}</p>
          <p className="mt-1 text-xs text-gray-500">{text('packageLabel')}: {(receipt.package || []).length} {text('packageDocuments')}</p>
          {receipt.note && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400"><bdi>{receipt.note}</bdi></p>}
        </li>)}
      </ul>
      {isAuditor && <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); recordReceipt(); }}>
        <label className="grow text-xs font-semibold text-gray-700 dark:text-gray-300">{text('noteLabel')}
          <input value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)}
            placeholder={text('notePlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{text('recordReceipt')}</button>
      </form>}
    </section>
  </div>;
}
