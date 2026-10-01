import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Star, MessageSquare, Send, Trash2 } from 'lucide-react';

export function ReviewManager({ businessId }) {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState([]);
  const [avgRating, setAvgRating] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [replyForms, setReplyForms] = useState({});
  const [filter, setFilter] = useState('all'); // all | replied | unreplied

  useEffect(() => { load(); }, [businessId, filter]);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter === 'replied') params.replied = 'true';
      if (filter === 'unreplied') params.replied = 'false';
      const res = await api.get(`/businesses/${businessId}/reviews-manage`, { params });
      setReviews(res.data.reviews || []);
      setAvgRating(res.data.avg_rating || 0);
      setTotal(res.data.total || 0);
    } catch { toast.error(t('businessHub.reviews.toastLoadFail')); }
    finally { setLoading(false); }
  };

  const submitReply = async (reviewId) => {
    const reply = replyForms[reviewId]?.trim();
    if (!reply) return toast.error(t('businessHub.reviews.toastReplyEmpty'));
    try {
      await api.post(`/businesses/${businessId}/reviews-manage/${reviewId}/reply`, { reply });
      toast.success(t('businessHub.reviews.toastReplyPosted'));
      setReplyForms(r => ({ ...r, [reviewId]: '' }));
      load();
    } catch { toast.error(t('businessHub.reviews.toastReplyPostFail')); }
  };

  const deleteReply = async (reviewId) => {
    if (!window.confirm(t('businessHub.reviews.confirmDeleteReply'))) return;
    try { await api.delete(`/businesses/${businessId}/reviews-manage/${reviewId}/reply`); toast.success(t('businessHub.reviews.toastReplyRemoved')); load(); }
    catch { toast.error(t('common.failed')); }
  };

  const renderStars = (rating) => Array.from({ length: 5 }, (_, i) => (
    <Star key={i} size={14} fill={i < rating ? '#f59e0b' : 'none'} color={i < rating ? '#f59e0b' : '#94a3b8'} />
  ));

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessHub.reviews.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.reviews.subtitle')}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Star size={20} fill="#f59e0b" color="#f59e0b" />
            <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{avgRating.toFixed(1)}</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{t('businessHub.reviews.count', { count: total })}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {[
          ['all', t('businessHub.reviews.filters.all')],
          ['unreplied', t('businessHub.reviews.filters.needsReply')],
          ['replied', t('businessHub.reviews.filters.replied')],
        ].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{ padding: '0.4rem 0.9rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: filter === v ? '#f97316' : 'transparent', color: filter === v ? '#fff' : 'var(--app-text)', cursor: 'pointer', fontSize: '0.875rem', fontWeight: filter === v ? 600 : 400 }}>{l}</button>
        ))}
      </div>

      {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : reviews.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
          <Star size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>{filter !== 'all' ? t('businessHub.reviews.emptyFiltered') : t('businessHub.reviews.empty')}</p>
        </div>
      ) : reviews.map(r => (
        <div key={r.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f97316', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0, fontSize: '0.875rem' }}>
              {(r.reviewer_name || 'A').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{r.reviewer_name || t('businessHub.reviews.anonymous')}</span>
                <div style={{ display: 'flex', gap: '2px' }}>{renderStars(r.rating)}</div>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              {r.comment && <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>{r.comment}</p>}
            </div>
          </div>

          {r.owner_reply ? (
            <div style={{ background: 'var(--app-bg)', borderInlineStart: '3px solid #f97316', padding: '0.75rem', borderRadius: '0 0.5rem 0.5rem 0', marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f97316', marginBottom: '0.25rem' }}>{t('businessHub.reviews.yourReply')}</div>
                  <p style={{ margin: 0, fontSize: '0.875rem' }}>{r.owner_reply}</p>
                </div>
                <button onClick={() => deleteReply(r.id)} style={{ padding: '0.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={12} /></button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
              <textarea
                value={replyForms[r.id] || ''}
                onChange={e => setReplyForms(f => ({ ...f, [r.id]: e.target.value }))}
                placeholder={t('businessHub.reviews.replyPlaceholder')}
                rows={2}
                style={{ flex: 1, padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', resize: 'vertical', fontSize: '0.875rem' }}
              />
              <button onClick={() => submitReply(r.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.6rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                <Send size={14} /> {t('businessHub.reviews.reply')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
