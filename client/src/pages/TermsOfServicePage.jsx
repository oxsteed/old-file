// Terms of Service Page
// Searchable, version-tracked, all-sections-open legal framework
// Design: Perplexity + Enhancements (diff viewer, approval workflow, i18n)

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Copy, CheckCircle, ChevronDown, AlertCircle, Clock } from 'lucide-react';
import api from '../api/axios';
import logger from '../utils/logger';
import './TermsOfServicePage.css';

const ALLOWED_LEGAL_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSafeLegalHref(href) {
  if (!href) return false;
  return /^(https?:|mailto:|tel:|\/|#)/i.test(href.trim());
}

function sanitizeLegalHtml(html, query = '') {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return '';

  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const output = document.createElement('div');

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const tagName = node.tagName.toLowerCase();
    if (!ALLOWED_LEGAL_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      node.childNodes.forEach((child) => fragment.appendChild(cleanNode(child)));
      return fragment;
    }

    const element = document.createElement(tagName);
    if (tagName === 'a') {
      const href = node.getAttribute('href');
      if (isSafeLegalHref(href)) {
        element.setAttribute('href', href.trim());
      }
      element.setAttribute('rel', 'noopener noreferrer');
    }
    node.childNodes.forEach((child) => element.appendChild(cleanNode(child)));
    return element;
  };

  doc.body.childNodes.forEach((node) => output.appendChild(cleanNode(node)));

  if (query && query.length >= 2) {
    const regex = new RegExp(escapeRegExp(query), 'gi');
    const highlightTextNodes = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (!regex.test(text)) return;
        regex.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const offset = match.index;
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
          const mark = document.createElement('mark');
          mark.textContent = match[0];
          fragment.appendChild(mark);
          lastIndex = offset + match[0].length;
        }
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        node.parentNode.replaceChild(fragment, node);
        return;
      }
      Array.from(node.childNodes).forEach(highlightTextNodes);
    };
    highlightTextNodes(output);
  }

  return output.innerHTML;
}

