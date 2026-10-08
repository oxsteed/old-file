import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Bell, Briefcase, Home, Mail, MapPin, Plus, Search, ShieldCheck, Users, Utensils, UserRound } from 'lucide-react';
import PageShell from '../../components/PageShell';
import LanguageSelector from '../../components/LanguageSelector';
import ThemeToggle from '../../components/ThemeToggle';
import OxSteedIcon from '../../components/OxSteedIcon';
import { useAuth } from '../../context/AuthContext';
import useNotifications from '../../hooks/useNotifications';
import api from '../../api/axios';
import MediaFooter from './MediaFooter';
import './MediaStyles.css';

const TABS = [
  { path: '/media', key: 'home', Icon: Home },
  { path: '/media/search', key: 'search', Icon: Search },
  { path: '/media/communities', key: 'spaces', Icon: Users },
  { path: '/media/notifications', key: 'notifications', Icon: Bell },
  { path: '/media/messages', key: 'messages', Icon: Mail },
];

const DISCOVER = [
  { path: '/restaurants', key: 'restaurants', Icon: Utensils },
  { path: '/helpers', key: 'helpers', Icon: UserRound },
  { path: '/jobs', key: 'jobs', Icon: Briefcase },
];

export default function MediaShell({ children }) {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const { unreadCount: notificationUnread } = useNotifications();
  const [messageUnread, setMessageUnread] = useState(0);
  const { pathname } = useLocation();
  const currentPath = pathname.replace(/\/+$/, '') || '/';
  const activeTab = currentPath === '/media/compose' ? null
    : TABS.find(tab => tab.path !== '/media' && currentPath.startsWith(tab.path))?.path || '/media';
  const displayName = user?.display_name
    || user?.name
    || [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim()
    || user?.email
    || '';

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setMessageUnread(0);
      return () => { cancelled = true; };
    }
    api.get('/messages/conversations', { params: { limit: 100, offset: 0 } })
      .then(({ data }) => {
        if (cancelled) return;
        const conversations = Array.isArray(data) ? data : (data?.conversations || []);
        setMessageUnread(conversations.reduce((total, conversation) => total + (Number(conversation.unread_count) || 0), 0));
      })
      .catch(() => {
        if (!cancelled) setMessageUnread(0);
      });
    return () => { cancelled = true; };
  }, [user]);

  const navigation = (mobile = false) => (
    <nav className={mobile ? 'media-bottom-nav' : 'media-side-nav'} aria-label={t('media.shell.navigation')}>
      {TABS.map(({ path, key, Icon }) => {
        const unread = key === 'notifications' ? notificationUnread : key === 'messages' ? messageUnread : 0;
        return (
        <Link key={path} to={path} aria-current={activeTab === path ? 'page' : undefined}
          className={`media-nav-tab ${activeTab === path ? 'active' : ''}`}>
          <Icon size={22} strokeWidth={activeTab === path ? 2.4 : 1.8} aria-hidden="true" />
          <span className="media-nav-label">{t(`media.shell.${key}`)}</span>
          {unread > 0 && <span className="media-nav-badge" aria-label={t('media.notifications.unread', { count: unread })}>{unread > 99 ? '99+' : unread}</span>}
        </Link>
        );
      })}
    </nav>
  );

  return (
    <PageShell hideNav hideFooter>
      <div className="media-shell">
        <header className="media-app-header">
          <div className="media-app-header-inner">
            <Link to="/" className="media-wordmark" aria-label={t('media.shell.homepage')}>
              <span className="media-brand-mark"><OxSteedIcon size={34} /></span>
              <span>OxSteed <span className="media-wordmark-branch">Media</span></span>
            </Link>
            <div className="media-header-tools">
              {!loading && (user ? (
                <div className="media-account-tools">
                  <span className="media-account-name" title={displayName}>{displayName}</span>
                  <button type="button" className="media-account-action" onClick={() => { void logout(); }}>
                    {t('nav.signOut')}
                  </button>
                </div>
              ) : (
                <div className="media-auth-links" aria-label={t('media.shell.account')}>
                  <Link to="/login" className="media-auth-link">{t('nav.signIn')}</Link>
                  <Link to="/join" className="media-auth-link media-auth-link-primary">{t('nav.joinOxsteed')}</Link>
                </div>
              ))}
              <LanguageSelector />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="media-layout">
          <aside className="media-left-rail">
            <div className="media-rail-sticky">
              {navigation()}
              <Link className="media-primary-button media-rail-compose" to="/media/compose">
                <Plus size={18} aria-hidden="true" />{t('media.feed.compose')}
              </Link>
            </div>
          </aside>
          <div className="media-content">{children}</div>
          <aside className="media-discovery" aria-label={t('media.shell.discover')}>
            <div className="media-rail-sticky">
              <section className="media-discovery-card">
                <div className="media-discovery-heading"><MapPin size={18} aria-hidden="true" /><h2>{t('media.shell.discover')}</h2></div>
                <p>{t('media.shell.discoverDescription')}</p>
                {DISCOVER.map(({ path, key, Icon }) => (
                  <Link to={path} className="media-discovery-link" key={path}>
                    <span className="media-discovery-link-icon"><Icon size={19} aria-hidden="true" /></span>
                    <span><strong>{t(`media.shell.${key}`)}</strong><small>{t(`media.shell.${key}Description`)}</small></span>
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </Link>
                ))}
              </section>
              <section className="media-purpose-card">
                <ShieldCheck size={23} aria-hidden="true" />
                <h2>{t('media.shell.purposeTitle')}</h2>
                <p>{t('media.shell.purposeDescription')}</p>
              </section>
            </div>
          </aside>
        </div>
        <MediaFooter />
        {navigation(true)}
      </div>
    </PageShell>
  );
}
