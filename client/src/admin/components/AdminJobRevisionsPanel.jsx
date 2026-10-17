import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import ConfirmDialog from '../lib/ConfirmDialog';
import JobRevisionHistory from '../../components/JobRevisionHistory';

/**
 * Admin/support view of a job's full revision history with rollback.
 * Rollback goes through PATCH-equivalent server validation, writes its own
 * revision, re-flags bids when material, and is recorded in the admin audit log.
 */
export default function AdminJobRevisionsPanel({ job, onChanged }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (jobId, { before } = {}) => {
    const { data } = await adminApi.get(`/admin/jobs/${jobId}/revisions`, { params: before ? { before } : {} });
    return data;
  }, []);

  const confirmRollback = async (reason) => {
    try {
      await adminApi.post(`/admin/jobs/${job.id}/revisions/${target.id}/rollback`, {
        reason, expected_version: job.version,
      });
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'precondition_failed' || code === 'version_conflict') throw new Error(t('jobEdit.failures.conflict'));
      if (code === 'validation_failed') throw new Error(t('jobEdit.rollbackInvalid'));
      throw err;
    }
    setTarget(null);
    setRefreshKey((k) => k + 1);
    onChanged?.();
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden text-gray-700 dark:text-gray-200 p-4">
      <JobRevisionHistory key={refreshKey} jobId={job.id} revision={job.revision} version={job.version}
        load={load} onRollback={(item) => setTarget(item)} defaultOpen />
      {target && (
        <ConfirmDialog
          open
          danger
          requireReason
          title={t('jobEdit.rollbackTitle')}
          message={t('jobEdit.rollbackHelp')}
          confirmLabel={t('jobEdit.rollback')}
          reasonPlaceholder={t('jobEdit.reasonPlaceholder')}
          onConfirm={confirmRollback}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
