import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Bookmark, Briefcase, Image, Plus, RefreshCw, ShieldCheck, Store, Users } from 'lucide-react';
import { getFeed } from '../../api/media';
import { useAuth } from '../../context/AuthContext';
import MediaPostCard from './MediaPostCard';
import PageMeta from '../../components/PageMeta';
import MediaNeighborhoodArt from './MediaNeighborhoodArt';
import { useMediaNeighborhood } from './MediaNeighborhoodContext';

function mergePosts(current, incoming) {
  const byId = new Map(current.map(post => [post.id, post]));
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()];
}

export default function MediaFeedPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { location, resolvedLocation, setResolvedLocation, openLocation, isLocationOpen, hasLocation } = useMediaNeighborhood();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab = ['following', 'nearby', 'mine'].includes(requestedTab) && (user || requestedTab === 'nearby') ? requestedTab : 'home';
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [before, setBefore] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const pendingNearby = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (location.location_mode === 'all') {
      next.set('location', 'all'); next.delete('city'); next.delete('state');
    } else if (location.location_mode === 'custom' && location.city && location.state) {
      next.delete('location'); next.set('city', location.city); next.set('state', location.state);
    } else {
      next.delete('location'); next.delete('city'); next.delete('state');
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [location, params, setParams]);

  const load = useCallback(async cursor => {
    if (cursor && inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true; setLoading(true); setError(null);
    if (!cursor) { setPosts([]); setBefore(null); setHasMore(false); }
    try {
      const data = await getFeed({ before: cursor, limit: 20, tab, ...location });
      if (request !== generation.current) return;
      setPosts(current => mergePosts(cursor ? current : [], data.posts || []));
      if (data.location && typeof data.location === 'object') setResolvedLocation({ ...location, ...data.location });
      setBefore(data.next_cursor || data.next_before);
      setHasMore(data.has_more === true && Boolean(data.next_cursor || data.next_before));
    } catch (err) {
      if (request !== generation.current) return;
      setError(t(err.response?.data?.code === 'media_feed_cursor_invalid' ? 'media.feed.cursorChanged'
        : err.response?.data?.code === 'media_nearby_location_required' ? 'media.landing.nearbyLocationRequired' : 'media.feed.loadError'));
    } finally {
      if (request === generation.current) { inFlight.current = false; setLoading(false); }
    }
  }, [t, tab, location, user?.id, setResolvedLocation]);

  useEffect(() => { void load(null); return () => { generation.current += 1; }; }, [load]);
  useEffect(() => {
    if (!isLocationOpen && !hasLocation) pendingNearby.current = false;
    if (!pendingNearby.current || !hasLocation) return;
    pendingNearby.current = false;
    const next = new URLSearchParams(params); next.set('tab', 'nearby'); setParams(next);
  }, [hasLocation, isLocationOpen, params, setParams]);
  const selectTab = nextTab => {
    if (nextTab === 'nearby' && !hasLocation) { pendingNearby.current = true; openLocation(); return; }
    pendingNearby.current = false;
    const next = new URLSearchParams(params);
    if (nextTab === 'home') next.delete('tab'); else next.set('tab', nextTab);
    setParams(next);
  };
  const composeTo = user ? '/media/compose' : '/login';
  const refresh = <button type="button" className="media-feed-refresh" disabled={loading} onClick={() => load(null)} aria-label={t('media.feed.refresh')}><RefreshCw size={21} aria-hidden="true" /></button>;

  return <div className="media-feed media-feed-page media-reference-feed">
    <PageMeta title={t('media.feed.metaTitle')} description={t('media.feed.metaDescription')} />
    {user ? <>
      <div className="media-desktop-home-title"><h1>{t(tab === 'mine' ? 'media.landing.myPosts' : 'media.shell.home')}</h1>{refresh}</div>
      <section className="media-mobile-hero"><h1>{t('media.landing.heroTitle')}</h1><p>{t('media.landing.heroDescription')}</p>
        <Link className="media-mobile-composer" to={composeTo}><span>{t('media.landing.prompt')}</span><span className="media-mobile-compose-plus"><Plus size={25} /></span></Link>
      </section>
      <Link className="media-reference-composer" to={composeTo}>
        <span className="media-composer-avatar">{user.profile_photo_url ? <img src={user.profile_photo_url} alt="" /> : <Users size={22} aria-hidden="true" />}</span>
        <span>{t('media.landing.prompt')}</span><span className="media-primary-button">{t('media.landing.shareUpdate')}</span>
      </Link>
      <nav className="media-reference-shortcuts" aria-label={t('media.landing.quickActions')}>
        <Link to="/media/bookmarks"><Bookmark size={26} /><span>{t('media.landing.saved')}</span></Link>
        <Link to="/media/verification"><ShieldCheck size={26} /><span>{t('media.landing.verify')}</span></Link>
        <Link to="/media?tab=mine"><Image size={26} /><span>{t('media.landing.myPosts')}</span></Link>
      </nav>
    </> : <>
      <section className="media-guest-hero"><h1>{t('media.landing.discoverTitle')}</h1><p>{t('media.landing.discoverDescription')}</p></section>
      <div className="media-guest-action-row"><Link to={composeTo} state={{ from: '/media/compose' }}><Plus size={24} />{t('media.landing.shareUpdate')}</Link><Link to="/media/creator"><Briefcase size={24} /><span className="media-desktop-label">{t('media.creator.title')}</span><span className="media-mobile-label">{t('media.landing.marketplace')}</span></Link></div>
    </>}
    <div className="media-reference-tabs" role="group" aria-label={t('media.landing.feedTabs')}>
      <button type="button" className={tab === 'home' ? 'active' : ''} aria-pressed={tab === 'home'} onClick={() => selectTab('home')}><span className={user ? 'media-desktop-label' : ''}>{t('media.feed.latest')}</span>{user && <span className="media-mobile-label">{t('media.landing.forYou')}</span>}</button>
      {user && <button type="button" className={tab === 'following' ? 'active' : ''} aria-pressed={tab === 'following'} onClick={() => selectTab('following')}>{t('media.feed.following')}</button>}
      {user && <button type="button" className={`media-nearby-tab ${tab === 'nearby' ? 'active' : ''}`} aria-pressed={tab === 'nearby'} onClick={() => selectTab('nearby')}>{t('media.landing.nearby')}</button>}
      {tab === 'mine' && <span className="media-mine-label">{t('media.landing.myPosts')}</span>}
      {!user && refresh}
    </div>
    {error && <div className="media-error" role="alert"><p>{error}</p><button type="button" onClick={() => load(null)}>{t('common.retry', { defaultValue: 'Retry' })}</button></div>}
    {posts.map(post => <MediaPostCard key={post.id} post={post} />)}
    {loading && <div className="media-skeleton" role="status" aria-label={t('media.landing.loadingFeed')}><div className="skeleton-line" /><div className="skeleton-line" /></div>}
    {!loading && !error && hasMore && posts.length > 0 && <button type="button" onClick={() => load(before)} className="media-load-more">{t('media.feed.loadMore')}</button>}
    {!loading && !error && !posts.length && <section className={`media-reference-card media-welcome-card ${!user ? 'media-guest-welcome' : ''}`}>
      <MediaNeighborhoodArt className="media-welcome-homes" />
      {!user && <MediaNeighborhoodArt kind="people" className="media-welcome-people" />}
      <div className="media-welcome-copy">
        <h2 className="media-desktop-welcome-title">{t(tab === 'following' ? 'media.feed.followingEmptyHeading' : tab === 'mine' ? 'media.landing.noPosts' : 'media.landing.goodThings')}</h2>
        <h2 className="media-mobile-welcome-title">{t(tab === 'following' ? 'media.feed.followingEmptyHeading' : tab === 'mine' ? 'media.landing.noPosts' : user ? 'media.landing.sayHello' : 'media.landing.goodThings')}</h2>
        <p>{tab === 'following' ? t('media.feed.followingEmptyDescription') : user
          ? <><span className="media-desktop-label">{t('media.landing.welcomeDesktopDescription')}</span><span className="media-mobile-label">{t('media.landing.shareNearby', { city: resolvedLocation.city?.replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase()) || t('media.landing.yourCommunity') })}</span></>
          : <><span className="media-desktop-label">{t('media.landing.discoverUpdates')}</span><span className="media-mobile-label">{t('media.landing.welcomeGuestPhoneDescription')}</span></>}</p>
        <div className="media-welcome-actions">
          <Link className={user ? 'media-primary-button' : 'media-outline-button'} to={user ? composeTo : '/join'}>{user ? <><span className="media-desktop-label">{t('media.landing.shareFirstUpdate')}</span><span className="media-mobile-label">{t('media.landing.shareUpdate')}</span></> : t('nav.joinOxsteed')}</Link>
          {user ? <button type="button" className="media-explore-nearby" onClick={() => selectTab('nearby')}>{t('media.landing.exploreNearby')}</button> : <Link className="media-welcome-signin" to="/login" state={{ from: '/media' }}>{t('nav.signIn')}</Link>}
        </div>
      </div>
    </section>}
    <section className="media-community-discovery"><h2>{t('media.landing.discoverCommunity')}</h2><div className="media-community-discovery-grid">
      <Link className="media-reference-card media-discovery-tile" to={`/discover?type=business${Number.isFinite(resolvedLocation.latitude) ? `&lat=${resolvedLocation.latitude}&lng=${resolvedLocation.longitude}` : resolvedLocation.city && resolvedLocation.state ? `&city=${encodeURIComponent(resolvedLocation.city)}&state=${encodeURIComponent(resolvedLocation.state)}` : ''}`}><MediaNeighborhoodArt kind="business" className="media-discovery-art" /><div><Store size={29} /><h3>{t('media.landing.localBusinesses')}</h3><p>{t('media.landing.businessesDescription')}</p></div></Link>
      <Link className="media-reference-card media-discovery-tile" to="/media/communities"><MediaNeighborhoodArt kind="community" className="media-discovery-art" /><div><Users size={29} /><h3>{t('media.landing.communitySpaces')}</h3><p>{t('media.landing.spacesDescription')}</p></div></Link>
    </div></section>
  </div>;
}
