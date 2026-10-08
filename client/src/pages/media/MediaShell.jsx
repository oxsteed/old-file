import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowUpRight, Bell, Briefcase, Home, Mail, MapPin, Plus, Search, ShieldCheck, Users, Utensils, UserRound } from 'lucide-react';
import PageShell from '../../components/PageShell';
import LanguageSelector from '../../components/LanguageSelector';
import ThemeToggle from '../../components/ThemeToggle';
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
  const { pathname } = useLocation();
  const currentPath = pathname.replace(/\/+$/, '') || '/';
  const activeTab = currentPath === '/media/compose' ? null
    : TABS.find(tab => tab.path !== '/media' && currentPath.startsWith(tab.path))?.path || '/media';

  const navigation = (mobile = false) => (
    <nav className={mobile ? 'media-bottom-nav' : 'media-side-nav'} aria-label={t('media.shell.navigation')}>
      {TABS.map(({ path, key, Icon }) => (
        <Link key={path} to={path} aria-current={activeTab === path ? 'page' : undefined}
          className={`media-nav-tab ${activeTab === path ? 'active' : ''}`}>
          <Icon size={22} strokeWidth={activeTab === path ? 2.4 : 1.8} aria-hidden="true" />
          <span className="media-nav-label">{t(`media.shell.${key}`)}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <PageShell hideNav hideFooter>
      <div className="media-shell">
        <header className="media-app-header">
          <div className="media-app-header-inner">
            <Link to="/media" className="media-wordmark" aria-label={t('media.feed.title')}>
              <span className="media-brand-mark" aria-hidden="true"><MapPin size={20} /></span>
              <span>OxSteed <span className="media-wordmark-branch">Media</span></span>
            </Link>
            <div className="media-header-tools">
              <Link to="/" className="media-back-link" aria-label={t('media.shell.back')}><ArrowLeft size={16} aria-hidden="true" /><span>{t('media.shell.back')}</span></Link>
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
              <p className="media-rail-note">{t('media.shell.railNote')}</p>
              <div className="media-legal-links">
                <Link to="/terms">{t('media.shell.terms')}</Link>
                <Link to="/privacy">{t('media.shell.privacy')}</Link>
                <Link to="/support">{t('media.shell.support')}</Link>
              </div>
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
        {navigation(true)}
      </div>
    </PageShell>
  );
}
