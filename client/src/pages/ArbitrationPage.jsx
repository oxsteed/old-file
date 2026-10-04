import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Scale, ChevronDown, ChevronUp, AlertTriangle, FileText } from 'lucide-react';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import { SuggestDropdown } from '../components/SuggestDropdown';


export default function ArbitrationPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedState, setExpandedState] = useState(null);
  const [acceptanceChecked, setAcceptanceChecked] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signature, setSignature] = useState('');
  const [signatureSubmitted, setSignatureSubmitted] = useState(false);

  const pk = (suffix) => `arbitration.${suffix}`;

  const stateDisclaimers = [
    {
      state: 'CA',
      title: t(pk('stateDisclaimers.ca.title')),
      content: [
        t(pk('stateDisclaimers.ca.point1')),
        t(pk('stateDisclaimers.ca.point2')),
        t(pk('stateDisclaimers.ca.point3')),
      ],
    },
    {
      state: 'NY',
      title: t(pk('stateDisclaimers.ny.title')),
      content: [
        t(pk('stateDisclaimers.ny.point1')),
        t(pk('stateDisclaimers.ny.point2')),
        t(pk('stateDisclaimers.ny.point3')),
      ],
    },
    {
      state: 'MA',
      title: t(pk('stateDisclaimers.ma.title')),
      content: [
        t(pk('stateDisclaimers.ma.point1')),
        t(pk('stateDisclaimers.ma.point2')),
        t(pk('stateDisclaimers.ma.point3')),
      ],
    },
  ];

  const arbitrationTimeline = [
    { phase: 1, label: t(pk('timeline.phase1')), days: 'Within 30 days', desc: t(pk('timeline.phase1Desc')) },
    { phase: 2, label: t(pk('timeline.phase2')), days: 'Within 60 days', desc: t(pk('timeline.phase2Desc')) },
    { phase: 3, label: t(pk('timeline.phase3')), days: 'Within 120 days', desc: t(pk('timeline.phase3Desc')) },
    { phase: 4, label: t(pk('timeline.phase4')), days: '120+ days', desc: t(pk('timeline.phase4Desc')) },
  ];

  const normalizedQuery = searchQuery.trim().toLowerCase();

  // Typeahead items for the in-page search: every section heading.
  const sectionSuggestItems = useMemo(
    () => [
      { id: 'binding-arbitration', title: t(pk('sections.bindingArbitration')) },
      { id: 'process', title: t(pk('sections.process')) },
      { id: 'fees', title: t(pk('sections.fees')) },
      { id: 'class-action', title: t(pk('sections.classAction')) },
      { id: 'exceptions', title: t(pk('sections.exceptions')) },
      { id: 'limitation', title: t(pk('sections.limitation')) },
      { id: 'state-disclaimers', title: t(pk('sections.stateDisclaimers')) },
      { id: 'initiate', title: t(pk('sections.initiate')) },
    ],
    [t]
  );

  const handleSectionSelect = (item) => {
    setSearchQuery(item.title || '');
    if (item.id) {
      document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

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
    // In production, this would be submitted to an acceptance tracking endpoint
    console.log('E-signature accepted:', { timestamp: new Date().toISOString(), signature });
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
        <div className="bg-gradient-to-r from-purple-600/20 via-purple-500/10 to-transparent border-b border-gray-800">
          <div className="max-w-4xl mx-auto px-4 py-12 flex items-start gap-6">
            <div className="bg-purple-500/20 p-4 rounded-xl shrink-0">
              <Scale className="w-10 h-10 text-purple-400" />
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
                <a href="#binding-arbitration" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.bindingArbitration'))}
                </a>
                <a href="#process" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.process'))}
                </a>
                <a href="#fees" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.fees'))}
                </a>
                <a href="#class-action" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.classAction'))}
                </a>
                <a href="#exceptions" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.exceptions'))}
                </a>
                <a href="#limitation" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.limitation'))}
                </a>
                <a href="#state-disclaimers" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.stateDisclaimers'))}
                </a>
                <a href="#initiate" className="text-gray-400 hover:text-purple-400 transition">
                  {t(pk('sections.initiate'))}
                </a>
              </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              {/* Search */}
              <SuggestDropdown
                id="arbitration-section-search"
                className="sd-theme-dark w-full mb-10"
                items={sectionSuggestItems}
                value={searchQuery}
                onQueryChange={setSearchQuery}
                onSelect={handleSectionSelect}
                recentsKey="oxsteed_arbitration_search_recents"
                placeholder={t(pk('searchPlaceholder'))}
                ariaLabel={t(pk('searchLabel'))}
              />

              {/* Section 1: Binding Arbitration */}
              <section id="binding-arbitration" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.bindingArbitration'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('bindingArbitration.intro')))}
                  </p>
                  <div className="bg-purple-500/5 border border-purple-900/30 rounded p-4">
                    <p className="text-gray-300 italic">
                      {highlightText(t(pk('bindingArbitration.keyPoint')))}
                    </p>
                  </div>
                  <p className="text-gray-300 leading-relaxed">
                    {highlightText(t(pk('bindingArbitration.details')))}
                  </p>
                </div>
              </section>

              {/* Section 2: Arbitration Process */}
              <section id="process" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.process'))}
                </h2>
                <div className="space-y-6">
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-xl font-semibold text-white mb-4">
                      {t(pk('process.rulesTitle'))}
                    </h3>
                    <p className="text-gray-300 mb-4">
                      {highlightText(t(pk('process.rulesIntro')))}
                    </p>
                    <ul className="space-y-2 pl-6 list-disc">
                      <li className="text-gray-300">
                        {highlightText(t(pk('process.rule1')))}
                      </li>
                      <li className="text-gray-300">
                        {highlightText(t(pk('process.rule2')))}
                      </li>
                      <li className="text-gray-300">
                        {highlightText(t(pk('process.rule3')))}
                      </li>
                    </ul>
                  </div>

                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-xl font-semibold text-white mb-4">
                      {t(pk('process.arbitratorTitle'))}
                    </h3>
                    <p className="text-gray-300">
                      {highlightText(t(pk('process.arbitratorDesc')))}
                    </p>
                  </div>

                  {/* Timeline */}
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-xl font-semibold text-white mb-6">
                      {t(pk('process.timelineTitle'))}
                    </h3>
                    <div className="space-y-4">
                      {arbitrationTimeline.map((item) => (
                        <div key={item.phase} className="flex gap-4 items-start">
                          <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white shrink-0">
                            {item.phase}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-white">{item.label}</h4>
                              <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-300">
                                {item.days}
                              </span>
                            </div>
                            <p className="text-gray-400 text-sm">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* Section 3: Fees */}
              <section id="fees" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.fees'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300">
                    {highlightText(t(pk('fees.intro')))}
                  </p>
                  <div className="bg-blue-500/5 border border-blue-900/30 rounded p-4">
                    <p className="text-gray-300 font-semibold mb-2">
                      {t(pk('fees.costTitle'))}
                    </p>
                    <p className="text-gray-300">
                      {highlightText(t(pk('fees.costDetail')))}
                    </p>
                  </div>
                  <p className="text-gray-300">
                    {highlightText(t(pk('fees.attorneyFees')))}
                  </p>
                  <p className="text-gray-300">
                    {highlightText(t(pk('fees.lowValue')))}
                  </p>
                </div>
              </section>

              {/* Section 4: Class Action Waiver */}
              <section id="class-action" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                  {t(pk('sections.classAction'))}
                </h2>
                <div className="bg-red-500/5 border border-red-900/30 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300 font-semibold">
                    {highlightText(t(pk('classAction.intro')))}
                  </p>
                  <div className="bg-red-900/20 rounded p-4 border border-red-900/50">
                    <p className="text-gray-300 italic">
                      {highlightText(t(pk('classAction.impact')))}
                    </p>
                  </div>
                  <p className="text-gray-300">
                    {highlightText(t(pk('classAction.meaning')))}
                  </p>
                  <div className="bg-yellow-500/5 border border-yellow-900/30 rounded p-4">
                    <p className="text-yellow-200 font-semibold mb-2">
                      {t(pk('classAction.stateNotice'))}
                    </p>
                    <p className="text-gray-300 text-sm">
                      {highlightText(t(pk('classAction.noticeText')))}
                    </p>
                  </div>
                </div>
              </section>

              {/* Section 5: Exceptions */}
              <section id="exceptions" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.exceptions'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
                  <p className="text-gray-300">
                    {highlightText(t(pk('exceptions.intro')))}
                  </p>
                  <ul className="space-y-3 pl-6 list-disc">
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('exceptions.item1'))}</strong>
                      {' - '}
                      {highlightText(t(pk('exceptions.item1Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('exceptions.item2'))}</strong>
                      {' - '}
                      {highlightText(t(pk('exceptions.item2Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('exceptions.item3'))}</strong>
                      {' - '}
                      {highlightText(t(pk('exceptions.item3Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('exceptions.item4'))}</strong>
                      {' - '}
                      {highlightText(t(pk('exceptions.item4Desc')))}
                    </li>
                  </ul>
                </div>
              </section>

              {/* Section 6: Limitation of Liability */}
              <section id="limitation" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.limitation'))}
                </h2>
                <div className="space-y-6">
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      {t(pk('limitation.capTitle'))}
                    </h3>
                    <p className="text-gray-300 mb-4">
                      {highlightText(t(pk('limitation.capIntro')))}
                    </p>
                    <div className="bg-orange-500/5 border border-orange-900/30 rounded p-4">
                      <p className="text-gray-300 font-semibold">
                        {highlightText(t(pk('limitation.capAmount')))}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      {t(pk('limitation.indirectTitle'))}
                    </h3>
                    <p className="text-gray-300 mb-4">
                      {highlightText(t(pk('limitation.indirectIntro')))}
                    </p>
                    <ul className="space-y-2 pl-6 list-disc">
                      <li className="text-gray-300">{highlightText(t(pk('limitation.item1')))}</li>
                      <li className="text-gray-300">{highlightText(t(pk('limitation.item2')))}</li>
                      <li className="text-gray-300">{highlightText(t(pk('limitation.item3')))}</li>
                      <li className="text-gray-300">{highlightText(t(pk('limitation.item4')))}</li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* Section 7: State-Specific Disclaimers */}
              <section id="state-disclaimers" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <FileText className="w-8 h-8 text-blue-400" />
                  {t(pk('sections.stateDisclaimers'))}
                </h2>
                <div className="space-y-4">
                  {stateDisclaimers.map((disclosure, index) => (
                    <div
                      key={index}
                      className="bg-gray-900/50 border border-gray-700 rounded-lg overflow-hidden hover:border-gray-600 transition"
                    >
                      <button
                        onClick={() => setExpandedState(expandedState === index ? null : index)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-800/50 transition text-left"
                      >
                        <span className="font-semibold text-white">
                          {disclosure.state} - {disclosure.title}
                        </span>
                        {expandedState === index ? (
                          <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
                        )}
                      </button>
                      {expandedState === index && (
                        <div className="px-6 py-4 bg-gray-950/50 border-t border-gray-700 text-gray-300 space-y-3">
                          {disclosure.content.map((point, i) => (
                            <p key={i} className="text-sm leading-relaxed">
                              {highlightText(point)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Section 8: How to Initiate Arbitration */}
              <section id="initiate" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6">
                  {t(pk('sections.initiate'))}
                </h2>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-6">
                  <p className="text-gray-300">
                    {highlightText(t(pk('initiate.intro')))}
                  </p>
                  <ol className="space-y-4 pl-6 list-decimal">
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('initiate.step1'))}</strong>
                      {' - '}
                      {highlightText(t(pk('initiate.step1Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('initiate.step2'))}</strong>
                      {' - '}
                      {highlightText(t(pk('initiate.step2Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('initiate.step3'))}</strong>
                      {' - '}
                      {highlightText(t(pk('initiate.step3Desc')))}
                    </li>
                    <li className="text-gray-300">
                      <strong className="text-purple-300">{t(pk('initiate.step4'))}</strong>
                      {' - '}
                      {highlightText(t(pk('initiate.step4Desc')))}
                    </li>
                  </ol>
                  <div className="bg-blue-500/5 border border-blue-900/30 rounded p-4">
                    <p className="text-gray-300">
                      <strong className="text-blue-300">{t(pk('initiate.contactTitle'))}:</strong>
                      {' '}
                      {highlightText(t(pk('initiate.contactInfo')))}
                    </p>
                  </div>
                </div>
              </section>

              {/* Acceptance Section */}
              <section className="mb-12 bg-purple-500/5 border border-purple-900/30 rounded-lg p-8">
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
                      className="w-5 h-5 rounded border-gray-600 text-purple-600 focus:ring-2 focus:ring-purple-400 mt-0.5"
                    />
                    <span className="text-gray-300">
                      {highlightText(t(pk('acceptance.checkbox')))}
                    </span>
                  </label>

                  {acceptanceChecked && !showSignature && (
                    <button
                      onClick={() => setShowSignature(true)}
                      className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition w-full"
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
                          className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-purple-400 font-serif text-lg"
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        {t(pk('acceptance.form.signatureNote'))}
                      </p>
                      <div className="flex gap-3">
                        <button
                          type="submit"
                          className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded font-semibold transition"
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
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
