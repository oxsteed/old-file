// Terms of Service — layout aligned with oxsteed_terms_visual_mockup.html
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Copy, CheckCircle, ChevronDown, AlertCircle, ArrowUp } from 'lucide-react';
import api from '../api/axios';
import './TermsOfServicePage.css';

export default function TermsOfServicePage() {
  const { t, i18n } = useTranslation();
  const [legalDocument, setLegalDocument] = useState(null);
  const [sections, setSections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [userAccepted, setUserAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [collapsed, setCollapsed] = useState({});
  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const acceptCheckboxRef = useRef(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setLoading(true);
        const { data } = await api.get(`/legal/documents/terms_of_service`, {
          params: { language: i18n.language },
        });

        setLegalDocument(data.document);
        setSections(data.sections || []);
        setUserAccepted(data.document.userAccepted);
      } catch (err) {
        setError('Failed to load terms of service. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [i18n.language]);

  const highlightMatch = (text, query) => {
    if (!query || query.length < 2 || !text) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  };

  const q = searchQuery.trim().toLowerCase();
  const searchActive = q.length >= 2;

  const filteredForDisplay = sections.map((s) => {
    const titleMatch = q && s.title?.toLowerCase().includes(q);
    const contentMatch = q && (s.content || '').toLowerCase().includes(q);
    const highlighted = searchActive && (titleMatch || contentMatch);
    const dimmed = searchActive && !highlighted;
    const html = searchActive
      ? highlightMatch(s.content || '', searchQuery.trim())
      : s.content || '';
    return { ...s, highlighted, dimmed, html };
  });

  const matchCount = searchActive
    ? filteredForDisplay.filter((s) => s.highlighted).length
    : 0;

  useEffect(() => {
    const onScroll = () => {
      const docH =
        globalThis.document.documentElement.scrollHeight - window.innerHeight;
      const pct = docH <= 0 ? 100 : (window.scrollY / docH) * 100;
      const clamped = Math.min(100, Math.max(0, pct));
      setScrollProgress(clamped);
      if (clamped >= 95 && acceptCheckboxRef.current && !userAccepted) {
        acceptCheckboxRef.current.disabled = false;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [userAccepted]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) {
          const key = visible.target.id.replace(/^sec-/, '');
          setActiveSectionKey(key);
        }
      },
      { root: null, rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.1, 0.25] }
    );

    sections.forEach((s) => {
      const el = sectionRefs.current[s.key];
      if (el) obs.observe(el);
    });

    return () => obs.disconnect();
  }, [sections]);

  const scrollToSection = (key) => {
    const el = sectionRefs.current[key];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSectionKey(key);
  };

  const toggleCollapsed = (key) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAccept = async (e) => {
    if (!e.target.checked) return;

    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const firstName = user.first_name || '';
      const lastName = user.last_name || '';

      if (!firstName || !lastName) {
        alert('Please complete your profile before accepting terms.');
        e.target.checked = false;
        return;
      }

      await api.post(`/legal/documents/${legalDocument.id}/accept`, {
        firstName,
        lastName,
      });

      setUserAccepted(true);
    } catch (err) {
      alert('Failed to accept terms. Please try again.');
      e.target.checked = false;
    }
  };

  const copyLink = (sectionKey) => {
    const url = `${window.location.origin}/terms#${sectionKey}`;
    navigator.clipboard.writeText(url);
  };

  if (loading) {
    return (
      <div className="terms-page terms-page-loading">
        <div className="terms-spinner">{t('common.loading', 'Loading…')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="terms-page terms-page-error">
        <div className="terms-error-box">
          <AlertCircle size={24} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const canAcceptScroll = scrollProgress >= 95;

  return (
    <div className="terms-page terms-visual">
      <header className="terms-header terms-header-span">
        <h1>{legalDocument?.title || 'Terms of Service'}</h1>
        <p>
          {legalDocument?.lastUpdated
            ? `${t('terms.lastUpdated', 'Last updated')} ${new Date(legalDocument.lastUpdated).toLocaleDateString()}`
            : ''}
          {legalDocument?.version != null && ` • ${t('terms.version', 'Version')} ${legalDocument.version}`}
        </p>
      </header>

      <aside className="terms-sidebar">
        <span className="toc-label">{t('terms.onThisPage', 'On this page')}</span>
        <ul className="toc-list" role="navigation" aria-label={t('terms.toc', 'Table of contents')}>
          {sections.map((section) => (
            <li key={section.key}>
              <button
                type="button"
                className={`toc-item ${activeSectionKey === section.key ? 'active' : ''}`}
                onClick={() => scrollToSection(section.key)}
              >
                {section.title}
              </button>
            </li>
          ))}
        </ul>
        <div className="terms-sidebar-footer">
          <button type="button" className="terms-history-button" onClick={() => setShowDiffViewer(true)}>
            {t('terms.versionHistory', 'Version history')}
          </button>
        </div>
      </aside>

      <main className="terms-main">
        <div className="search-box">
          <Search size={18} aria-hidden />
          <input
            type="search"
            placeholder={t('terms.searchPlaceholder', 'Search terms…')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t('terms.searchLabel', 'Search in terms')}
          />
          <span className="search-count">
            {searchActive ? `${matchCount}/${sections.length}` : ''}
          </span>
        </div>

        <div className="terms-sections-wrap">
          {filteredForDisplay.length === 0 ? (
            <div className="terms-no-results">
              <p>{t('terms.noResults', 'No sections match your search.')}</p>
            </div>
          ) : (
            filteredForDisplay.map((section) => {
              const isCollapsed = !!collapsed[section.key];
              return (
                <section
                  key={section.key}
                  id={`sec-${section.key}`}
                  ref={(el) => {
                    sectionRefs.current[section.key] = el;
                  }}
                  className={`section ${section.isCritical ? 'critical' : ''} ${section.highlighted ? 'highlighted' : ''} ${section.dimmed ? 'dimmed' : ''} ${isCollapsed ? 'collapsed' : ''}`}
                >
                  <div
                    className="section-header"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleCollapsed(section.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleCollapsed(section.key);
                      }
                    }}
                  >
                    <div className="section-toggle" aria-hidden>
                      <ChevronDown size={16} />
                    </div>
                    <div className="section-title-wrap">
                      <span className="section-title">{section.title}</span>
                      {section.isCritical && (
                        <span className="critical-badge">{t('terms.critical', 'Critical')}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="copy-link-btn"
                      title={t('terms.copySectionLink', 'Copy link to section')}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        copyLink(section.key);
                      }}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  <div
                    className="section-content"
                    dangerouslySetInnerHTML={{ __html: section.html }}
                  />
                </section>
              );
            })
          )}
        </div>

        <div className="acceptance-section">
          <div className="acceptance-box">
            <h3>{t('terms.acceptHeading', 'Do you agree to these terms?')}</h3>
            <p>
              {t(
                'terms.acceptIntro',
                'By checking the box below, you acknowledge that you have read and agree to these terms of service.'
              )}
            </p>

            {!userAccepted && !canAcceptScroll && (
              <div className="scroll-indicator">
                <ArrowUp size={14} aria-hidden />
                <span>{t('terms.scrollToAccept', 'Scroll to bottom to accept')}</span>
              </div>
            )}
            {!userAccepted && (
              <div className="scroll-bar" aria-hidden>
                <div className="scroll-fill" style={{ width: `${scrollProgress}%` }} />
              </div>
            )}

            <label className="checkbox-wrapper">
              <input
                ref={acceptCheckboxRef}
                type="checkbox"
                disabled={userAccepted ? true : !canAcceptScroll}
                checked={userAccepted}
                onChange={handleAccept}
              />
              <span>{t('terms.acceptCheckbox', 'I have read and agree to the terms of service')}</span>
            </label>

            {userAccepted && (
              <div className="accepted-msg">
                <CheckCircle size={16} aria-hidden />
                {t('terms.acceptedMsg', 'You have accepted these terms')}
              </div>
            )}
          </div>
        </div>

        <footer className="terms-legal-notice">
          <p>
            © {new Date().getFullYear()} OxSteed. {t('terms.legalFooter', 'All rights reserved.')}
          </p>
        </footer>
      </main>

      {showDiffViewer && (
        <VersionDiffModal documentId={legalDocument?.id} onClose={() => setShowDiffViewer(false)} />
      )}
    </div>
  );
}

function VersionDiffModal({ documentId, onClose }) {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [versionContent, setVersionContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { data } = await api.get(`/legal/documents/${documentId}/history`);
        setVersions(data.versions || []);
        if (data.versions?.length > 0) setSelectedVersion(data.versions[0]);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    };
    if (documentId) fetchHistory();
  }, [documentId]);

  useEffect(() => {
    if (!documentId || !selectedVersion?.versionNumber) {
      setVersionContent('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingContent(true);
      try {
        const { data } = await api.get(
          `/legal/documents/${documentId}/version/${selectedVersion.versionNumber}`
        );
        if (!cancelled) setVersionContent(data.content || '');
      } catch {
        if (!cancelled) setVersionContent('');
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, selectedVersion]);

  return (
    <div className="terms-modal-overlay" onClick={onClose} role="presentation">
      <div className="terms-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="terms-modal-header">
          <h2>Version history</h2>
          <button type="button" className="terms-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="terms-modal-content">
          {loading ? (
            <p>Loading…</p>
          ) : (
            <div className="terms-versions-list">
              {versions.map((version) => (
                <button
                  type="button"
                  key={version.versionNumber}
                  className={`terms-version-item ${selectedVersion?.versionNumber === version.versionNumber ? 'active' : ''}`}
                  onClick={() => setSelectedVersion(version)}
                >
                  <div className="terms-version-header">
                    <h4>Version {version.versionNumber}</h4>
                    <span className="terms-version-date">
                      {version.publishedAt ? new Date(version.publishedAt).toLocaleDateString() : 'Draft'}
                    </span>
                  </div>
                  {version.changeSummary && (
                    <p className="terms-version-summary">{version.changeSummary}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedVersion && (
          <div className="terms-modal-preview">
            <h3>{selectedVersion.title}</h3>
            <div className="terms-version-content">
              {loadingContent ? 'Loading…' : versionContent || '—'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
