import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useSubscription from '../hooks/useSubscription';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

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
const IcoArrowR   = (p) => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Ico>;
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const { plans, subscription, loading, error, createCheckout, cancelSubscription, openPortal } = useSubscription();
  const [billing, setBilling] = useState('monthly'); // 'monthly' | 'yearly'
  const [cancelling, setCancelling] = useState(false);

  const isSubscribed = subscription && (subscription.status === 'active' || subscription.status === 'trialing');
  const isHelper = user?.role === 'helper';

  const proMonthly = 14.99;
  const proYearly = 79.99;
  const proYearlySavings = Math.round((1 - (proYearly / (proMonthly * 12))) * 100);
  const displayPrice = billing === 'yearly' ? proYearly : proMonthly;
  const displayPeriod = billing === 'yearly' ? 'year' : 'month';

  const handleSubscribe = async (planSlug) => {
    const slug = billing === 'yearly' ? `${planSlug}-yearly` : planSlug;
    await createCheckout(slug);
  };

  const handleCancel = async () => {
    if (window.confirm('Are you sure you want to cancel? You\'ll keep access until the end of your billing period.')) {
      setCancelling(true);
      await cancelSubscription();
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <div className="flex flex-col items-center justify-center py-32">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4" />
          <p className="text-gray-500 text-sm">Loading plans...</p>
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
            <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Level Up</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            {isHelper ? 'Choose Your Helper Plan' : 'Upgrade Your Experience'}
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            {isHelper
              ? 'Get verified, unlock priority placement, and start earning more with Pro.'
              : 'Unlock budget tracking, goal setting, saved helpers, and the full life dashboard.'}
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
              <h2 className="text-xl font-bold mb-2">You're on the Pro Plan</h2>
              <div className="inline-block bg-emerald-500/15 text-emerald-400 text-xs font-semibold px-3 py-1 rounded-full mb-4">
                Active
              </div>
              <p className="text-gray-400 text-sm mb-6">
                Your subscription renews on {new Date(subscription.current_period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={openPortal}
                  className="bg-gray-800 hover:bg-gray-700 text-white font-semibold px-6 py-3 rounded-xl transition text-sm">
                  Manage Billing
                </button>
                <button onClick={handleCancel} disabled={cancelling}
                  className="text-red-400 hover:text-red-300 font-medium text-sm transition">
                  {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
                </button>
              </div>
            </div>

            <div className="text-center mt-6">
              <Link to="/dashboard" className="text-sm text-orange-400 hover:text-orange-300 font-medium transition">
                ← Back to Dashboard
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
              >Monthly</button>
              <button
                onClick={() => setBilling('yearly')}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition relative ${
                  billing === 'yearly' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Yearly
                <span className="absolute -top-2.5 -right-12 bg-emerald-500 text-gray-950 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Save {proYearlySavings}%
                </span>
              </button>
            </div>

            {/* ── Plan Cards ──────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto mb-16">

              {/* FREE */}
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-8">
                <h3 className="text-lg font-bold text-white mb-1">Free</h3>
                <p className="text-gray-500 text-sm mb-6">Get started with the basics</p>

                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-bold text-white">$0</span>
                  <span className="text-gray-500 text-sm">/forever</span>
                </div>

                <div className="bg-gray-800/50 rounded-xl p-4 mb-6 text-center">
                  <span className="text-xs text-gray-500">Your current plan</span>
                </div>

                <ul className="space-y-0.5">
                  <Feature text="Profile listing on OxSteed" />
                  <Feature text="Browse and view job posts" />
                  <Feature text="Receive introduction requests" />
                  <Feature text="Set your own rates" />
                  <Feature text="Basic messaging" />
                  <Feature text="Verified Pro badge" included={false} />
                  <Feature text="Submit bids on jobs" included={false} />
                  <Feature text="Background check" included={false} />
                  <Feature text="Priority search placement" included={false} />
                  <Feature text="Life Dashboard features" included={false} />
                </ul>
              </div>

              {/* PRO */}
              <div className="relative bg-gray-900/60 border-2 border-orange-500/60 rounded-2xl p-8 shadow-lg shadow-orange-500/5">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-orange-500 text-gray-950 text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                    Recommended
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-1">Pro</h3>
                <p className="text-gray-500 text-sm mb-6">Everything you need to grow</p>

                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-orange-400">${displayPrice}</span>
                  <span className="text-gray-500 text-sm">/{displayPeriod}</span>
                </div>
                {billing === 'yearly' && (
                  <p className="text-emerald-400 text-xs font-medium mb-5">
                    That's ${(proYearly / 12).toFixed(2)}/mo — saves ${((proMonthly * 12) - proYearly).toFixed(2)}/year
                  </p>
                )}
                {billing === 'monthly' && <div className="mb-5" />}

                <button
                  onClick={() => handleSubscribe('pro')}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-xl transition text-sm mb-6"
                >
                  Subscribe to Pro
                </button>

                <ul className="space-y-0.5">
                  <Feature text="Everything in Free" />
                  <Feature text="Verified Pro badge on profile" />
                  <Feature text="Submit bids on any job" />
                  <Feature text="Push notifications for urgent jobs" />
                  <Feature text="Background check eligibility" />
                  <Feature text="Identity verification (Didit)" />
                  <Feature text="Priority search placement" />
                  <Feature text="Full Life Dashboard — budgets, goals, tracking" />
                  <Feature text="Saved helpers & home maintenance" />
                  <Feature text="Community Pulse & local insights" />
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
                    <h2 className="text-xl font-bold text-white">OxSteed Protection</h2>
                    <p className="text-gray-500 text-sm">Secure payments for every job</p>
                  </div>
                </div>

                <p className="text-gray-400 text-sm leading-relaxed mb-6">
                  When you use OxSteed Protection, payments are processed securely through Stripe.
                  The customer pays the agreed job price, and OxSteed takes a simple <span className="text-orange-400 font-bold">7.1%</span> platform
                  fee (minimum $5). That's it — one transparent fee that covers payment processing, dispute mediation, and platform support.
                </p>

                {/* Example breakdown */}
                <div className="bg-gray-800/50 rounded-xl p-6 mb-6">
                  <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-4">Example: $200 Job</p>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-300">Customer pays</span>
                      <span className="text-sm font-bold text-white">$200.00</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-300">OxSteed platform fee (7.1%)</span>
                      <span className="text-sm font-semibold text-orange-400">-$14.20</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-300">Stripe processing fee (~2.9% + $0.30)</span>
                      <span className="text-sm font-semibold text-gray-500">-$6.10</span>
                    </div>
                    <div className="border-t border-gray-700 pt-3 flex justify-between items-center">
                      <span className="text-sm font-bold text-white">Helper receives</span>
                      <span className="text-lg font-bold text-emerald-400">~$179.70</span>
                    </div>
                  </div>
                </div>

                {/* Who can use it */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gray-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <IcoUsers size={16} cls="text-blue-400" />
                      <span className="text-sm font-semibold text-white">For Customers</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Complete ID verification to unlock protected payments. Your money is secure until the job is done.
                    </p>
                  </div>
                  <div className="bg-gray-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <IcoBriefcase size={16} cls="text-emerald-400" />
                      <span className="text-sm font-semibold text-white">For Helpers</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Complete ID verification, background check, and set up your Stripe Express account to accept protected payments.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Comparison Table ──────────────────────────────────── */}
            <div className="max-w-3xl mx-auto mb-16">
              <h2 className="text-xl font-bold text-white text-center mb-8">Compare Plans</h2>
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/40">
                      <th className="text-left p-4 text-gray-500 font-semibold">Feature</th>
                      <th className="text-center p-4 text-gray-400 font-semibold w-28">Free</th>
                      <th className="text-center p-4 text-orange-400 font-semibold w-28">Pro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Profile listing', true, true],
                      ['Browse job posts', true, true],
                      ['Basic messaging', true, true],
                      ['Set your own rates', true, true],
                      ['Verified Pro badge', false, true],
                      ['Submit bids on jobs', false, true],
                      ['Push notifications', false, true],
                      ['Background check', false, true],
                      ['Identity verification', false, true],
                      ['Priority search placement', false, true],
                      ['Life Dashboard (budgets, goals)', false, true],
                      ['Home maintenance tracking', false, true],
                      ['Saved helpers', false, true],
                      ['Community insights', false, true],
                      ['OxSteed Protection eligible', '✓*', true],
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
                  * OxSteed Protection requires ID verification for customers and ID verification + background check + Stripe account for helpers.
                </div>
              </div>
            </div>

            {/* ── FAQ ──────────────────────────────────────────────── */}
            <div className="max-w-3xl mx-auto mb-12">
              <h2 className="text-xl font-bold text-white text-center mb-8">Frequently Asked Questions</h2>
              <div className="space-y-3">
                <FaqItem
                  q="What's included in Pro?"
                  a="Pro gives you a verified badge, the ability to submit bids on jobs, priority search placement, background check eligibility, identity verification, push notifications for urgent jobs, and the full Life Dashboard with budget tracking, goals, home maintenance reminders, and community insights."
                />
                <FaqItem
                  q="Can I cancel anytime?"
                  a="Yes, you can cancel your Pro subscription at any time. You'll keep access to all Pro features until the end of your current billing period. No cancellation fees."
                />
                <FaqItem
                  q="What's OxSteed Protection?"
                  a="OxSteed Protection is our secure payment system powered by Stripe. When a customer and helper agree on a job, the payment is processed through Stripe Connect. OxSteed takes a 7.1% platform fee (minimum $5), and the helper receives the rest minus Stripe's standard processing fees. This isn't a subscription — it's a per-transaction fee that only applies when you use OxSteed Protection for a job."
                />
                <FaqItem
                  q="How much does the helper actually receive?"
                  a="On a $200 job, OxSteed takes $14.20 (7.1%) and Stripe's processing fee is approximately $6.10 (2.9% + $0.30). The helper receives approximately $179.70. The helper is the merchant of record — payments go directly to their Stripe Express account."
                />
                <FaqItem
                  q="Do I need Pro to use OxSteed Protection?"
                  a="OxSteed Protection is available to all verified users — both Free and Pro. However, Pro helpers have priority placement which means more job opportunities, and the verified badge builds more trust with customers."
                />
                <FaqItem
                  q="What's the difference between monthly and yearly?"
                  a={`Monthly is $${proMonthly}/month. Yearly is $${proYearly}/year — that's $${(proYearly / 12).toFixed(2)}/month, saving you $${((proMonthly * 12) - proYearly).toFixed(2)} per year (${proYearlySavings}% off).`}
                />
                <FaqItem
                  q="Is my payment information secure?"
                  a="Absolutely. All payments are processed through Stripe, a PCI Level 1 certified payment processor. OxSteed never stores your credit card information."
                />
              </div>
            </div>

            {/* ── Bottom CTA ──────────────────────────────────────── */}
            <div className="text-center mb-8">
              <button
                onClick={() => handleSubscribe('pro')}
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-10 py-4 rounded-xl transition text-base"
              >
                Get Pro — ${displayPrice}/{displayPeriod}
              </button>
              <p className="text-gray-600 text-xs mt-3">Cancel anytime. No hidden fees.</p>
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
