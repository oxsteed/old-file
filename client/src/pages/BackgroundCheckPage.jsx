import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, ChevronDown, ChevronUp, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';

const SECTION_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export default function BackgroundCheckPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFAQ, setExpandedFAQ] = useState(null);
  const [showAppealForm, setShowAppealForm] = useState(false);
  const [appealForm, setAppealForm] = useState({
    email: '',
    reason: '',
    evidence: ''
  });
  const [appealSubmitted, setAppealSubmitted] = useState(false);

  const pk = (suffix) => `backgroundCheck.${suffix}`;

  const disqualifyingFactors = [
    { id: 1, crime: t(pk('disqualifying.violent')), examples: '1st or 2nd degree murder, assault, aggravated assault' },
    { id: 2, crime: t(pk('disqualifying.sexual')), examples: 'Sexual assault, child sexual abuse, indecent exposure' },
    { id: 3, crime: t(pk('disqualifying.felony')), examples: 'Any felony within the past 7 years' },
    { id: 4, crime: t(pk('disqualifying.sex_offender')), examples: 'Registered sex offender in any jurisdiction' },
    { id: 5, crime: t(pk('disqualifying.theft')), examples: 'Theft, burglary, robbery within past 5 years' },
    { id: 6, crime: t(pk('disqualifying.drugs')), examples: 'Drug trafficking, distribution (any timeline)' },
    { id: 7, crime: t(pk('disqualifying.fraud')), examples: 'Identity theft, fraud, forgery within past 7 years' },
  ];

  const timelineSteps = [
    { step: 1, label: t(pk('timeline.submitted')), description: t(pk('timeline.submitted_desc')) },
    { step: 2, label: t(pk('timeline.initiated')), description: t(pk('timeline.initiated_desc')) },
    { step: 3, label: t(pk('timeline.received')), description: t(pk('timeline.received_desc')) },
    { step: 4, label: t(pk('timeline.result')), description: t(pk('timeline.result_desc')) },
    { step: 5, label: t(pk('timeline.appeal')), description: t(pk('timeline.appeal_desc')) },
  ];

  const faqs = [
    {
      q: t(pk('faq.q1')),
      a: t(pk('faq.a1')),
    },
    {
      q: t(pk('faq.q2')),
      a: t(pk('faq.a2')),
    },
    {
      q: t(pk('faq.q3')),
      a: t(pk('faq.a3')),
    },
    {
      q: t(pk('faq.q4')),
      a: t(pk('faq.a4')),
    },
    {
      q: t(pk('faq.q5')),
      a: t(pk('faq.a5')),
    },
    {
      q: t(pk('faq.q6')),
      a: t(pk('faq.a6')),
    },
  ];

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const highlightText = (text) => {
    if (!normalizedQuery || !text) return text;
    const parts = text.split(new RegExp(`(${normalizedQuery})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === normalizedQuery ? (
        <mark key={i} className="bg-yellow-500/40 text-yellow-100 font-semibold">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const handleAppealSubmit = async (e) => {
    e.preventDefault();
    // In production, this would submit to /api/support with ticket_type: 'background_check_appeal'
    console.log('Appeal submitted:', appealForm);
    setAppealSubmitted(true);
    setTimeout(() => {
      setShowAppealForm(false);
      setAppealSubmitted(false);
      setAppealForm({ email: '', reason: '', evidence: '' });
    }, 3000);
  };

  return (
    <PageShell>
      <PageMeta
        title={t(pk('title'))}
        description={t(pk('description'))}
      />

      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-300 flex flex-col">
        {/* Hero Section */}
        <div className="bg-gradient-to-r from-blue-600/20 via-blue-500/10 to-transparent border-b border-gray-800">
          <div className="max-w-4xl mx-auto px-4 py-12 flex items-start gap-6">
            <div className="bg-blue-500/20 p-4 rounded-xl shrink-0">
              <Shield className="w-10 h-10 text-blue-400" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">{t(pk('title'))}</h1>
              <p className="text-gray-400 text-lg mb-4">{t(pk('subtitle'))}</p>
              <p className="text-gray-500 text-sm">{t(pk('lastUpdated'))}</p>
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="max-w-6xl mx-auto px-4 py-12 flex gap-10 items-start">
            {/* Sidebar TOC */}
            <aside className="sticky top-20 shrink-0 w-52 max-lg:hidden">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
                {t(pk('onThisPage'))}
              </p>
              <nav className="flex flex-col gap-2 text-sm">
                <a href="#what-we-check" className="text-gray-400 hover:text-blue-400 transition">
                  {t(pk('sections.whatWeCheck'))}
                </a>
                <a href="#disqualifying" className="text-gray-400 hover:text-blue-400 transition">
                  {t(pk('sections.disqualifying'))}
                </a>
                <a href="#our-process" className="text-gray-400 hover:text-blue-400 transition">
                  {t(pk('sections.ourProcess'))}
                </a>
                <a href="#if-denied" className="text-gray-400 hover:text-blue-400 transition">
                  {t(pk('sections.ifDenied'))}
                </a>
                <a href="#appeal" className="text-gray-400 hover:text-blue-400 transition">
                  {t(pk('sections.appeal'))}
                </a>
                <a href="#timeline" className="text-gray-400 hover:text-blue-400 transition">
                  {t(pk('sections.timeline'))}
                </a>
                <a href="#faqs" className="text-gray-400 hover:text-blue-400 transition">
                  {t(pk('sections.faqs'))}
                </a>
              </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              {/* Search */}
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t(pk('searchPlaceholder'))}
                className="w-full mb-10 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition"
                aria-label={t(pk('searchLabel'))}
              />

              {/* Section 1: What We Check */}
              <section id="what-we-check" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-blue-400" />
                  {t(pk('sections.whatWeCheck'))}
                </h2>
                <div className="prose prose-invert max-w-none space-y-4">
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('whatWeCheck.intro')))}
                  </p>
                  <ul className="space-y-3 pl-6">
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('whatWeCheck.item1'))}</strong>
                      {' - '}
                      {highlightText(t(pk('whatWeCheck.item1_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('whatWeCheck.item2'))}</strong>
                      {' - '}
                      {highlightText(t(pk('whatWeCheck.item2_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('whatWeCheck.item3'))}</strong>
                      {' - '}
                      {highlightText(t(pk('whatWeCheck.item3_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('whatWeCheck.item4'))}</strong>
                      {' - '}
                      {highlightText(t(pk('whatWeCheck.item4_desc')))}
                    </li>
                  </ul>
                </div>
              </section>

              {/* Section 2: Disqualifying Factors */}
              <section id="disqualifying" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                  {t(pk('sections.disqualifying'))}
                </h2>
                <div className="bg-red-500/5 border border-red-900/30 rounded-lg p-6 mb-8">
                  <p className="text-gray-300 mb-6">
                    {highlightText(t(pk('disqualifying.intro')))}
                  </p>
                  <div className="space-y-4">
                    {disqualifyingFactors.map((factor) => (
                      <div
                        key={factor.id}
                        className="bg-gray-900/50 border border-gray-700 rounded p-4 hover:border-red-500/30 transition"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 bg-red-400 rounded-full mt-2 shrink-0" />
                          <div className="flex-1">
                            <h4 className="font-semibold text-white mb-1">
                              {highlightText(factor.crime)}
                            </h4>
                            <p className="text-sm text-gray-400">
                              {t(pk('disqualifying.examples'))}: {highlightText(factor.examples)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-blue-500/5 border border-blue-900/30 rounded-lg p-4">
                  <p className="text-sm text-gray-300">
                    <strong>{t(pk('disqualifying.note'))}:</strong> {highlightText(t(pk('disqualifying.noteDesc')))}
                  </p>
                </div>
              </section>

              {/* Section 3: Our Process */}
              <section id="our-process" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <Clock className="w-8 h-8 text-green-400" />
                  {t(pk('sections.ourProcess'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 mb-6">
                  <p className="text-gray-300 mb-4">{highlightText(t(pk('process.intro')))}</p>
                  <ol className="space-y-4 pl-6 list-decimal">
                    <li className="text-gray-300">
                      <strong className="text-green-300">{t(pk('process.step1'))}</strong>
                      {' - '}
                      {highlightText(t(pk('process.step1_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-green-300">{t(pk('process.step2'))}</strong>
                      {' - '}
                      {highlightText(t(pk('process.step2_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-green-300">{t(pk('process.step3'))}</strong>
                      {' - '}
                      {highlightText(t(pk('process.step3_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-green-300">{t(pk('process.step4'))}</strong>
                      {' - '}
                      {highlightText(t(pk('process.step4_desc')))}
                    </li>
                  </ol>
                </div>
              </section>

              {/* Section 4: If Denied */}
              <section id="if-denied" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.ifDenied'))}
                </h2>
                <div className="space-y-6">
                  <div className="bg-gray-900/50 border border-yellow-900/30 rounded-lg p-6">
                    <h3 className="text-xl font-semibold text-yellow-300 mb-4">
                      {t(pk('ifDenied.adverseNotice'))}
                    </h3>
                    <p className="text-gray-300 mb-4">
                      {highlightText(t(pk('ifDenied.adverseIntro')))}
                    </p>
                    <div className="bg-gray-800/50 rounded p-4 my-4 border-l-4 border-yellow-400">
                      <p className="text-gray-300 italic mb-2">
                        {t(pk('ifDenied.adverseExample'))}
                      </p>
                      <p className="text-gray-400 text-sm">
                        {highlightText(t(pk('ifDenied.adverseNote')))}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      {t(pk('ifDenied.disputeTitle'))}
                    </h3>
                    <p className="text-gray-300 mb-4">
                      {highlightText(t(pk('ifDenied.disputeDesc')))}
                    </p>
                    <a
                      href="https://www.checkr.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold transition"
                    >
                      {t(pk('ifDenied.viewCheckr'))}
                    </a>
                  </div>
                </div>
              </section>

              {/* Section 5: Appeal Process */}
              <section id="appeal" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.appeal'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 mb-6">
                  <p className="text-gray-300 mb-6">
                    {highlightText(t(pk('appeal.intro')))}
                  </p>
                  <ol className="space-y-4 pl-6 list-decimal mb-6">
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('appeal.step1'))}</strong>
                      {' - '}
                      {highlightText(t(pk('appeal.step1_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('appeal.step2'))}</strong>
                      {' - '}
                      {highlightText(t(pk('appeal.step2_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('appeal.step3'))}</strong>
                      {' - '}
                      {highlightText(t(pk('appeal.step3_desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('appeal.step4'))}</strong>
                      {' - '}
                      {highlightText(t(pk('appeal.step4_desc')))}
                    </li>
                  </ol>

                  {!showAppealForm && !appealSubmitted && (
                    <button
                      onClick={() => setShowAppealForm(true)}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                    >
                      {t(pk('appeal.submitBtn'))}
                    </button>
                  )}

                  {showAppealForm && (
                    <form onSubmit={handleAppealSubmit} className="mt-6 space-y-4 p-6 bg-gray-800/50 rounded-lg border border-gray-700">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          {t(pk('appeal.form.email'))}
                        </label>
                        <input
                          type="email"
                          required
                          value={appealForm.email}
                          onChange={(e) => setAppealForm({ ...appealForm, email: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-400"
                          placeholder="your@email.com"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          {t(pk('appeal.form.reason'))}
                        </label>
                        <textarea
                          required
                          value={appealForm.reason}
                          onChange={(e) => setAppealForm({ ...appealForm, reason: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-400 resize-none"
                          rows="4"
                          placeholder={t(pk('appeal.form.reasonPlaceholder'))}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          {t(pk('appeal.form.evidence'))} ({t('common.optional')})
                        </label>
                        <textarea
                          value={appealForm.evidence}
                          onChange={(e) => setAppealForm({ ...appealForm, evidence: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-400 resize-none"
                          rows="4"
                          placeholder={t(pk('appeal.form.evidencePlaceholder'))}
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="submit"
                          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold transition"
                        >
                          {t(pk('appeal.form.submit'))}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAppealForm(false)}
                          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-semibold transition"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  )}

                  {appealSubmitted && (
                    <div className="mt-6 p-4 bg-green-500/10 border border-green-600/30 rounded-lg">
                      <p className="text-green-300 font-semibold">
                        {t(pk('appeal.successMsg'))}
                      </p>
                      <p className="text-gray-400 text-sm mt-2">
                        {highlightText(t(pk('appeal.successDesc')))}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Section 6: Timeline */}
              <section id="timeline" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-8">
                  {t(pk('sections.timeline'))}
                </h2>
                <div className="relative">
                  <div className="space-y-8">
                    {timelineSteps.map((item, index) => (
                      <div key={item.step} className="flex gap-6 items-start">
                        <div className="flex flex-col items-center">
                          <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center font-bold text-white relative z-10">
                            {item.step}
                          </div>
                          {index < timelineSteps.length - 1 && (
                            <div className="w-1 h-16 bg-gradient-to-b from-blue-600 to-gray-700 mt-2" />
                          )}
                        </div>
                        <div className="pt-2">
                          <h3 className="text-lg font-semibold text-white mb-2">{item.label}</h3>
                          <p className="text-gray-400">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Section 7: FAQs */}
              <section id="faqs" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-8">
                  {t(pk('sections.faqs'))}
                </h2>
                <div className="space-y-4">
                  {faqs.map((faq, index) => (
                    <div
                      key={index}
                      className="bg-gray-900/50 border border-gray-700 rounded-lg overflow-hidden hover:border-gray-600 transition"
                    >
                      <button
                        onClick={() => setExpandedFAQ(expandedFAQ === index ? null : index)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-800/50 transition text-left"
                      >
                        <h4 className="font-semibold text-white">
                          {highlightText(faq.q)}
                        </h4>
                        {expandedFAQ === index ? (
                          <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
                        )}
                      </button>
                      {expandedFAQ === index && (
                        <div className="px-6 py-4 bg-gray-950/50 border-t border-gray-700 text-gray-300">
                          {highlightText(faq.a)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Contact Support */}
              <div className="bg-blue-500/5 border border-blue-900/30 rounded-lg p-6 mt-12">
                <p className="text-gray-300 mb-4">
                  {t(pk('contactSupport.intro'))}
                </p>
                <a
                  href="/support"
                  className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                >
                  {t(pk('contactSupport.btn'))}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
