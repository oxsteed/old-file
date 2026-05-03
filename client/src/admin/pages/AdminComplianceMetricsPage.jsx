import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, Mail, TrendingUp, TrendingDown } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// ─── Acceptance Rate Card ─────────────────────────────────────────────────────

function AcceptanceCard({ title, percentage, accepted, total, acceptedDate }) {
  const getStatus = (pct) => {
    if (pct >= 90) return { color: 'bg-green-500/20', textColor: 'text-green-400', icon: '✓' };
    if (pct >= 80) return { color: 'bg-yellow-500/20', textColor: 'text-yellow-400', icon: '⚠' };
    return { color: 'bg-red-500/20', textColor: 'text-red-400', icon: '!' };
  };

  const status = getStatus(percentage);
  const notAccepted = total - accepted;

  return (
    <div className={`rounded-xl border p-6 ${status.color}`}>
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-gray-300 font-semibold">{title}</h3>
        <span className={`text-2xl font-bold ${status.textColor}`}>{status.icon}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <p className={`text-3xl font-bold ${status.textColor}`}>{percentage}%</p>
        <p className="text-gray-400 text-sm">Accepted</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 mb-3">
        <div>
          <p className="text-gray-500">Signed</p>
          <p className={`text-lg font-semibold ${status.textColor}`}>{accepted}</p>
        </div>
        <div>
          <p className="text-gray-500">Pending</p>
          <p className="text-lg font-semibold text-gray-300">{notAccepted}</p>
        </div>
      </div>

      <p className="text-gray-500 text-xs">Updated {acceptedDate}</p>
    </div>
  );
}

// ─── Document Status Column ───────────────────────────────────────────────────

