import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getFeed } from '../../api/media';
import { MapPin, MessageCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './MediaStyles.css';
import MediaPostCard from './MediaPostCard';
import { Link } from 'react-router-dom';
import PageMeta from '../../components/PageMeta';
import { getSharedBrowserLocation } from '../../utils/browserLocation';

const LOCATION_KEY = 'oxsteed.media.location';
function savedLocation() {
  try {
    const choice = JSON.parse(localStorage.getItem(LOCATION_KEY));
    if (choice?.location_mode === 'all') return { location_mode: 'all' };
    if (choice?.location_mode === 'custom') {
      if (typeof choice.city === 'string' && choice.city.trim() && choice.city.length <= 120
        && typeof choice.state === 'string' && choice.state.trim() && choice.state.length <= 120) {
        return { location_mode: 'custom', city: choice.city, state: choice.state };
      }
      if (Number.isFinite(choice.latitude) && Math.abs(choice.latitude) <= 90
        && Number.isFinite(choice.longitude) && Math.abs(choice.longitude) <= 180) {
        return { location_mode: 'custom', latitude: choice.latitude, longitude: choice.longitude };
      }
    }
  } catch { /* Location choices are optional when browser storage is unavailable. */ }
  return { location_mode: 'profile' };
}

function mergePosts(current, incoming) {
  const byId = new Map(current.map(post => [post.id, post]));
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()];
}

