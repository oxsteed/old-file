import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import SupportSubNav from '../components/SupportSubNav';
import {
  MessageSquare, TrendingUp, Heart, AlertCircle, RefreshCw, Calendar, ThumbsUp,
} from 'lucide-react';

// Maps API sentiment names to localized display labels. API values stay untouched for color logic.
function sentimentLabel(t, name) {
  if (name === 'Positive') return t('adminSupportCSAT.sentimentPositive');
  if (name === 'Neutral') return t('adminSupportCSAT.sentimentNeutral');
  if (name === 'Negative') return t('adminSupportCSAT.sentimentNegative');
  return name;
}

// CSAT Score Card
function CSATScoreCard({ score, target = 80, trend, responseRate }) {
  const { t } = useTranslation();
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

      <p className="text-gray-400 text-sm mb-2">{t('adminSupportCSAT.scoreCardTitle')}</p>

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
          <p className="text-gray-500">{t('adminSupportCSAT.responseRate')}</p>
          <p className="text-white font-semibold">{responseRate}%</p>
        </div>
        <div className="text-right">
          <p className="text-gray-500">{t('adminSupportCSAT.statusLabel')}</p>
          <p className={isOnTarget ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
            {isOnTarget ? t('adminSupportCSAT.onTarget') : t('adminSupportCSAT.belowTarget')}
          </p>
        </div>
      </div>
    </div>
  );
}

// Feedback Item
function FeedbackItem({ feedback }) {
  const { t } = useTranslation();
  const getRatingColor = (rating) => {
    if (rating >= 4) return 'text-green-400';
    if (rating >= 3) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-gray-700 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <p className="text-white font-medium">{feedback.customer_name || t('adminSupportCSAT.customerFallback')}</p>
          <p className="text-gray-400 text-sm">{feedback.conversation_subject || t('adminSupportCSAT.subjectFallback')} · {feedback.agent_name || t('adminSupportCSAT.teamFallback')}</p>
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
          {feedback.nps_score != null && <span className="text-blue-300">{t('adminSupportCSAT.npsValue', { score: feedback.nps_score })}</span>}
          {feedback.helpful_count != null && <span className="flex items-center gap-1"><ThumbsUp size={12} />{t('adminSupportCSAT.foundHelpful', { count: feedback.helpful_count })}</span>}
        </span>
      </div>
    </div>
  );
}

// (Sentiment distribution is rendered inline in the main component below.)

// Main CSAT Analytics
export default function SupportCSATAnalytics() {
  const { t } = useTranslation();
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
      <SupportSubNav />
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminSupportCSAT.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminSupportCSAT.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
            className="px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg
                       text-sm focus:outline-none focus:border-orange-500 flex items-center gap-2"
          >
            <option value="7d">{t('adminSupportCSAT.range7d')}</option>
            <option value="30d">{t('adminSupportCSAT.range30d')}</option>
            <option value="90d">{t('adminSupportCSAT.range90d')}</option>
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
          <p className="text-gray-400 text-sm mb-2">{t('adminSupportCSAT.surveysSent')}</p>
          <p className="text-white text-3xl font-bold mb-3">{csatMetrics.surveys_sent || 0}</p>
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <MessageSquare size={14} />
            <span>{t('adminSupportCSAT.surveysCompleted', { count: csatMetrics.surveys_completed || 0 })}</span>
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">{t('adminSupportCSAT.avgRating')}</p>
          <p className="text-white text-3xl font-bold mb-3">{averageRating == null ? t('common.na') : `${averageRating.toFixed(1)}★`}</p>
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <Heart size={14} className="text-red-400" />
            <span>{averageRating == null ? t('adminSupportCSAT.noRatings') : t('adminSupportCSAT.outOfFive')}</span>
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">{t('adminSupportCSAT.npsScore')}</p>
          <p className="text-white text-3xl font-bold mb-3">{averageNps == null ? t('common.na') : averageNps.toFixed(1)}</p>
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <TrendingUp size={14} className="text-blue-400" />
            <span>{npsIndex == null ? t('adminSupportCSAT.noNps') : t('adminSupportCSAT.npsIndexLabel', { value: `${npsIndex > 0 ? '+' : ''}${npsIndex}` })}</span>
          </div>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
        {/* CSAT Trend */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-6">{t('adminSupportCSAT.trendTitle')}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={csatTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="day" stroke="#9CA3AF" style={{ fontSize: '12px' }} />
                {/* csat_score is a percentage (see score card above), not a 0-5 rating */}
                <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} domain={[0, 100]} />
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
                  name={t('adminSupportCSAT.legendCsat')}
                  dot={{ fill: '#F97316' }}
                />
                <Line
                  type="monotone"
                  dataKey="response_rate"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  name={t('adminSupportCSAT.legendResponseRate')}
                  yAxisId="right"
                  dot={{ fill: '#3B82F6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* NPS Trend */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-6">{t('adminSupportCSAT.npsTrendTitle')}</h3>
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
                    name={t('adminSupportCSAT.legendAvgNps')}
                    dot={{ fill: '#60A5FA' }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {t('adminSupportCSAT.noNpsPeriod')}
              </div>
            )}
          </div>
        </div>

        {/* Sentiment Distribution */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-6">{t('adminSupportCSAT.sentimentTitle')}</h3>
          <div className="h-64">
            {sentimentDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sentimentDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${sentimentLabel(t, name)} ${(percent * 100).toFixed(0)}%`}
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
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {t('adminSupportCSAT.noSentimentData', { defaultValue: 'No sentiment data for this period.' })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent CSAT Comparison */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
        <h3 className="text-white font-bold text-lg mb-6">{t('adminSupportCSAT.byAgentTitle')}</h3>
        {agentCSAT.length > 0 ? (
        <>
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
              <Bar dataKey="avg_rating" fill="#F97316" name={t('adminSupportCSAT.legendAvgCsat')} />
            </BarChart>
          </ResponsiveContainer>
          </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-gray-500">
                  <tr><th className="pb-2">{t('adminSupportCSAT.colAgent')}</th><th className="pb-2">{t('adminSupportCSAT.colCsat')}</th><th className="pb-2">{t('adminSupportCSAT.colNps')}</th><th className="pb-2">{t('adminSupportCSAT.colNpsIndex')}</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-700/70">
                  {agentCSAT.map((agent) => (
                    <tr key={agent.agent_name} className="text-gray-300">
                      <td className="py-2">{agent.agent_name}</td>
                      <td className="py-2">{agent.avg_rating == null ? t('common.na') : `${Number(agent.avg_rating).toFixed(1)}/5`}</td>
                      <td className="py-2">{agent.avg_nps == null ? t('common.na') : `${Number(agent.avg_nps).toFixed(1)}/10`}</td>
                      <td className="py-2">{agent.nps_index == null ? t('common.na') : `${agent.nps_index > 0 ? '+' : ''}${agent.nps_index}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </>
        ) : (
          <p className="text-gray-400 text-sm text-center py-12">{t('adminSupportCSAT.noAgentData', { defaultValue: 'No agent data for this period.' })}</p>
        )}
        </div>

      {/* Recent Feedback */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
          <MessageSquare size={20} className="text-orange-400" />
          {t('adminSupportCSAT.feedbackTitle')}
        </h3>

        {recentFeedback.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle size={32} className="mx-auto mb-2 text-gray-600" />
            <p className="text-gray-400">{t('adminSupportCSAT.noFeedback')}</p>
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