function DocumentStatusColumn({ title, count, docs, status }) {
  const bgColor = {
    created: 'bg-blue-500/20',
    in_review: 'bg-yellow-500/20',
    approved: 'bg-purple-500/20',
    published: 'bg-green-500/20',
  }[status] || 'bg-gray-700/20';

  const textColor = {
    created: 'text-blue-400',
    in_review: 'text-yellow-400',
    approved: 'text-purple-400',
    published: 'text-green-400',
  }[status] || 'text-gray-400';

  return (
    <div className={`rounded-xl border ${bgColor} p-4`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-gray-300 font-semibold text-sm">{title}</h3>
        <span className={`text-2xl font-bold ${textColor}`}>{count}</span>
      </div>

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {docs.length === 0 ? (
          <p className="text-gray-500 text-xs py-4 text-center">No documents</p>
        ) : (
          docs.map((doc, idx) => (
            <div key={idx} className="bg-gray-900/50 rounded p-2 text-xs">
              <p className="text-gray-300 font-medium truncate">{doc.name}</p>
              <p className="text-gray-500 text-xs">v{doc.version}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Alert Box ────────────────────────────────────────────────────────────────

function AlertBox({ type, title, message, action }) {
  const styles = {
    danger: 'bg-red-500/20 border-red-500/50 text-red-300',
    warning: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300',
    info: 'bg-blue-500/20 border-blue-500/50 text-blue-300',
  };

  const icons = {
    danger: '🔴',
    warning: '🟡',
    info: '🔵',
  };

  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${styles[type]}`}>
      <span className="text-lg flex-shrink-0">{icons[type]}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs mt-1">{message}</p>
      </div>
      {action && (
        <button className="flex-shrink-0 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition whitespace-nowrap ml-2">
          {action.label}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminComplianceMetricsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.get('/admin/legal/compliance-metrics');
      setData(res.data);
    } catch (err) {
      console.error('Failed to load metrics:', err);
      setError(err.response?.data?.message || 'Failed to load compliance metrics');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="p-6 h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const {
    acceptanceRates = {},
    ccpaMetrics = {},
    documentStatus = {},
    trends = {},
    alerts = [],
  } = data || {};

  const trendData = trends.acceptance || [];
  const ccpaData = trends.ccpa || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Compliance Metrics</h1>
          <p className="text-gray-400 text-sm">Legal document adoption rates, compliance risks, and trends.</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Acceptance Rates Grid */}
      <div>
        <h2 className="text-white font-bold text-lg mb-4">Acceptance Rates by Document Type</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(acceptanceRates).map(([key, rate]) => (
            <AcceptanceCard
              key={key}
              title={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
              percentage={Math.round(rate.percentage)}
              accepted={rate.accepted}
              total={rate.total}
              acceptedDate={new Date(rate.lastUpdated).toLocaleDateString()}
            />
          ))}
        </div>
      </div>

      {/* CCPA/GDPR Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CCPA Card */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-4">CCPA Compliance</h3>
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-400 text-sm">Requests This Month</p>
                <p className="text-white text-3xl font-bold">{ccpaMetrics.thisMonth || 0}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm">Pending</p>
                <p className="text-yellow-400 text-2xl font-bold">{ccpaMetrics.pending || 0}</p>
              </div>
            </div>
            <div className="border-t border-gray-700 pt-3">
              <p className="text-gray-400 text-sm mb-1">Avg Response Time</p>
              <div className="flex items-baseline gap-2">
                <p className="text-white text-2xl font-bold">{ccpaMetrics.avgResponseTime || 0}</p>
                <p className="text-gray-500 text-sm">days (goal: 45)</p>
              </div>
            </div>
          </div>
        </div>

        {/* GDPR Card */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-bold text-lg mb-4">GDPR Compliance</h3>
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-400 text-sm">Access Requests</p>
                <p className="text-white text-3xl font-bold">{ccpaMetrics.gdprRequests || 0}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm">Deletions</p>
                <p className="text-white text-2xl font-bold">{ccpaMetrics.deletionRequests || 0}</p>
              </div>
            </div>
            <div className="border-t border-gray-700 pt-3">
              <p className="text-gray-400 text-sm mb-1">Avg Response Time</p>
              <div className="flex items-baseline gap-2">
                <p className="text-white text-2xl font-bold">{ccpaMetrics.gdprResponseTime || 0}</p>
                <p className="text-gray-500 text-sm">days (goal: 30)</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Document Status Timeline */}
      <div>
        <h2 className="text-white font-bold text-lg mb-4">Document Workflow Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <DocumentStatusColumn
            title="Created"
            count={documentStatus.created?.length || 0}
            docs={documentStatus.created || []}
            status="created"
          />
          <DocumentStatusColumn
            title="In Review"
            count={documentStatus.inReview?.length || 0}
            docs={documentStatus.inReview || []}
            status="in_review"
          />
          <DocumentStatusColumn
            title="Approved"
            count={documentStatus.approved?.length || 0}
            docs={documentStatus.approved || []}
            status="approved"
          />
          <DocumentStatusColumn
            title="Published"
            count={documentStatus.published?.length || 0}
            docs={documentStatus.published || []}
            status="published"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Acceptance Trend */}
        {trendData.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">Acceptance Rate Trend (90 Days)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9ca3af" style={{ fontSize: '12px' }} />
                <YAxis stroke="#9ca3af" style={{ fontSize: '12px' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                <Legend />
                <Line type="monotone" dataKey="rate" stroke="#f97316" strokeWidth={2} name="Acceptance Rate %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* CCPA Requests */}
        {ccpaData.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">CCPA Requests by Month</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={ccpaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9ca3af" style={{ fontSize: '12px' }} />
                <YAxis stroke="#9ca3af" style={{ fontSize: '12px' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                <Legend />
                <Bar dataKey="count" fill="#8b5cf6" name="Requests" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div>
          <h2 className="text-white font-bold text-lg mb-4">Active Alerts</h2>
          <div className="space-y-3">
            {alerts.map((alert, idx) => (
              <AlertBox
                key={idx}
                type={alert.type}
                title={alert.title}
                message={alert.message}
                action={alert.action}
              />
            ))}
          </div>
        </div>
      )}

      {/* Document Versions Chart */}
      {trends.versions && trends.versions.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">Document Version Adoption</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={trends.versions}
              layout="vertical"
              margin={{ left: 150, right: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" stroke="#9ca3af" style={{ fontSize: '12px' }} />
              <YAxis type="category" dataKey="name" stroke="#9ca3af" style={{ fontSize: '12px' }} width={140} />
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
              <Bar dataKey="signatures" fill="#10b981" name="Signatures" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
