import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Plus, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createCommunitySuggestion, getCommunities, getMyCommunitySuggestions } from '../../api/media';
import { useAuth } from '../../context/AuthContext';
import { useMediaGuestGate } from './MediaGuestGate';

export default function MediaCommunitiesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { requireLogin } = useMediaGuestGate();
  const [communities, setCommunities] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestion, setSuggestion] = useState({ title: '', geo_scope: '', category: 'general', description: '' });
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [suggestionError, setSuggestionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getCommunities().then(d => setCommunities(d.communities || [])),
      user ? getMyCommunitySuggestions().then(d => setSuggestions(d.suggestions || [])).catch(() => {}) : Promise.resolve(),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  const updateSuggestion = (field) => (event) => setSuggestion(current => ({ ...current, [field]: event.target.value }));
  const openSuggestion = () => {
    if (!user) return requireLogin('/media/communities');
    setSuggestionError(''); setSuggestionMessage(''); setSuggestOpen(true);
  };
  const submitSuggestion = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setSuggestionError(''); setSuggestionMessage('');
    try {
      const result = await createCommunitySuggestion(suggestion);
      setSuggestions(current => [result.suggestion, ...current]);
      setSuggestion({ title: '', geo_scope: '', category: 'general', description: '' });
      setSuggestOpen(false);
      setSuggestionMessage(t('media.spaces.suggestionSubmitted', { defaultValue: 'Space suggestion submitted for review.' }));
    } catch (err) {
      setSuggestionError(err.response?.data?.error || t('media.spaces.suggestionError', { defaultValue: 'We could not submit that suggestion.' }));
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="media-empty-state"><p>{t('media.spaces.loading')}</p></div>;

  return (
    <div className="media-communities">
      <h1>{t('media.shell.spaces')}</h1>
      <p className="media-subtitle">{t('media.spaces.description')}</p>
      <div className="media-space-actions">
        <button type="button" className="media-primary-button" onClick={openSuggestion} data-track="ui.b92937b1c4.1"><Plus size={17} aria-hidden="true" /> {t('media.spaces.suggest', { defaultValue: 'Suggest a Space' })}</button>
        {suggestionMessage && <p role="status" className="media-inline-success">{suggestionMessage}</p>}
      </div>
      {suggestOpen && (
        <div className="media-card media-space-suggestion-card">
          <div className="media-space-suggestion-heading"><h2>{t('media.spaces.suggestTitle', { defaultValue: 'Suggest a Space' })}</h2><button type="button" className="media-icon-button" onClick={() => setSuggestOpen(false)} aria-label={t('media.shell.close', { defaultValue: 'Close' })} data-track="ui.b92937b1c4.2"><X size={18} /></button></div>
          <p>{t('media.spaces.suggestHint', { defaultValue: 'Tell us what local conversation is missing. An administrator reviews suggestions before they become public.' })}</p>
          <form onSubmit={submitSuggestion} className="media-space-suggestion-form" data-track="ui.b92937b1c4.3">
            <label>Space name<input required minLength={3} maxLength={120} value={suggestion.title} onChange={updateSuggestion('title')} placeholder="Springfield Small Businesses" /></label>
            <label>City, region, or county<input required maxLength={160} value={suggestion.geo_scope} onChange={updateSuggestion('geo_scope')} placeholder="Springfield, OH" /></label>
            <label>Category<select value={suggestion.category} onChange={updateSuggestion('category')}><option value="general">General</option><option value="food">Food & dining</option><option value="helpers">Local help</option><option value="jobs">Jobs & opportunities</option><option value="businesses">Businesses</option><option value="events">Events</option><option value="mutual_aid">Mutual aid</option></select></label>
            <label>Description <span>(optional)</span><textarea maxLength={1000} rows={3} value={suggestion.description} onChange={updateSuggestion('description')} placeholder="What should neighbors share here?" /></label>
            {suggestionError && <p role="alert" className="media-inline-error">{suggestionError}</p>}
            <div className="media-space-suggestion-actions"><button type="button" className="media-text-button" onClick={() => setSuggestOpen(false)} data-track="ui.b92937b1c4.4">Cancel</button><button type="submit" className="media-primary-button" disabled={submitting} data-track="ui.b92937b1c4.5">{submitting ? 'Submitting…' : 'Submit for review'}</button></div>
          </form>
        </div>
      )}
      {communities.map(c => (
        <Link key={c.id} to={`/media/communities/${encodeURIComponent(c.slug)}`} className="media-community-card">
          <span className="media-community-card-icon"><Users size={19} aria-hidden="true" /></span>
          <span className="media-community-card-body"><strong>{c.title}</strong><small>{[c.geo_scope, c.category].filter(Boolean).join(' · ') || t('media.spaces.local')}</small></span>
          <span className="media-community-card-count">
            <span aria-label={t('media.spaces.posts', { count: c.post_count || 0 })}><MapPin size={14} aria-hidden="true" />{c.post_count || 0}</span>
            <span aria-label={t('media.spaces.members', { count: c.member_count || 0 })}><Users size={14} aria-hidden="true" />{c.member_count || 0}</span>
          </span>
        </Link>
      ))}
      {!communities.length && (
        <p className="media-empty">{t('media.spaces.emptyHeading')}</p>
      )}
      {user && suggestions.length > 0 && <section className="media-space-suggestions" aria-labelledby="media-my-space-suggestions"><h2 id="media-my-space-suggestions">Your suggestions</h2>{suggestions.map(item => <article key={item.id} className="media-community-card media-space-suggestion-row"><span className="media-community-card-body"><strong>{item.title}</strong><small>{item.geo_scope} · {item.category}</small>{item.review_note && <small>{item.review_note}</small>}</span><span className={`media-space-status media-space-status-${item.status}`}>{item.status}</span></article>)}</section>}
    </div>
  );
}
