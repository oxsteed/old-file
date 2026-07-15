import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Clock3,
  ExternalLink,
  FileText,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime } from '../lib/format';

function normalizeCase(responseData) {
  return responseData?.data || responseData || null;
}

function tone(status) {
  const map = {
    new: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    awaiting_restaurant: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
    awaiting_customer: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20',
    awaiting_oxsteed: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
    awaiting_runner: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
    investigating: 'bg-orange-500/15 text-orange-300 border-orange-500/20',
    resolution_offered: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
    resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    closed: 'bg-slate-500/15 text-slate-300 border-slate-500/20',
    reopened: 'bg-rose-500/15 text-rose-300 border-rose-500/20',
    escalated: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/20',
  };
  return map[status] || 'bg-white/5 text-slate-300 border-white/10';
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/75 p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-white">
        {Icon && <Icon size={18} className="text-orange-300" />}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export default function RestaurantSupportCasePage() {
  const { t } = useTranslation();
  const { caseId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [supportCase, setSupportCase] = useState(null);
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [sending, setSending] = useState(false);

  const loadCase = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get(`/restaurants/support/cases/${caseId}`);
      const data = normalizeCase(response.data);
      setSupportCase(data?.case || null);
      setMessages(data?.messages || []);
      setAttachments(data?.attachments || []);
      setEvents(data?.events || []);
    } catch (err) {
      setError(err.response?.data?.error || t('support.errorLoading', { defaultValue: 'Failed to load support case.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (caseId) loadCase();
  }, [caseId]);

  const caseStatus = String(supportCase?.status || '').replace(/_/g, ' ');
  const caseTitle = supportCase?.title || supportCase?.public_case_number || t('support.case', { defaultValue: 'Support case' });
  const orderSnapshot = useMemo(() => parseMaybeJson(supportCase?.order_snapshot), [supportCase?.order_snapshot]);
  const relatedOrderId = supportCase?.order_id || orderSnapshot?.id || null;

  const handleSubmit = async () => {
    if (!message.trim() && !attachmentUrl.trim()) {
      toast.error(t('support.caseActionRequired', { defaultValue: 'Add a message or attachment first.' }));
      return;
    }
    try {
      setSending(true);
      if (message.trim()) {
        await api.post(`/restaurants/support/cases/${caseId}/messages`, {
          message: message.trim(),
          language: localStorage.getItem('oxs:language') || 'en',
        });
      }
      if (attachmentUrl.trim()) {
        await api.post(`/restaurants/support/cases/${caseId}/attachments`, {
          fileUrl: attachmentUrl.trim(),
          attachmentType: 'proof',
          fileName: 'support-proof',
        });
      }
      toast.success(t('support.replySent', { defaultValue: 'Saved.' }));
      setMessage('');
      setAttachmentUrl('');
      await loadCase();
    } catch (err) {
      toast.error(err.response?.data?.error || t('support.replyError', { defaultValue: 'Failed to save update.' }));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="animate-pulse rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-white/10" />
            <div className="h-5 w-52 rounded bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !supportCase) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <PageMeta title={t('support.case', { defaultValue: 'Support case' })} noIndex />
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-12">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950/80 p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-300">
              <ShieldAlert size={28} />
            </div>
            <h1 className="text-2xl font-semibold text-white">{t('support.caseUnavailable', { defaultValue: 'Support case unavailable' })}</h1>
            <p className="mt-3 text-slate-300">{error || t('support.caseUnavailableBody', { defaultValue: 'We could not load this support case.' })}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={loadCase}
                className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3 font-semibold text-white transition hover:bg-orange-600"
              >
                <RefreshCw size={16} />
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
              <button
                type="button"
                onClick={() => navigate('/support')}
                className="inline-flex items-center gap-2 rounded-full bg-white/5 px-5 py-3 font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <ArrowLeft size={16} />
                {t('support.supportCenter', { defaultValue: 'Support' })}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <PageMeta title={caseTitle} noIndex />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/support')}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <ArrowLeft size={16} />
            {t('common.back', { defaultValue: 'Back' })}
          </button>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tone(supportCase.status)}`}>
            {caseStatus || 'new'}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
          <div className="space-y-6">
            <Section title={caseTitle} icon={FileText}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.caseNumber', { defaultValue: 'Case number' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{supportCase.public_case_number}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.restaurant', { defaultValue: 'Restaurant' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{supportCase.restaurant_name || t('common.none', { defaultValue: 'None' })}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.priority', { defaultValue: 'Priority' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{supportCase.priority || 'normal'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.due', { defaultValue: 'Due' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{formatDateTime(supportCase.due_at)}</div>
                </div>
              </div>
            </Section>

            <Section title={t('support.messages', { defaultValue: 'Messages' })} icon={MessageSquare}>
              <div className="space-y-3">
                {messages.map((msg) => (
                  <article
                    key={msg.id}
                    className={`rounded-2xl border p-4 ${
                      msg.sender_type === 'restaurant'
                        ? 'border-blue-500/20 bg-blue-500/10'
                        : msg.sender_type === 'customer'
                          ? 'border-white/10 bg-white/5'
                          : 'border-violet-500/20 bg-violet-500/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{msg.sender_type || 'system'}</div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                          {msg.internal_note ? t('support.internalNote', { defaultValue: 'Internal note' }) : t('support.message', { defaultValue: 'Message' })}
                        </div>
                      </div>
                      <span className="text-xs text-slate-400">{formatDateTime(msg.created_at)}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-200">{msg.message}</p>
                  </article>
                ))}
                {!messages.length && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-slate-300">
                    {t('support.noMessages', { defaultValue: 'No messages yet.' })}
                  </div>
                )}
              </div>
            </Section>
          </div>

          <div className="space-y-6">
            <Section title={t('support.caseDetails', { defaultValue: 'Case details' })} icon={Clock3}>
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.issueType', { defaultValue: 'Issue type' })}</dt>
                  <dd className="mt-1 text-slate-100">{String(supportCase.issue_type || 'other').replace(/_/g, ' ')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.status', { defaultValue: 'Status' })}</dt>
                  <dd className="mt-1 text-slate-100">{String(supportCase.status || '').replace(/_/g, ' ')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.created', { defaultValue: 'Created' })}</dt>
                  <dd className="mt-1 text-slate-100">{formatDateTime(supportCase.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.description', { defaultValue: 'Description' })}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-slate-100">{supportCase.description}</dd>
                </div>
              </dl>
            </Section>

            {relatedOrderId && (
              <Section title={t('support.relatedOrder', { defaultValue: 'Related order' })} icon={ExternalLink}>
                <Link
                  to={`/food/orders/${relatedOrderId}`}
                  className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600"
                >
                  {t('support.viewOrder', { defaultValue: 'View order' })}
                  <ExternalLink size={15} />
                </Link>
              </Section>
            )}

            <Section title={t('support.attachmentAndReply', { defaultValue: 'Message or proof link' })} icon={Paperclip}>
              <div className="space-y-3">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-orange-400/60"
                  placeholder={t('support.replyPlaceholder', { defaultValue: 'Add a message for the restaurant or OxSteed team…' })}
                />
                <input
                  value={attachmentUrl}
                  onChange={(e) => setAttachmentUrl(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-orange-400/60"
                  placeholder={t('support.proofLinkPlaceholder', { defaultValue: 'Paste a receipt / proof link (optional)' })}
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
                >
                  <Send size={15} />
                  {sending ? t('common.sending', { defaultValue: 'Sending…' }) : t('support.saveUpdate', { defaultValue: 'Save update' })}
                </button>
              </div>
            </Section>

            <Section title={t('support.attachments', { defaultValue: 'Attachments' })} icon={Paperclip}>
              <div className="space-y-3">
                {attachments.map((attachment) => (
                  <article key={attachment.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{attachment.file_name || attachment.file_url}</div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{attachment.attachment_type || 'proof'}</div>
                      </div>
                      <a href={attachment.file_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-orange-300 hover:text-orange-200">
                        {t('common.open', { defaultValue: 'Open' })}
                      </a>
                    </div>
                  </article>
                ))}
                {!attachments.length && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-slate-300">
                    {t('support.noAttachments', { defaultValue: 'No attachments yet.' })}
                  </div>
                )}
              </div>
            </Section>

            {events.length > 0 && (
              <Section title={t('support.timeline', { defaultValue: 'Timeline' })} icon={Clock3}>
                <div className="space-y-3">
                  {events.slice(-10).map((event) => (
                    <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-white">{String(event.event_type || 'event').replace(/_/g, ' ')}</div>
                        <div className="text-xs text-slate-400">{formatDateTime(event.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
