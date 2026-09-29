import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import AdminErrorState from '../lib/AdminErrorState';
import { MessageSquare, CheckCircle, Clock, TrendingUp, RefreshCw } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function SupportMetricsDashboard() {
  const { businessId } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/metrics', {
        params: { business_id: businessId },
      });
      setData(res.data);
      setError(null);
    } catch (err) {
      console.error('Failed to load metrics:', err);
      setError(err);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <AdminErrorState
          title={t('adminSupportMetrics.failedTitle')}
          message={error?.response?.data?.error || t('adminSupportMetrics.failedMessage')}
          onRetry={loadData}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const stats = data.stats || {};
  const trendData = data.trend || [];
  const departmentData = data.departments || [];
  const categoryData = data.categories || [];
  const topAgents = data.top_agents || [];

  const COLORS = ['#ea580c', '#f97316', '#fb923c', '#fbbf24', '#fcd34d'];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminSupportMetrics.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminSupportMetrics.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          aria-label={t('adminSupportMetrics.refresh')}
          title={t('adminSupportMetrics.refresh')}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <MessageSquare size={14} />
            {t('adminSupportMetrics.conversations')}
          </p>
          <p className="text-white text-3xl font-bold">{stats.total_conversations || 0}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportMetrics.total')}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <CheckCircle size={14} />
            {t('adminSupportMetrics.resolved')}
          </p>
          <p className="text-white text-3xl font-bold">{stats.resolved_conversations || 0}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportMetrics.resolutionRate', { value: stats.resolution_rate || 0 })}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Clock size={14} />
            {t('adminSupportMetrics.avgResponseTime')}
          </p>
          <p className="text-white text-3xl font-bold">{t('adminSupportMetrics.seconds', { value: stats.avg_response_time_seconds || 0 })}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportMetrics.teamAverage')}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <TrendingUp size={14} />
            {t('adminSupportMetrics.activeAgents')}
          </p>
          <p className="text-white text-3xl font-bold">{stats.active_agents || 0}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportMetrics.onlineNow')}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Trend Chart */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-white font-bold text-lg mb-4">{t('adminSupportMetrics.trendTitle')}</h2>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
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
                  dataKey="conversations"
                  name={t('adminSupportMetrics.conversations')}
                  stroke="#ea580c"
                  strokeWidth={2}
                  dot={{ fill: '#ea580c' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-sm text-center py-12">{t('adminSupportMetrics.noTrendData')}</p>
          )}
        </div>

        {/* Category Distribution */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-white font-bold text-lg mb-4">{t('adminSupportMetrics.issuesByCategory')}</h2>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                  labelStyle={{ color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-sm text-center py-12">{t('adminSupportMetrics.noCategoryData')}</p>
          )}
        </div>
      </div>

      {/* Department Breakdown */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
        <h2 className="text-white font-bold text-lg mb-4">{t('adminSupportMetrics.departmentBreakdown')}</h2>
        {departmentData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={departmentData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }}
              />
              <Legend />
              <Bar dataKey="conversations" fill="#ea580c" name={t('adminSupportMetrics.conversations')} />
              <Bar dataKey="resolved" fill="#10b981" name={t('adminSupportMetrics.resolved')} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-400 text-sm text-center py-12">{t('adminSupportMetrics.noDepartmentData')}</p>
        )}
      </div>

      {/* Top Agents Leaderboard */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h2 className="text-white font-bold text-lg mb-4">{t('adminSupportMetrics.topAgents')}</h2>
        {topAgents.length > 0 ? (
          <div className="space-y-3">
            {topAgents.map((agent, idx) => (
              <div key={agent.id} className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-600 flex items-center justify-center text-white font-bold text-sm">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="text-white font-medium">{agent.name}</p>
                      <p className="text-gray-400 text-xs">{t('adminSupportMetrics.resolvedCount', { count: agent.resolved_conversations })}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-orange-400 font-semibold">
                      {agent.rating == null ? t('adminSupportMetrics.noRating') : t('adminSupportMetrics.rating', { value: agent.rating })}
                    </p>
                    <p className="text-gray-400 text-xs">
                      {agent.avg_response_time_seconds == null ? t('adminSupportMetrics.noResponseData') : t('adminSupportMetrics.avgSeconds', { value: agent.avg_response_time_seconds })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-12">{t('adminSupportMetrics.noAgentData')}</p>
        )}
      </div>
    </div>
  );
}
