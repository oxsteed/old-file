import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ClipboardList, FileText, Download } from 'lucide-react';
import { deliverablesApi } from '../api/consultantDeliverables';
import { changesApi } from '../api/consultantChanges';
import { confidentialityApi, downloadEngagementRecord } from '../api/consultantConfidentiality';

// Group 10 Slice F (531-535): the change-request, history, and pause
// UI for one engagement. Either party files a request; the other party
// decides it. Approval applies the change (scope text, due date, or a
// draft invoice for an additional fee) and re-opens an accepted
// milestone when its scope or deadline changes.
function EngagementChanges({ sessionId, deliverables, sessionStatus, onChanged }) {
  const { t } = useTranslation();
  const tx = (key, fallback, options) => t(key, { defaultValue: fallback, ...options });
  const [requests, setRequests] = useState([]);
  const [events, setEvents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('scope_revision');
  const [formDeliverable, setFormDeliverable] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formReason, setFormReason] = useState('');
  const [rejectReasons, setRejectReasons] = useState({});
  const [pauseReason, setPauseReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const [reqRes, histRes] = await Promise.all([
        changesApi.listContractorChangeRequests(sessionId),
        changesApi.getContractorHistory(sessionId),
      ]);
      setRequests(Array.isArray(reqRes.data?.changeRequests) ? reqRes.data.changeRequests : []);
      setEvents(Array.isArray(histRes.data?.events) ? histRes.data.events : []);
    } catch {
      toast.error(t('common.errorLoading'));
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  const runAction = async (key, fn, successKey) => {
    setBusy(key);
    try {
      await fn();
      if (successKey) toast.success(t(successKey));
      await load();
      if (onChanged) await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating'));
    } finally {
      setBusy('');
    }
  };

  const submitRequest = () => {
    const payload = {
      request_type: formType,
      deliverable_id: formDeliverable || null,
      title: null,
      reason: formReason.trim(),
      new_title: formTitle.trim() || null,
      new_description: formDescription.trim() || null,
      new_due_date: formDueDate || null,
      amount_cents: formType === 'additional_fee' ? Math.round(Number(formAmount) * 100) : null,
      currency: 'USD',
    };
    return runAction('submit-request', () => changesApi.createContractorChangeRequest(sessionId, payload), 'consultantChange.requested').then(() => {
      setShowForm(false);
      setFormTitle('');
      setFormDescription('');
      setFormDueDate('');
      setFormAmount('');
      setFormReason('');
    });
  };

  const paused = sessionStatus === 'paused';

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">{tx('consultantChange.title', 'Changes')}</h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5" data-track="ui.d91e4e0189.13"
          >
            {tx('consultantChange.requestChange', 'Request a change')}
          </button>
          {paused ? (
            <button
              type="button"
              onClick={() => runAction('resume', () => changesApi.resumeContractorEngagement(sessionId), 'consultantChange.resumed')}
              disabled={busy === 'resume'}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              data-track="ui.d91e4e0189.12"
            >
              {tx('consultantChange.resume', 'Resume engagement')}
            </button>
          ) : (
            <span className="inline-flex items-center gap-2">
              <input
                type="text"
                value={pauseReason}
                onChange={(event) => setPauseReason(event.target.value)}
                placeholder={tx('consultantChange.pauseReasonPlaceholder', 'Why pause? (at least 10 characters)')}
                aria-label={tx('consultantChange.pauseReasonPlaceholder', 'Why pause? (at least 10 characters)')}
                className="w-[220px] rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
              />
              <button
                type="button"
                onClick={() => runAction('pause', () => changesApi.pauseContractorEngagement(sessionId, pauseReason.trim()), 'consultantChange.paused')}
                disabled={busy === 'pause' || pauseReason.trim().length < 10}
                className="rounded-xl border border-amber-600 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-600/10 disabled:opacity-60"
                data-track="ui.d91e4e0189.11"
              >
                {tx('consultantChange.pause', 'Pause engagement')}
              </button>
            </span>
          )}
        </div>
      </div>
      {paused && (
        <p className="rounded-lg bg-amber-600/10 px-3 py-2 text-xs text-amber-300">
          {tx('consultantChange.pausedNotice', 'This engagement is paused. Milestone work and change approvals are on hold until it resumes.')}
        </p>
      )}
      {showForm && (
        <div className="space-y-2 rounded-xl border border-gray-800 p-3">
          <select
            value={formType}
            onChange={(event) => setFormType(event.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-gray-200"
            aria-label={tx('consultantChange.requestType', 'Change type')}
          >
            <option value="scope_revision">{tx('consultantChange.types.scope_revision', 'Scope revision')}</option>
            <option value="deadline_adjustment">{tx('consultantChange.types.deadline_adjustment', 'Deadline adjustment')}</option>
            <option value="additional_fee">{tx('consultantChange.types.additional_fee', 'Additional fee')}</option>
          </select>
          {formType !== 'additional_fee' && (
            <select
              value={formDeliverable}
              onChange={(event) => setFormDeliverable(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-gray-200"
              aria-label={tx('consultantChange.milestone', 'Milestone')}
            >
              <option value="">{tx('consultantChange.wholeEngagement', 'Whole engagement')}</option>
              {(deliverables || []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          )}
          {formType === 'scope_revision' && (
            <>
              <input
                type="text"
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder={tx('consultantChange.newTitlePlaceholder', 'New milestone title (optional)')}
                className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
              />
              <textarea
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                placeholder={tx('consultantChange.newDescriptionPlaceholder', 'New scope or description')}
                rows={2}
                className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
              />
            </>
          )}
          {formType === 'deadline_adjustment' && (
            <input
              type="date"
              value={formDueDate}
              onChange={(event) => setFormDueDate(event.target.value)}
              className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
              aria-label={tx('consultantChange.newDueDate', 'New due date')}
            />
          )}
          {formType === 'additional_fee' && (
            <input
              type="number"
              min="0"
              step="0.01"
              value={formAmount}
              onChange={(event) => setFormAmount(event.target.value)}
              placeholder={tx('consultantChange.amountPlaceholder', 'Additional fee in dollars')}
              className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
            />
          )}
          <textarea
            value={formReason}
            onChange={(event) => setFormReason(event.target.value)}
            placeholder={tx('consultantChange.reasonPlaceholder', 'Why is this change needed? (at least 10 characters)')}
            rows={2}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
          />
          <button
            type="button"
            onClick={submitRequest}
            disabled={busy === 'submit-request' || formReason.trim().length < 10}
            className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
            data-track="ui.d91e4e0189.7"
          >
            {tx('consultantChange.submitRequest', 'Send change request')}
          </button>
        </div>
      )}
      {requests.length === 0 && events.length === 0 && (
        <p className="text-xs text-gray-400">{tx('consultantChange.empty', 'No changes yet.')}</p>
      )}
      {requests.map((request) => (
        <div key={request.id} className="rounded-xl border border-gray-800 p-3">
          <p className="text-sm font-semibold text-white">
            {tx(`consultantChange.types.${request.requestType}`, request.requestType.replace(/_/g, ' '))}
            {request.deliverableName ? ` • ${request.deliverableName}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {tx(`consultantChange.status.${request.status}`, request.status)}
            {' • '}
            {tx('consultantChange.requestedBy', 'Requested by {{role}}', { role: tx(`consultantChange.roles.${request.requestedByRole}`, request.requestedByRole) })}
            {request.amountCents != null ? ` • $${(request.amountCents / 100).toFixed(2)}` : ''}
            {request.newDueDate ? ` • ${tx('consultantDeliverable.dueLabel', 'due {{date}}', { date: request.newDueDate })}` : ''}
          </p>
          {request.reason && <p className="mt-1 text-xs leading-5 text-gray-400">{request.reason}</p>}
          {request.decisionReason && (
            <p className="mt-1 text-xs leading-5 text-gray-400">
              {tx('consultantChange.decisionReason', 'Decision: {{reason}}', { reason: request.decisionReason })}
            </p>
          )}
          {request.status === 'pending' && request.requestedByRole === 'client' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => runAction(`approve-${request.id}`, () => changesApi.approveContractorChangeRequest(sessionId, request.id), 'consultantChange.approved')}
                disabled={busy === `approve-${request.id}`}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                data-track="ui.d91e4e0189.8"
              >
                {tx('consultantChange.approve', 'Approve')}
              </button>
              <input
                type="text"
                value={rejectReasons[request.id] || ''}
                onChange={(event) => setRejectReasons((prev) => ({ ...prev, [request.id]: event.target.value }))}
                placeholder={tx('consultantChange.rejectReasonPlaceholder', 'Reason for declining (required)')}
                className="min-w-[200px] flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
              />
              <button
                type="button"
                onClick={() => runAction(`reject-${request.id}`, () => changesApi.rejectContractorChangeRequest(sessionId, request.id, (rejectReasons[request.id] || '').trim()), 'consultantChange.rejected')}
                disabled={busy === `reject-${request.id}` || (rejectReasons[request.id] || '').trim().length < 10}
                className="rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-60"
                data-track="ui.d91e4e0189.9"
              >
                {tx('consultantChange.reject', 'Decline')}
              </button>
            </div>
          )}
          {request.status === 'pending' && request.requestedByRole === 'consultant' && (
            <button
              type="button"
              onClick={() => runAction(`withdraw-${request.id}`, () => changesApi.withdrawContractorChangeRequest(sessionId, request.id), 'consultantChange.withdrawn')}
              disabled={busy === `withdraw-${request.id}`}
              className="mt-2 rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-60"
              data-track="ui.d91e4e0189.10"
            >
              {tx('consultantChange.withdraw', 'Withdraw request')}
            </button>
          )}
        </div>
      ))}
      {events.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-300">{tx('consultantChange.history', 'Change history')}</h5>
          <ul className="mt-1 space-y-1">
            {events.map((event) => (
              <li key={event.id} className="text-xs text-gray-400">
                {event.summary}
                {' • '}
                {event.createdAt ? String(event.createdAt).slice(0, 10) : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Group 10 Slice G (536-540): participants, confidentiality
// acknowledgment, document sharing, and the record export for one
// engagement. The consultant adds participants by email, acknowledges
// for themselves, and changes document sharing; participants read the
// board and the documents shared with them.
function EngagementConfidentiality({ sessionId, deliverables, onChanged }) {
  const { t } = useTranslation();
  const tx = (key, fallback, options) => t(key, { defaultValue: fallback, ...options });
  const [participants, setParticipants] = useState(null);
  const [confidentiality, setConfidentiality] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('site_contact');
  const [busy, setBusy] = useState('');
  const [expiryDrafts, setExpiryDrafts] = useState({});
  const [clearedExpiry, setClearedExpiry] = useState({});
  const [visibilityDrafts, setVisibilityDrafts] = useState({});
  const [shareDrafts, setShareDrafts] = useState({});

  const load = async () => {
    try {
      const [partRes, confRes] = await Promise.all([
        confidentialityApi.listContractorParticipants(sessionId),
        confidentialityApi.getContractorConfidentiality(sessionId),
      ]);
      setParticipants(partRes.data);
      setConfidentiality(confRes.data);
    } catch {
      toast.error(t('common.errorLoading'));
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  const runAction = async (key, fn, successKey) => {
    setBusy(key);
    try {
      await fn();
      if (successKey) toast.success(t(successKey));
      await load();
      if (onChanged) await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating'));
    } finally {
      setBusy('');
    }
  };

  const addParticipant = () => runAction(
    'add-participant',
    () => confidentialityApi.addContractorParticipant(sessionId, { email: email.trim(), role }),
    'consultantConfidentiality.added',
  ).then(() => setEmail(''));

  const removeParticipant = (participantId) => runAction(
    `remove-${participantId}`,
    () => confidentialityApi.removeContractorParticipant(sessionId, participantId),
    'consultantConfidentiality.removed',
  );

  const acknowledge = () => runAction(
    'acknowledge',
    () => confidentialityApi.acknowledgeContractorConfidentiality(sessionId),
    'consultantConfidentiality.acknowledged',
  );

  const exportRecord = async () => {
    setBusy('export');
    try {
      const { data } = await confidentialityApi.exportContractorRecord(sessionId);
      downloadEngagementRecord(data, sessionId);
      toast.success(t('consultantConfidentiality.exported'));
    } catch {
      toast.error(t('consultantConfidentiality.exportError'));
    } finally {
      setBusy('');
    }
  };

  const allDocs = (deliverables || []).flatMap((item) => (item.documents || []).map((doc) => ({ ...doc, deliverableId: item.id })));
  const parties = [
    ...(participants?.core || []),
    ...(participants?.participants || []).filter((party) => party.active),
  ];
  const myAck = (confidentiality?.parties || []).find((party) => party.role === 'consultant');
  const pending = (confidentiality?.parties || []).filter((party) => !party.acknowledgedAt);
  const fmtName = (party) => [party.firstName, party.lastName].filter(Boolean).join(' ') || party.email || party.userId;

  const saveSharing = (doc) => {
    const visibility = visibilityDrafts[doc.id] || doc.visibility;
    const payload = { visibility };
    if (clearedExpiry[doc.id]) {
      payload.expires_at = null;
    } else if (expiryDrafts[doc.id]) {
      payload.expires_at = new Date(`${expiryDrafts[doc.id]}T23:59:59.999Z`).toISOString();
    }
    if (visibility === 'limited') {
      payload.shared_with = shareDrafts[doc.id] ?? doc.sharedWith ?? [];
    }
    return runAction(
      `sharing-${doc.id}`,
      () => confidentialityApi.updateContractorDocumentSharing(sessionId, doc.deliverableId, doc.id, payload),
      'consultantConfidentiality.sharingUpdated',
    );
  };

  const toggleShare = (doc, userId) => {
    setShareDrafts((prev) => {
      const current = new Set(prev[doc.id] ?? doc.sharedWith ?? []);
      if (current.has(userId)) current.delete(userId);
      else current.add(userId);
      return { ...prev, [doc.id]: [...current] };
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">{tx('consultantConfidentiality.title', 'Confidentiality')}</h4>
        <button
          type="button"
          onClick={exportRecord}
          disabled={busy === 'export'}
          className="rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-60" data-track="ui.d91e4e0189.14"
        >
          {tx('consultantConfidentiality.export', 'Export engagement record')}
        </button>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-gray-300">{tx('consultantConfidentiality.participantsTitle', 'Participants')}</h5>
        <ul className="mt-1 space-y-1">
          {parties.map((party) => (
            <li key={party.userId} className="flex items-center justify-between gap-2 text-xs text-gray-300">
              <span>
                {fmtName(party)}
                {' • '}
                {tx(`consultantConfidentiality.roles.${party.role}`, party.role.replace(/_/g, ' '))}
              </span>
              {party.id && (
                <button
                  type="button"
                  onClick={() => removeParticipant(party.id)}
                  disabled={busy === `remove-${party.id}`}
                  className="font-semibold text-gray-400 hover:text-red-300 disabled:opacity-60" data-track="ui.d91e4e0189.15"
                >
                  {tx('consultantConfidentiality.remove', 'Remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {parties.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">{tx('consultantConfidentiality.participantsEmpty', 'Only the client and the consultant are on this engagement.')}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={tx('consultantConfidentiality.participantEmailPlaceholder', 'Participant email')}
            aria-label={tx('consultantConfidentiality.participantEmailPlaceholder', 'Participant email')}
            className="min-w-[200px] flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-gray-200"
            aria-label={tx('consultantConfidentiality.participantRole', 'Role')}
          >
            <option value="site_contact">{tx('consultantConfidentiality.roles.site_contact', 'Site contact')}</option>
            <option value="observer">{tx('consultantConfidentiality.roles.observer', 'Observer')}</option>
          </select>
          <button
            type="button"
            onClick={addParticipant}
            disabled={busy === 'add-participant' || !email.trim()}
            className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-60" data-track="ui.d91e4e0189.16"
          >
            {tx('consultantConfidentiality.addParticipant', 'Add participant')}
          </button>
        </div>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-gray-300">{tx('consultantConfidentiality.title', 'Confidentiality')}</h5>
        {pending.length === 0 ? (
          <p className="mt-1 text-xs text-emerald-300">{tx('consultantConfidentiality.ackDone', 'Everyone on this engagement has acknowledged confidentiality.')}</p>
        ) : (
          <p className="mt-1 text-xs text-gray-400">
            {pending.map((party) => tx('consultantConfidentiality.ackPending', 'Still waiting on {{name}}.', { name: fmtName(party) })).join(' ')}
          </p>
        )}
        {myAck && !myAck.acknowledgedAt && (
          <div className="mt-2 space-y-2">
            <p className="text-xs leading-5 text-gray-400">{tx('consultantConfidentiality.ackStatement', 'I will keep this engagement\u2019s information confidential and share it only with the people on this engagement.')}</p>
            <button
              type="button"
              onClick={acknowledge}
              disabled={busy === 'acknowledge'}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60" data-track="ui.d91e4e0189.17"
            >
              {tx('consultantConfidentiality.acknowledge', 'Acknowledge confidentiality')}
            </button>
          </div>
        )}
        {myAck && myAck.acknowledgedAt && (
          <p className="mt-1 text-xs text-emerald-300">{tx('consultantConfidentiality.ackYou', 'You have acknowledged confidentiality.')}</p>
        )}
      </div>

      {allDocs.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-300">{tx('consultantDeliverable.attachDocument', 'Attach a document')}</h5>
          <ul className="mt-1 space-y-2">
            {allDocs.map((doc) => {
              const visibility = visibilityDrafts[doc.id] || doc.visibility;
              const expiry = expiryDrafts[doc.id] ?? (doc.expired ? '' : (doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : ''));
              return (
                <li key={doc.id} className="rounded-xl border border-gray-800 p-3">
                  <p className="text-xs font-semibold text-white">{doc.originalName}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {tx(`consultantConfidentiality.visibility${visibility === 'shared' ? 'Shared' : visibility === 'client_only' ? 'ClientOnly' : visibility === 'consultant_only' ? 'ConsultantOnly' : visibility === 'limited' ? 'Limited' : 'Internal'}`, visibility.replace(/_/g, ' '))}
                    {doc.expired ? (
                      <span className="text-red-300">{` • ${tx('consultantConfidentiality.docExpired', 'Access expired')}`}</span>
                    ) : doc.expiresAt ? (
                      <span>{` • ${tx('consultantConfidentiality.docExpiry', 'Access until {{date}}', { date: String(doc.expiresAt).slice(0, 10) })}`}</span>
                    ) : (
                      <span>{` • ${tx('consultantConfidentiality.docNoExpiry', 'No expiry')}`}</span>
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={visibility}
                      onChange={(event) => setVisibilityDrafts((prev) => ({ ...prev, [doc.id]: event.target.value }))}
                      className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                      aria-label={tx('consultantConfidentiality.visibility', 'Who can see this')}
                    >
                      <option value="shared">{tx('consultantConfidentiality.visibilityShared', 'Shared with client')}</option>
                      <option value="consultant_only">{tx('consultantConfidentiality.visibilityConsultantOnly', 'Consultant only')}</option>
                      <option value="limited">{tx('consultantConfidentiality.visibilityLimited', 'Named people only')}</option>
                    </select>
                    <input
                      type="date"
                      value={expiry}
                      onChange={(event) => {
                        setExpiryDrafts((prev) => ({ ...prev, [doc.id]: event.target.value }));
                        setClearedExpiry((prev) => ({ ...prev, [doc.id]: false }));
                      }}
                      className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                      aria-label={tx('consultantConfidentiality.setExpiry', 'Set expiry')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setExpiryDrafts((prev) => ({ ...prev, [doc.id]: '' }));
                        setClearedExpiry((prev) => ({ ...prev, [doc.id]: true }));
                      }}
                      className="rounded-lg border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-white/5" data-track="ui.d91e4e0189.18"
                    >
                      {tx('consultantConfidentiality.clearExpiry', 'Clear expiry')}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveSharing(doc)}
                      disabled={busy === `sharing-${doc.id}`}
                      className="rounded-xl bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-60" data-track="ui.d91e4e0189.19"
                    >
                      {tx('consultantConfidentiality.saveSharing', 'Save sharing')}
                    </button>
                  </div>
                  {visibility === 'limited' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {parties.map((party) => {
                        const selected = (shareDrafts[doc.id] ?? doc.sharedWith ?? []).includes(party.userId);
                        return (
                          <label key={party.userId} className="inline-flex items-center gap-1 text-xs text-gray-300">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleShare(doc, party.userId)} data-track="ui.d91e4e0189.20"
                            />
                            {fmtName(party)}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {visibility === 'limited' && (
                    <p className="mt-1 text-xs text-gray-400">
                      {tx('consultantConfidentiality.sharedWithCount', 'Shared with {{count}} people', { count: (shareDrafts[doc.id] ?? doc.sharedWith ?? []).length })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Group 10 Slice E (526-530): the consultant's milestone board. Each
// engagement session shows the deliverables seeded from the approved
// proposal; the consultant moves milestones forward, delivers drafts
// with a note, and exchanges documents on a milestone (visibility +
// signed downloads). The client accepts milestones from their own board.
export default function ConsultantEngagementsSection() {
  const { t } = useTranslation();
  const tx = (key, fallback, options) => t(key, { defaultValue: fallback, ...options });
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [boards, setBoards] = useState({});
  const [busy, setBusy] = useState('');
  const [draftNotes, setDraftNotes] = useState({});
  const [uploadVisibility, setUploadVisibility] = useState({});

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await deliverablesApi.listMyEngagements();
      setEngagements(Array.isArray(data?.engagements) ? data.engagements : []);
    } catch {
      toast.error(t('common.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadBoard = async (sessionId) => {
    const { data } = await deliverablesApi.listContractorDeliverables(sessionId);
    setBoards((prev) => ({ ...prev, [sessionId]: Array.isArray(data?.deliverables) ? data.deliverables : [] }));
  };

  const toggleExpand = async (sessionId) => {
    if (expandedId === String(sessionId)) {
      setExpandedId(null);
      return;
    }
    setExpandedId(String(sessionId));
    try {
      await loadBoard(sessionId);
    } catch {
      toast.error(t('common.errorLoading'));
    }
  };

  const runAction = async (key, fn, successKey) => {
    setBusy(key);
    try {
      await fn();
      if (successKey) toast.success(t(successKey));
      await load();
      if (expandedId) await loadBoard(expandedId);
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating'));
    } finally {
      setBusy('');
    }
  };

  const moveStatus = (sessionId, deliverableId, status) => runAction(
    `status-${deliverableId}`,
    () => deliverablesApi.updateDeliverableStatus(sessionId, deliverableId, status),
    'consultantDeliverable.moved',
  );

  const deliverDraft = (sessionId, deliverable) => runAction(
    `draft-${deliverable.id}`,
    () => deliverablesApi.deliverDraft(sessionId, deliverable.id, draftNotes[deliverable.id] || ''),
    'consultantDeliverable.draftDelivered',
  );

  const uploadDocument = async (event, sessionId, deliverable) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('visibility', uploadVisibility[deliverable.id] || 'shared');
    await runAction(
      `upload-${deliverable.id}`,
      () => deliverablesApi.attachContractorDocument(sessionId, deliverable.id, form),
      'consultantDeliverable.documentUploaded',
    );
    event.target.value = '';
  };

  const downloadDocument = async (document) => {
    try {
      const { data } = await deliverablesApi.downloadContractorDocument(document.id);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t('common.errorLoading'));
    }
  };

  const fmtTitle = (row) => {
    if (row.referral_business_name) return row.referral_business_name;
    return row.email || '';
  };

  const fmtDue = (value) => (value ? String(value).slice(0, 10) : '-');

  if (loading) {
    return <p className="text-sm text-gray-400">{tx('common.loading', 'Loading…')}</p>;
  }
  if (!engagements.length) {
    return (
      <p className="text-sm leading-6 text-gray-400">
        {tx('consultantDeliverable.empty', 'No engagements started yet. Start an engagement from an approved proposal and its milestones will appear here.')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {engagements.map((engagement) => {
        const sessionId = String(engagement.id);
        const board = boards[sessionId] || [];
        const expanded = expandedId === sessionId;
        return (
          <div key={sessionId} className="rounded-2xl border border-gray-800 bg-[#111318] p-4">
            <button
              type="button"
              onClick={() => toggleExpand(sessionId)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={expanded}
              data-track="ui.d91e4e0189.1"
            >
              <span>
                <span className="block text-sm font-semibold text-white">{fmtTitle(engagement)}</span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  {tx(`consultantDeliverable.sessionStatus.${engagement.status}`, engagement.status)}
                  {' • '}
                  {tx('consultantDeliverable.acceptedCount', '{{accepted}} of {{total}} milestones accepted', { accepted: engagement.accepted_count ?? 0, total: engagement.deliverable_count ?? 0 })}
                </span>
              </span>
              <span className="text-xs font-semibold text-orange-400">{expanded ? '−' : '+'}</span>
            </button>
            {expanded && (
              <div className="mt-3 space-y-3 border-t border-gray-800 pt-3">
                {board.length === 0 && (
                  <p className="text-sm text-gray-400">{tx('consultantDeliverable.noMilestones', 'No milestones on this engagement yet.')}</p>
                )}
                {board.map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.name}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {tx(`consultantProposal.deliverableTypes.${item.deliverable_type}`, (item.deliverable_type || 'other').replace(/_/g, ' '))}
                          {' • '}
                          {tx('consultantDeliverable.dueLabel', 'due {{date}}', { date: fmtDue(item.due_date) })}
                          {' • '}
                          {tx(`consultantDeliverable.status.${item.status}`, item.status.replace(/_/g, ' '))}
                        </p>
                        {item.description && <p className="mt-1 text-xs leading-5 text-gray-400">{item.description}</p>}
                        {item.draft_note && (
                          <p className="mt-1 text-xs leading-5 text-gray-300">
                            {tx('consultantDeliverable.draftNote', 'Draft note: {{note}}', { note: item.draft_note })}
                          </p>
                        )}
                        {item.feedback_count > 0 && (
                          <p className="mt-1 text-xs text-gray-400">
                            {tx('consultantDeliverable.feedbackCount', '{{count}} feedback notes', { count: item.feedback_count })}
                            {item.latest_rating ? ` • ${tx('consultantDeliverable.latestRating', 'latest rating {{rating}}/5', { rating: item.latest_rating })}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    {(item.documents || []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {item.documents.map((doc) => (
                          <li key={doc.id} className="flex items-center gap-2 text-xs text-gray-300">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                            <span className="min-w-0 flex-1 truncate">{doc.originalName}</span>
                            <button
                              type="button"
                              onClick={() => downloadDocument(doc)}
                              className="inline-flex shrink-0 items-center gap-1 font-semibold text-orange-400 hover:text-orange-300"
                              data-track="ui.d91e4e0189.6"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {tx('consultantDeliverable.download', 'Download')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-gray-400">
                        <ClipboardList className="h-3.5 w-3.5" />
                        <input
                          type="file"
                          onChange={(event) => uploadDocument(event, sessionId, item)}
                          disabled={busy === `upload-${item.id}`}
                          accept="image/*,application/pdf,.doc,.docx"
                          aria-label={tx('consultantDeliverable.attachDocument', 'Attach a document')}
                        />
                      </label>
                      <select
                        value={uploadVisibility[item.id] || 'shared'}
                        onChange={(event) => setUploadVisibility((prev) => ({ ...prev, [item.id]: event.target.value }))}
                        className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                        aria-label={tx('consultantDeliverable.visibility', 'Who can see the document')}
                      >
                        <option value="shared">{tx('consultantDeliverable.visibilityShared', 'Shared with client')}</option>
                        <option value="consultant_only">{tx('consultantDeliverable.visibilityConsultantOnly', 'Consultant only')}</option>
                      </select>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => moveStatus(sessionId, item.id, 'in_progress')}
                          disabled={busy === `status-${item.id}`}
                          className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
                          data-track="ui.d91e4e0189.2"
                        >
                          {tx('consultantDeliverable.startWork', 'Start work')}
                        </button>
                      )}
                      {item.status === 'in_progress' && (
                        <>
                          <input
                            type="text"
                            value={draftNotes[item.id] || ''}
                            onChange={(event) => setDraftNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
                            placeholder={tx('consultantDeliverable.draftNotePlaceholder', 'Draft note for the client…')}
                            aria-label={tx('consultantDeliverable.draftNotePlaceholder', 'Draft note for the client…')}
                            className="min-w-[200px] flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
                          />
                          <button
                            type="button"
                            onClick={() => deliverDraft(sessionId, item)}
                            disabled={busy === `draft-${item.id}`}
                            className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            data-track="ui.d91e4e0189.3"
                          >
                            {tx('consultantDeliverable.deliverDraft', 'Deliver draft')}
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStatus(sessionId, item.id, 'completed')}
                            disabled={busy === `status-${item.id}`}
                            className="rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-60"
                            data-track="ui.d91e4e0189.4"
                          >
                            {tx('consultantDeliverable.markComplete', 'Mark complete')}
                          </button>
                        </>
                      )}
                      {item.status === 'draft_delivered' && (
                        <>
                          <button
                            type="button"
                            onClick={() => moveStatus(sessionId, item.id, 'completed')}
                            disabled={busy === `status-${item.id}`}
                            className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            data-track="ui.d91e4e0189.4"
                          >
                            {tx('consultantDeliverable.markComplete', 'Mark complete')}
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStatus(sessionId, item.id, 'in_progress')}
                            disabled={busy === `status-${item.id}`}
                            className="rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-60"
                            data-track="ui.d91e4e0189.5"
                          >
                            {tx('consultantDeliverable.revise', 'Back to in progress')}
                          </button>
                        </>
                      )}
                      {item.status === 'accepted' && (
                        <span className="rounded-xl bg-emerald-600/15 px-3 py-2 text-xs font-semibold text-emerald-300">
                          {tx('consultantDeliverable.accepted', 'Accepted by the client')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <EngagementChanges
                  sessionId={sessionId}
                  deliverables={board}
                  sessionStatus={engagement.status}
                  onChanged={async () => { await load(); if (expandedId) await loadBoard(expandedId); }}
                />
                <EngagementConfidentiality
                  sessionId={sessionId}
                  deliverables={board}
                  onChanged={async () => { await load(); if (expandedId) await loadBoard(expandedId); }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
