import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Group 14 Slice 5d (716-720): the request detail shared by the requester
// page (/statements/audit-requests) and the admin queue page
// (/admin/super/oxsteed-credit/audit-requests). The apiClient prop is the
// caller-appropriate axios instance (api for the requester, adminApi for
// the admin); every permission is enforced server-side, and the component
// only hides controls the API would refuse anyway (driven by
// request.access: owner | admin | auditor).
export default function AuditRequestDetail({ apiClient, requestId, onBack }) {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options = {}) => t(`statements.auditRequests.${key}`, options);
  const [request, setRequest] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [shares, setShares] = useState([]);
  const [messages, setMessages] = useState([]);
  const [receipts, setReceipts] = useState([]);
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

  const readError = (err) => err?.response?.data?.error || err?.message || text('loadError');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [detailRes, evidenceRes, messagesRes, receiptsRes] = await Promise.all([
        apiClient.get(`/audit-requests/${requestId}`),
        apiClient.get(`/audit-requests/${requestId}/evidence`),
        apiClient.get(`/audit-requests/${requestId}/messages`),
        apiClient.get(`/audit-requests/${requestId}/receipts`),
      ]);
      setRequest(detailRes.data?.request || null);
      setEvidence(evidenceRes.data?.evidence || []);
      setMessages(messagesRes.data?.messages || []);
      setReceipts(receiptsRes.data?.receipts || []);
      // Shares are owner/admin only; auditors get 403 here, which is
      // expected — the section stays hidden for them.
      try {
        const sharesRes = await apiClient.get(`/audit-requests/${requestId}/shares`);
        setShares(sharesRes.data?.shares || []);
      } catch {
        setShares([]);
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
      {canManage && request.status !== 'closed' && <div className="flex gap-2">
        {request.status === 'open' && <button type="button" disabled={busy} onClick={() => moveStatus('in_review')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('moveToReview')}</button>}
        <button type="button" disabled={busy} onClick={() => moveStatus('closed')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{text('closeRequest')}</button>
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
