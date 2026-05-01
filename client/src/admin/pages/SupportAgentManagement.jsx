import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { Users, Search, RefreshCw, Eye, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';

export default function SupportAgentManagement() {
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
    }
    setLoading(false);
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
    if (!window.confirm('Delete this agent?')) return;
    try {
      await adminApi.delete(`/support/agents/${agentId}`);
      loadAgents();
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Agent Management</h1>
          <p className="text-gray-400 text-sm">View and manage all support agents.</p>
        </div>
        <button
          onClick={loadAgents}
          disabled={loading}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="mb-8">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search agents by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        {agents.length === 0 ? (
          <div className="text-center py-12">
            <Users size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">No agents found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-700/50">
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Agent</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Role</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Skills</th>
                  <th className="px-6 py-3 text-right text-gray-400 text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => (
                  <tr key={agent.id} className="border-b border-gray-700 hover:bg-gray-700/30 transition">
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-white font-medium">{agent.name}</p>
                        <p className="text-gray-400 text-sm">{agent.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 bg-blue-900/30 text-blue-300 rounded-full text-sm">
                        {agent.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${agent.is_active ? 'bg-green-500' : 'bg-gray-500'}`} />
                        <span className="text-white text-sm">{agent.is_active ? 'Active' : 'Inactive'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(agent.skills || []).slice(0, 2).map(skill => (
                          <span key={skill} className="px-2 py-1 bg-orange-900/30 text-orange-300 rounded text-xs">
                            {skill}
                          </span>
                        ))}
                        {(agent.skills || []).length > 2 && (
                          <span className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs">
                            +{(agent.skills || []).length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSelectedAgent(agent)}
                          className="p-2 hover:bg-gray-700 rounded transition"
                        >
                          <Eye size={16} className="text-gray-400" />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(agent.id)}
                          className="p-2 hover:bg-gray-700 rounded transition"
                        >
                          {agent.is_active ? (
                            <ToggleRight size={16} className="text-green-400" />
                          ) : (
                            <ToggleLeft size={16} className="text-gray-400" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(agent.id)}
                          className="p-2 hover:bg-red-900/30 rounded transition"
                        >
                          <Trash2 size={16} className="text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg w-full">
            <div className="border-b border-gray-700 p-6 flex items-center justify-between">
              <h2 className="text-white font-bold text-xl">Agent Details</h2>
              <button onClick={() => setSelectedAgent(null)} className="text-gray-500 hover:text-white text-2xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-gray-400 text-sm mb-1">Name</p>
                <p className="text-white font-medium">{selectedAgent.name}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">Email</p>
                <p className="text-white">{selectedAgent.email}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-2">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {(selectedAgent.skills || []).map(skill => (
                    <span key={skill} className="px-3 py-1 bg-orange-900/30 text-orange-300 rounded-full text-sm">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Chats Today</p>
                  <p className="text-white font-bold text-2xl">{selectedAgent.chats_today || 0}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">Avg Rating</p>
                  <p className="text-white font-bold text-2xl">{selectedAgent.avg_rating || '–'}★</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
