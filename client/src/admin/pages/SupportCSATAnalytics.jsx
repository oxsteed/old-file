import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import {
  MessageSquare, TrendingUp, Heart, AlertCircle, RefreshCw, Calendar, ThumbsUp,
} from 'lucide-react';

// CSAT Score Card
function CSATScoreCard({ score, target = 80, trend, responseRate }) {
  const isOnTarget = score >= target;
  const percentage = (score / target) * 100;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-lg ${isOnTarget ? 'bg-green-900/30' : 'bg-red-900/30'}`}>
          <Heart size={24} className={isOnTarget ? 'text-green-400' : 'text-red-400'} />
        </div>
        {trend !== null && (
          <div className={`text-sm font-bold ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </div>
        )}
      </div>

      <p className="text-gray-400 text-sm mb-2">Customer Satisfaction Score</p>

      <div className="mb-3">
        <div className="flex items-end gap-2 mb-1">
          <p className="text-white text-3xl font-bold">{score.toFixed(1)}%</p>
          <p className="text-gray-500 text-sm">/ {target}%</p>
        </div>
      </div>

      <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
        <div
          className={`h-2 rounded-full transition-all ${
            isOnTarget ? 'bg-green-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500">Response Rate</p>
          <p className="text-white font-semibold">{responseRate}%</p>
        </div>
        <div className="text-right">
          <p className="text-gray-500">Status</p>
          <p className={isOnTarget ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
            {isOnTarget ? 'On Target' : 'Below Target'}
          </p>
        </div>
      </div>
    </div>
  );
}

// Feedback Item
function FeedbackItem({ feedback }) {
  const getRatingColor = (rating) => {
    if (rating >= 4) return 'text-green-400';
    if (rating >= 3) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-gray-700 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <p className="text-white font-medium">{feedback.agent_name}</p>
          <p className="text-gray-400 text-sm">{feedback.conversation_subject}</p>
        </div>
        <div className={`text-2xl font-bold ${getRatingColor(feedback.rating)}`}>
          {feedback.rating}★
        </div>
      </div>

      {feedback.comment && (
        <p className="text-gray-300 text-sm mb-2 italic">"{feedback.comment}"</p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{new Date(feedback.created_at).toLocaleDateString()}</span>
        <span className="flex items-center gap-3">
          {feedback.nps_score != null && <span className="text-blue-300">NPS {feedback.nps_score}/10</span>}
          {feedback.helpful_count != null && <span className="flex items-center gap-1"><ThumbsUp size={12} />{feedback.helpful_count} found helpful</span>}
        </span>
      </div>
    </div>
  );
}

// Sentiment Distribution Card
function SentimentCard({ data }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const sentiments = data.map((item) => ({
    ...item,
    percentage: ((item.value / total) * 100).toFixed(1),
  }));

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
      <h3 className="text-white font-semibold text-lg mb-4">Sentiment Distribution</h3>
      <div className="space-y-3">
        {sentiments.map((item, idx) => (
          <div key={idx}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-300 text-sm">{item.name}</span>
              <span className="text-white font-semibold">{item.value}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  item.name === 'Positive'
                    ? 'bg-green-500'
                    : item.name === 'Neutral'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${item.percentage}%` }}
              />
            </div>
            <p className="text-gray-500 text-xs mt-1">{item.percentage}%</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Main CSAT Analytics
