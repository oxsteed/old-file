import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useSubscription from '../hooks/useSubscription';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { formatDate, formatMoney } from '../lib/format';

// ── Icons ─────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoCheck    = (p) => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoX        = (p) => <Ico {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;
const IcoShield   = (p) => <Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ico>;
const IcoZap      = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;
const IcoStar     = (p) => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;
const IcoDollar   = (p) => <Ico {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>;
const IcoUsers    = (p) => <Ico {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>;
const IcoBriefcase = (p) => <Ico {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></Ico>;
const IcoHeart    = (p) => <Ico {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></Ico>;

// ── Feature row ───────────────────────────────────────────────────────────
const Feature = ({ text, included = true }) => (
  <li className="flex items-start gap-3 py-2">
    {included
      ? <IcoCheck size={16} cls="text-emerald-400 mt-0.5" />
      : <IcoX size={16} cls="text-gray-600 mt-0.5" />
    }
    <span className={included ? 'text-gray-300 text-sm' : 'text-gray-600 text-sm'}>{text}</span>
  </li>
);

// ── FAQ Item ──────────────────────────────────────────────────────────────
const FaqItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-700/40 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-900/40 transition"
      >
        <span className="font-semibold text-white text-sm pr-4">{q}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" className={`text-gray-500 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 -mt-1">
          <p className="text-gray-400 text-sm leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
export default function UpgradePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { subscription, loading, error } = useSubscription();
  const [billing, setBilling] = useState('monthly');

  const isSubscribed = subscription && (subscription.status === 'active' || subscription.status === 'trialing');
  const isHelper = user?.role === 'helper';

  const proMonthly = 14.99;
  const proYearly = 79.99;
  const proYearlySavings = Math.round((1 - (proYearly / (proMonthly * 12))) * 100);
  const displayPrice = billing === 'yearly' ? proYearly : proMonthly;
  const displayPriceText = formatMoney(displayPrice);
  const displayPeriod = billing === 'yearly' ? t('plans.year') : t('plans.month');
  const yearlyPerMonthText = formatMoney(proYearly / 12);
  const yearlySavingsText = formatMoney((proMonthly * 12) - proYearly);
  const renewalDateText = subscription?.current_period_end
    ? formatDate(subscription.current_period_end, { month: 'long', day: 'numeric', year: 'numeric' })
    : t('upgrade.renewalSoon');
  const exampleJobAmount = formatMoney(200);
  const examplePlatformFee = formatMoney(14.2);
  const exampleProcessorFee = formatMoney(6.1);
  const exampleHelperReceives = formatMoney(179.7);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <div className="flex flex-col items-center justify-center py-32">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4" />
          <p className="text-gray-500 text-sm">{t('upgrade.loadingPlans')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12">

        {/* ── Hero ──────────────────────────────────────────────── */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-full px-4 py-1.5 mb-6">
            <IcoZap size={14} cls="text-orange-400" />
            <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">{t('upgrade.levelUp')}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            {isHelper ? t('upgrade.helperTitle') : t('upgrade.customerTitle')}
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            {isHelper ? t('upgrade.helperSubtitle') : t('upgrade.customerSubtitle')}
          </p>
          <p className="text-gray-500 text-sm max-w-2xl mx-auto mt-3">
            Billing actions are informational only during launch. Restaurant credit and direct payment are the active payment paths.
          </p>
        </div>

        {/* ── Error ────────────────────────────────────────────── */}
        {error && (
          <div className="mb-8 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ── Already subscribed ────────────────────────────────── */}
        {isSubscribed ? (
          <div className="max-w-lg mx-auto">
            <div className="bg-gray-900/60 border border-orange-500/30 rounded-2xl p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/10 mb-4">
                <IcoStar size={28} cls="text-orange-400" />
              </div>
              <h2 className="text-xl font-bold mb-2">{t('upgrade.proActiveTitle')}</h2>
              <div className="inline-block bg-emerald-500/15 text-emerald-400 text-xs font-semibold px-3 py-1 rounded-full mb-4">
                {t('upgrade.activeLabel')}
              </div>
              <p className="text-gray-400 text-sm mb-6">
                {t('upgrade.renewsOn', { date: renewalDateText })}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  to="/settings"
                  className="bg-gray-800 hover:bg-gray-700 text-white font-semibold px-6 py-3 rounded-xl transition text-sm text-center"
                >
                  {t('settings.subscription.manageBilling')}
                </Link>
                <Link
                  to="/activity"
                  className="text-orange-400 hover:text-orange-300 font-medium text-sm transition text-center"
                >
                  View history
                </Link>
              </div>
            </div>

            <div className="text-center mt-6">
              <Link to="/dashboard" className="text-sm text-orange-400 hover:text-orange-300 font-medium transition">
                {t('upgrade.backToDashboard')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* ── Billing Toggle ──────────────────────────────────── */}
            <div className="flex items-center justify-center gap-3 mb-10">
              <button
                onClick={() => setBilling('monthly')}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition ${
                  billing === 'monthly' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >{t('upgrade.monthly')}</button>
              <button
                onClick={() => setBilling('yearly')}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition relative ${
                  billing === 'yearly' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t('upgrade.yearly')}
                <span className="absolute -top-2.5 -right-12 bg-emerald-500 text-gray-950 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {t('upgrade.savePct', { pct: proYearlySavings })}
                </span>
              </button>
            </div>

            {/* ── Plan Cards ──────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto mb-16">

              {/* FREE */}
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-8">
                <h3 className="text-lg font-bold text-white mb-1">{t('plans.free')}</h3>
                <p className="text-gray-500 text-sm mb-6">{t('upgrade.freeDesc')}</p>

                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-bold text-white">{formatMoney(0)}</span>
                  <span className="text-gray-500 text-sm">{t('upgrade.freeForever')}</span>
                </div>

                <div className="bg-gray-800/50 rounded-xl p-4 mb-6 text-center">
                  <span className="text-xs text-gray-500">{t('upgrade.currentPlan')}</span>
                </div>

                <ul className="space-y-0.5">
                  <Feature text={t('upgrade.freeF1')} />
                  <Feature text={t('upgrade.freeF2')} />
                  <Feature text={t('upgrade.freeF3')} />
                  <Feature text={t('upgrade.freeF4')} />
                  <Feature text={t('upgrade.freeF5')} />
                  <Feature text={t('upgrade.freeF6')} included={false} />
                  <Feature text={t('upgrade.freeF7')} included={false} />
                  <Feature text={t('upgrade.freeF8')} included={false} />
                  <Feature text={t('upgrade.freeF9')} included={false} />
                  <Feature text={t('upgrade.freeF10')} included={false} />
                </ul>
              </div>

              {/* PRO */}
              <div className="relative bg-gray-900/60 border-2 border-orange-500/60 rounded-2xl p-8 shadow-lg shadow-orange-500/5">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-orange-500 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                    {t('upgrade.recommended')}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-1">{t('plans.pro')}</h3>
                <p className="text-gray-500 text-sm mb-6">{t('upgrade.proDesc')}</p>

                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-orange-400">{displayPriceText}</span>
                  <span className="text-gray-500 text-sm">/{displayPeriod}</span>
                </div>
                {billing === 'yearly' && (
                  <p className="text-emerald-400 text-xs font-medium mb-5">
                    {t('upgrade.yearlySavingsFormatted', {
                      monthly: yearlyPerMonthText,
                      savings: yearlySavingsText,
                    })}
                  </p>
                )}
                {billing === 'monthly' && <div className="mb-5" />}

                <div className="w-full bg-orange-500/10 border border-orange-500/20 text-orange-300 font-semibold py-3.5 rounded-xl text-sm mb-6 text-center">
                  {t('upgrade.subscribePro')} (coming soon)
                </div>

                <ul className="space-y-0.5">
                  <Feature text={t('upgrade.proF1')} />
                  <Feature text={t('upgrade.proF2')} />
                  <Feature text={t('upgrade.proF3')} />
                  <Feature text={t('upgrade.proF4')} />
                  <Feature text={t('upgrade.proF5')} />
                  <Feature text={t('upgrade.proF6')} />
                  <Feature text={t('upgrade.proF7')} />
                  <Feature text={t('upgrade.proF8')} />
                  <Feature text={t('upgrade.proF9')} />
                  <Feature text={t('upgrade.proF10')} />
                </ul>
              </div>
            </div>

            {/* ── OxSteed Protection Explainer ─────────────────────── */}
            <div className="max-w-3xl mx-auto mb-16">
              <div className="bg-gradient-to-br from-gray-900/80 to-gray-900/40 border border-gray-700/40 rounded-2xl p-8 sm:p-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                    <IcoShield size={22} cls="text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{t('upgrade.protectionTitle')}</h2>
                    <p className="text-gray-500 text-sm">{t('upgrade.protectionTagline')}</p>
                  </div>
                </div>

                <p className="text-gray-400 text-sm leading-relaxed mb-6">
                  {t('upgrade.protectionDesc')}
                </p>

                {/* Example breakdown */}
                <div className="bg-gray-800/50 rounded-xl p-6 mb-6">
                  <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-4">
                    {t('upgrade.exampleTitleAmount', { amount: exampleJobAmount })}
                  </p>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-300">{t('upgrade.customerPays')}</span>
                      <span className="text-sm font-bold text-white">{exampleJobAmount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-300">{t('upgrade.platformFee')}</span>
                      <span className="text-sm font-semibold text-orange-400">-{examplePlatformFee}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-300">
                        {t('upgrade.legacyProcessorFee', { defaultValue: 'Legacy processor fee (backend only)' })}
                      </span>
                      <span className="text-sm font-semibold text-gray-500">-{exampleProcessorFee}</span>
                    </div>
                    <div className="border-t border-gray-700 pt-3 flex justify-between items-center">
                      <span className="text-sm font-bold text-white">{t('upgrade.helperReceives')}</span>
                      <span className="text-lg font-bold text-emerald-400">~{exampleHelperReceives}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gray-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <IcoUsers size={16} cls="text-blue-400" />
                      <span className="text-sm font-semibold text-white">{t('upgrade.forCustomers')}</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {t('upgrade.forCustomersDesc')}
                    </p>
                  </div>
                  <div className="bg-gray-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <IcoBriefcase size={16} cls="text-emerald-400" />
                      <span className="text-sm font-semibold text-white">{t('upgrade.forHelpers')}</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {t('upgrade.forHelpersDesc')}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Comparison Table ──────────────────────────────────── */}
            <div className="max-w-3xl mx-auto mb-16">
              <h2 className="text-xl font-bold text-white text-center mb-8">{t('upgrade.comparePlans')}</h2>
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/40">
                      <th className="text-left p-4 text-gray-500 font-semibold">{t('upgrade.featureCol')}</th>
                      <th className="text-center p-4 text-gray-400 font-semibold w-28">{t('plans.free')}</th>
                      <th className="text-center p-4 text-orange-400 font-semibold w-28">{t('plans.pro')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [t('upgrade.compareF1'),  true,  true],
                      [t('upgrade.compareF2'),  true,  true],
                      [t('upgrade.compareF3'),  true,  true],
                      [t('upgrade.compareF4'),  true,  true],
                      [t('upgrade.compareF5'),  false, true],
                      [t('upgrade.compareF6'),  false, true],
                      [t('upgrade.compareF7'),  false, true],
                      [t('upgrade.compareF8'),  false, true],
                      [t('upgrade.compareF9'),  false, true],
                      [t('upgrade.compareF10'), false, true],
                      [t('upgrade.compareF11'), false, true],
                      [t('upgrade.compareF12'), false, true],
                      [t('upgrade.compareF13'), false, true],
                      [t('upgrade.compareF14'), false, true],
                      [t('upgrade.compareF15'), '✓*',  true],
                    ].map(([feature, free, pro], i) => (
                      <tr key={i} className="border-b border-gray-800/50 last:border-0">
                        <td className="p-4 text-gray-300">{feature}</td>
                        <td className="p-4 text-center">
                          {free === true ? <IcoCheck size={16} cls="text-emerald-400 mx-auto" /> :
                           free === false ? <IcoX size={16} cls="text-gray-700 mx-auto" /> :
                           <span className="text-gray-500 text-xs">{free}</span>}
                        </td>
                        <td className="p-4 text-center">
                          {pro === true ? <IcoCheck size={16} cls="text-emerald-400 mx-auto" /> :
                           <span className="text-gray-500 text-xs">{pro}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-4 bg-gray-800/20 text-xs text-gray-500">
                  {t('upgrade.protectionNote')}
                </div>
              </div>
            </div>

            {/* ── FAQ ──────────────────────────────────────────────── */}
            <div className="max-w-3xl mx-auto mb-12">
              <h2 className="text-xl font-bold text-white text-center mb-8">{t('upgrade.faqTitle')}</h2>
              <div className="space-y-3">
                <FaqItem q={t('upgrade.faq1Q')} a={t('upgrade.faq1A')} />
                <FaqItem q={t('upgrade.faq2Q')} a={t('upgrade.faq2A')} />
                <FaqItem q={t('upgrade.faq3Q')} a={t('upgrade.faq3A')} />
                <FaqItem q={t('upgrade.faq4Q')} a={t('upgrade.faq4A')} />
                <FaqItem q={t('upgrade.faq5Q')} a={t('upgrade.faq5A')} />
                <FaqItem
                  q={t('upgrade.faq6Q')}
                  a={t('upgrade.faq6AFormatted', {
                    monthly: formatMoney(proMonthly),
                    yearly: formatMoney(proYearly),
                    perMonth: yearlyPerMonthText,
                    savings: yearlySavingsText,
                    pct: proYearlySavings,
                  })}
                />
                <FaqItem q={t('upgrade.faq7Q')} a={t('upgrade.faq7A')} />
              </div>
            </div>

            {/* ── Bottom CTA ──────────────────────────────────────── */}
            <div className="text-center mb-8">
              <div className="inline-block bg-gray-900/70 border border-gray-700/50 text-gray-300 font-bold px-10 py-4 rounded-xl text-base">
                {t('upgrade.getProBtnFormatted', { price: displayPriceText, period: displayPeriod })} (coming soon)
              </div>
              <p className="text-gray-600 text-xs mt-3">
                Billing is managed outside the launch flow for now. Contact support if you need help with plan access.
              </p>
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
