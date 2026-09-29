import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { Users, Search, RefreshCw, TrendingUp, Star, Clock, MessageSquare } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function SupportPerformanceAnalytics() {
  const { businessId } = useParams();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('rating');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentDetails, setAgentDetails] = useState(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/performance', {
        params: { business_id: businessId, search, sort_by: sortBy },
      });
      setAgents(res.data.agents || []);
    } catch (err) {
      console.error('Failed to load performance data:', err);
    }
    setLoading(false);
  }, [businessId, search, sortBy]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Sequence-guarded: a slow response for a previously selected agent can
  // never populate the modal with the wrong agent's metrics.
  const detailSeq = useRef(0);
  const loadAgentDetails = useCallback(async (agentId) => {
    const seq = ++detailSeq.current;
    try {
      const res = await adminApi.get(`/support/performance/${agentId}`, {
        params: { business_id: businessId },
      });
      if (detailSeq.current === seq) setAgentDetails(res.data);
    } catch (err) {
      if (detailSeq.current === seq) console.error('Failed to load agent details:', err);
    }
  }, [businessId]);

  const handleSelectAgent = (agent) => {
    setSelectedAgent(agent);
    // Clear the previous agent's metrics immediately so the modal never shows
    // the new agent's name alongside stale metrics while loading.
    setAgentDetails(null);
    loadAgentDetails(agent.id);
  };

  const teamAvgRating = agents.length > 0
    ? (agents.reduce((sum, a) => sum + (a.rating || 0), 0) / agents.length).toFixed(1)
    : 0;

  const teamAvgResponseTime = agents.length > 0
    ? Math.round(agents.reduce((sum, a) => sum + (a.avg_response_time_seconds || 0), 0) / agents.length)
    : 0;

  const totalChats = agents.reduce((sum, a) => sum + (a.total_chats || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Performance Analytics</h1>
          <p className="text-gray-400 text-sm">Team and individual agent performance metrics.</p>
        </div>
        <button
          onClick={loadAgents}
          disabled={loading}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Team Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Users size={14} />
            Total Agents
          </p>
          <p className="text-white text-3xl font-bold">{agents.length}</p>
          <p className="text-gray-500 text-xs mt-2">Active</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Star size={14} />
            Avg Rating
          </p>
          <p className="text-white text-3xl font-bold">{teamAvgRating}★</p>
          <p className="text-gray-500 text-xs mt-2">Team average</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Clock size={14} />
            Avg Response Time
          </p>
          <p className="text-white text-3xl font-bold">{teamAvgResponseTime}s</p>
          <p className="text-gray-500 text-xs mt-2">Team average</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <MessageSquare size={14} />
            Total Chats
          </p>
          <p className="text-white text-3xl font-bold">{totalChats}</p>
          <p className="text-gray-500 text-xs mt-2">All time</p>
        </div>
      </div>

      {/* Agents Search and Sort */}
      <div className="mb-8 space-y-4">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search agents by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
          />
        </div>
        <div className="flex gap-3">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 focus:outline-none focus:border-orange-500"
          >
            <option value="rating">Sort by Rating</option>
            <option value="response_time">Sort by Response Time</option>
            <option value="chats">Sort by Chats</option>
            <option value="resolution_rate">Sort by Resolution Rate</option>
          </select>
        </div>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
        {agents.map(agent => (
          <button
            key={agent.id}
            onClick={() => handleSelectAgent(agent)}
            className="bg-gray-800 border border-gray-700 rounded-xl p-6 text-left hover:border-orange-500 transition"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-white font-bold text-lg">{agent.name}</h3>
                <p className="text-gray-400 text-sm">{agent.role}</p>
              </div>
              <div className="text-right">
                <p className="text-orange-400 font-bold">{agent.rating}★</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Response Time</span>
                    <span className="text-white font-medium">
                      {agent.avg_response_time_seconds == null ? '-' : `${agent.avg_response_time_seconds}s`}
                    </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Resolution Rate</span>
                <span className="text-green-400 font-medium">{agent.resolution_rate}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Total Chats</span>
                <span className="text-white font-medium">{agent.total_chats}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Satisfaction</span>
                <span className="text-white font-medium">{agent.satisfaction_score}%</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="border-b border-gray-700 p-6 flex items-center justify-between sticky top-0 bg-gray-800">
              <h2 className="text-white font-bold text-xl">{selectedAgent.name} - Performance Details</h2>
              <button
                onClick={() => {
                  setSelectedAgent(null);
                  setAgentDetails(null);
                }}
                className="text-gray-500 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            {!agentDetails ? (
              <div className="p-12 text-center text-gray-400">Loading performance details…</div>
            ) : (
            <div className="p-6 space-y-6">
              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Overall Rating</p>
                  <p className="text-white text-2xl font-bold">{agentDetails.rating}★</p>
                </div>
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Satisfaction Score</p>
                  <p className="text-white text-2xl font-bold">{agentDetails.satisfaction_score}%</p>
                </div>
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Avg Response Time</p>
                  <p className="text-white text-2xl font-bold">
                    {agentDetails.avg_response_time_seconds == null ? '-' : `${agentDetails.avg_response_time_seconds}s`}
                  </p>
                </div>
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Resolution Rate</p>
                  <p className="text-white text-2xl font-bold">{agentDetails.resolution_rate}%</p>
                </div>
              </div>

              {/* 7-Day Trend */}
              {agentDetails.trend && agentDetails.trend.length > 0 && (
                <div>
                  <h3 className="text-white font-bold text-lg mb-4">7-Day Performance Trend</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={agentDetails.trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" />
                      <YAxis stroke="#9ca3af" />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                        labelStyle={{ color: '#fff' }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="rating"
                        stroke="#ea580c"
                        strokeWidth={2}
                        dot={{ fill: '#ea580c' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="chats"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ fill: '#10b981' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Detailed Stats */}
              <div>
                <h3 className="text-white font-bold text-lg mb-3">Detailed Statistics</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-gray-400">
                    <span>Total Conversations</span>
                    <span className="text-white font-medium">{agentDetails.total_conversations}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Resolved</span>
                    <span className="text-white font-medium">{agentDetails.resolved_conversations}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Avg Handling Time</span>
                    <span className="text-white font-medium">{agentDetails.avg_handling_time_seconds}s</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>First Contact Resolution</span>
                    <span className="text-white font-medium">{agentDetails.fcr_rate}%</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Quality Score</span>
                    <span className="text-white font-medium">{agentDetails.quality_score}/100</span>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
