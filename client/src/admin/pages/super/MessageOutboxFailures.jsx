import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';

// P1-268: dead-lettered chat notifications (message_notification_outbox rows
// that exhausted their attempts) are listed here and can be requeued.
export default function MessageOutboxFailures() {
  const { t } = useTranslation();
  const [data, setData] = useState({ items: [], total: 0 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: payload } = await adminApi.get('/admin/message-notification-outbox/failed', { params: { limit: 50 } });
      setData({ items: payload?.items || [], total: payload?.total || 0 });
    } catch {
      // Non-blocking panel: the conversations list stays usable.
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retry = async (body) => {
    setBusy(true);
    try {
      const { data: payload } = await adminApi.post('/admin/message-notification-outbox/retry', body);
      toast.success(t('superConversations.outboxRetried', { count: payload?.retried || 0 }));
      await load();
    } catch {
      toast.error(t('superConversations.outboxRetryFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!data.total) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="flex items-center gap-2 text-amber-300 font-medium text-start">
          <AlertTriangle size={16} aria-hidden="true" />
          {t('superConversations.outboxFailedCount', { count: data.total })}
        </button>
        <button type="button" disabled={busy} onClick={() => retry({ all: true })}
          className="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 text-amber-200 disabled:opacity-50">
          <RefreshCw size={14} aria-hidden="true" />
          {t('superConversations.outboxRetryAll')}
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
          {data.items.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 text-gray-300">
              <span className="truncate" title={row.last_error || ''}>
                {t('superConversations.outboxRowLabel', { attempts: row.attempts, error: row.last_error || '-' })}
              </span>
              <button type="button" disabled={busy} onClick={() => retry({ ids: [row.id] })}
                className="shrink-0 text-amber-300 underline disabled:opacity-50">
                {t('superConversations.outboxRetryOne')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
