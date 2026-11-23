import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { formatDate } from '../../lib/format';

// Group 4 item 184: private Trust & Safety view of a helper's hand-backs.
// Admin-only (manage_users); never public and never part of ratings.
export default function AdminHelperHandbacks({ userId }) {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.handbackAdmin.${key}`, opts);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null); setFailed(false);
    adminApi.get(`/admin/users/${encodeURIComponent(userId)}/handbacks`, { signal: ctrl.signal })
      .then(({ data: d }) => { if (!ctrl.signal.aborted) setData(d); })
      .catch(() => { if (!ctrl.signal.aborted) setFailed(true); });
    return () => ctrl.abort();
  }, [userId]);

  if (failed) return <p role="alert">{c('failed')}</p>;
  if (!data) return null;
  return <div>
    <p className="text-xs text-gray-500">{c('hint')}</p>
    <p className="text-sm">{c('counts', data.counts)}</p>
    {data.handbacks.length === 0 ? <p className="text-sm text-gray-500">{c('empty')}</p> : <ul className="space-y-2">
      {data.handbacks.map((h) => <li key={h.id} className="text-sm">
        <bdi>{h.jobTitle || h.jobId}</bdi> · {t(`helperG4.handback.reasons.${h.reasonCode}`)} · <time dateTime={h.createdAt}>{formatDate(h.createdAt, { locale: i18n.language })}</time>
        {h.note && <p dir="auto" className="text-xs text-gray-500">{h.note}</p>}
      </li>)}
    </ul>}
  </div>;
}
