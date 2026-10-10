import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Bookmark, Briefcase, ChevronDown, Home, Mail, MapPin, Search, ShieldCheck, Users, UserRound } from 'lucide-react';
import PageShell from '../../components/PageShell';
import LanguageSelector from '../../components/LanguageSelector';
import ThemeToggle from '../../components/ThemeToggle';
import OxSteedIcon from '../../components/OxSteedIcon';
import PageMeta from '../../components/PageMeta';
import { useAuth } from '../../context/AuthContext';
import useNotifications from '../../hooks/useNotifications';
import api from '../../api/axios';
import MediaFooter from './MediaFooter';
import MediaLinkModal from './MediaLinkModal';
import { MediaGuestGateProvider } from './MediaGuestGate';
import { getCommunities, getMediaBadges, joinCommunity, markMediaCommunitiesSeen } from '../../api/media';
import { MediaNeighborhoodProvider, useMediaNeighborhood } from './MediaNeighborhoodContext';
import './MediaStyles.css';
import './MediaLanding.css';

const TABS = [
  { path: '/media', key: 'home', Icon: Home },
  { path: '/media/search', key: 'search', Icon: Search },
  { path: '/media/communities', key: 'spaces', Icon: Users },
  { path: '/media/notifications', key: 'notifications', Icon: Bell },
  { path: '/media/messages', key: 'messages', Icon: Mail },
];

