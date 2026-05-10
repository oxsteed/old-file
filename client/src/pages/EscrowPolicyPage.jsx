import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, ChevronDown, ChevronUp, AlertCircle, Lock, CheckCircle } from 'lucide-react';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';


export default function EscrowPolicyPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFAQ, setExpandedFAQ] = useState(null);
  const [acceptanceChecked, setAcceptanceChecked] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signature, setSignature] = useState('');
  const [signatureSubmitted, setSignatureSubmitted] = useState(false);

  const pk = (suffix) => `escrowPolicy.${suffix}`;

  const escrowTimeline = [
    { stage: 1, label: t(pk('timeline.authorized')), time: 'Day 0', desc: t(pk('timeline.authorizedDesc')) },
    { stage: 2, label: t(pk('timeline.completed')), time: 'Day 0', desc: t(pk('timeline.completedDesc')) },
    { stage: 3, label: t(pk('timeline.released')), time: '3 business days', desc: t(pk('timeline.releasedDesc')) },
    { stage: 4, label: t(pk('timeline.received')), time: '5-7 business days', desc: t(pk('timeline.receivedDesc')) },
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
    {
      q: t(pk('faq.q7')),
      a: t(pk('faq.a7')),
    },
    {
      q: t(pk('faq.q8')),
      a: t(pk('faq.a8')),
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

  const handleSignatureSubmit = async (e) => {
    e.preventDefault();
    if (!signature.trim()) return;
    console.log('E-signature accepted for escrow policy:', { timestamp: new Date().toISOString(), signature });
    setSignatureSubmitted(true);
    setTimeout(() => {
      setShowSignature(false);
      setSignature('');
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
        <div className="bg-gradient-to-r from-emerald-600/20 via-emerald-500/10 to-transparent border-b border-gray-800">
          <div className="max-w-4xl mx-auto px-4 py-12 flex items-start gap-6">
            <div className="bg-emerald-500/20 p-4 rounded-xl shrink-0">
              <Lock className="w-10 h-10 text-emerald-400" />
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
                <a href="#mechanism" className="text-gray-400 hover:text-emerald-400 transition">
                  {t(pk('sections.mechanism'))}
                </a>
                <a href="#authorization" className="text-gray-400 hover:text-emerald-400 transition">
                  {t(pk('sections.authorization'))}
                </a>
                <a href="#ownership" className="text-gray-400 hover:text-emerald-400 transition">
                  {t(pk('sections.ownership'))}
                </a>
                <a href="#liability" className="text-gray-400 hover:text-emerald-400 transition">
                  {t(pk('sections.liability'))}
                </a>
                <a href="#release" className="text-gray-400 hover:text-emerald-400 transition">
                  {t(pk('sections.release'))}
                </a>
                <a href="#timeline" className="text-gray-400 hover:text-emerald-400 transition">
                  {t(pk('sections.timeline'))}
                </a>
                <a href="#faqs" className="text-gray-400 hover:text-emerald-400 transition">
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
                className="w-full mb-10 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30 transition"
                aria-label={t(pk('searchLabel'))}
              />

              {/* Section 1: Fund Holding Mechanism */}
              <section id="mechanism" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <DollarSign className="w-8 h-8 text-emerald-400" />
                  {t(pk('sections.mechanism'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('mechanism.intro')))}
                  </p>
                  <div className="bg-emerald-500/5 border border-emerald-900/30 rounded p-4">
                    <p className="text-gray-300 italic">
                      {highlightText(t(pk('mechanism.keyPoint')))}
                    </p>
                  </div>
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('mechanism.details')))}
                  </p>
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('mechanism.stripe')))}
                  </p>
                </div>
              </section>

              {/* Section 2: Authorization */}
              <section id="authorization" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.authorization'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('authorization.intro')))}
                  </p>
                  <div className="bg-blue-500/5 border border-blue-900/30 rounded p-4">
                    <h3 className="font-semibold text-blue-300 mb-2">
                      {t(pk('authorization.byChoosingTitle'))}
                    </h3>
                    <p className="text-gray-300">
                      {highlightText(t(pk('authorization.byChoosingDesc')))}
                    </p>
                  </div>
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('authorization.details')))}
                  </p>
                </div>
              </section>

              {/* Section 3: Fund Ownership */}
              <section id="ownership" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.ownership'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('ownership.intro')))}
                  </p>
                  <ul className="space-y-3 pl-6 list-disc">
                    <li className="text-gray-300">
                      <strong className="text-emerald-300">{t(pk('ownership.item1'))}</strong>
                      {' - '}
                      {highlightText(t(pk('ownership.item1Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-emerald-300">{t(pk('ownership.item2'))}</strong>
                      {' - '}
                      {highlightText(t(pk('ownership.item2Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-emerald-300">{t(pk('ownership.item3'))}</strong>
                      {' - '}
                      {highlightText(t(pk('ownership.item3Desc')))}
                    </li>
                  </ul>
                  <div className="bg-yellow-500/5 border border-yellow-900/30 rounded p-4">
                    <p className="text-yellow-200 font-semibold mb-2">
                      {t(pk('ownership.disclaimerTitle'))}
                    </p>
                    <p className="text-gray-300 text-sm">
                      {highlightText(t(pk('ownership.disclaimerDesc')))}
                    </p>
                  </div>
                </div>
              </section>

              {/* Section 4: OxSteed Liability */}
              <section id="liability" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <AlertCircle className="w-8 h-8 text-yellow-400" />
                  {t(pk('sections.liability'))}
                </h2>
                <div className="bg-yellow-500/5 border border-yellow-900/30 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('liability.intro')))}
                  </p>
                  <div className="bg-gray-900/50 rounded p-4 border border-gray-700">
                    <h3 className="font-semibold text-white mb-2">
                      {t(pk('liability.serviceInterruptionTitle'))}
                    </h3>
                    <p className="text-gray-300">
                      {highlightText(t(pk('liability.serviceInterruptionDesc')))}
                    </p>
                  </div>
                  <div className="bg-gray-900/50 rounded p-4 border border-gray-700">
                    <h3 className="font-semibold text-white mb-2">
                      {t(pk('liability.securityTitle'))}
                    </h3>
                    <p className="text-gray-300">
                      {highlightText(t(pk('liability.securityDesc')))}
                    </p>
                  </div>
                  <div className="bg-gray-900/50 rounded p-4 border border-gray-700">
                    <h3 className="font-semibold text-white mb-2">
                      {t(pk('liability.recoveryTitle'))}
                    </h3>
                    <p className="text-gray-300">
                      {highlightText(t(pk('liability.recoveryDesc')))}
                    </p>
                  </div>
                </div>
              </section>

              {/* Section 5: Release & Refunds */}
              <section id="release" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-emerald-400" />
                  {t(pk('sections.release'))}
                </h2>
                <div className="space-y-6">
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      {t(pk('release.jobCompletionTitle'))}
                    </h3>
                    <p className="text-gray-300 mb-4">
                      {highlightText(t(pk('release.jobCompletionDesc')))}
                    </p>
                    <div className="bg-emerald-500/5 border border-emerald-900/30 rounded p-4">
                      <p className="text-emerald-200 font-semibold">
                        {highlightText(t(pk('release.timeline')))}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      {t(pk('release.refundTitle'))}
                    </h3>
                    <p className="text-gray-300 mb-4">
                      {highlightText(t(pk('release.refundDesc')))}
                    </p>
                    <div className="bg-blue-500/5 border border-blue-900/30 rounded p-4">
                      <p className="text-gray-300">
                        <strong className="text-blue-300">{t(pk('release.processingTime'))}:</strong>
                        {' '}
                        {highlightText(t(pk('release.processingTimeDesc')))}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      {t(pk('release.disputeTitle'))}
                    </h3>
                    <p className="text-gray-300">
                      {highlightText(t(pk('release.disputeDesc')))}
                    </p>
                  </div>
                </div>
              </section>

              {/* Section 6: Important Notices */}
              <section id="timeline" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-8">
                  {t(pk('sections.timeline'))}
                </h2>
                <div className="relative">
                  <div className="space-y-8">
                    {escrowTimeline.map((item, index) => (
                      <div key={item.stage} className="flex gap-6 items-start">
                        <div className="flex flex-col items-center">
                          <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center font-bold text-white relative z-10">
                            {item.stage}
                          </div>
                          {index < escrowTimeline.length - 1 && (
                            <div className="w-1 h-16 bg-gradient-to-b from-emerald-600 to-gray-700 mt-2" />
                          )}
                        </div>
                        <div className="pt-2 flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-semibold text-white">{item.label}</h3>
                            <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-300">
                              {item.time}
                            </span>
                          </div>
                          <p className="text-gray-400">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Additional Important Notices */}
                <div className="mt-8 space-y-4">
                  <div className="bg-red-500/5 border border-red-900/30 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-red-300 mb-2">
                      {t(pk('notices.chargebackTitle'))}
                    </h3>
                    <p className="text-gray-300 mb-3">
                      {highlightText(t(pk('notices.chargebackDesc')))}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {highlightText(t(pk('notices.chargebackFee')))}
                    </p>
                  </div>

                  <div className="bg-purple-500/5 border border-purple-900/30 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-purple-300 mb-2">
                      {t(pk('notices.legalHoldTitle'))}
                    </h3>
                    <p className="text-gray-300">
                      {highlightText(t(pk('notices.legalHoldDesc')))}
                    </p>
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

              {/* Acceptance Section */}
              <section className="mb-12 bg-emerald-500/5 border border-emerald-900/30 rounded-lg p-8">
                <h2 className="text-2xl font-bold text-white mb-6">
                  {t(pk('acceptance.title'))}
                </h2>
                <div className="space-y-4">
                  <p className="text-gray-300">
                    {highlightText(t(pk('acceptance.intro')))}
                  </p>

                  <label className="flex items-start gap-3 p-4 bg-gray-900/50 border border-gray-700 rounded-lg hover:bg-gray-900 transition cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptanceChecked}
                      onChange={(e) => setAcceptanceChecked(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-600 text-emerald-600 focus:ring-2 focus:ring-emerald-400 mt-0.5"
                    />
                    <span className="text-gray-300">
                      {highlightText(t(pk('acceptance.checkbox')))}
                    </span>
                  </label>

                  {acceptanceChecked && !showSignature && (
                    <button
                      onClick={() => setShowSignature(true)}
                      className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition w-full"
                    >
                      {t(pk('acceptance.signBtn'))}
                    </button>
                  )}

                  {showSignature && (
                    <form onSubmit={handleSignatureSubmit} className="space-y-4 p-6 bg-gray-800/50 rounded-lg border border-gray-700">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          {t(pk('acceptance.form.signature'))}
                        </label>
                        <input
                          type="text"
                          required
                          value={signature}
                          onChange={(e) => setSignature(e.target.value)}
                          placeholder={t(pk('acceptance.form.signaturePlaceholder'))}
                          className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-emerald-400 font-serif text-lg"
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        {t(pk('acceptance.form.signatureNote'))}
                      </p>
                      <div className="flex gap-3">
                        <button
                          type="submit"
                          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold transition"
                        >
                          {t(pk('acceptance.form.submit'))}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowSignature(false)}
                          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-semibold transition"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  )}

                  {signatureSubmitted && (
                    <div className="p-4 bg-green-500/10 border border-green-600/30 rounded-lg">
                      <p className="text-green-300 font-semibold">
                        {t(pk('acceptance.successMsg'))}
                      </p>
                      <p className="text-gray-400 text-sm mt-2">
                        {highlightText(t(pk('acceptance.successDesc')))}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Contact Support */}
              <div className="bg-emerald-500/5 border border-emerald-900/30 rounded-lg p-6">
                <p className="text-gray-300 mb-4">
                  {t(pk('contactSupport.intro'))}
                </p>
                <a
                  href="/support/escalation"
                  className="inline-block px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition"
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
