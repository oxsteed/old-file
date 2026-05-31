import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Users, Check, X } from 'lucide-react';

export function WaitlistManager({ businessId }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('waiting');

  useEffect(() => { load(); }, [businessId, filter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/businesses/${businessId}/waitlist`, { params: { status: filter } });
      setEntries(res.data || []);
    } catch { toast.error(t('businessHub.waitlist.toastLoadFail')); }
    finally { setLoading(false); }
  };

  const update = async (id, status) => {
    try {
      await api.put(`/businesses/${businessId}/waitlist/${id}`, { status });
      toast.success(status === 'notified' ? t('businessHub.waitlist.toastCustomerNotified') : t('businessHub.waitlist.toastStatusUpdated'));
      load();
    } catch { toast.error(t('businessHub.waitlist.toastUpdateFail')); }
  };

  const remove = async (id) => {
    if (!window.confirm(t('businessHub.waitlist.confirmRemove'))) return;
    try { await api.delete(`/businesses/${businessId}/waitlist/${id}`); toast.success(t('businessHub.waitlist.toastRemoved')); load(); }
    catch { toast.error(t('common.failed')); }
  };

  const STATUS_LABEL = { waiting: 'Waiting', notified: 'Notified', booked: 'Booked', removed: 'Removed' };
  const STATUS_COLOR = { waiting: '#f59e0b', notified: '#3b82f6', booked: '#10b981', removed: '#94a3b8' };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessHub.waitlist.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.waitlist.subtitle')}</p>
        </div>
        <div style={{ background: '#f97316', color: '#fff', borderRadius: '999px', padding: '0.25rem 0.75rem', fontWeight: 700, fontSize: '0.875rem' }}>
          {t('businessHub.waitlist.waitingCount', { count: entries.filter(e => e.status === 'waiting').length })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {['waiting','notified','booked','removed'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: '0.4rem 0.9rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: filter === s ? STATUS_COLOR[s] : 'transparent', color: filter === s ? '#fff' : 'var(--app-text)', cursor: 'pointer', fontSize: '0.875rem', fontWeight: filter === s ? 600 : 400 }}>{STATUS_LABEL[s]}</button>
        ))}
      </div>

      {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
          <Users size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>{t('businessHub.waitlist.empty', { status: STATUS_LABEL[filter].toLowerCase() })}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {entries.map((e, idx) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f97316', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>#{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{e.customer_name || e.customer_email || t('businessHub.waitlist.customerFallback')}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>
                  {e.service_name && `${e.service_name} · `}
                  {e.preferred_date ? `${t('businessHub.waitlist.preferredPrefix')} ${new Date(e.preferred_date).toLocaleDateString()}` : t('businessHub.waitlist.anyDate')}
                  {e.preferred_time_range && ` · ${e.preferred_time_range}`}
                </div>
              </div>
              <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', borderRadius: '999px', background: STATUS_COLOR[e.status] + '22', color: STATUS_COLOR[e.status], fontWeight: 600 }}>{STATUS_LABEL[e.status]}</span>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {e.status === 'waiting' && <button onClick={() => update(e.id, 'notified')} title="Mark as notified" style={{ padding: '0.35rem', background: '#3b82f622', border: 'none', borderRadius: '0.35rem', cursor: 'pointer', color: '#3b82f6' }}><Check size={14} /></button>}
                {e.status !== 'removed' && <button onClick={() => remove(e.id)} title="Remove" style={{ padding: '0.35rem', background: '#ef444422', border: 'none', borderRadius: '0.35rem', cursor: 'pointer', color: '#ef4444' }}><X size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
