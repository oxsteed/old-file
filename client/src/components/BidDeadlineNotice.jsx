import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../lib/format';

// A visible deadline reminder; authorization and acceptance stay server-owned.
export default function BidDeadlineNotice({ bid }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  if (bid.status !== 'pending') return null;
  const until = new Date(bid.expires_at || '').getTime();
  const expired = Number.isFinite(until) && until <= now;
  if (!Number.isFinite(until) && !bid.needs_reconfirm) return null;
  return <aside className="helper-work" aria-label={t('helperWork.bidReminder')}>
    {Number.isFinite(until) && <p>{expired ? t('helperWork.bidExpired') : t('helperWork.bidExpires', { date: formatDate(bid.expires_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })}</p>}
    {bid.needs_reconfirm && !expired && <p><Link to={`/jobs/${bid.job_id}`}>{t('helperWork.reviewChanges')}</Link></p>}
  </aside>;
}