function MediaShellContent({ children }) {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const { label, openLocation, resolvedLocation } = useMediaNeighborhood();
  const { unreadCount: notificationUnread } = useNotifications('media');
  const [messageUnread, setMessageUnread] = useState(0);
  const [spacesUnread, setSpacesUnread] = useState(0);
  const [communities, setCommunities] = useState([]);
  const [communityError, setCommunityError] = useState('');
  const [joining, setJoining] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modalLink, setModalLink] = useState(null);
  const accountRef = useRef(null);
  const shellRef = useRef(null);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const currentPath = pathname.replace(/\/+$/, '') || '/';
  const isFeedPage = currentPath === '/media';
  const activeTab = ['/media/compose', '/media/verification', '/media/verify-identity', '/media/creator'].some(path => currentPath.startsWith(path)) ? null
    : TABS.find(tab => tab.path !== '/media' && currentPath.startsWith(tab.path))?.path || '/media';
  const displayName = user?.display_name || user?.name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || '';
  const verified = user?.is_verified === true || ['approved', 'verified'].includes(user?.didit_status);
  const completed = [Boolean(displayName), Boolean(user?.profile_photo_url), Boolean(user?.city && user?.state), verified].filter(Boolean).length;
  const mediaMetaTitle = currentPath === '/media/creator' ? t('media.creator.title')
    : currentPath === '/media/search' ? t('media.search.title')
      : currentPath === '/media/communities' ? t('media.shell.spaces')
        : currentPath === '/media/notifications' ? t('media.shell.notifications')
          : currentPath === '/media/messages' ? t('media.shell.messages')
            : currentPath === '/media/bookmarks' ? t('media.shell.saved')
              : currentPath === '/media/compose' ? t('media.compose.title')
                : t('media.feed.metaTitle');

  useEffect(() => {
    if (!accountOpen) return undefined;
    const close = event => { if (!accountRef.current?.contains(event.target)) setAccountOpen(false); };
    const key = event => { if (event.key === 'Escape') { setAccountOpen(false); accountRef.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [accountOpen]);
  useEffect(() => { setAccountOpen(false); }, [pathname, search]);

  useEffect(() => {
    let cancelled = false;
    setMessageUnread(0);
    if (user) api.get('/messages/conversations', { params: { limit: 100, offset: 0 } })
      .then(({ data }) => { if (!cancelled) setMessageUnread((Array.isArray(data) ? data : data?.conversations || []).reduce((total, item) => total + (Number(item.unread_count) || 0), 0)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    setSpacesUnread(0);
    if (user) (pathname.startsWith('/media/communities') ? markMediaCommunitiesSeen() : getMediaBadges())
      .then(data => { if (!cancelled) setSpacesUnread(Number(data?.spaces_unread) || 0); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, pathname]);

  // Intercept internal link clicks: open in modal instead of navigating
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest('a');
      if (!anchor || !shell.contains(anchor)) return;
      // Skip links already handled by their own modal (legal pages) or expand buttons.
      // Footer legal links have their own embedded modal via MediaFooter.
      if (anchor.closest('.media-legal-dialog') || anchor.classList.contains('media-legal-expand')) return;
      if (anchor.closest('.media-footer-card')) return;
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;
      // Skip non-navigating anchors
      if (href === '#' || anchor.hasAttribute('download')) return;
      // Links within /media navigate normally; only links leaving Media open in the modal
      if (href === '/media' || href.startsWith('/media/') || href.startsWith('/media?')) return;
      // Authentication and verification flows navigate directly so the login
      // page receives the return path (see "guest sign in retains the current
      // Media return path" browser test); the modal cannot preserve it.
      if (['/login', '/join', '/verify-email', '/verify-identity'].some(path => href === path || href.startsWith(`${path}?`))) return;
      event.preventDefault();
      const title = anchor.textContent?.trim().slice(0, 80) || href;
      setModalLink({ url: href, title });
    };
    shell.addEventListener('click', onClick);
    return () => shell.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCommunities([]); setCommunityError('');
    if (isFeedPage && user) getCommunities()
      .then(data => { if (!cancelled) setCommunities(data.communities || []); })
      .catch(() => { if (!cancelled) setCommunityError(t('media.spaces.loadError')); });
    return () => { cancelled = true; };
  }, [isFeedPage, user?.id, t]);

  const join = async community => {
    if (joining !== null) return;
    setJoining(community.id); setCommunityError('');
    try {
      const result = await joinCommunity(community.id);
      setCommunities(current => current.map(item => item.id === community.id ? { ...item, joined: result.joined === true } : item));
    } catch { setCommunityError(t('media.spaces.membershipError')); }
    finally { setJoining(null); }
  };
  const suggested = [...communities].sort((a, b) => {
    const score = item => Boolean(resolvedLocation.city && item.geo_scope?.toLowerCase().includes(resolvedLocation.city.toLowerCase()));
    return Number(score(b)) - Number(score(a));
  }).slice(0, 3);

  const navigation = (mobile = false) => <nav className={mobile ? 'media-bottom-nav' : 'media-side-nav'} aria-label={t('media.shell.navigation')}>
    {TABS.filter(tab => mobile || user || !['notifications', 'messages'].includes(tab.key)).map(({ path, key, Icon }) => {
      const unread = key === 'notifications' ? notificationUnread : key === 'messages' ? messageUnread : key === 'spaces' ? spacesUnread : 0;
      return <Link key={path} to={path} aria-current={activeTab === path ? 'page' : undefined} className={`media-nav-tab ${activeTab === path ? 'active' : ''}`}>
        <Icon size={24} strokeWidth={1.8} aria-hidden="true" />
        <span className="media-nav-label">{mobile && key === 'notifications' ? t('media.landing.alerts') : mobile && key === 'messages' ? t('media.landing.inbox') : t(`media.shell.${key}`)}</span>
        {unread > 0 && <span className="media-nav-badge" aria-label={t('media.notifications.unread', { count: unread })}>{unread > 99 ? '99+' : unread}</span>}
      </Link>;
    })}
  </nav>;
  const locationButton = <button type="button" className="media-global-location" onClick={openLocation}><MapPin size={21} aria-hidden="true" /><span>{label}</span><ChevronDown size={17} aria-hidden="true" /></button>;
  const preferences = <div className="media-preferences"><LanguageSelector appearance="media" /><ThemeToggle /></div>;

  return <MediaGuestGateProvider><PageShell hideNav hideFooter>
    <PageMeta title={mediaMetaTitle} />
    <div ref={shellRef} className={`media-shell media-reference-shell ${user ? 'media-signed-in' : 'media-guest'} ${isFeedPage ? 'media-home-shell' : ''}`}>
      <header className="media-app-header">
        <div className="media-app-header-inner">
          <Link to="/media" className="media-wordmark" aria-label={t('media.shell.homepage')}><span className="media-brand-mark"><OxSteedIcon size={44} /></span><span>OxSteed<span className="media-wordmark-branch"> Media</span></span></Link>
          {user && <div className="media-header-location">{locationButton}</div>}
          <form className="media-header-search" role="search" onSubmit={event => { event.preventDefault(); navigate(`/media/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`); }}>
            <Search size={21} aria-hidden="true" /><input type="search" aria-label={t('media.search.placeholder')} placeholder={t('media.shell.search')} value={query} onChange={event => setQuery(event.target.value)} />
          </form>
          <div className="media-header-tools">
            <div className="media-desktop-preferences">{preferences}</div>
            {!loading && (user ? <div className="media-account-tools" ref={accountRef}>
              <button type="button" className="media-account-trigger" aria-expanded={accountOpen} aria-controls="media-account-menu" aria-label={displayName} onClick={() => setAccountOpen(value => !value)}>
                <span className="media-account-avatar">{user.profile_photo_url ? <img src={user.profile_photo_url} alt="" /> : <UserRound size={23} aria-hidden="true" />}</span><span className="media-account-name">{displayName}</span><ChevronDown size={17} aria-hidden="true" />
              </button>
              {accountOpen && <div id="media-account-menu" className="media-account-menu">
                <div className="media-account-preferences">{preferences}</div>
                <Link to={`/profile/${user.id}`} onClick={() => setAccountOpen(false)}>{t('media.shell.viewProfile')}</Link>
                <Link to="/dashboard" onClick={() => setAccountOpen(false)}>{t('media.shell.editProfile')}</Link>
                <Link to="/media?tab=mine" onClick={() => setAccountOpen(false)}>{t('media.landing.myPosts')}</Link>
                <Link to="/media/creator" onClick={() => setAccountOpen(false)}>{t('media.shell.creatorEarnings')}</Link>
                <Link to="/settings/notifications" onClick={() => setAccountOpen(false)}>{t('media.shell.notificationSettings')}</Link>
                <Link to="/support" onClick={() => setAccountOpen(false)}>{t('media.shell.helpSupport')}</Link>
                <button className="media-account-action" type="button" onClick={() => { setAccountOpen(false); void logout(); }}>{t('nav.signOut')}</button>
              </div>}
            </div> : <div className="media-auth-links"><Link to="/login" state={{ from: `${pathname}${search}` }} className="media-auth-link">{t('nav.signIn')}</Link><Link to="/join" className="media-auth-link media-auth-link-primary"><span className="media-desktop-label">{t('nav.joinOxsteed')}</span><span className="media-mobile-label">{t('media.landing.join')}</span></Link></div>)}
          </div>
        </div>
        <div className="media-mobile-location-row">{locationButton}{preferences}</div>
      </header>
      <div className="media-layout">
        <aside className="media-left-rail"><div className="media-rail-sticky">{navigation()}
          {user && <><div className="media-rail-divider" /><Link className="media-saved-link" to="/media/bookmarks"><Bookmark size={23} />{t('media.shell.saved')}</Link><Link className="media-saved-link" to="/media/verification"><ShieldCheck size={23} />{t('media.shell.verification')}</Link></>}
          <Link className="media-saved-link" to="/media/creator"><Briefcase size={23} />{t('media.creator.title')}</Link>
          {!user && <section className="media-rail-join media-reference-card"><h2>{t('media.landing.joinCommunity')}</h2><p>{t('media.landing.joinDescription')}</p><Link className="media-primary-button" to="/join">{t('media.landing.createAccount')}</Link></section>}
        </div></aside>
        <div className="media-content">{children}</div>
        <aside className="media-discovery" aria-label={t('media.shell.discover')}><div className="media-rail-sticky">
          {user ? <>
            <section className="media-reference-card media-neighborhood-card"><h2>{t('media.landing.yourNeighborhood')}</h2><p>{label}</p><button type="button" className="media-discovery-card-link" onClick={openLocation}>{t('media.landing.changeLocation')}</button></section>
            <section className="media-reference-card media-spaces-card"><h2>{t('media.landing.suggestedSpaces')}</h2>
              {suggested.map(community => <div className="media-suggested-space" key={community.id}><Link className="media-space-name" to={`/media/communities/${encodeURIComponent(community.slug)}`}><span className="media-space-avatar"><Users size={20} /></span><strong>{community.title}</strong></Link>
                {community.joined ? <Link className="media-space-join" to={`/media/communities/${encodeURIComponent(community.slug)}`}>{t('media.landing.open')}</Link> : <button type="button" className="media-space-join" disabled={joining !== null} onClick={() => join(community)}>{t(joining === community.id ? 'media.landing.joining' : 'media.landing.join')}</button>}
              </div>)}
              {communityError && <p role="alert">{communityError}</p>}
              {!suggested.length && !communityError && <p>{t('media.landing.spacesEmpty')}</p>}
              {!suggested.length && <Link to="/media/communities" className="media-discovery-card-link">{t('media.landing.exploreSpaces')}</Link>}
            </section>
            <section className="media-reference-card media-profile-card"><h2>{t('media.landing.completeProfile')}</h2><progress max={4} value={completed} aria-label={t('media.landing.completeProfile')} /><Link className="media-discovery-card-link" to="/media/verification">{t(verified ? 'media.landing.reviewVerification' : 'media.landing.verifyAccount')}</Link></section>
          </> : <>
            <section className="media-reference-card media-how-card"><h2>{t('media.landing.howItWorks')}</h2><ol><li><button type="button" onClick={openLocation}>{t('media.landing.chooseYourLocation')}</button></li><li><Link to="/media/communities">{t('media.landing.exploreCommunity')}</Link></li><li><Link to="/join">{t('media.landing.joinConversation')}</Link></li></ol></section>
            <section className="media-reference-card media-creators-card"><h2>{t('media.landing.forCreators')}</h2><p>{t('media.landing.creatorDescription')}</p><Link className="media-outline-button" to="/media/creator">{t('media.landing.exploreMarketplace')}</Link></section>
          </>}
        </div></aside>
      </div>
      <MediaFooter />{navigation(true)}
      {modalLink && <MediaLinkModal url={modalLink.url} title={modalLink.title} onClose={() => setModalLink(null)} />}
    </div>
  </PageShell></MediaGuestGateProvider>;
}

export default function MediaShell({ children }) {
  const { user } = useAuth();
  return <MediaNeighborhoodProvider user={user}><MediaShellContent>{children}</MediaShellContent></MediaNeighborhoodProvider>;
}
