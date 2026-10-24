import { useTranslation } from 'react-i18next';
export default function AuditQueuePager({ offset, limit, total, busy, onChange }) {
  const { t } = useTranslation();
  return <div className="flex items-center justify-between gap-3 py-4 text-sm">
    <span role="status">{t('adminOpsAudit.showing', { from: total ? offset + 1 : 0, to: Math.min(offset + limit, total), total })}</span>
    <div className="flex gap-3">
      <button type="button" disabled={busy || offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>{t('adminOpsAudit.previous')}</button>
      <button type="button" disabled={busy || offset + limit >= total} onClick={() => onChange(offset + limit)}>{t('adminOpsAudit.next')}</button>
    </div>
  </div>;
}
