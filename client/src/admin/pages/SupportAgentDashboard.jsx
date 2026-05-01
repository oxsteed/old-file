import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import {
  Users, Clock, MessageSquare, TrendingUp, Phone, AlertCircle, RefreshCw, MapPin,
} from 'lucide-react';

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
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const stats = data.stats || {};
  const agents = data.agents || [];
  const activeConversations = data.active_conversations || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Agent Dashboard</h1>
          <p className="text-gray-400 text-sm">Real-time agent status and performance metrics.</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Users size={14} />
            Online Agents
          </p>
          <p className="text-white text-3xl font-bold">{stats.agents_online || 0}</p>
          <p className="text-gray-500 text-xs mt-2">Active now</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <MessageSquare size={14} />
            Active Conversations
          </p>
          <p className="text-white text-3xl font-bold">{stats.active_conversations || 0}</p>
          <p className="text-gray-500 text-xs mt-2">In progress</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Clock size={14} />
            Avg Response Time
          </p>
          <p className="text-white text-3xl font-bold">{stats.avg_response_time_seconds || 0}s</p>
          <p className="text-gray-500 text-xs mt-2">Team average</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <TrendingUp size={14} />
            Resolution Rate
          </p>
          <p className="text-white text-3xl font-bold">{stats.resolution_rate || 0}%</p>
          <p className="text-gray-500 text-xs mt-2">Today</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-white font-bold text-lg mb-4">Online Agents</h2>
          <div className="space-y-3">
            {agents.length === 0 ? (
              <p className="text-gray-400 text-sm">No agents online</p>
            ) : (
              agents.map(agent => (
                <div key={agent.id} className="flex items-center justify-between bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <div>
                      <p className="text-white font-medium">{agent.name}</p>
                      <p className="text-gray-400 text-xs">{agent.role}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-sm font-semibold">{agent.active_chats}</p>
                    <p className="text-gray-400 text-xs">active</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-white font-bold text-lg mb-4">Active Conversations</h2>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {activeConversations.length === 0 ? (
              <p className="text-gray-400 text-sm">No active conversations</p>
            ) : (
              activeConversations.map(conv => (
                <div key={conv.id} className="bg-gray-700 rounded-lg p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-white text-sm font-medium">{conv.customer_name}</p>
                      <p className="text-gray-400 text-xs">{conv.agent_name}</p>
                    </div>
                    <span className="text-gray-400 text-xs">{conv.duration}</span>
                  </div>
                  <p className="text-gray-300 text-xs line-clamp-2">{conv.last_message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
