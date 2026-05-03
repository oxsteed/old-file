import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import PageMeta from '../components/PageMeta';
import Footer from '../components/Footer';
import toast from 'react-hot-toast';
import '../styles/DisputeResolutionPage.css';

export default function DisputeResolutionPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [expandedSection, setExpandedSection] = useState('overview');
  const [expandedFaq, setExpandedFaq] = useState(null);
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

      const res = await fetch('/api/legal/dispute_resolution/history', {
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
      toast.error(t('disputeResolution.errorCheckbox'));
      return;
    }

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error(t('disputeResolution.errorNameRequired'));
      return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('/api/legal/dispute_resolution/accept', {
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
          documentType: 'dispute_resolution',
          versionNumber: 1,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to accept policy');
      }

      toast.success(t('disputeResolution.successSignature'));
      fetchAcceptanceHistory();
      setFormData({ firstName: '', lastName: '', agreed: false });
    } catch (err) {
      toast.error(t('disputeResolution.errorSubmit'));
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReportDispute = () => {
    navigate('/support?ticketType=dispute_refund');
  };

  const canAccept = scrollProgress >= 95 && formData.agreed;

  const SECTIONS = [
    { id: 'overview', title: t('disputeResolution.overviewTitle'), icon: '📋' },
    { id: 'refund-window', title: t('disputeResolution.refundWindowTitle'), icon: '⏰' },
    { id: 'dispute-types', title: t('disputeResolution.disputeTypesTitle'), icon: '🔍' },
    { id: 'process', title: t('disputeResolution.processTitle'), icon: '⚙️' },
    { id: 'escalation', title: t('disputeResolution.escalationTitle'), icon: '📈' },
    { id: 'chargeback', title: t('disputeResolution.chargebackTitle'), icon: '⚠️' },
  ];

  const FAQS = [
    {
      id: 'faq1',
      q: t('disputeResolution.faq1Q'),
      a: t('disputeResolution.faq1A'),
    },
    {
      id: 'faq2',
      q: t('disputeResolution.faq2Q'),
      a: t('disputeResolution.faq2A'),
    },
    {
      id: 'faq3',
      q: t('disputeResolution.faq3Q'),
      a: t('disputeResolution.faq3A'),
    },
    {
      id: 'faq4',
      q: t('disputeResolution.faq4Q'),
      a: t('disputeResolution.faq4A'),
    },
    {
      id: 'faq5',
      q: t('disputeResolution.faq5Q'),
      a: t('disputeResolution.faq5A'),
    },
    {
      id: 'faq6',
      q: t('disputeResolution.faq6Q'),
      a: t('disputeResolution.faq6A'),
    },
  ];

  return (
    <>
      <PageMeta
        title={t('disputeResolution.pageTitle')}
        description={t('disputeResolution.pageDescription')}
      />

      <div className="dispute-page-container">
        {/* Header */}
        <div className="dispute-header">
          <h1>{t('disputeResolution.pageTitle')}</h1>
          <p className="dispute-version">
            {t('disputeResolution.version')} 1.0 • {t('disputeResolution.effectiveDate')} May 1, 2026
          </p>
        </div>

        <div className="dispute-layout">
          {/* Sidebar */}
          <aside className="dispute-sidebar">
            <div className="toc-header">
              <h3>{t('disputeResolution.tableOfContents')}</h3>
            </div>

            {/* Search */}
            <div className="search-box">
              <input
                type="text"
                placeholder={t('disputeResolution.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('disputeResolution.searchAriaLabel')}
              />
              {searchQuery && (
                <span className="search-count">
                  {searchMatches.length} {t('disputeResolution.matches')}
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
              {t('disputeResolution.viewVersionHistory')}
            </button>

            {showVersionHistory && (
              <div className="version-history-modal">
                <h4>{t('disputeResolution.acceptanceHistory')}</h4>
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
                  <p className="no-history">{t('disputeResolution.noAcceptanceHistory')}</p>
                )}
              </div>
            )}

            {/* CTA Button */}
            <button className="report-dispute-btn" onClick={handleReportDispute}>
              {t('disputeResolution.reportDisputeBtn')}
            </button>
          </aside>

          {/* Main Content */}
          <main className="dispute-main">
            <div className="dispute-content" ref={contentRef}>
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
                  <h2>{t('disputeResolution.overviewTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'overview' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'overview' && (
                  <div className="section-content">
                    <p>{t('disputeResolution.overviewBody1')}</p>
                    <p>{t('disputeResolution.overviewBody2')}</p>

                    <div className="callout-info">
                      <span className="callout-icon">ℹ️</span>
                      <p>{t('disputeResolution.overviewCallout')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Refund Window Section */}
              <section
                data-section="refund-window"
                className={`content-section ${expandedSection === 'refund-window' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'refund-window' ? null : 'refund-window')}
                  aria-expanded={expandedSection === 'refund-window'}
                >
                  <span className="section-icon">⏰</span>
                  <h2>{t('disputeResolution.refundWindowTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'refund-window' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'refund-window' && (
                  <div className="section-content">
                    <p>{t('disputeResolution.refundWindowBody')}</p>

                    <div className="timeline-box">
                      <div className="timeline-item">
                        <div className="timeline-marker">Day 0</div>
                        <div className="timeline-content">
                          <h4>{t('disputeResolution.timelineJobComplete')}</h4>
                          <p>{t('disputeResolution.timelineJobCompleteDesc')}</p>
                        </div>
                      </div>

                      <div className="timeline-item">
                        <div className="timeline-marker">Days 1-30</div>
                        <div className="timeline-content">
                          <h4>{t('disputeResolution.timelineRefundWindow')}</h4>
                          <p>{t('disputeResolution.timelineRefundWindowDesc')}</p>
                        </div>
                      </div>

                      <div className="timeline-item">
                        <div className="timeline-marker">Day 31+</div>
                        <div className="timeline-content">
                          <h4>{t('disputeResolution.timelineNoRefund')}</h4>
                          <p>{t('disputeResolution.timelineNoRefundDesc')}</p>
                        </div>
                      </div>
                    </div>

                    <p className="terms-note">{t('disputeResolution.refundWindowNote')}</p>
                  </div>
                )}
              </section>

              {/* Dispute Types Section */}
              <section
                data-section="dispute-types"
                className={`content-section ${expandedSection === 'dispute-types' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'dispute-types' ? null : 'dispute-types')}
                  aria-expanded={expandedSection === 'dispute-types'}
                >
                  <span className="section-icon">🔍</span>
                  <h2>{t('disputeResolution.disputeTypesTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'dispute-types' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'dispute-types' && (
                  <div className="section-content">
                    <p>{t('disputeResolution.disputeTypesBody')}</p>

                    <div className="dispute-types-grid">
                      <div className="dispute-type-card">
                        <div className="type-icon">🏠</div>
                        <h4>{t('disputeResolution.typeQuality')}</h4>
                        <p>{t('disputeResolution.typeQualityDesc')}</p>
                      </div>

                      <div className="dispute-type-card">
                        <div className="type-icon">❌</div>
                        <h4>{t('disputeResolution.typeIncomplete')}</h4>
                        <p>{t('disputeResolution.typeIncompleteDesc')}</p>
                      </div>

                      <div className="dispute-type-card">
                        <div className="type-icon">🤕</div>
                        <h4>{t('disputeResolution.typeInjury')}</h4>
                        <p>{t('disputeResolution.typeInjuryDesc')}</p>
                      </div>

                      <div className="dispute-type-card">
                        <div className="type-icon">💳</div>
                        <h4>{t('disputeResolution.typePayment')}</h4>
                        <p>{t('disputeResolution.typePaymentDesc')}</p>
                      </div>

                      <div className="dispute-type-card">
                        <div className="type-icon">🔐</div>
                        <h4>{t('disputeResolution.typeSecurity')}</h4>
                        <p>{t('disputeResolution.typeSecurityDesc')}</p>
                      </div>

                      <div className="dispute-type-card">
                        <div className="type-icon">📋</div>
                        <h4>{t('disputeResolution.typeOther')}</h4>
                        <p>{t('disputeResolution.typeOtherDesc')}</p>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Process Section */}
              <section
                data-section="process"
                className={`content-section ${expandedSection === 'process' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'process' ? null : 'process')}
                  aria-expanded={expandedSection === 'process'}
                >
                  <span className="section-icon">⚙️</span>
                  <h2>{t('disputeResolution.processTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'process' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'process' && (
                  <div className="section-content">
                    <p>{t('disputeResolution.processBody')}</p>

                    <ol className="numbered-list">
                      <li>
                        <strong>{t('disputeResolution.processStep1')}</strong> - {t('disputeResolution.processStep1Desc')}
                      </li>
                      <li>
                        <strong>{t('disputeResolution.processStep2')}</strong> - {t('disputeResolution.processStep2Desc')}
                      </li>
                      <li>
                        <strong>{t('disputeResolution.processStep3')}</strong> - {t('disputeResolution.processStep3Desc')}
                      </li>
                      <li>
                        <strong>{t('disputeResolution.processStep4')}</strong> - {t('disputeResolution.processStep4Desc')}
                      </li>
                      <li>
                        <strong>{t('disputeResolution.processStep5')}</strong> - {t('disputeResolution.processStep5Desc')}
                      </li>
                    </ol>

                    <div className="callout-warning">
                      <span className="callout-icon">⚠️</span>
                      <p>{t('disputeResolution.processWarning')}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Escalation Section */}
              <section
                data-section="escalation"
                className={`content-section ${expandedSection === 'escalation' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'escalation' ? null : 'escalation')}
                  aria-expanded={expandedSection === 'escalation'}
                >
                  <span className="section-icon">📈</span>
                  <h2>{t('disputeResolution.escalationTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'escalation' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'escalation' && (
                  <div className="section-content">
                    <p>{t('disputeResolution.escalationBody')}</p>

                    <h4>{t('disputeResolution.escalationPath')}</h4>
                    <div className="escalation-path">
                      <div className="escalation-step">
                        <div className="step-number">1</div>
                        <div className="step-content">
                          <p className="step-title">{t('disputeResolution.escalationStep1')}</p>
                          <p className="step-desc">{t('disputeResolution.escalationStep1Desc')}</p>
                        </div>
                      </div>

                      <div className="escalation-arrow">→</div>

                      <div className="escalation-step">
                        <div className="step-number">2</div>
                        <div className="step-content">
                          <p className="step-title">{t('disputeResolution.escalationStep2')}</p>
                          <p className="step-desc">{t('disputeResolution.escalationStep2Desc')}</p>
                        </div>
                      </div>

                      <div className="escalation-arrow">→</div>

                      <div className="escalation-step">
                        <div className="step-number">3</div>
                        <div className="step-content">
                          <p className="step-title">{t('disputeResolution.escalationStep3')}</p>
                          <p className="step-desc">{t('disputeResolution.escalationStep3Desc')}</p>
                        </div>
                      </div>
                    </div>

                    <p className="terms-note">{t('disputeResolution.escalationNote')}</p>
                  </div>
                )}
              </section>

              {/* Chargeback Section */}
              <section
                data-section="chargeback"
                className={`content-section ${expandedSection === 'chargeback' ? 'expanded' : 'collapsed'}`}
              >
                <button
                  className="section-header"
                  onClick={() => setExpandedSection(expandedSection === 'chargeback' ? null : 'chargeback')}
                  aria-expanded={expandedSection === 'chargeback'}
                >
                  <span className="section-icon">⚠️</span>
                  <h2>{t('disputeResolution.chargebackTitle')}</h2>
                  <span className="expand-icon">{expandedSection === 'chargeback' ? '−' : '+'}</span>
                </button>

                {expandedSection === 'chargeback' && (
                  <div className="section-content">
                    <p>{t('disputeResolution.chargebackBody')}</p>

                    <div className="callout-warning">
                      <span className="callout-icon">⚠️</span>
                      <p>{t('disputeResolution.chargebackWarning')}</p>
                    </div>

                    <h4>{t('disputeResolution.chargebackFee')}</h4>
                    <p>{t('disputeResolution.chargebackFeeDesc')}</p>

                    <ul className="bullet-list">
                      <li>{t('disputeResolution.chargebackPoint1')}</li>
                      <li>{t('disputeResolution.chargebackPoint2')}</li>
                      <li>{t('disputeResolution.chargebackPoint3')}</li>
                      <li>{t('disputeResolution.chargebackPoint4')}</li>
                    </ul>
                  </div>
                )}
              </section>

              {/* FAQs Section */}
              <section className="faqs-section">
                <h3>{t('disputeResolution.faqsTitle')}</h3>

                <div className="faqs-container">
                  {FAQS.map((faq) => (
                    <div key={faq.id} className="faq-item">
                      <button
                        className="faq-question"
                        onClick={() => setExpandedFaq(expandedFaq === faq.id ? null : faq.id)}
                        aria-expanded={expandedFaq === faq.id}
                      >
                        <span className="faq-icon">{expandedFaq === faq.id ? '−' : '+'}</span>
                        <span>{faq.q}</span>
                      </button>

                      {expandedFaq === faq.id && (
                        <div className="faq-answer">
                          <p>{faq.a}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
                aria-label={t('disputeResolution.scrollProgress')}
              />
            </div>

            {/* E-Signature Form */}
            <form className="signature-form" onSubmit={handleAcceptance}>
              <h3>{t('disputeResolution.acceptanceTitle')}</h3>

              <div className="form-group">
                <label htmlFor="firstName" className="form-label">
                  {t('disputeResolution.firstName')} <span aria-label="required">*</span>
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder={t('disputeResolution.firstNamePlaceholder')}
                  required
                  aria-required="true"
                />
              </div>

              <div className="form-group">
                <label htmlFor="lastName" className="form-label">
                  {t('disputeResolution.lastName')} <span aria-label="required">*</span>
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder={t('disputeResolution.lastNamePlaceholder')}
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
                    ? t('disputeResolution.scrollToAgree')
                    : t('disputeResolution.iAgreeLabel')}
                </label>
              </div>

              <div className="form-meta">
                <p className="meta-line">
                  <strong>{t('disputeResolution.timestamp')}:</strong> {new Date().toLocaleString()}
                </p>
                <p className="meta-line">
                  <strong>{t('disputeResolution.ipAddress')}:</strong> {ipAddress}
                </p>
              </div>

              <button
                type="submit"
                className={`submit-btn ${canAccept ? 'enabled' : 'disabled'}`}
                disabled={!canAccept || isLoading}
                aria-busy={isLoading}
              >
                {isLoading
                  ? t('disputeResolution.signingPlease')
                  : t('disputeResolution.signPolicy')}
              </button>

              <p className="signature-note">{t('disputeResolution.signatureNote')}</p>
            </form>
          </main>
        </div>
      </div>

      <Footer />
    </>
  );
}
