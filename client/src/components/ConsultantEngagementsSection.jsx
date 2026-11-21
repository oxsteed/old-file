import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ClipboardList, FileText, Download } from 'lucide-react';
import { deliverablesApi } from '../api/consultantDeliverables';

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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