export default function MediaFeedPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState('home');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [before, setBefore] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [location, setLocation] = useState(savedLocation);
  // The API resolves profile-based location choices to the canonical city or
  // device context. Keep that resolved value for the label and form so a
  // signed-in viewer can see what "nearby" means without changing the saved
  // preference from profile to a stale copy of the profile address.
  const [resolvedLocation, setResolvedLocation] = useState(savedLocation);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [city, setCity] = useState(location.city || '');
  const [state, setState] = useState(location.state || '');
  const [locationError, setLocationError] = useState(null);
  const [locating, setLocating] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const locationRequest = useRef(0);
  const activeTab = tab === 'following' && !user ? 'home' : tab;

  const load = useCallback(async (beforeParam) => {
    if (beforeParam && inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    if (!beforeParam) { setPosts([]); setBefore(null); setHasMore(false); }
    try {
      const data = await getFeed({ before: beforeParam, limit: 20, tab: activeTab, ...location });
      if (request !== generation.current) return;
      if (beforeParam) {
        setPosts(p => mergePosts(p, data.posts));
      } else {
        setPosts(mergePosts([], data.posts));
      }
      if (data.location && typeof data.location === 'object') {
        const nextResolved = { ...location, ...data.location };
        setResolvedLocation(nextResolved);
        if (location.location_mode === 'profile' && data.location.city && data.location.state) {
          setCity(data.location.city);
          setState(data.location.state);
        }
      }
      setBefore(data.next_before);
      setHasMore(data.has_more === true && Boolean(data.next_before));
    } catch (err) {
      if (request !== generation.current) return;
      setError(t(err.response?.data?.code === 'media_feed_cursor_invalid'
        ? 'media.feed.cursorChanged' : 'media.feed.loadError'));
    } finally {
      if (request === generation.current) { inFlight.current = false; setLoading(false); }
    }
  }, [t, activeTab, location, user?.id]);

  useEffect(() => {
    load(null);
    return () => { generation.current += 1; };
  }, [load]);

  const selectTab = (nextTab) => {
    if (nextTab === tab) return;
    generation.current += 1;
    setTab(nextTab);
  };

  const chooseLocation = (choice) => {
    generation.current += 1;
    locationRequest.current += 1;
    setLocating(false);
    setLocation(choice);
    setResolvedLocation(choice);
    setLocationError(null);
    setChoosingLocation(false);
    try { localStorage.setItem(LOCATION_KEY, JSON.stringify(choice)); } catch { /* Optional persistence. */ }
  };
  const useDeviceLocation = async () => {
    const request = ++locationRequest.current;
    setLocating(true); setLocationError(null);
    const coords = await getSharedBrowserLocation(true);
    if (request !== locationRequest.current) return;
    setLocating(false);
    if (!coords) { setLocationError(t('media.feed.locationUnavailable')); return; }
    chooseLocation({ location_mode: 'custom', latitude: Math.round(coords.lat * 1000) / 1000,
      longitude: Math.round(coords.lng * 1000) / 1000 });
  };

  return (
      <div className="media-feed media-feed-page">
        <PageMeta title={t('media.feed.metaTitle')} description={t('media.feed.metaDescription')} />
        <header className="media-timeline-header">
          <div>
            <h1>{t('media.shell.home')}</h1>
            <button type="button" className="media-location-toggle" aria-expanded={choosingLocation}
              aria-controls="media-location-choice" onClick={() => setChoosingLocation(value => !value)}>
              <MapPin size={13} aria-hidden="true" />
              {resolvedLocation.city ? `${resolvedLocation.city}, ${resolvedLocation.state}` : t(resolvedLocation.latitude !== null && resolvedLocation.latitude !== undefined
                ? 'media.feed.nearDevice' : resolvedLocation.location_mode === 'all'
                  ? 'media.feed.allLocations' : 'media.feed.chooseLocation')}
            </button>
          </div>
          <button type="button" className="media-icon-button" disabled={loading}
            onClick={() => load(null)} aria-label={t('media.feed.refresh')}>
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </header>
        {choosingLocation && (
          <section id="media-location-choice" className="media-location-choice" aria-label={t('media.feed.chooseLocation')}>
            <p>{t('media.feed.locationHelp')}</p>
            <form onSubmit={event => { event.preventDefault(); chooseLocation({ location_mode: 'custom', city: city.trim(), state: state.trim() }); }}>
              <label>{t('media.feed.city')}<input value={city} onChange={event => setCity(event.target.value)} required pattern=".*\S.*" maxLength={120} /></label>
              <label>{t('media.feed.state')}<input value={state} onChange={event => setState(event.target.value)} required pattern=".*\S.*" maxLength={120} /></label>
              <button type="submit">{t('media.feed.applyLocation')}</button>
            </form>
            <div className="media-location-actions">
              <button type="button" disabled={locating} onClick={useDeviceLocation}>{t(locating ? 'media.feed.locating' : 'media.feed.useDeviceLocation')}</button>
              {user && <button type="button" onClick={() => chooseLocation({ location_mode: 'profile' })}>{t('media.feed.profileLocation')}</button>}
              <button type="button" onClick={() => chooseLocation({ location_mode: 'all' })}>{t('media.feed.allLocations')}</button>
            </div>
            {locationError && <p role="alert">{locationError}</p>}
          </section>
        )}
        <Link className="media-composer-prompt" to="/media/compose">
          <span className="media-composer-avatar" aria-hidden="true">
            {user?.profile_photo_url ? <img src={user.profile_photo_url} alt="" /> : <MessageCircle size={20} />}
          </span>
          <span>{t('media.feed.prompt')}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <div className="media-feed-toolbar">
          <button type="button" className={`media-feed-tab ${activeTab === 'home' ? 'active' : ''}`}
            aria-pressed={activeTab === 'home'} onClick={() => selectTab('home')}>
            {t('media.feed.latest')}
          </button>
          {user && (
            <button type="button" className={`media-feed-tab ${tab === 'following' ? 'active' : ''}`}
              aria-pressed={tab === 'following'} onClick={() => selectTab('following')}>
              {t('media.feed.following')}
            </button>
          )}
        </div>
        {error && (
          <div className="media-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => load(null)}>{t('common.retry', 'Retry')}</button>
          </div>
        )}
        {posts.map(post => (
          <MediaPostCard key={post.id} post={post} />
        ))}
        {loading && (
          <div className="media-skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        )}
        {!loading && !error && hasMore && posts.length > 0 && (
          <button onClick={() => load(before)} className="media-load-more">
            {t('media.feed.loadMore')}
          </button>
        )}
        {!loading && !error && !posts.length && (
          <div className="media-feed-empty">
            <div className="media-empty-illustration" aria-hidden="true">
              <span className="media-empty-bubble"><MessageCircle size={27} /></span>
              <span className="media-empty-pin"><MapPin size={21} /></span>
            </div>
            <h2>{activeTab === 'following' ? t('media.feed.followingEmptyHeading') : t('media.feed.emptyHeading')}</h2>
            <p>{activeTab === 'following' ? t('media.feed.followingEmptyDescription') : t('media.feed.emptyDescription')}</p>
            <Link className="media-text-link" to="/restaurants">{t('media.feed.explore')}<ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        )}
      </div>
  );
}
