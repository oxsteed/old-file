import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import LegalSubNav from '../components/LegalSubNav';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeAcceptanceRate = (rate, totalUsers = 0) => {
  if (rate && typeof rate === 'object') {
    const percentage = toNumber(rate.percentage ?? rate.rate ?? rate.acceptanceRate, toNumber(rate.total && rate.accepted ? (rate.accepted / rate.total) * 100 : 0));
    const total = toNumber(rate.total, totalUsers);
    const accepted = Math.max(0, toNumber(rate.accepted, Math.round((percentage / 100) * total)));
    const safeTotal = total > 0 ? total : Math.max(accepted, toNumber(rate.total, 0));
    return {
      percentage: Math.min(100, Math.round(percentage)),
      accepted,
      total: safeTotal,
    };
  }

  const percentage = toNumber(rate);
  const safeTotal = toNumber(totalUsers);
  const accepted = Math.max(0, Math.round((percentage / 100) * safeTotal));
  return {
    percentage: Math.min(100, Math.round(percentage)),
    accepted,
    total: safeTotal,
  };
};

// ─── Acceptance Rate Card ─────────────────────────────────────────────────────

function AcceptanceCard({ title, percentage, accepted, total, acceptedDate }) {
  const { t } = useTranslation();
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
        <p className="text-gray-400 text-sm">{t('adminComplianceMetricsPage.cardAccepted', { defaultValue: 'Accepted' })}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 mb-3">
        <div>
          <p className="text-gray-500">{t('adminComplianceMetricsPage.cardSigned', { defaultValue: 'Signed' })}</p>
          <p className={`text-lg font-semibold ${status.textColor}`}>{accepted}</p>
        </div>
        <div>
          <p className="text-gray-500">{t('adminComplianceMetricsPage.cardPending', { defaultValue: 'Pending' })}</p>
          <p className="text-lg font-semibold text-gray-300">{notAccepted}</p>
        </div>
      </div>

      <p className="text-gray-500 text-xs">{t('adminComplianceMetricsPage.cardUpdated', { date: acceptedDate, defaultValue: 'Updated {{date}}' })}</p>
    </div>
  );
}

// ─── Document Status Column ───────────────────────────────────────────────────

