// client/src/components/profileStudio/ProfileMediaSection.jsx
//
// Profile Studio > Media section: manage the helper's Media posts.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import MediaPostCard from '../../pages/media/MediaPostCard';
import '../../pages/media/MediaStyles.css';

export default function ProfileMediaSection({ userId }) {
  const { t } = useTranslation();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/media/feed', { params: { tab: 'mine', limit: 20 } });
      setPosts(Array.isArray(data?.posts) ? data.posts : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePost = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.post('/media/posts', { body: draft.trim() });
      setDraft('');
      toast.success(t('profileMedia.posted'));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('profileMedia.postFailed'));
    } finally {
      setPosting(false);
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
    <div className="profile-media-section">
      <div className="business-media-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('profileMedia.composePlaceholder')}
          rows={3}
        />
        <button
          type="button"
          onClick={handlePost}
          disabled={posting || !draft.trim()}
          className="business-media-post-btn"
        >
          <Plus size={16} /> {t('profileMedia.post')}
        </button>
      </div>

      {posts.length === 0 ? (
        <div className="media-empty-state">
          <p>{t('profileMedia.empty')}</p>
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