export default function SupportCSATAnalytics() {
  const { businessId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('7d');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/csat/analytics', {
        params: { business_id: businessId, range: dateRange },
      });
      setData(res.data);
    } catch (err) {
      console.error('Failed to load CSAT data:', err);
    }
    setLoading(false);
  }, [businessId, dateRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const csatData = data || {};
  const csatMetrics = csatData.metrics || {};
  const csatTrend = csatData.csat_trend || [];
  const sentimentDistribution = csatData.sentiment_distribution || [];
  const agentCSAT = csatData.agent_csat || [];
  const recentFeedback = csatData.recent_feedback || [];
  const averageNps = csatMetrics.avg_nps == null ? null : Number(csatMetrics.avg_nps);
  const npsIndex = csatMetrics.nps_index == null ? null : Number(csatMetrics.nps_index);
  const averageRating = csatMetrics.avg_rating == null ? null : Number(csatMetrics.avg_rating);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">CSAT Analytics</h1>
          <p className="text-gray-400 text-sm">Customer satisfaction metrics and feedback analysis.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
            className="px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg
                       text-sm focus:outline-none focus:border-orange-500 flex items-center gap-2"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg
                       hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <CSATScoreCard
          score={csatMetrics.csat_score || 0}
          target={csatMetrics.csat_target || 80}
          trend={csatMetrics.csat_trend_percent}
          responseRate={csatMetrics.survey_response_rate || 0}
        />

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Surveys Sent</p>
          <p className="text-white text-3xl font-bold mb-3">{csatMetrics.surveys_sent || 0}</p>
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <MessageSquare size={14} />
            <span>{csatMetrics.surveys_completed || 0} completed</span>
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Avg Rating</p>
          <p className="text-white text-3xl font-bold mb-3">{averageRating == null ? 'N/A' : `${averageRating.toFixed(1)}★`}</p>
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <Heart size={14} className="text-red-400" />
            <span>{averageRating == null ? 'No ratings yet' : 'Out of 5.0'}</span>
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">NPS Score</p>
          <p className="text-white text-3xl font-bold mb-3">{averageNps == null ? 'N/A' : averageNps.toFixed(1)}</p>
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <TrendingUp size={14} className="text-blue-400" />
            <span>{npsIndex == null ? 'No NPS responses yet' : `Index ${npsIndex > 0 ? '+' : ''}${npsIndex}`}</span>
          </div>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
        {/* CSAT Trend */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-6">CSAT Trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={csatTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="day" stroke="#9CA3AF" style={{ fontSize: '12px' }} />
                <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} domain={[0, 5]} />
                <YAxis yAxisId="right" orientation="right" stroke="#9CA3AF" style={{ fontSize: '12px' }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                  labelStyle={{ color: '#F3F4F6' }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="csat_score"
                  stroke="#F97316"
                  strokeWidth={2}
                  name="CSAT Score"
                  dot={{ fill: '#F97316' }}
                />
                <Line
                  type="monotone"
                  dataKey="response_rate"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  name="Response Rate (%)"
                  yAxisId="right"
                  dot={{ fill: '#3B82F6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* NPS Trend */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-6">NPS Score Trend</h3>
          <div className="h-64">
            {csatTrend.some((point) => point.avg_nps != null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={csatTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="day" stroke="#9CA3AF" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} domain={[0, 10]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    labelStyle={{ color: '#F3F4F6' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="avg_nps"
                    stroke="#60A5FA"
                    strokeWidth={2}
                    name="Average NPS score"
                    dot={{ fill: '#60A5FA' }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                No NPS responses in this period
              </div>
            )}
          </div>
        </div>

        {/* Sentiment Distribution */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-6">Sentiment Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sentimentDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {sentimentDistribution.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.name === 'Positive'
                          ? '#10B981'
                          : entry.name === 'Neutral'
                          ? '#FBBF24'
                          : '#EF4444'
                      }
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                  labelStyle={{ color: '#F3F4F6' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Agent CSAT Comparison */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
        <h3 className="text-white font-bold text-lg mb-6">CSAT by Agent</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agentCSAT}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="agent_name" stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} domain={[0, 5]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                labelStyle={{ color: '#F3F4F6' }}
              />
              <Bar dataKey="avg_rating" fill="#F97316" name="Avg CSAT Score" />
            </BarChart>
          </ResponsiveContainer>
          </div>
          {agentCSAT.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-gray-500">
                  <tr><th className="pb-2">Agent</th><th className="pb-2">CSAT</th><th className="pb-2">NPS score</th><th className="pb-2">NPS index</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-700/70">
                  {agentCSAT.map((agent) => (
                    <tr key={agent.agent_name} className="text-gray-300">
                      <td className="py-2">{agent.agent_name}</td>
                      <td className="py-2">{agent.avg_rating == null ? 'N/A' : `${Number(agent.avg_rating).toFixed(1)}/5`}</td>
                      <td className="py-2">{agent.avg_nps == null ? 'N/A' : `${Number(agent.avg_nps).toFixed(1)}/10`}</td>
                      <td className="py-2">{agent.nps_index == null ? 'N/A' : `${agent.nps_index > 0 ? '+' : ''}${agent.nps_index}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* Recent Feedback */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
          <MessageSquare size={20} className="text-orange-400" />
          Recent Feedback
        </h3>

        {recentFeedback.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle size={32} className="mx-auto mb-2 text-gray-600" />
            <p className="text-gray-400">No feedback in this period</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentFeedback.slice(0, 10).map((feedback, idx) => (
              <FeedbackItem key={idx} feedback={feedback} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
