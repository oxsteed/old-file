import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import AdminErrorState from '../lib/AdminErrorState';
import { Clock, AlertCircle, TrendingUp, CheckCircle, RefreshCw, Target } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import SupportSubNav from '../components/SupportSubNav';

export default function SupportSLADashboard() {
  const { businessId } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/sla', {
        params: { business_id: businessId },
      });
      setData(res.data);
      setError(null);
    } catch (err) {
      console.error('Failed to load SLA data:', err);
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
          title={t('adminSupportSla.failedTitle')}
          message={error?.response?.data?.error || t('adminSupportSla.failedMessage')}
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
  const violations = data.violations || [];
  const compliance = stats.overall_compliance;

  const getComplianceColor = (compliance) => {
    if (compliance == null) return 'text-gray-400';
    if (compliance >= 95) return 'text-green-400';
    if (compliance >= 85) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getComplianceBg = (compliance) => {
    if (compliance == null) return 'bg-gray-800';
    if (compliance >= 95) return 'bg-green-900/30';
    if (compliance >= 85) return 'bg-yellow-900/30';
    return 'bg-red-900/30';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SupportSubNav />
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminSupportSla.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminSupportSla.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          aria-label={t('adminSupportSla.refresh')}
          title={t('adminSupportSla.refresh')}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Target size={14} />
            {t('adminSupportSla.overallCompliance')}
          </p>
          <p className={`text-3xl font-bold ${getComplianceColor(compliance)}`}>
            {compliance == null ? t('adminSupportSla.notAvailable') : `${compliance}%`}
          </p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportSla.targetPercent', { value: 95 })}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Clock size={14} />
            {t('adminSupportSla.avgFirstResponse')}
          </p>
          <p className="text-white text-3xl font-bold">{t('adminSupportSla.minutes', { value: stats.avg_first_response_minutes || 0 })}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportSla.targetHour', { value: 1 })}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <CheckCircle size={14} />
            {t('adminSupportSla.avgResolutionTime')}
          </p>
          <p className="text-white text-3xl font-bold">{t('adminSupportSla.hours', { value: stats.avg_resolution_hours || 0 })}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportSla.targetHours', { value: 24 })}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <AlertCircle size={14} />
            {t('adminSupportSla.violations')}
          </p>
          <p className="text-white text-3xl font-bold">{stats.violation_count || 0}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportSla.thisWeek')}</p>
        </div>
      </div>

      {/* Compliance Trend */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
        <h2 className="text-white font-bold text-lg mb-4">{t('adminSupportSla.complianceTrend')}</h2>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="colorCompliance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ea580c" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#ea580c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }}
              />
              <Area
                type="monotone"
                dataKey="compliance"
                stroke="#ea580c"
                fillOpacity={1}
                fill="url(#colorCompliance)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-400 text-sm text-center py-12">{t('adminSupportSla.noTrendData')}</p>
        )}
      </div>

      {/* Department Comparison */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
        <h2 className="text-white font-bold text-lg mb-4">{t('adminSupportSla.departmentComparison')}</h2>
        {departmentData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-700/50">
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">{t('adminSupportSla.department')}</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">{t('adminSupportSla.compliance')}</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">{t('adminSupportSla.avgResponse')}</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">{t('adminSupportSla.avgResolution')}</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">{t('adminSupportSla.violations')}</th>
                </tr>
              </thead>
              <tbody>
                {departmentData.map(dept => (
                  <tr key={dept.id} className="border-b border-gray-700 hover:bg-gray-700/30 transition">
                    <td className="px-6 py-4 text-white font-medium">{dept.name}</td>
                    <td className="px-6 py-4">
                      <span className={`font-semibold ${getComplianceColor(dept.compliance)}`}>
                        {dept.compliance == null ? t('adminSupportSla.notAvailable') : `${dept.compliance}%`}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white">
                      {dept.avg_first_response_minutes == null ? t('adminSupportSla.notAvailable') : t('adminSupportSla.minutes', { value: dept.avg_first_response_minutes })}
                    </td>
                    <td className="px-6 py-4 text-white">
                      {dept.avg_resolution_hours == null ? t('adminSupportSla.notAvailable') : t('adminSupportSla.hours', { value: dept.avg_resolution_hours })}
                    </td>
                    <td className="px-6 py-4 text-white font-medium">{dept.violations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-12">{t('adminSupportSla.noDepartmentData')}</p>
        )}
      </div>

      {/* SLA Violations */}
      {violations.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <AlertCircle size={20} className="text-red-400" />
            {t('adminSupportSla.recentViolations')}
          </h2>
          <div className="space-y-3">
            {violations.slice(0, 10).map(violation => (
              <div key={violation.id} className={`rounded-lg p-4 ${getComplianceBg(0)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-white font-medium">{violation.customer_name}</p>
                    <p className="text-gray-400 text-sm mt-1">{violation.issue_type}</p>
                    <p className="text-gray-500 text-xs mt-2">
                      {violation.violation_type === 'first_response'
                        ? t('adminSupportSla.firstResponseMissed', { value: violation.minutes_over })
                        : t('adminSupportSla.resolutionMissed', { value: violation.hours_over })}
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-red-900/50 text-red-300 rounded text-xs font-medium capitalize">
                    {t(`adminSupportSla.violationTypes.${violation.violation_type}`, { defaultValue: violation.violation_type })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
