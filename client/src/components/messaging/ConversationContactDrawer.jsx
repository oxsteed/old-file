import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import api from '../../api/axios';

export default function ConversationContactDrawer({
  open,
  onClose,
  conversationId,
  guestSessionId = null,
}) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || (!conversationId && !guestSessionId)) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (conversationId) {
          const { data } = await api.get(`/messages/conversations/${conversationId}/meta`);
          if (!cancelled) setMeta(data);
        } else if (guestSessionId) {
          const { data } = await api.get(`/messages/guest-inquiries/${guestSessionId}`);
          if (!cancelled) {
            setMeta({
              other_name: data?.guest_name,
              other_email: data?.guest_email,
              guest_session_id: guestSessionId,
              quote_ids: data?.quote_ids || [],
              booking_ids: data?.booking_ids || [],
            });
          }
        }
      } catch {
        if (!cancelled) setError(t('messages.contactDrawer.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, conversationId, guestSessionId, t]);

  if (!open) return null;

  const name = meta?.other_name || meta?.customer_name || meta?.guest_name || '—';
  const email = meta?.other_email || meta?.customer_email || meta?.guest_email || '—';
  const quotes = meta?.quote_ids || meta?.linked_quote_ids || [];
  const bookings = meta?.booking_ids || meta?.linked_booking_ids || [];

  return (
    <aside className="conversation-contact-drawer" role="dialog" aria-label={t('messages.contactDrawer.title')}>
      <header className="conversation-contact-drawer-head">
        <h3>{t('messages.contactDrawer.title')}</h3>
        <button type="button" onClick={onClose} aria-label={t('common.close')}>
          <X size={16} aria-hidden />
        </button>
      </header>
      {loading ? <p>{t('common.loading')}</p> : null}
      {error ? <p className="conversation-contact-error">{error}</p> : null}
      {!loading && !error ? (
        <dl className="conversation-contact-list">
          <div>
            <dt>{t('messages.contactDrawer.name')}</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>{t('messages.contactDrawer.email')}</dt>
            <dd>{email}</dd>
          </div>
          <div>
            <dt>{t('messages.contactDrawer.quotes')}</dt>
            <dd>{quotes.length ? quotes.join(', ') : t('messages.contactDrawer.none')}</dd>
          </div>
          <div>
            <dt>{t('messages.contactDrawer.bookings')}</dt>
            <dd>{bookings.length ? bookings.join(', ') : t('messages.contactDrawer.none')}</dd>
          </div>
        </dl>
      ) : null}
    </aside>
  );
}
