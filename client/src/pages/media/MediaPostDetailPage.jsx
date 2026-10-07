import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getPost, getReplies, recordView } from '../../api/media';
import PageShell from '../../components/PageShell';
import './MediaStyles.css';
import MediaPostCard from './MediaPostCard';
import MediaReplyComposer from './MediaReplyComposer';

export default function MediaPostDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [replies, setReplies] = useState([]);
  const [sort, setSort] = useState('latest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postData, repliesData] = await Promise.all([
        getPost(id),
        getReplies(id),
      ]);
      setPost(postData.post);
      setReplies(repliesData.replies);
      recordView(id).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.error || t('media.post.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  const loadReplies = async (sortMode) => {
    const data = await getReplies(id, sortMode);
    setReplies(data.replies);
  };

  const handleNewReply = (reply) => {
    setReplies(r => [reply, ...r]);
    setPost(p => p ? { ...p, reply_count: p.reply_count + 1 } : p);
  };

  const handleSortChange = (newSort) => {
    setSort(newSort);
    loadReplies(newSort);
  };

  return (
    <PageShell>
      <div className="media-post-detail">
        {loading && (
          <div className="media-skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        )}
        {error && !loading && (
          <div className="media-error">
            <p>{error}</p>
            <button type="button" onClick={load}>{t('common.retry', 'Retry')}</button>
          </div>
        )}
        {!loading && !error && !post && (
          <div className="media-empty-state">
            <p>{t('media.post.notFound')}</p>
          </div>
        )}
        {post && !loading && (
          <>
            <MediaPostCard post={post} />
            <MediaReplyComposer parentId={id} onReply={handleNewReply} />
            <div className="media-replies-section">
              <h2>{t('media.post.replies')} ({post.reply_count})</h2>
              <div className="media-reply-sort">
                <button
                  onClick={() => handleSortChange('latest')}
                  className={sort === 'latest' ? 'active' : ''}
                >
                  {t('media.post.latest')}
                </button>
                <button
                  onClick={() => handleSortChange('relevant')}
                  className={sort === 'relevant' ? 'active' : ''}
                >
                  {t('media.post.relevant')}
                </button>
              </div>
              {replies.map(reply => (
                <MediaPostCard key={reply.id} post={reply} />
              ))}
              {!replies.length && <p className="media-empty">{t('media.post.noReplies')}</p>}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
