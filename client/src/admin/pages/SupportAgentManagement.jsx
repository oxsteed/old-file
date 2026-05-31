import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import {
  Users,
  Search,
  RefreshCw,
  Eye,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ShieldCheck,
  Star,
} from 'lucide-react';
import {
  SupportPageShell,
  SupportHero,
  SupportPanel,
  SupportEmptyState,
  SupportActionButton,
  SupportTag,
} from '../components/support/SupportPageChrome';

export default function SupportAgentManagement() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/agents', {
        params: { business_id: businessId, search },
      });
      setAgents(res.data.agents || []);
    } catch (err) {
      console.error('Failed to load agents:', err);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, search]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleToggleStatus = async (agentId) => {
    try {
      await adminApi.patch(`/support/agents/${agentId}/toggle-status`);
      loadAgents();
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const handleDelete = async (agentId) => {
    if (!window.confirm(t('supportAdmin.agentManagement.confirmDeleteAgent'))) return;
    try {
      await adminApi.delete(`/support/agents/${agentId}`);
      loadAgents();
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  const activeCount = agents.filter((agent) => agent.is_active).length;
  const skillCount = new Set(agents.flatMap((agent) => agent.skills || [])).size;

  return (
    <SupportPageShell>
      <SupportHero
        icon={Users}
        eyebrow="Team Directory"
        title="Support agents"
        description="Review staffing, inspect skills, and manage who is active in the support operation without leaving the team roster."
        actions={(
          <>
            <SupportActionButton icon={RefreshCw} onClick={loadAgents} tone="secondary">
              Refresh
            </SupportActionButton>
          </>
        )}
        stats={[
          {
            icon: Users,
            label: 'Agents',
            value: agents.length,
            detail: 'Total support agents currently in the roster.',
          },
          {
            icon: ShieldCheck,
            label: 'Active',
            value: activeCount,
            detail: 'Agents currently enabled for support work.',
            tone: 'text-green-300',
          },
          {
            icon: Star,
            label: 'Skill areas',
            value: skillCount,
            detail: 'Unique support specialties represented on the team.',
            tone: 'text-blue-300',
          },
          {
            icon: Search,
            label: 'Search mode',
            value: search ? 'Filtered' : 'All',
            detail: search ? `Current query: ${search}` : 'Browsing the full team roster.',
            tone: 'text-orange-300',
          },
        ]}
      />

      <SupportPanel
        title="Agent roster"
        subtitle="Search by name or email, then inspect skills and activation status."
      >
        <div className="mb-5">
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search agents by name or email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-2xl border border-gray-700 bg-gray-900 py-3 pl-11 pr-4 text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
        </div>

        {agents.length === 0 ? (
          <SupportEmptyState
            icon={Users}
            title="No agents found"
            body="Try a different search or onboard new support staff to begin building out the team roster."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {agents.map((agent) => (
              <div key={agent.id} className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-white">{agent.name}</div>
                    <div className="mt-1 text-sm text-gray-500">{agent.email}</div>
                  </div>
                  <SupportTag tone={agent.is_active ? 'green' : 'default'}>
                    {agent.is_active ? 'Active' : 'Inactive'}
                  </SupportTag>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <SupportTag tone="blue">{agent.role}</SupportTag>
                  {(agent.skills || []).slice(0, 3).map((skill) => (
                    <SupportTag key={skill} tone="orange">{skill}</SupportTag>
                  ))}
                  {(agent.skills || []).length > 3 && (
                    <SupportTag>+{(agent.skills || []).length - 3} more</SupportTag>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-gray-800 pt-4">
                  <div className="text-xs text-gray-500">
                    Chats today: <span className="text-gray-300">{agent.chats_today || 0}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedAgent(agent)}
                      className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 transition hover:text-white"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      onClick={() => handleToggleStatus(agent.id)}
                      className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 transition hover:text-white"
                    >
                      {agent.is_active ? (
                        <ToggleRight size={16} className="text-green-400" />
                      ) : (
                        <ToggleLeft size={16} className="text-gray-500" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(agent.id)}
                      className="rounded-xl border border-red-900/40 bg-red-950/30 p-2 text-red-400 transition hover:bg-red-900/30"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SupportPanel>

      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-[28px] border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-5">
              <div>
                <div className="text-xl font-semibold text-white">Agent profile</div>
                <div className="mt-1 text-sm text-gray-500">Support performance and specialization snapshot.</div>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="text-2xl text-gray-500 hover:text-white">x</button>
            </div>
            <div className="space-y-5 px-6 py-6">
              <div>
                <div className="text-sm font-medium text-white">{selectedAgent.name}</div>
                <div className="mt-1 text-sm text-gray-500">{selectedAgent.email}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Chats today</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{selectedAgent.chats_today || 0}</div>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Avg rating</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{selectedAgent.avg_rating || '-'}</div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-300">Skill coverage</div>
                <div className="flex flex-wrap gap-2">
                  {(selectedAgent.skills || []).map((skill) => (
                    <SupportTag key={skill} tone="orange">{skill}</SupportTag>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </SupportPageShell>
  );
}
