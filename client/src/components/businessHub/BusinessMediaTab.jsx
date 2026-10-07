// client/src/components/businessHub/BusinessMediaTab.jsx
//
// Business Hub > Media tab: view the business's Media posts and compose new ones.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import MediaPostCard from '../../pages/media/MediaPostCard';
import '../../pages/media/MediaStyles.css';

export default function BusinessMediaTab({ businessId }) {
  const { t } = useTranslation();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/media/business/${businessId}/posts`);
      setPosts(Array.isArray(data?.posts) ? data.posts : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const handlePost = async () => {
    if (!draft.trim()) return;
    setComposing(true);
    try {
      await api.post('/media/posts', { body: draft.trim(), business_id: businessId });
      setDraft('');
      toast.success(t('businessMedia.posted'));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('businessMedia.postFailed'));
    } finally {
      setComposing(false);
    }
  };

  if (loading) {
    return (
      <div className="media-skeleton">
        <div className="skeleton-line" style={{ width: '60%' }} />
        <div className="skeleton-line" />
        <div className="skeleton-line" style={{ width: '80%' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="media-error">
        <p>{error}</p>
        <button type="button" onClick={load}>
          <RefreshCw size={16} /> {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="business-media-tab">
      <div className="business-media-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('businessMedia.composePlaceholder')}
          rows={3}
        />
        <button
          type="button"
          onClick={handlePost}
          disabled={composing || !draft.trim()}
          className="business-media-post-btn"
        >
          <Plus size={16} /> {t('businessMedia.post')}
        </button>
      </div>

      {posts.length === 0 ? (
        <div className="media-empty-state">
          <p>{t('businessMedia.empty')}</p>
        </div>
      ) : (
        <div className="business-media-posts">
          {posts.map((post) => (
            <MediaPostCard key={post.id} post={post} onUpdate={load} />
          ))}
        </div>
      )}
    </div>
  );
}