function DocumentStatusColumn({ title, count, docs, status }) {
  const { t } = useTranslation();
  const bgColor = {
    created: 'bg-blue-500/20',
    draft: 'bg-blue-500/20',
    in_review: 'bg-yellow-500/20',
    inReview: 'bg-yellow-500/20',
    approved: 'bg-purple-500/20',
    published: 'bg-green-500/20',
  }[status] || 'bg-gray-700/20';

  const textColor = {
    created: 'text-blue-400',
    draft: 'text-blue-400',
    in_review: 'text-yellow-400',
    inReview: 'text-yellow-400',
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
        {(docs || []).length === 0 ? (
          <p className="text-gray-500 text-xs py-4 text-center">{t('adminComplianceMetricsPage.noDocuments', { defaultValue: 'No documents' })}</p>
        ) : (
          (docs || []).map((doc, idx) => (
            <div key={idx} className="bg-gray-900/50 rounded p-2 text-xs">
              <p className="text-gray-300 font-medium truncate">{doc.name || doc.document_name || doc.package_name || doc.type || doc.id}</p>
              <p className="text-gray-500 text-xs">v{doc.version || doc.document_version || 1}</p>
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
  const handleAction = () => {
    if (!action) return;
    const href = action.href || action.url || action.path || action.route;
    if (href) {
      window.location.href = href;
      return;
    }
    if (action.type === 'mailto' && action.to) {
      window.location.href = `mailto:${action.to}`;
      return;
    }
    if (action.type === 'email' && action.to) {
      window.location.href = `mailto:${action.to}`;
      return;
    }
  };

  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${styles[type]}`}>
      <span className="text-lg flex-shrink-0">{icons[type]}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs mt-1">{message}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={handleAction}
          className="flex-shrink-0 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition whitespace-nowrap ml-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminComplianceMetricsPage() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/legal/compliance-metrics', { signal });
    return res.data?.metrics ? res.data.metrics : res.data;
  }, []);

  if (loading) {
    return (
      <div className="p-6 h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const {
    totalActiveUsers = 0,
    acceptanceRates = {},
    ccpaMetrics = {},
    documentStatus = {},
    trends = {},
    alerts = [],
  } = data || {};

  const trendRows = Array.isArray(trends.acceptance)
    ? trends.acceptance
    : Array.isArray(trends.acceptanceTrend)
      ? trends.acceptanceTrend
    : Array.isArray(trends.last90Days)
      ? trends.last90Days
      : Array.isArray(trends.trend)
        ? trends.trend
        : [];
  const trendData = trendRows
    .map((entry) => ({
      date: entry.date || entry.bucket || entry.month || entry.day,
      rate: toNumber(
        entry.rate ?? entry.acceptanceRate,
        toNumber(entry.total) > 0 && toNumber(entry.acceptanceCount) > 0
          ? (toNumber(entry.acceptanceCount) / toNumber(entry.total)) * 100
          : 0,
      ),
      acceptanceCount: toNumber(entry.acceptanceCount ?? entry.count ?? 0),
      total: toNumber(entry.total ?? 0),
    }))
    .filter((entry) => entry.date);

  const byTypeRows = ccpaMetrics?.byType && typeof ccpaMetrics.byType === 'object'
    ? Object.entries(ccpaMetrics.byType)
    : [];
  const ccpaData = Array.isArray(trends.ccpa)
    ? trends.ccpa
    : byTypeRows.map(([type, stats]) => ({
        month: type,
        count: toNumber(stats?.total ?? stats?.count, 0),
        completed: toNumber(stats?.completed, 0),
      }));

  const documentStatusCounts = {
    created: Number(documentStatus.created ?? documentStatus.draft ?? 0),
    inReview: Number(documentStatus.inReview ?? documentStatus.in_review ?? 0),
    approved: Number(documentStatus.approved ?? 0),
    published: Number(documentStatus.published ?? 0),
  };
  const normalizedDocumentStatus = {
    created: Array.isArray(documentStatus.created)
      ? documentStatus.created
      : Array.isArray(documentStatus.draft)
        ? documentStatus.draft
        : [],
    inReview: Array.isArray(documentStatus.inReview)
      ? documentStatus.inReview
      : Array.isArray(documentStatus.in_review)
        ? documentStatus.in_review
        : [],
    approved: Array.isArray(documentStatus.approved)
      ? documentStatus.approved
      : [],
    published: Array.isArray(documentStatus.published)
      ? documentStatus.published
      : [],
  };
  const ccpaResponseTime = ccpaMetrics.avgResponseTimeDays ?? ccpaMetrics.avgResponseTime ?? ccpaMetrics.gdprResponseTime ?? 0;
  const ccpaRequestTotal = ccpaMetrics.thisMonth ?? byTypeRows.reduce((sum, [, stats]) => sum + toNumber(stats?.total ?? stats?.count, 0), 0);
  const ccpaPendingCount = ccpaMetrics.pending ?? 0;
  const gdprRequestTotal = ccpaMetrics.deletionRequests ?? ccpaMetrics.deletionRequestCount ?? byTypeRows.reduce((sum, [, stats]) => sum + toNumber(stats?.total ?? stats?.count, 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <LegalSubNav />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminComplianceMetricsPage.title', { defaultValue: 'Compliance Metrics' })}</h1>
          <p className="text-gray-400 text-sm">{t('adminComplianceMetricsPage.subtitle', { defaultValue: 'Legal document adoption rates, compliance risks, and trends.' })}</p>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          aria-label={t('common.refresh')}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error Alert */}
      {error ? (
        <AdminErrorState onRetry={reload} />
      ) : (
        <>

      {/* Acceptance Rates Grid */}
      <div>
        <h2 className="text-white font-bold text-lg mb-4">{t('adminComplianceMetricsPage.acceptanceRatesTitle', { defaultValue: 'Acceptance Rates by Document Type' })}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(acceptanceRates).map(([key, rate]) => {
            const normalizedRate = normalizeAcceptanceRate(rate, totalActiveUsers);
            return (
              <AcceptanceCard
                key={key}
                title={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                percentage={normalizedRate.percentage}
                accepted={normalizedRate.accepted}
                total={normalizedRate.total}
                acceptedDate={normalizedRate.total ? new Date().toLocaleDateString() : t('adminComplianceMetricsPage.cardNa', { defaultValue: 'N/A' })}
              />
            );
          })}
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
                <p className="text-white text-3xl font-bold">{ccpaRequestTotal || 0}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm">Pending</p>
                <p className="text-yellow-400 text-2xl font-bold">{ccpaPendingCount || 0}</p>
              </div>
            </div>
            <div className="border-t border-gray-700 pt-3">
              <p className="text-gray-400 text-sm mb-1">Avg Response Time</p>
              <div className="flex items-baseline gap-2">
                <p className="text-white text-2xl font-bold">{ccpaResponseTime || 0}</p>
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
                <p className="text-white text-3xl font-bold">{ccpaRequestTotal || 0}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm">Deletions</p>
                <p className="text-white text-2xl font-bold">{gdprRequestTotal || 0}</p>
              </div>
            </div>
            <div className="border-t border-gray-700 pt-3">
              <p className="text-gray-400 text-sm mb-1">Avg Response Time</p>
              <div className="flex items-baseline gap-2">
                <p className="text-white text-2xl font-bold">{ccpaResponseTime || 0}</p>
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
            count={documentStatusCounts.created}
            docs={normalizedDocumentStatus.created}
            status="created"
          />
          <DocumentStatusColumn
            title="In Review"
            count={documentStatusCounts.inReview}
            docs={normalizedDocumentStatus.inReview}
            status="inReview"
          />
          <DocumentStatusColumn
            title="Approved"
            count={documentStatusCounts.approved}
            docs={normalizedDocumentStatus.approved}
            status="approved"
          />
          <DocumentStatusColumn
            title="Published"
            count={documentStatusCounts.published}
            docs={normalizedDocumentStatus.published}
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
                <Line type="monotone" dataKey="rate" stroke="#f97316" strokeWidth={2} name="Acceptance" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* CCPA Requests */}
        {ccpaData.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">CCPA Requests by Type</h3>
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
      {Array.isArray(trends.versions) && trends.versions.length > 0 && (
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
        </>
      )}
    </div>
  );
}
