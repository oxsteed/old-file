import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

// D16: operational notices for admins (e.g. regional analytics switched to
// GeoNames postal centres). Shown until each admin acknowledges it.
export default function AdminOperationalNotices() {
  const { t } = useTranslation();
  const [notices, setNotices] = useState([]);

  useEffect(() => {
    let alive = true;
    api.get('/admin/operational-notices/notices')
      .then(({ data }) => { if (alive) setNotices(Array.isArray(data?.notices) ? data.notices : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!notices.length) return null;

  const dismiss = async (id) => {
    setNotices((list) => list.filter((n) => n.id !== id));
    try { await api.post(`/admin/operational-notices/notices/${id}/ack`); } catch { /* shown again next load */ }
  };

  return (
    <div className="px-4 pt-4 space-y-2" role="region" aria-label={t('adminOperationalNotices.regionLabel')}>
      {notices.map((notice) => {
        const params = notice.params || {};
        return (
          <div
            key={notice.id}
            role="status"
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          >
            <div className="flex-1 min-w-0 text-start">
              <p className="font-semibold">{t(notice.title_key, params)}</p>
              <p>{t(notice.body_key, {
                ...params,
                usersBefore: params.users_located_before ?? 0,
                usersAfter: params.users_located_after ?? 0,
              })}</p>
            </div>
            <button
              type="button"
              data-track="admin_operational_notice_dismiss"
              onClick={() => dismiss(notice.id)}
              className="shrink-0 rounded-md border border-amber-400 px-3 py-1 font-medium hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-900"
            >
              {t('adminOperationalNotices.dismiss')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
