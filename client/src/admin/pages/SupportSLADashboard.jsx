import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { Clock, AlertCircle, TrendingUp, CheckCircle, RefreshCw, Target } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function SupportSLADashboard() {
  const { businessId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/sla', {
        params: { business_id: businessId },
      });
      setData(res.data);
    } catch (err) {
      console.error('Failed to load SLA data:', err);
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
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">SLA Dashboard</h1>
          <p className="text-gray-400 text-sm">Service level agreement compliance tracking.</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
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
            Overall Compliance
          </p>
          <p className={`text-3xl font-bold ${getComplianceColor(compliance)}`}>
            {compliance == null ? '-' : `${compliance}%`}
          </p>
          <p className="text-gray-500 text-xs mt-2">Target: 95%</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Clock size={14} />
            Avg First Response
          </p>
          <p className="text-white text-3xl font-bold">{stats.avg_first_response_minutes || 0}m</p>
          <p className="text-gray-500 text-xs mt-2">Target: 1h</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <CheckCircle size={14} />
            Avg Resolution Time
          </p>
          <p className="text-white text-3xl font-bold">{stats.avg_resolution_hours || 0}h</p>
          <p className="text-gray-500 text-xs mt-2">Target: 24h</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <AlertCircle size={14} />
            Violations
          </p>
          <p className="text-white text-3xl font-bold">{stats.violation_count || 0}</p>
          <p className="text-gray-500 text-xs mt-2">This week</p>
        </div>
      </div>

      {/* Compliance Trend */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
        <h2 className="text-white font-bold text-lg mb-4">Compliance Trend (30 days)</h2>
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
          <p className="text-gray-400 text-sm text-center py-12">No trend data</p>
        )}
      </div>

      {/* Department Comparison */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-8">
        <h2 className="text-white font-bold text-lg mb-4">Department Comparison</h2>
        {departmentData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-700/50">
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Department</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Compliance</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Avg Response</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Avg Resolution</th>
                  <th className="px-6 py-3 text-left text-gray-400 text-sm font-semibold">Violations</th>
                </tr>
              </thead>
              <tbody>
                {departmentData.map(dept => (
                  <tr key={dept.id} className="border-b border-gray-700 hover:bg-gray-700/30 transition">
                    <td className="px-6 py-4 text-white font-medium">{dept.name}</td>
                    <td className="px-6 py-4">
                      <span className={`font-semibold ${getComplianceColor(dept.compliance)}`}>
                        {dept.compliance == null ? '-' : `${dept.compliance}%`}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white">{dept.avg_first_response_minutes}m</td>
                    <td className="px-6 py-4 text-white">{dept.avg_resolution_hours}h</td>
                    <td className="px-6 py-4 text-white font-medium">{dept.violations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-12">No department data</p>
        )}
      </div>

      {/* SLA Violations */}
      {violations.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <AlertCircle size={20} className="text-red-400" />
            Recent SLA Violations
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
                        ? `First response missed by ${violation.minutes_over}m`
                        : `Resolution missed by ${violation.hours_over}h`}
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-red-900/50 text-red-300 rounded text-xs font-medium capitalize">
                    {violation.violation_type}
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
