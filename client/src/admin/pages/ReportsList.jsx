import { useEffect, useState } from 'react';
import adminApi              from '../../lib/adminApi';

const STATUS_TABS = ['pending','reviewed','escalated','dismissed'];

const REASON_COLORS = {
  spam:          'bg-yellow-900 text-yellow-400',
  fraud:         'bg-red-900   text-red-400',
  inappropriate: 'bg-orange-900 text-orange-400',
  other:         'bg-gray-700   text-gray-400'
};

export default function ReportsList() {
  const [reports, setReports]  = useState([]);
  const [tab,     setTab]      = useState('pending');
  const [total,   setTotal]    = useState(0);
  const [loading, setLoading]  = useState(true);
  const [acting,  setActing]   = useState(null);
  const [message, setMessage]  = useState(null);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/reports', {
        params: { status: tab }
      });
      setReports(data.reports);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(); }, [tab]);

  const handleAction = async (reportId, action) => {
    const actionLabel = {
      dismiss: 'Dismiss this report',
      warn_user: 'Warn the reported user',
      remove_content: 'Remove the reported content',
      escalate: 'Escalate to super admin'
    }[action];
    if (!window.confirm(`${actionLabel}?`)) return;

    setActing(reportId);
    setMessage(null);
    try {
      await adminApi.put(`/admin/reports/${reportId}`, {
        action,
        action_taken: actionLabel
      });
      setMessage({ type: 'success', text: `Report ${action} successfully.` });
      fetchReports();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Action failed.'
      });
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Content Reports</h1>
          <p className="text-gray-400 text-sm mt-1">
            {total} {tab} report{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-6">
        {STATUS_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold
              capitalize transition ${
              tab === t
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
          >
            {t}
          </button>
        ))}
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm mb-6 ${
          message.type === 'success'
            ? 'bg-green-900 border border-green-700 text-green-300'
            : 'bg-red-900 border border-red-700 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading...</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">✓</p>
          <p className="text-gray-400 font-medium">
            No {tab} reports. Queue is clear.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map(report => (
            <div key={report.id}
              className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-xs font-semibold text-gray-300
                      uppercase tracking-wider bg-gray-700
                      px-2 py-0.5 rounded">
                      {report.target_type}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5
                      rounded-full capitalize ${
                      REASON_COLORS[report.reason] || REASON_COLORS.other
                    }`}>
                      {report.reason}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(report.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">
                    {report.description || 'No description provided.'}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Reported by:{' '}
                    <span className="text-gray-400">
                      {report.reporter_name || 'Anonymous'} —{' '}
                      {report.reporter_email || ''}
                    </span>
                  </p>
                </div>

                {/* Actions — only for pending */}
                {tab === 'pending' && (
                  <div className="flex flex-col gap-2 shrink-0">
                    {[
                      { action: 'dismiss', label: 'Dismiss',
                        cls: 'bg-gray-700 text-gray-300 hover:bg-gray-600' },
                      { action: 'warn_user', label: 'Warn',
                        cls: 'bg-yellow-900 text-yellow-300 hover:bg-yellow-800' },
                      { action: 'remove_content', label: 'Remove',
                        cls: 'bg-red-900 text-red-300 hover:bg-red-800' },
                      { action: 'escalate', label: 'Escalate',
                        cls: 'bg-orange-900 text-orange-300 hover:bg-orange-800' },
                    ].map(({ action, label, cls }) => (
                      <button
                        key={action}
                        onClick={() => handleAction(report.id, action)}
                        disabled={acting === report.id}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold
                          transition disabled:opacity-50 ${cls}`}
                      >
                        {acting === report.id ? '...' : label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Reviewed state */}
                {tab !== 'pending' && report.action_taken && (
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-gray-500">Action taken</p>
                    <p className="text-xs text-gray-300 mt-0.5 font-medium">
                      {report.action_taken}
                    </p>
                    {report.reviewed_by_name && (
                      <p className="text-xs text-gray-600 mt-1">
                        by {report.reviewed_by_name}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
