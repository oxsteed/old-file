import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import {
  Users,
  Clock,
  MessageSquare,
  TrendingUp,
  RefreshCw,
  Activity,
  Headphones,
  Mail,
  ShieldCheck,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  SupportPageShell,
  SupportHero,
  SupportPanel,
  SupportEmptyState,
  SupportActionButton,
  SupportTag,
} from '../components/support/SupportPageChrome';

function formatSeconds(value) {
  const seconds = Number(value || 0);
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatDuration(value) {
  const seconds = Number(value || 0);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDateTime(value) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function MissedConversationCard({ conversation, onUpdated }) {
  const [showEmail, setShowEmail] = useState(false);
  const [subject, setSubject] = useState('Following up on your OxSteed support request');
  const [content, setContent] = useState(
    `Hi ${conversation.customer_name || 'there'},\n\nI’m following up because we missed you when you requested live support. How can we help?\n\nOxSteed Support`
  );
  const [sending, setSending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const sendFollowUp = async (event) => {
    event.preventDefault();
    if (!subject.trim() || !content.trim() || !conversation.customer_email) return;
    setSending(true);
    try {
      await adminApi.post(`/support/conversations/${conversation.id}/email`, {
        subject: subject.trim(),
        content: content.trim(),
        requestId,
      });
      toast.success(`Email sent to ${conversation.customer_email}`);
      setShowEmail(false);
      await onUpdated();
    } catch (err) {
      setRequestId(crypto.randomUUID());
      toast.error(err?.response?.data?.error || 'Failed to send follow-up email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-white">{conversation.customer_name}</h3>
            {conversation.guest_verified_at && (
              <SupportTag tone="green"><ShieldCheck size={12} /> Email verified</SupportTag>
            )}
            {conversation.followed_up_at && (
              <SupportTag tone="blue">
                {conversation.follow_up_count} email{Number(conversation.follow_up_count) === 1 ? '' : 's'} · latest {formatDateTime(conversation.followed_up_at)}
              </SupportTag>
            )}
          </div>
          {conversation.customer_email ? (
            <a
              href={`mailto:${conversation.customer_email}`}
              className="mt-2 inline-flex items-center gap-2 break-all text-sm text-orange-300 hover:text-orange-200"
            >
              <Mail size={14} /> {conversation.customer_email}
            </a>
          ) : (
            <div className="mt-2 text-sm text-gray-500">No verified email is available.</div>
          )}
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-gray-600">Requested</dt>
              <dd className="mt-1 text-gray-300">{formatDateTime(conversation.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-gray-600">Wait ended</dt>
              <dd className="mt-1 text-gray-300">{formatDateTime(conversation.live_wait_ended_at)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-gray-600">Status</dt>
              <dd className="mt-1 capitalize text-gray-300">{String(conversation.status || '').replaceAll('_', ' ')}</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-600">Their latest message</div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-300">
              {conversation.last_message || 'No message was provided.'}
            </p>
          </div>
          <div className="mt-3 break-all font-mono text-[11px] text-gray-600">
            Conversation {conversation.id}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowEmail((value) => !value)}
          disabled={!conversation.customer_email}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Mail size={15} /> {showEmail ? 'Close email' : 'Email customer'}
        </button>
      </div>

      {showEmail && (
        <form onSubmit={sendFollowUp} className="mt-5 space-y-3 border-t border-gray-800 pt-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">To</label>
            <input
              value={conversation.customer_email}
              readOnly
              className="w-full rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-400"
            />
          </div>
          <div>
            <label htmlFor={`subject-${conversation.id}`} className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">Subject</label>
            <input
              id={`subject-${conversation.id}`}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
              required
              className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor={`message-${conversation.id}`} className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">Message</label>
            <textarea
              id={`message-${conversation.id}`}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={5000}
              rows={6}
              required
              className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm leading-6 text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-gray-600">The sent email is recorded in this support conversation.</p>
            <button
              type="submit"
              disabled={sending || !subject.trim() || !content.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:opacity-40"
            >
              {sending ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
              {sending ? 'Sending…' : 'Send email'}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

export default function SupportAgentDashboard() {
  const { businessId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/agents/dashboard', {
        params: { business_id: businessId },
      });
      setData(res.data);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !data) {
    return (
      <SupportPageShell>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
        </div>
      </SupportPageShell>
    );
  }

  const stats = data?.stats || {};
  const agents = data?.agents || [];
  const activeConversations = data?.active_conversations || [];
  const missedConversations = data?.missed_conversations || [];

  return (
    <SupportPageShell>
      <SupportHero
        icon={Headphones}
        eyebrow="Support Operations"
        title="Agent dashboard"
        description="Monitor live staffing, current conversations, and response health so leads can see whether the team is keeping pace right now."
        actions={(
          <SupportActionButton icon={RefreshCw} onClick={loadData} tone="secondary">
            Refresh
          </SupportActionButton>
        )}
        stats={[
          {
            icon: Users,
            label: 'Online agents',
            value: stats.agents_online || 0,
            detail: 'Agents currently active in the support system.',
          },
          {
            icon: MessageSquare,
            label: 'Live conversations',
            value: stats.active_conversations || 0,
            detail: 'Customer conversations happening right now.',
            tone: 'text-orange-300',
          },
          {
            icon: Clock,
            label: 'Avg response',
            value: formatSeconds(stats.avg_response_time_seconds),
            detail: 'Current average time to reply across the team.',
            tone: 'text-blue-300',
          },
          {
            icon: TrendingUp,
            label: 'Resolution rate',
            value: `${stats.resolution_rate || 0}%`,
            detail: 'Today’s resolution performance.',
            tone: 'text-green-300',
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <SupportPanel
          title="Online agent roster"
          subtitle={`${agents.length} agent${agents.length === 1 ? '' : 's'} visible in the live roster.`}
        >
          {agents.length === 0 ? (
            <SupportEmptyState
              icon={Users}
              title="No agents online"
              body="Once agents log in and begin taking work, their live status and chat load will appear here."
            />
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => (
                <div key={agent.id} className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]" />
                      <div>
                        <div className="text-sm font-semibold text-white">{agent.name}</div>
                        <div className="mt-1 text-xs text-gray-500">{agent.role}</div>
                      </div>
                    </div>
                    <SupportTag tone="orange">{agent.active_chats || 0} active chats</SupportTag>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SupportPanel>

        <SupportPanel
          title="Active conversation flow"
          subtitle="Who is handling customers right now and what each thread looks like at a glance."
        >
          {activeConversations.length === 0 ? (
            <SupportEmptyState
              icon={MessageSquare}
              title="No active conversations"
              body="When a customer is in a live support session, it will appear here with the assigned agent and latest message."
            />
          ) : (
            <div className="space-y-3">
              {activeConversations.map((conv) => (
                <div key={conv.id} className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{conv.customer_name}</div>
                      <div className="mt-1 text-xs text-gray-500">{conv.agent_name}</div>
                    </div>
                    <SupportTag tone="blue">{formatDuration(conv.duration_seconds)}</SupportTag>
                  </div>
                  <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm leading-6 text-gray-400">
                    {conv.last_message || 'No recent message preview available.'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SupportPanel>
      </div>

      <SupportPanel
        title="Missed live-support follow-ups"
        subtitle="Verified customers whose five-minute live-support wait ended before an agent responded."
      >
        {missedConversations.length === 0 ? (
          <SupportEmptyState
            icon={Mail}
            title="No missed follow-ups"
            body="Customers who finish the verified live-support wait without an agent response will appear here with their contact details and message."
          />
        ) : (
          <div className="space-y-4">
            {missedConversations.map((conversation) => (
              <MissedConversationCard
                key={conversation.id}
                conversation={conversation}
                onUpdated={loadData}
              />
            ))}
          </div>
        )}
      </SupportPanel>

      <SupportPanel
        title="Operational pulse"
        subtitle="A compact snapshot for shift leads reviewing the floor."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
              <Activity size={15} className="text-orange-300" />
              Queue pressure
            </div>
            <div className="mt-2 text-sm leading-6 text-gray-500">
              Compare online agents against live conversations to see whether the team is underloaded, balanced, or at risk of delay.
            </div>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
              <Clock size={15} className="text-blue-300" />
              Response health
            </div>
            <div className="mt-2 text-sm leading-6 text-gray-500">
              Use average response time as the first signal of customer wait pain before CSAT or escalations start slipping.
            </div>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
              <TrendingUp size={15} className="text-green-300" />
              Resolution quality
            </div>
            <div className="mt-2 text-sm leading-6 text-gray-500">
              Rising resolution rate usually means triage, staffing, and documentation are all working together effectively.
            </div>
          </div>
        </div>
      </SupportPanel>
    </SupportPageShell>
  );
}
