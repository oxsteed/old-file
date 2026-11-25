import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import AuditRequestDetail from '../../../../components/statements/AuditRequestDetail';
import {
  CreditSubNav,
  Section,
  dateTime,
  useCreditPageState,
} from './shared';

// Group 14 Slice 5d (716-720): the bookkeeper/admin audit-request queue.
// Every request filed through the intake lands here; the admin opens one
// to approve evidence, grant (or revoke) an auditor share, follow up, and
// see the reviewer's receipt. Same workflow as the requester page, driven
// by the same API — the server decides what each caller may do.
export default function OxsteedCreditAuditRequestsPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, loadRequestRef } = useCreditPageState();
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get('/audit-requests', { params: { page: 1, pageSize: 50 } });
      if (requestId !== loadRequestRef.current) return;
      setRequests(response.data?.requests || []);
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [loadRequestRef, setError, setLoading, t]);

  useEffect(() => { load(); }, [load]);

  const statusLabel = (value) => t(`statements.auditRequests.${value === 'open' ? 'statusOpen' : value === 'in_review' ? 'statusInReview' : 'statusClosed'}`);

  return <div>
    <CreditSubNav />
    <Section eyebrow={t('adminAuditRequests')} title={t('adminAuditRequests')} detail={t('adminAuditRequestsDescription')}>
      {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
      {selectedId ? <AuditRequestDetail apiClient={adminApi} requestId={selectedId} onBack={() => { setSelectedId(null); load(); }} />
        : <>
          {loading && <p role="status" className="text-sm text-gray-500">{t('statements.auditRequests.loading')}</p>}
          {!loading && !requests.length && <p className="text-sm text-gray-500">{t('statements.auditRequests.noRequestsAdmin')}</p>}
          {!loading && requests.length > 0 && <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-[720px] w-full text-left text-xs">
              <thead className="bg-gray-50/70 dark:bg-gray-950/70 text-gray-500">
                <tr>
                  <th className="px-3 py-3 font-medium">{t('statements.auditRequests.titleLabel')}</th>
                  <th className="px-3 py-3 font-medium">{t('statements.auditRequests.typeLabel')}</th>
                  <th className="px-3 py-3 font-medium">{t('statements.auditRequests.statusLabel')}</th>
                  <th className="px-3 py-3 font-medium">{t('statements.auditRequests.evidenceTitle')}</th>
                  <th className="px-3 py-3 font-medium">{t('statements.auditRequests.receiptsTitle')}</th>
                  <th className="px-3 py-3 font-medium">{t('statements.auditRequests.createdAt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {requests.map((item) => <tr key={item.id}>
                  <td className="px-3 py-3"><button type="button" disabled={busy} onClick={() => setSelectedId(item.id)} className="font-semibold text-sky-600 hover:underline disabled:opacity-50 dark:text-sky-400"><bdi>{item.title}</bdi></button></td>
                  <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{t(`statements.auditRequests.type${item.auditType.charAt(0).toUpperCase()}${item.auditType.slice(1)}`)}</td>
                  <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{statusLabel(item.status)}</td>
                  <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{item.approvedCount}/{item.evidenceCount}</td>
                  <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{item.receiptCount}</td>
                  <td className="px-3 py-3 text-gray-500">{dateTime(item.createdAt)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
          <button type="button" disabled={busy} onClick={() => { setBusy(true); load().finally(() => setBusy(false)); }} className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-gray-700">{t('statements.auditRequests.retry')}</button>
        </>}
    </Section>
  </div>;
}
