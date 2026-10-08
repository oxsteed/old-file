import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { createPost, getPost, getQuotes, getReplies, recordView } from '../../api/media';
import './MediaStyles.css';
import MediaPostCard from './MediaPostCard';
import MediaReplyComposer from './MediaReplyComposer';
import PageMeta from '../../components/PageMeta';

export default function MediaPostDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [post, setPost] = useState(null);
  const [replies, setReplies] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quoteBody, setQuoteBody] = useState('');
  const [quoting, setQuoting] = useState(false);

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

  const handleNewReply = (reply) => {
    setReplies(r => [reply, ...r]);
    setPost(p => p ? { ...p, reply_count: p.reply_count + 1 } : p);
  };

  const handleQuote = async (event) => {
    event.preventDefault();
    if (!quoteBody.trim()) return;
    if (!user) {
      navigate('/login', { state: { from: window.location.pathname } });
      return;
    }
    setQuoting(true);
    try {
      await createPost({ body: quoteBody.trim(), quoted_post_id: id });
      setQuoteBody('');
    } catch (err) {
      setError(err.response?.data?.error || t('media.post.quoteError'));
    } finally {
      setQuoting(false);
    }
  };

  const loadQuotes = async () => {
    if (quotesOpen) return setQuotesOpen(false);
    try {
      const data = await getQuotes(id);
      setQuotes(data.quotes || []);
      setQuotesOpen(true);
    } catch (err) {
      setError(err.response?.data?.error || t('media.post.quoteError'));
    }
  };

  return (
      <div className="media-post-detail">
        <PageMeta
          title={post?.body ? `${post.display_name}: ${post.body.slice(0, 70)}` : t('media.post.metaTitle')}
          description={post?.body || t('media.post.metaDescription')}
          type="article"
        />
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
            <button type="button" className="media-view-quotes" onClick={loadQuotes}>
              {quotesOpen ? t('media.post.hideQuotes') : t('media.post.viewQuotes')} ({post.quote_count || 0})
            </button>
            {quotesOpen && (
              <div className="media-quotes-list">
                {quotes.map((quote) => <MediaPostCard key={quote.id} post={quote} />)}
                {!quotes.length && <p className="media-empty">{t('media.post.noQuotes')}</p>}
              </div>
            )}
            <form className="media-quote-composer" onSubmit={handleQuote}>
              <label htmlFor="media-quote-body">{t('media.post.quoteLabel')}</label>
              <textarea
                id="media-quote-body"
                value={quoteBody}
                onChange={(event) => setQuoteBody(event.target.value)}
                placeholder={t('media.post.quotePlaceholder')}
                maxLength={2000}
                rows={3}
              />
              <button type="submit" disabled={quoting || !quoteBody.trim()}>
                {quoting ? t('media.post.quotePosting') : t('media.post.quote')}
              </button>
            </form>
            <MediaReplyComposer parentId={id} onReply={handleNewReply} />
            <div className="media-replies-section">
              <div className="media-replies-heading">
                <h2>{t('media.post.replies')} ({post.reply_count})</h2>
                <span className="media-latest-sort">{t('media.post.latest')}</span>
              </div>
              {replies.map(reply => (
                <MediaPostCard key={reply.id} post={reply} />
              ))}
              {!replies.length && <p className="media-empty">{t('media.post.noReplies')}</p>}
            </div>
          </>
        )}
      </div>
  );
}