export default function TermsOfServicePage() {
  const { t, i18n } = useTranslation();
  const [document, setDocument] = useState(null);
  const [sections, setSections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSection, setSelectedSection] = useState(null);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [userAccepted, setUserAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const contentRef = useRef(null);
  const acceptCheckboxRef = useRef(null);

  // ──────────────────────────────────────────────────────────
  // LOAD DOCUMENT
  // ──────────────────────────────────────────────────────────

  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setLoading(true);
        const { data } = await api.get(`/legal/documents/terms_of_service`, {
          params: { language: i18n.language }
        });

        setDocument(data.document);
        setSections(data.sections || []);
        setUserAccepted(data.document.userAccepted);
        logger.info('Terms of Service loaded', {
          version: data.document.version,
          sections: data.sections.length
        });
      } catch (err) {
        logger.error('Failed to load terms', { err });
        setError('Failed to load terms of service. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [i18n.language]);

  // ──────────────────────────────────────────────────────────
  // SEARCH & FILTERING
  // ──────────────────────────────────────────────────────────

  const filteredSections = searchQuery.length > 1
    ? sections.filter(s =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sections;

  // ──────────────────────────────────────────────────────────
  // SCROLL TRACKING (Legal requirement)
  // ──────────────────────────────────────────────────────────

  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;

      const element = contentRef.current;
      const scrollTop = element.scrollTop;
      const scrollHeight = element.scrollHeight - element.clientHeight;
      const scrollPercent = scrollHeight === 0 ? 100 : (scrollTop / scrollHeight) * 100;

      setScrollProgress(scrollPercent);

      // Enable acceptance checkbox only if scrolled to bottom
      if (scrollPercent >= 95 && acceptCheckboxRef.current) {
        acceptCheckboxRef.current.disabled = false;
      }
    };

    const contentElement = contentRef.current;
    if (contentElement) {
      contentElement.addEventListener('scroll', handleScroll);
    }

    return () => {
      if (contentElement) {
        contentElement.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  // ──────────────────────────────────────────────────────────
  // ACCEPT DOCUMENT
  // ──────────────────────────────────────────────────────────

  const handleAccept = async (e) => {
    if (!e.target.checked) return;

    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const firstName = user.first_name || '';
      const lastName = user.last_name || '';

      if (!firstName || !lastName) {
        alert(t('termsPage.acceptAlerts.completeProfile'));
        return;
      }

      await api.post(`/legal/documents/${document.id}/accept`, {
        firstName,
        lastName
      });

      setUserAccepted(true);
      logger.info('Terms accepted', {
        version: document.version,
        timestamp: new Date().toISOString()
      });

      // Show confirmation
      alert(t('termsPage.acceptAlerts.thankYou'));
    } catch (err) {
      logger.error('Failed to accept terms', { err });
      alert(t('termsPage.acceptAlerts.failed'));
      e.target.checked = false;
    }
  };

  // ──────────────────────────────────────────────────────────
  // COPY DEEP LINK
  // ──────────────────────────────────────────────────────────

  const copyLink = (sectionKey) => {
    const url = `${window.location.origin}/terms#${sectionKey}`;
    navigator.clipboard.writeText(url);
    // Toast notification would go here
  };

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="terms-page terms-page-loading">
        <div className="terms-spinner">{t('termsPage.loading')}</div>
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

  return (
    <div className="terms-page">
      {/* Header */}
      <header className="terms-header">
        <div className="terms-header-content">
          <h1>{document?.title || 'Terms of Service'}</h1>
          <p className="terms-subtitle">
            Last updated: {document?.lastUpdated ? new Date(document.lastUpdated).toLocaleDateString() : 'Unknown'}
            {document?.version && ` • Version ${document.version}`}
          </p>
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="terms-container">
        {/* Sidebar: Table of Contents */}
        <aside className="terms-sidebar">
          <div className="terms-toc-header">
            <h3>Contents</h3>
          </div>
          <nav className="terms-toc">
            {sections.map((section) => (
              <a
                key={section.key}
                href={`#${section.key}`}
                className={`terms-toc-link ${selectedSection === section.key ? 'active' : ''}`}
                onClick={() => setSelectedSection(section.key)}
              >
                <span className="terms-toc-link-title">{section.title}</span>
                {section.isCritical && <span className="terms-critical-badge">Critical</span>}
              </a>
            ))}
          </nav>

          {/* Version History Link */}
          <div className="terms-sidebar-footer">
            <button className="terms-history-button" onClick={() => setShowDiffViewer(!showDiffViewer)}>
              <Clock size={16} />
              Version History
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="terms-content" ref={contentRef}>
          {/* Search Bar */}
          <div className="terms-search-container">
            <Search size={20} />
            <input
              type="text"
              className="terms-search-input"
              placeholder="Search terms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <span className="terms-search-results">
                {filteredSections.length} of {sections.length} sections
              </span>
            )}
          </div>

          {/* Sections */}
          <div className="terms-sections">
            {filteredSections.length === 0 ? (
              <div className="terms-no-results">
                <p>No sections match your search. Try different keywords.</p>
              </div>
            ) : (
              filteredSections.map((section, index) => (
                <section
                  key={section.key}
                  id={section.key}
                  className={`terms-section ${section.isCritical ? 'critical' : ''}`}
                >
                  {/* Section Header */}
                  <div className="terms-section-header">
                    <div className="terms-section-title-container">
                      <h2 className="terms-section-title">{section.title}</h2>
                      {section.isCritical && (
                        <span className="terms-critical-indicator">Critical Update</span>
                      )}
                    </div>
                    <button
                      className="terms-copy-link-button"
                      onClick={() => copyLink(section.key)}
                      title="Copy link to this section"
                    >
                      <Copy size={16} />
                    </button>
                  </div>

                  {/* Section Content */}
                  <div
                    className="terms-section-content"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeLegalHtml(section.content, searchQuery)
                    }}
                  />

                  {/* Section Divider */}
                  {index < filteredSections.length - 1 && <hr className="terms-section-divider" />}
                </section>
              ))
            )}
          </div>

          {/* Acceptance Section */}
          <div className="terms-acceptance-section">
            <div className="terms-acceptance-box">
              <div className="terms-acceptance-content">
                <h3>Do you agree to these terms?</h3>
                <p>By checking the box below, you acknowledge that you have read and agree to these terms of service.</p>
              </div>

              <label className="terms-acceptance-checkbox">
                <input
                  ref={acceptCheckboxRef}
                  type="checkbox"
                  disabled={scrollProgress < 95}
                  checked={userAccepted}
                  onChange={handleAccept}
                />
                <span>I have read and agree to the terms of service</span>
              </label>

              {scrollProgress < 95 && (
                <div className="terms-scroll-requirement">
                  <AlertCircle size={16} />
                  <span>Please scroll to the bottom to accept</span>
                  <div className="terms-progress-bar">
                    <div
                      className="terms-progress-fill"
                      style={{ width: `${scrollProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {userAccepted && (
                <div className="terms-accepted-confirmation">
                  <CheckCircle size={16} className="terms-check-icon" />
                  <span>You have accepted these terms</span>
                </div>
              )}
            </div>
          </div>

          {/* Legal Notice */}
          <div className="terms-legal-notice">
            <p>
              © {new Date().getFullYear()} OxSteed. All rights reserved. This document is legally binding
              and enforceable in accordance with applicable law.
            </p>
          </div>
        </main>
      </div>

      {/* Version Diff Viewer Modal */}
      {showDiffViewer && (
        <VersionDiffModal documentId={document?.id} onClose={() => setShowDiffViewer(false)} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// VERSION DIFF VIEWER COMPONENT
// ──────────────────────────────────────────────────────────

function VersionDiffModal({ documentId, onClose }) {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { data } = await api.get(`/legal/documents/${documentId}/history`);
        setVersions(data.versions || []);
        if (data.versions.length > 0) {
          setSelectedVersion(data.versions[0]);
        }
      } catch (err) {
        logger.error('Failed to load version history', { err });
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [documentId]);

  return (
    <div className="terms-modal-overlay" onClick={onClose}>
      <div className="terms-modal" onClick={(e) => e.stopPropagation()}>
        <div className="terms-modal-header">
          <h2>Version History</h2>
          <button className="terms-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="terms-modal-content">
          {loading ? (
            <p>Loading version history...</p>
          ) : (
            <div className="terms-versions-list">
              {versions.map((version) => (
                <div
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
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedVersion && (
          <div className="terms-modal-preview">
            <h3>{selectedVersion.title}</h3>
            <div className="terms-version-content">{selectedVersion.content}</div>
          </div>
        )}
      </div>
    </div>
  );
}
