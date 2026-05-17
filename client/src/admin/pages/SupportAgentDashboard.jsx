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
} from 'lucide-react';
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
                    <SupportTag tone="blue">{conv.duration}</SupportTag>
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
