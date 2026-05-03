import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import toast from 'react-hot-toast';
import '../styles/AccountTerminationPage.css';

export default function AccountTerminationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [expandedSection, setExpandedSection] = useState('overview');
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
    fetch('https://api.ipify.org?format=json')
      .then(res => res.json())
      .then(data => setIpAddress(data.ip))
      .catch(() => setIpAddress('N/A'));

    fetchAcceptanceHistory();
  }, []);

  const fetchAcceptanceHistory = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const res = await fetch('/api/legal/account_termination/history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAcceptanceHistory(data.history || []);
      }
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
      toast.error(t('accountTermination.errorCheckbox'));
      return;
    }

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error(t('accountTermination.errorNameRequired'));
      return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('/api/legal/account_termination/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          timestamp: new Date().toISOString(),
          ipAddress,
          userAgent,
          documentType: 'account_termination',
          versionNumber: 1,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to accept policy');
      }

      toast.success(t('accountTermination.successSignature'));
      fetchAcceptanceHistory();
      setFormData({ firstName: '', lastName: '', agreed: false });
    } catch (err) {
      toast.error(t('accountTermination.errorSubmit'));
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const canAccept = scrollProgress >= 95 && formData.agreed;

  const SECTIONS = [
    { id: 'overview', title: t('accountTermination.overviewTitle'), icon: '📋' },
    { id: 'grounds', title: t('accountTermination.groundsTitle'), icon: '⚖️' },
    { id: 'immediate-effect', title: t('accountTermination.immediateEffectTitle'), icon: '⚡' },
    { id: 'appeal', title: t('accountTermination.appealTitle'), icon: '📞' },
    { id: 'timeline', title: t('accountTermination.timelineTitle'), icon: '⏱️' },
    { id: 'data-deletion', title: t('accountTermination.dataDeletionTitle'), icon: '🗑️' },
  ];

  return (
    <PageShell>
      <PageMeta
        title={t('accountTermination.pageTitle')}
        description={t('accountTermination.pageDescription')}
      />

      <div className="termination-page-container">
        {/* Header */}
        <div className="termination-header">
          <h1>{t('accountTermination.pageTitle')}</h1>
          <p className="termination-version">
            {t('accountTermination.version')} 1.0 • {t('accountTermination.effectiveDate')} May 1, 2026
          </p>
        </div>

        <div className="termination-layout">
          {/* Sidebar */}
          <aside className="termination-sidebar">
            <div className="toc-header">
              <h3>{t('accountTermination.tableOfContents')}</h3>
            </div>

            {/* Search */}
            <div className="search-box">
              <input
                type="text"
                placeholder={t('accountTermination.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('accountTermination.searchAriaLabel')}
              />
              {searchQuery && (
                <span className="search-count">
                  {searchMatches.length} {t('accountTermination.matches')}
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
              {t('accountTermination.viewVersionHistory')}
            </button>

            {showVersionHistory && (
              <div className="version-history-modal">
                <h4>{t('accountTermination.acceptanceHistory')}</h4>
                {acceptanceHistory.length > 0 ? (
                  <ul className="history-list">
                    {acceptanceHistory.map((entry, idx) => (
                      <li key={idx} className="history-entry">
                        <div className="entry-date">
                          {new Date(entry.accepted_at).toLocaleDateString()} {new Date(entry.accepted_at).toLocaleTimeString()}
                        </div>
                        <div className="entry-signer">
                          {entry.first_name} {entry.last_name}
                        </div>
                        <div className="entry-version">v{entry.version_number}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-history">{t('accountTermination.noAcceptanceHistory')}</p>
                )}
              </div>
            )}
          </aside>

          {/* Main Content */}
          <main className="termination-main">
            <div className="termination-content" ref={contentRef}>
              {/* Overview Section */}
              <section
                data-section="overview"
                className={`content-section ${expandedSection === 'overview' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'overview' ? null : 'overview')}
                  aria-expanded={expandedSection === 'overview'}
                >
                  <span className="section-icon">📋</span>
                  <h2>{t('accountTermination.overviewTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'overview' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'overview' && (
                  <div className="section-content">
                    <p>{t('accountTermination.overviewBody')}</p>

                    <div className="callout-warning">
                      <span className="callout-icon">⚠️</span>
                      <p>{t('accountTermination.overviewWarning')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Grounds for Deactivation */}
              <section
                data-section="grounds"
                className={`content-section ${expandedSection === 'grounds' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'grounds' ? null : 'grounds')}
                  aria-expanded={expandedSection === 'grounds'}
                >
                  <span className="section-icon">⚖️</span>
                  <h2>{t('accountTermination.groundsTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'grounds' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'grounds' && (
                  <div className="section-content">
                    <p>{t('accountTermination.groundsBody')}</p>

                    <div className="grounds-grid">
                      <div className="ground-card">
                        <div className="ground-icon">📜</div>
                        <h4>{t('accountTermination.groundTnC')}</h4>
                        <p>{t('accountTermination.groundTnCDesc')}</p>
                      </div>

                      <div className="ground-card">
                        <div className="ground-icon">🔍</div>
                        <h4>{t('accountTermination.groundBackground')}</h4>
                        <p>{t('accountTermination.groundBackgroundDesc')}</p>
                      </div>

                      <div className="ground-card">
                        <div className="ground-icon">⚠️</div>
                        <h4>{t('accountTermination.groundDisputes')}</h4>
                        <p>{t('accountTermination.groundDisputesDesc')}</p>
                      </div>

                      <div className="ground-card">
                        <div className="ground-icon">😤</div>
                        <h4>{t('accountTermination.groundHarassment')}</h4>
                        <p>{t('accountTermination.groundHarassmentDesc')}</p>
                      </div>

                      <div className="ground-card">
                        <div className="ground-icon">🚨</div>
                        <h4>{t('accountTermination.groundSafety')}</h4>
                        <p>{t('accountTermination.groundSafetyDesc')}</p>
                      </div>

                      <div className="ground-card">
                        <div className="ground-icon">💳</div>
                        <h4>{t('accountTermination.groundFraud')}</h4>
                        <p>{t('accountTermination.groundFraudDesc')}</p>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Immediate Effect Section */}
              <section
                data-section="immediate-effect"
                className={`content-section ${expandedSection === 'immediate-effect' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'immediate-effect' ? null : 'immediate-effect')}
                  aria-expanded={expandedSection === 'immediate-effect'}
                >
                  <span className="section-icon">⚡</span>
                  <h2>{t('accountTermination.immediateEffectTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'immediate-effect' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'immediate-effect' && (
                  <div className="section-content">
                    <p>{t('accountTermination.immediateEffectBody')}</p>

                    <h4>{t('accountTermination.immediateEffects')}</h4>
                    <ul className="bullet-list">
                      <li>{t('accountTermination.immediateEffect1')}</li>
                      <li>{t('accountTermination.immediateEffect2')}</li>
                      <li>{t('accountTermination.immediateEffect3')}</li>
                      <li>{t('accountTermination.immediateEffect4')}</li>
                      <li>{t('accountTermination.immediateEffect5')}</li>
                    </ul>

                    <h4>{t('accountTermination.earningsHandling')}</h4>
                    <p>{t('accountTermination.earningsHandlingDesc')}</p>

                    <div className="callout-info">
                      <span className="callout-icon">ℹ️</span>
                      <p>{t('accountTermination.immediateEffectNote')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Appeal Section */}
              <section
                data-section="appeal"
                className={`content-section ${expandedSection === 'appeal' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'appeal' ? null : 'appeal')}
                  aria-expanded={expandedSection === 'appeal'}
                >
                  <span className="section-icon">📞</span>
                  <h2>{t('accountTermination.appealTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'appeal' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'appeal' && (
                  <div className="section-content">
                    <p>{t('accountTermination.appealBody')}</p>

                    <h4>{t('accountTermination.appealProcess')}</h4>
                    <ol className="numbered-list">
                      <li>{t('accountTermination.appealStep1')}</li>
                      <li>{t('accountTermination.appealStep2')}</li>
                      <li>{t('accountTermination.appealStep3')}</li>
                      <li>{t('accountTermination.appealStep4')}</li>
                      <li>{t('accountTermination.appealStep5')}</li>
                    </ol>

                    <h4>{t('accountTermination.appealWindow')}</h4>
                    <ul className="bullet-list">
                      <li>{t('accountTermination.appealWindow1')}</li>
                      <li>{t('accountTermination.appealWindow2')}</li>
                      <li>{t('accountTermination.appealWindow3')}</li>
                    </ul>

                    <div className="callout-info">
                      <span className="callout-icon">ℹ️</span>
                      <p>{t('accountTermination.appealNote')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Timeline Section */}
              <section
                data-section="timeline"
                className={`content-section ${expandedSection === 'timeline' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'timeline' ? null : 'timeline')}
                  aria-expanded={expandedSection === 'timeline'}
                >
                  <span className="section-icon">⏱️</span>
                  <h2>{t('accountTermination.timelineTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'timeline' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'timeline' && (
                  <div className="section-content">
                    <p>{t('accountTermination.timelineBody')}</p>

                    <div className="appeal-timeline">
                      <div className="timeline-step">
                        <div className="step-marker">Day 0</div>
                        <h4>{t('accountTermination.timelineStep1')}</h4>
                        <p>{t('accountTermination.timelineStep1Desc')}</p>
                      </div>

                      <div className="timeline-connector"></div>

                      <div className="timeline-step">
                        <div className="step-marker">Days 1-14</div>
                        <h4>{t('accountTermination.timelineStep2')}</h4>
                        <p>{t('accountTermination.timelineStep2Desc')}</p>
                      </div>

                      <div className="timeline-connector"></div>

                      <div className="timeline-step">
                        <div className="step-marker">Days 15-21</div>
                        <h4>{t('accountTermination.timelineStep3')}</h4>
                        <p>{t('accountTermination.timelineStep3Desc')}</p>
                      </div>

                      <div className="timeline-connector"></div>

                      <div className="timeline-step">
                        <div className="step-marker">Day 22+</div>
                        <h4>{t('accountTermination.timelineStep4')}</h4>
                        <p>{t('accountTermination.timelineStep4Desc')}</p>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Data Deletion Section */}
              <section
                data-section="data-deletion"
                className={`content-section ${expandedSection === 'data-deletion' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'data-deletion' ? null : 'data-deletion')}
                  aria-expanded={expandedSection === 'data-deletion'}
                >
                  <span className="section-icon">🗑️</span>
                  <h2>{t('accountTermination.dataDeletionTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'data-deletion' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'data-deletion' && (
                  <div className="section-content">
                    <p>{t('accountTermination.dataDeletionBody')}</p>

                    <h4>{t('accountTermination.dataRetained')}</h4>
                    <ul className="bullet-list">
                      <li>{t('accountTermination.dataRetained1')}</li>
                      <li>{t('accountTermination.dataRetained2')}</li>
                      <li>{t('accountTermination.dataRetained3')}</li>
                      <li>{t('accountTermination.dataRetained4')}</li>
                    </ul>

                    <h4>{t('accountTermination.dataDeleted')}</h4>
                    <ul className="bullet-list">
                      <li>{t('accountTermination.dataDeleted1')}</li>
                      <li>{t('accountTermination.dataDeleted2')}</li>
                      <li>{t('accountTermination.dataDeleted3')}</li>
                    </ul>

                    <div className="callout-info">
                      <span className="callout-icon">ℹ️</span>
                      <p>{t('accountTermination.dataDeletionNote')}</p>
                    </div>
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
                aria-label={t('accountTermination.scrollProgress')}
              />
            </div>

            {/* E-Signature Form */}
            <form className="signature-form" onSubmit={handleAcceptance}>
              <h3>{t('accountTermination.acceptanceTitle')}</h3>

              <div className="form-group">
                <label htmlFor="firstName" className="form-label">
                  {t('accountTermination.firstName')} <span aria-label="required">*</span>
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder={t('accountTermination.firstNamePlaceholder')}
                  required
                  aria-required="true"
                />
              </div>

              <div className="form-group">
                <label htmlFor="lastName" className="form-label">
                  {t('accountTermination.lastName')} <span aria-label="required">*</span>
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder={t('accountTermination.lastNamePlaceholder')}
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
                    ? t('accountTermination.scrollToAgree')
                    : t('accountTermination.iAgreeLabel')}
                </label>
              </div>

              <div className="form-meta">
                <p className="meta-line">
                  <strong>{t('accountTermination.timestamp')}:</strong> {new Date().toLocaleString()}
                </p>
                <p className="meta-line">
                  <strong>{t('accountTermination.ipAddress')}:</strong> {ipAddress}
                </p>
              </div>

              <button
                type="submit"
                className={`submit-btn ${canAccept ? 'enabled' : 'disabled'}`}
                disabled={!canAccept || isLoading}
                aria-busy={isLoading}
              >
                {isLoading
                  ? t('accountTermination.signingPlease')
                  : t('accountTermination.acknowledgePolicy')}
              </button>

              <p className="signature-note">{t('accountTermination.signatureNote')}</p>
            </form>
          </main>
        </div>
      </div>

    </PageShell>
  );
}
