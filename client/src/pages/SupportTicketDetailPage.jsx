import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BadgeAlert, Clock3, MessageSquare, RefreshCw, Send, Ticket } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime } from '../lib/format';

function normalizeTicket(responseData) {
  return responseData?.data || responseData || null;
}

function statusTone(status) {
  const map = {
    open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    assigned: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
    in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
    waiting_user: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20',
    resolved: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
    closed: 'bg-slate-500/15 text-slate-300 border-slate-500/20',
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

export default function SupportTicketDetailPage() {
  const { t } = useTranslation();
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const loadTicket = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get(`/support/my-tickets/${ticketId}`);
      const data = normalizeTicket(response.data);
      setTicket(data?.ticket || null);
      setMessages(data?.messages || []);
    } catch (err) {
      setError(err.response?.data?.error || t('support.errorLoading', { defaultValue: 'Failed to load support ticket.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ticketId) loadTicket();
  }, [ticketId]);

  const isClosed = useMemo(() => ['resolved', 'closed'].includes(String(ticket?.status || '').toLowerCase()), [ticket?.status]);

  const handleReply = async () => {
    if (!reply.trim()) {
      toast.error(t('support.replyRequired', { defaultValue: 'Please write a reply first.' }));
      return;
    }
    try {
      setSending(true);
      await api.post(`/support/my-tickets/${ticketId}/reply`, {
        content: reply.trim(),
        sender_language: localStorage.getItem('oxs:language') || 'en',
      });
      setReply('');
      toast.success(t('support.replySent', { defaultValue: 'Reply sent.' }));
      await loadTicket();
    } catch (err) {
      toast.error(err.response?.data?.error || t('support.replyError', { defaultValue: 'Failed to send reply.' }));
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

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <PageMeta title={t('support.ticketDetails', { defaultValue: 'Support Ticket' })} noIndex />
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-12">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950/80 p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-300">
              <Ticket size={28} />
            </div>
            <h1 className="text-2xl font-semibold text-white">{t('support.ticketUnavailable', { defaultValue: 'Support ticket unavailable' })}</h1>
            <p className="mt-3 text-slate-300">{error || t('support.ticketUnavailableBody', { defaultValue: 'We could not load this ticket.' })}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={loadTicket}
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
      <PageMeta title={`${t('support.ticket', { defaultValue: 'Ticket' })} #${ticket.ticket_number}`} noIndex />

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
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusTone(ticket.status)}`}>
            {String(ticket.status || 'open').replace(/_/g, ' ')}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
          <div className="space-y-6">
            <Section title={ticket.subject || t('support.ticket', { defaultValue: 'Ticket' })} icon={Ticket}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.ticketNumber', { defaultValue: 'Ticket #' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">#{ticket.ticket_number}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.category', { defaultValue: 'Category' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{String(ticket.category || 'general').replace(/_/g, ' ')}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.priority', { defaultValue: 'Priority' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{ticket.priority}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.updated', { defaultValue: 'Updated' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{formatDateTime(ticket.updated_at || ticket.created_at)}</div>
                </div>
              </div>
            </Section>

            <Section title={t('support.messages', { defaultValue: 'Messages' })} icon={MessageSquare}>
              <div className="space-y-3">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`rounded-2xl border p-4 ${
                      message.is_from_admin
                        ? 'border-blue-500/20 bg-blue-500/10'
                        : 'border-white/10 bg-white/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">
                          {message.is_from_admin ? t('support.team', { defaultValue: 'OxSteed Support' }) : (message.sender_name || ticket.name || user?.name || t('common.you', { defaultValue: 'You' }))}
                        </div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                          {message.is_from_admin ? t('support.replyFromTeam', { defaultValue: 'Support reply' }) : t('support.yourMessage', { defaultValue: 'Your message' })}
                        </div>
                      </div>
                      <span className="text-xs text-slate-400">{formatDateTime(message.created_at)}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-200">{message.content}</p>
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
            <Section title={t('support.ticketInfo', { defaultValue: 'Ticket info' })} icon={BadgeAlert}>
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.subject', { defaultValue: 'Subject' })}</dt>
                  <dd className="mt-1 text-slate-100">{ticket.subject}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.created', { defaultValue: 'Created' })}</dt>
                  <dd className="mt-1 text-slate-100">{formatDateTime(ticket.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('support.status', { defaultValue: 'Status' })}</dt>
                  <dd className="mt-1 text-slate-100">{String(ticket.status || '').replace(/_/g, ' ')}</dd>
                </div>
              </dl>
            </Section>

            <Section title={t('support.reply', { defaultValue: 'Reply' })} icon={Clock3}>
              {isClosed ? (
                <p className="text-slate-300">
                  {t('support.closedReplyNotice', { defaultValue: 'This ticket is closed. Reopen it from the support center if you need to add more details.' })}
                </p>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={5}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-orange-400/60"
                    placeholder={t('support.replyPlaceholder', { defaultValue: 'Write your reply…' })}
                  />
                  <button
                    type="button"
                    onClick={handleReply}
                    disabled={sending}
                    className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
                  >
                    <Send size={15} />
                    {sending ? t('common.sending', { defaultValue: 'Sending…' }) : t('support.sendReply', { defaultValue: 'Send reply' })}
                  </button>
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
