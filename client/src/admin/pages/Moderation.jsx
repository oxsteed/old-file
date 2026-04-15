import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, AlertTriangle, CheckCircle, Flag, Ban, ExternalLink,
} from 'lucide-react';
import adminApi from '../../lib/adminApi';

export default function Moderation() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acting, setActing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminApi.get('/admin/moderation-queue');
      setQueue(Array.isArray(data.queue) ? data.queue : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load moderation queue.');
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runAction = async (jobId, action) => {
    const reason =
      action === 'cancel'
        ? window.prompt('Reason for cancelling this job (required):') || ''
        : window.prompt('Optional note for audit log:') || '';
    if (action === 'cancel' && !reason.trim()) {
      window.alert('A reason is required to cancel.');
      return;
    }
    setActing(jobId + action);
    try {
      await adminApi.post(`/admin/jobs/${jobId}/action`, { action, reason: reason.trim() || undefined });
      await load();
    } catch (err) {
      window.alert(err.response?.data?.error || 'Action failed.');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="text-orange-400" size={24} />
            Job moderation
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Jobs flagged by admins or with pending user reports. Actions use the job moderation API.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-gray-300 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading queue…</div>
        ) : queue.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle className="mx-auto mb-3 text-green-400" size={48} />
            <p className="text-gray-400">No flagged jobs or pending job reports.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {queue.map((job) => (
              <li key={job.id} className="p-4 sm:p-5 hover:bg-slate-700/20">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-white font-semibold truncate">{job.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-gray-300">
                        {job.status}
                      </span>
                      {Number(job.report_count) > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900 text-yellow-300 flex items-center gap-1">
                          <AlertTriangle size={12} />
                          {job.report_count} report{Number(job.report_count) !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      {job.category_name || 'Uncategorized'} · {job.client_name}{' '}
                      <span className="text-gray-600">({job.client_email})</span>
                    </p>
                    {job.description && (
                      <p className="text-sm text-gray-400 line-clamp-3">{job.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Link
                      to={`/admin/jobs/${job.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-gray-200 hover:bg-slate-600"
                    >
                      Open <ExternalLink size={12} />
                    </Link>
                    <button
                      type="button"
                      disabled={!!acting}
                      onClick={() => runAction(job.id, 'flag')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25 disabled:opacity-40"
                    >
                      <Flag size={14} /> Flag
                    </button>
                    <button
                      type="button"
                      disabled={!!acting}
                      onClick={() => runAction(job.id, 'unflag')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-600 text-gray-200 hover:bg-slate-500 disabled:opacity-40"
                    >
                      Unflag
                    </button>
                    <button
                      type="button"
                      disabled={!!acting}
                      onClick={() => runAction(job.id, 'cancel')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                    >
                      <Ban size={14} /> Cancel job
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
