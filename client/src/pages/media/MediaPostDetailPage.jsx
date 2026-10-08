import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { createPost, deletePost, getPost, getQuotes, getReplies, recordView, replacePostLinks, searchMediaEntities, updatePost } from '../../api/media';
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
  const [editingLinks, setEditingLinks] = useState(false);
  const [draftLinks, setDraftLinks] = useState([]);
  const [linkType, setLinkType] = useState('restaurant');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkName, setLinkName] = useState('');
  const [savingLinks, setSavingLinks] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [savingBody, setSavingBody] = useState(false);
  const [entitySuggestions, setEntitySuggestions] = useState([]);
  const [searchingEntities, setSearchingEntities] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postData, repliesData] = await Promise.all([
        getPost(id),
        getReplies(id),
      ]);
      setPost(postData.post);
      setBodyDraft(postData.post.body || '');
      setDraftLinks(postData.post.links || []);
      setReplies(repliesData.replies);
      recordView(id).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.error || t('media.post.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const query = linkName.trim();
    if (!editingLinks || !query) {
      setEntitySuggestions([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSearchingEntities(true);
      searchMediaEntities({ type: linkType, q: query })
        .then((data) => { if (!cancelled) setEntitySuggestions(data.entities || []); })
        .catch(() => { if (!cancelled) setEntitySuggestions([]); })
        .finally(() => { if (!cancelled) setSearchingEntities(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [editingLinks, linkName, linkType]);

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

  const addDraftLink = (event) => {
    event.preventDefault();
    if (!linkTarget.trim() || !linkName.trim() || draftLinks.length >= 5) return;
    setDraftLinks((current) => [...current, {
      link_type: linkType,
      target_id: linkTarget.trim(),
      name_snapshot: linkName.trim(),
    }]);
    setLinkTarget('');
    setLinkName('');
    setEntitySuggestions([]);
  };

  const chooseEntity = (entity) => {
    setLinkTarget(entity.target_id);
    setLinkName(entity.name);
    setEntitySuggestions([]);
  };

  const saveLinks = async () => {
    setSavingLinks(true);
    try {
      const data = await replacePostLinks(id, draftLinks.map((link) => ({
        link_type: link.link_type,
        target_id: link.target_id,
        name_snapshot: link.name_snapshot || link.name,
        label: link.label || null,
        price_snapshot_cents: link.price_snapshot_cents,
      })));
      setPost(data.post);
      setDraftLinks(data.post.links || []);
      setEditingLinks(false);
    } catch (err) {
      setError(err.response?.data?.error || t('media.post.linksError'));
    } finally {
      setSavingLinks(false);
    }
  };

  const saveBody = async (event) => {
    event.preventDefault();
    setSavingBody(true);
    try {
      const data = await updatePost(id, { body: bodyDraft });
      setPost(data.post);
      setEditingBody(false);
    } catch (err) {
      setError(err.response?.data?.error || t('media.post.editError', { defaultValue: 'Could not update this post.' }));
    } finally {
      setSavingBody(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('media.post.deleteConfirm', { defaultValue: 'Delete this post?' }))) return;
    try {
      await deletePost(id);
      navigate('/media');
    } catch (err) {
      setError(err.response?.data?.error || t('media.post.deleteError', { defaultValue: 'Could not delete this post.' }));
    }
  };

  return (
      <div className="media-post-detail">
        <PageMeta
          title={post?.body ? `${post.display_name}: ${post.body.slice(0, 70)}` : t('media.post.metaTitle')}
          description={post?.body || t('media.post.metaDescription')}
          image={post?.assets?.find((asset) => asset.thumbnail_url || asset.url)?.thumbnail_url || post?.assets?.find((asset) => asset.url)?.url}
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
            {user?.id && String(post.owner_user_id) === String(user.id) && (
              <section className="media-owner-controls">
                <div className="media-owner-actions">
                  <button type="button" className="media-text-button" onClick={() => setEditingBody((value) => !value)}>
                    {editingBody ? t('media.post.cancelEdit', { defaultValue: 'Cancel edit' }) : t('media.post.edit', { defaultValue: 'Edit post' })}
                  </button>
                  <button type="button" className="media-text-button media-danger-button" onClick={handleDelete}>
                    {t('media.post.delete', { defaultValue: 'Delete post' })}
                  </button>
                </div>
                {editingBody && (
                  <form className="media-links-editor-panel" onSubmit={saveBody}>
                    <label htmlFor="media-edit-body">{t('media.post.editLabel', { defaultValue: 'Post text' })}</label>
                    <textarea id="media-edit-body" value={bodyDraft} onChange={(event) => setBodyDraft(event.target.value)} maxLength={2000} rows={4} />
                    <button type="submit" className="media-primary-button" disabled={savingBody || !bodyDraft.trim()}>
                      {savingBody ? t('media.post.saving', { defaultValue: 'Saving…' }) : t('media.post.save', { defaultValue: 'Save changes' })}
                    </button>
                  </form>
                )}
                <div className="media-links-editor">
                <button type="button" className="media-text-button" onClick={() => setEditingLinks((value) => !value)}>
                  {editingLinks ? t('media.post.cancelLinks') : t('media.post.editLinks')}
                </button>
                {editingLinks && (
                  <div className="media-links-editor-panel">
                    <div className="media-links-editor-list">
                      {draftLinks.map((link, index) => (
                        <div className="media-compose-link" key={`${link.id || link.target_id}-${index}`}>
                          <span>{link.name || link.name_snapshot}</span>
                          <button type="button" onClick={() => setDraftLinks((current) => current.filter((_, i) => i !== index))}>{t('media.compose.remove')}</button>
                        </div>
                      ))}
                    </div>
                    <form className="media-link-picker" onSubmit={addDraftLink}>
                      <select value={linkType} onChange={(event) => setLinkType(event.target.value)}>
                        {['restaurant', 'food_item', 'helper', 'business', 'job'].map((type) => <option key={type} value={type}>{t(`media.compose.linkTypes.${type}`, { defaultValue: type })}</option>)}
                      </select>
                      <input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder={t('media.compose.entitySearchPlaceholder')} />
                      <input value={linkTarget} readOnly aria-label={t('media.compose.targetId')} placeholder={t('media.compose.targetId')} />
                      <button type="submit" disabled={draftLinks.length >= 5}>{t('media.compose.addLink')}</button>
                    </form>
                    {(searchingEntities || entitySuggestions.length > 0) && (
                      <div className="media-entity-suggestions" role="listbox" aria-label={t('media.compose.entitySearchHint')}>
                        {searchingEntities && <span className="media-entity-suggestion-status">{t('media.compose.searchingEntities')}</span>}
                        {entitySuggestions.map((entity) => (
                          <button type="button" key={entity.target_id} className="media-entity-suggestion" onClick={() => chooseEntity(entity)}>
                            <span>{entity.name}</span>
                            {entity.price_snapshot_cents != null && <small>${(Number(entity.price_snapshot_cents) / 100).toFixed(2)}</small>}
                          </button>
                        ))}
                      </div>
                    )}
                    <button type="button" className="media-primary-button" onClick={saveLinks} disabled={savingLinks}>
                      {savingLinks ? t('media.post.savingLinks') : t('media.post.saveLinks')}
                    </button>
                  </div>
                )}
                </div>
              </section>
            )}
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
