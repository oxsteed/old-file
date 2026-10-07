import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { SuggestDropdown } from '../components/SuggestDropdown';
import '../admin/lib/suggestDropdownAdmin.css';
import toast from 'react-hot-toast';
import api from '../api/axios';
import '../styles/IndependentContractorPage.css';

export default function IndependentContractorPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [expandedSection, setExpandedSection] = useState('intro');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [acceptanceHistory, setAcceptanceHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const contentRef = useRef(null);
  const [ipAddress, setIpAddress] = useState('');
  const [userAgent, setUserAgent] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    firstName: user?.first_name || '',
    lastName: user?.last_name || '',
    agreed: false,
  });

  // Get IP address and user agent
  useEffect(() => {
    setUserAgent(navigator.userAgent);
    // In production, fetch from backend
    fetch('https://api.ipify.org?format=json')
      .then(res => res.json())
      .then(data => setIpAddress(data.ip))
      .catch(() => setIpAddress('N/A'));

    // Fetch acceptance history
    fetchAcceptanceHistory();
  }, []);

  const fetchAcceptanceHistory = async () => {
    try {
      if (!localStorage.getItem('user')) return;

      const { data } = await api.get('/legal/contractor_agreement/history');
      setAcceptanceHistory(data.history || []);
    } catch (err) {
      console.error('Failed to fetch acceptance history:', err);
    }
  };

  // Scroll listener
  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
      const totalScroll = scrollHeight - clientHeight;
      const progress = totalScroll > 0 ? (scrollTop / totalScroll) * 100 : 0;
      setScrollProgress(Math.min(progress, 100));
    };

    const ref = contentRef.current;
    if (ref) {
      ref.addEventListener('scroll', handleScroll);
      return () => ref.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      return;
    }

    const matches = [];
    const lowerQuery = searchQuery.toLowerCase();
    const sections = document.querySelectorAll('[data-section]');

    sections.forEach(section => {
      const text = section.textContent.toLowerCase();
      if (text.includes(lowerQuery)) {
        matches.push(section.getAttribute('data-section'));
      }
    });

    setSearchMatches(matches);
  }, [searchQuery]);

  const handleAcceptance = async (e) => {
    e.preventDefault();

    if (!formData.agreed) {
      toast.error(t('contractorAgreement.errorCheckbox'));
      return;
    }

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error(t('contractorAgreement.errorNameRequired'));
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/legal/contractor_agreement/accept', {
        firstName: formData.firstName,
        lastName: formData.lastName,
        timestamp: new Date().toISOString(),
        ipAddress,
        userAgent,
        documentType: 'contractor_agreement',
        versionNumber: 1,
      });

      toast.success(t('contractorAgreement.successSignature'));
      fetchAcceptanceHistory();
      setFormData({ firstName: '', lastName: '', agreed: false });
    } catch (err) {
      toast.error(t('contractorAgreement.errorSubmit'));
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const canAccept = scrollProgress >= 95 && formData.agreed;

  const SECTIONS = [
    {
      id: 'intro',
      title: t('contractorAgreement.introTitle'),
      icon: '📋',
    },
    {
      id: 'control',
      title: t('contractorAgreement.controlTitle'),
      icon: '🎯',
    },
    {
      id: 'income',
      title: t('contractorAgreement.incomeTitle'),
      icon: '💰',
    },
    {
      id: 'tools',
      title: t('contractorAgreement.toolsTitle'),
      icon: '🛠️',
    },
    {
      id: 'training',
      title: t('contractorAgreement.trainingTitle'),
      icon: '📚',
    },
    {
      id: 'termination',
      title: t('contractorAgreement.terminationTitle'),
      icon: '⏹️',
    },
    {
      id: 'taxes',
      title: t('contractorAgreement.taxesTitle'),
      icon: '🧾',
    },
    {
      id: '1099',
      title: t('contractorAgreement.1099Title'),
      icon: '📄',
    },
  ];

  // Typeahead items for the in-page search: every section heading.
  const sectionSuggestItems = useMemo(
    () => SECTIONS.map((section) => ({ id: section.id, title: section.title })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  const handleSectionSelect = (item) => {
    setSearchQuery(item.title || '');
    setExpandedSection(item.id);
    if (item.id) {
      document
        .querySelector(`[data-section="${item.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <PageShell>
      <PageMeta
        title={t('contractorAgreement.pageTitle')}
        description={t('contractorAgreement.pageDescription')}
      />

      <div className="contractor-page-container">
        {/* Header */}
        <div className="contractor-header">
          <h1>{t('contractorAgreement.pageTitle')}</h1>
          <p className="contractor-version">
            {t('contractorAgreement.version')} 1.0 • {t('contractorAgreement.effectiveDate')} May 1, 2026
          </p>
        </div>

        <div className="contractor-layout">
          {/* Sidebar TOC */}
          <aside className="contractor-sidebar">
            <div className="toc-header">
              <h3>{t('contractorAgreement.tableOfContents')}</h3>
            </div>

            {/* Search */}
            <div className="search-box">
              <SuggestDropdown
                id="contractor-agreement-section-search"
                className="sd-admin-adaptive"
                items={sectionSuggestItems}
                value={searchQuery}
                onQueryChange={setSearchQuery}
                onSelect={handleSectionSelect}
                recentsKey="oxsteed_contractor_agreement_search_recents"
                placeholder={t('contractorAgreement.searchPlaceholder')}
                ariaLabel={t('contractorAgreement.searchAriaLabel')}
              />
              {searchQuery && (
                <span className="search-count">
                  {searchMatches.length} {t('contractorAgreement.matches')}
                </span>
              )}
            </div>

            {/* TOC Links */}
            <nav className="toc-nav">
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  className={`toc-link ${expandedSection === section.id ? 'active' : ''} ${
                    searchMatches.includes(section.id) ? 'highlighted' : ''
                  }`}
                  onClick={() => setExpandedSection(section.id)}
                  aria-current={expandedSection === section.id ? 'true' : 'false'}
                >
                  <span className="toc-icon">{section.icon}</span>
                  <span className="toc-text">{section.title}</span>
                </button>
              ))}
            </nav>

            {/* Version History */}
            <button
              className="version-history-btn"
              onClick={() => setShowVersionHistory(!showVersionHistory)}
              aria-expanded={showVersionHistory}
            >
              {t('contractorAgreement.viewVersionHistory')}
            </button>

            {showVersionHistory && (
              <div className="version-history-modal">
                <h4>{t('contractorAgreement.acceptanceHistory')}</h4>
                {acceptanceHistory.length > 0 ? (
                  <ul className="history-list">
                    {acceptanceHistory.map((entry, idx) => (
                      <li key={idx} className="history-entry">
                        <div className="entry-date">
                          {new Date(entry.acceptedAt || entry.accepted_at).toLocaleDateString()} {new Date(entry.acceptedAt || entry.accepted_at).toLocaleTimeString()}
                        </div>
                        <div className="entry-signer">
                          {entry.firstName || entry.first_name} {entry.lastName || entry.last_name}
                        </div>
                        <div className="entry-version">v{entry.versionNumber || entry.version_number}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-history">{t('contractorAgreement.noAcceptanceHistory')}</p>
                )}
              </div>
            )}
          </aside>

          {/* Main Content */}
          <main className="contractor-main">
            <div className="contractor-content" ref={contentRef}>
              {/* Intro Section */}
              <section
                data-section="intro"
                className={`content-section ${expandedSection === 'intro' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'intro' ? null : 'intro')}
                  aria-expanded={expandedSection === 'intro'}
                >
                  <span className="section-icon">📋</span>
                  <h2>{t('contractorAgreement.introTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'intro' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'intro' && (
                  <div className="section-content">
                    <p>
                      {t('contractorAgreement.introBody1')}
                    </p>
                    <p>
                      {t('contractorAgreement.introBody2')}
                    </p>
                    <div className="callout-info">
                      <span className="callout-icon">ℹ️</span>
                      <p>{t('contractorAgreement.introCallout')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Control Section */}
              <section
                data-section="control"
                className={`content-section ${expandedSection === 'control' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'control' ? null : 'control')}
                  aria-expanded={expandedSection === 'control'}
                >
                  <span className="section-icon">🎯</span>
                  <h2>{t('contractorAgreement.controlTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'control' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'control' && (
                  <div className="section-content">
                    <h3>{t('contractorAgreement.controlSubtitle')}</h3>
                    <p>{t('contractorAgreement.controlBody')}</p>
                    <ul className="numbered-list">
                      <li>{t('contractorAgreement.controlPoint1')}</li>
                      <li>{t('contractorAgreement.controlPoint2')}</li>
                      <li>{t('contractorAgreement.controlPoint3')}</li>
                      <li>{t('contractorAgreement.controlPoint4')}</li>
                    </ul>

                    {/* State Callouts */}
                    <div className="state-callout ca">
                      <strong>🌴 California (AB5):</strong>
                      <p>{t('contractorAgreement.caCallout')}</p>
                    </div>

                    <div className="state-callout ny">
                      <strong>🗽 New York:</strong>
                      <p>{t('contractorAgreement.nyCallout')}</p>
                    </div>

                    <div className="state-callout ma">
                      <strong>🍂 Massachusetts:</strong>
                      <p>{t('contractorAgreement.maCallout')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Income Section */}
              <section
                data-section="income"
                className={`content-section ${expandedSection === 'income' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'income' ? null : 'income')}
                  aria-expanded={expandedSection === 'income'}
                >
                  <span className="section-icon">💰</span>
                  <h2>{t('contractorAgreement.incomeTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'income' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'income' && (
                  <div className="section-content">
                    <h3>{t('contractorAgreement.incomeSubtitle')}</h3>
                    <p>{t('contractorAgreement.incomeBody1')}</p>
                    <p>{t('contractorAgreement.incomeBody2')}</p>

                    <table className="terms-table">
                      <thead>
                        <tr>
                          <th>{t('contractorAgreement.tier')}</th>
                          <th>{t('contractorAgreement.platformFee')}</th>
                          <th>{t('contractorAgreement.yourEarnings')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{t('contractorAgreement.tierFree')}</td>
                          <td>20%</td>
                          <td>80%</td>
                        </tr>
                        <tr>
                          <td>{t('contractorAgreement.tierPro')}</td>
                          <td>15%</td>
                          <td>85%</td>
                        </tr>
                        <tr>
                          <td>{t('contractorAgreement.tierEnterprise')}</td>
                          <td>{t('contractorAgreement.negotiable')}</td>
                          <td>{t('contractorAgreement.custom')}</td>
                        </tr>
                      </tbody>
                    </table>

                    <p className="terms-note">
                      {t('contractorAgreement.incomeNote')}
                    </p>
                  </div>
                )}
              </section>

              {/* Tools Section */}
              <section
                data-section="tools"
                className={`content-section ${expandedSection === 'tools' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'tools' ? null : 'tools')}
                  aria-expanded={expandedSection === 'tools'}
                >
                  <span className="section-icon">🛠️</span>
                  <h2>{t('contractorAgreement.toolsTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'tools' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'tools' && (
                  <div className="section-content">
                    <h3>{t('contractorAgreement.toolsSubtitle')}</h3>
                    <p>{t('contractorAgreement.toolsBody')}</p>
                    <ul className="bullet-list">
                      <li>{t('contractorAgreement.toolsPoint1')}</li>
                      <li>{t('contractorAgreement.toolsPoint2')}</li>
                      <li>{t('contractorAgreement.toolsPoint3')}</li>
                    </ul>

                    <div className="callout-warning">
                      <span className="callout-icon">⚠️</span>
                      <p>{t('contractorAgreement.toolsWarning')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Training Section */}
              <section
                data-section="training"
                className={`content-section ${expandedSection === 'training' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'training' ? null : 'training')}
                  aria-expanded={expandedSection === 'training'}
                >
                  <span className="section-icon">📚</span>
                  <h2>{t('contractorAgreement.trainingTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'training' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'training' && (
                  <div className="section-content">
                    <h3>{t('contractorAgreement.trainingSubtitle')}</h3>
                    <p>{t('contractorAgreement.trainingBody')}</p>
                    <ul className="numbered-list">
                      <li>{t('contractorAgreement.trainingPoint1')}</li>
                      <li>{t('contractorAgreement.trainingPoint2')}</li>
                      <li>{t('contractorAgreement.trainingPoint3')}</li>
                    </ul>
                  </div>
                )}
              </section>

              {/* Termination Section */}
              <section
                data-section="termination"
                className={`content-section ${expandedSection === 'termination' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'termination' ? null : 'termination')}
                  aria-expanded={expandedSection === 'termination'}
                >
                  <span className="section-icon">⏹️</span>
                  <h2>{t('contractorAgreement.terminationTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'termination' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'termination' && (
                  <div className="section-content">
                    <h3>{t('contractorAgreement.terminationSubtitle')}</h3>
                    <p>{t('contractorAgreement.terminationBody')}</p>
                    <p>{t('contractorAgreement.terminationBody2')}</p>

                    <h4>{t('contractorAgreement.causesTermination')}</h4>
                    <ul className="bullet-list">
                      <li>{t('contractorAgreement.terminationCause1')}</li>
                      <li>{t('contractorAgreement.terminationCause2')}</li>
                      <li>{t('contractorAgreement.terminationCause3')}</li>
                      <li>{t('contractorAgreement.terminationCause4')}</li>
                    </ul>
                  </div>
                )}
              </section>

              {/* Taxes Section */}
              <section
                data-section="taxes"
                className={`content-section ${expandedSection === 'taxes' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'taxes' ? null : 'taxes')}
                  aria-expanded={expandedSection === 'taxes'}
                >
                  <span className="section-icon">🧾</span>
                  <h2>{t('contractorAgreement.taxesTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'taxes' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'taxes' && (
                  <div className="section-content">
                    <h3>{t('contractorAgreement.taxesSubtitle')}</h3>
                    <p>{t('contractorAgreement.taxesBody')}</p>

                    <h4>{t('contractorAgreement.yourTaxResponsibilities')}</h4>
                    <ul className="numbered-list">
                      <li>{t('contractorAgreement.taxPoint1')}</li>
                      <li>{t('contractorAgreement.taxPoint2')}</li>
                      <li>{t('contractorAgreement.taxPoint3')}</li>
                      <li>{t('contractorAgreement.taxPoint4')}</li>
                    </ul>

                    <div className="callout-info">
                      <span className="callout-icon">ℹ️</span>
                      <p>{t('contractorAgreement.taxesCallout')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* 1099-NEC Section */}
              <section
                data-section="1099"
                className={`content-section ${expandedSection === '1099' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === '1099' ? null : '1099')}
                  aria-expanded={expandedSection === '1099'}
                >
                  <span className="section-icon">📄</span>
                  <h2>{t('contractorAgreement.1099Title')}</h2>
                  <span className="expand-icon">{expandedSection === '1099' ? '−' : '+'}</span>
                </button>

                {expandedSection === '1099' && (
                  <div className="section-content">
                    <h3>{t('contractorAgreement.1099Subtitle')}</h3>
                    <p>{t('contractorAgreement.1099Body1')}</p>

                    <h4>{t('contractorAgreement.howItWorks')}</h4>
                    <ol className="numbered-list">
                      <li>{t('contractorAgreement.1099Point1')}</li>
                      <li>{t('contractorAgreement.1099Point2')}</li>
                      <li>{t('contractorAgreement.1099Point3')}</li>
                      <li>{t('contractorAgreement.1099Point4')}</li>
                    </ol>

                    <p className="terms-note">{t('contractorAgreement.1099Note')}</p>
                  </div>
                )}
              </section>
            </div>

            {/* Scroll Progress Indicator */}
            <div className="scroll-progress">
              <div
                className="scroll-bar"
                style={{ width: `${scrollProgress}%` }}
                role="progressbar"
                aria-valuenow={Math.round(scrollProgress)}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label={t('contractorAgreement.scrollProgress')}
              />
            </div>

            {/* E-Signature Form */}
            <form className="signature-form" onSubmit={handleAcceptance}>
              <h3>{t('contractorAgreement.acceptanceTitle')}</h3>

              <div className="form-group">
                <label htmlFor="firstName" className="form-label">
                  {t('contractorAgreement.firstName')} <span aria-label="required">*</span>
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder={t('contractorAgreement.firstNamePlaceholder')}
                  required
                  aria-required="true"
                />
              </div>

              <div className="form-group">
                <label htmlFor="lastName" className="form-label">
                  {t('contractorAgreement.lastName')} <span aria-label="required">*</span>
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder={t('contractorAgreement.lastNamePlaceholder')}
                  required
                  aria-required="true"
                />
              </div>

              <div className="form-group checkbox">
                <input
                  id="agreed"
                  type="checkbox"
                  checked={formData.agreed}
                  onChange={(e) => setFormData({ ...formData, agreed: e.target.checked })}
                  disabled={scrollProgress < 95}
                  aria-required="true"
                />
                <label htmlFor="agreed">
                  {scrollProgress < 95
                    ? t('contractorAgreement.scrollToAgree')
                    : t('contractorAgreement.iAgreeLabel')}
                </label>
              </div>

              <div className="form-meta">
                <p className="meta-line">
                  <strong>{t('contractorAgreement.timestamp')}:</strong> {new Date().toLocaleString()}
                </p>
                <p className="meta-line">
                  <strong>{t('contractorAgreement.ipAddress')}:</strong> {ipAddress}
                </p>
              </div>

              <button
                type="submit"
                className={`submit-btn ${canAccept ? 'enabled' : 'disabled'}`}
                disabled={!canAccept || isLoading}
                aria-busy={isLoading}
              >
                {isLoading
                  ? t('contractorAgreement.signingPlease')
                  : t('contractorAgreement.signAgreement')}
              </button>

              <p className="signature-note">{t('contractorAgreement.signatureNote')}</p>
            </form>
          </main>
        </div>
      </div>

    </PageShell>
  );
}
