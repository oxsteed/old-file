import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

// Review P2-479: jobs assigned to the signed-in helper.
export default function AssignedJobsPanel({ onCount }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'loading', jobs: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const { data } = await api.get('/jobs/me/list', { params: { role: 'helper' } });
      const jobs = Array.isArray(data) ? data : (data?.jobs || []);
      setState({ status: 'success', jobs });
      onCount?.(jobs.length);
    } catch {
      setState({ status: 'error', jobs: [] });
    }
  }, [onCount]);

  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <p role="status" className="text-gray-400">{t('myJobs.assignedLoading')}</p>;
  if (state.status === 'error') {
    return (
      <div role="alert" className="text-gray-300">
        <p>{t('myJobs.assignedFailed')}</p>
        <button type="button" onClick={load} className="mt-2 text-orange-400">{t('myJobs.assignedRetry')}</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to="/helper/payouts" className="text-sm font-semibold text-orange-400">{t('myJobs.assignedPayouts')}</Link>
      </div>
      {state.jobs.length === 0 && <p className="text-gray-400">{t('myJobs.assignedEmpty')}</p>}
      <ul className="space-y-3">
        {state.jobs.map((job) => (
          <li key={job.id} className="rounded-2xl border border-gray-700/40 bg-gray-900/50 p-4">
            <Link to={`/jobs/${job.id}`} className="font-semibold text-white hover:text-orange-400">
              {job.title || t('myBids.untitledJob')}
            </Link>
            <p className="mt-1 text-xs text-gray-400">
              {t(`myJobs.assignedStatus.${job.status}`, { defaultValue: job.status })}
              {job.status === 'in_progress' && job.completion_requested_at ? ` · ${t('myJobs.assignedAwaitingConfirmation')}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
