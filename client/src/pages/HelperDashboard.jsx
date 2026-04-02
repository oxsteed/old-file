import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import useSubscription from '../hooks/useSubscription';
import BadgeDisplay from '../components/BadgeDisplay';
import api from '../api/axios';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

// ── Inline SVG Icons ──────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400', ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${cls}`} {...rest}>{children}</svg>
);
const IcoBriefcase = (p) => <Ico {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></Ico>;
const IcoDollar    = (p) => <Ico {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>;
const IcoStar      = (p) => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;
const IcoBell      = (p) => <Ico {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></Ico>;
const IcoShield    = (p) => <Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ico>;
const IcoCheck     = (p) => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoZap       = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;
const IcoUsers     = (p) => <Ico {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>;
const IcoMap       = (p) => <Ico {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></Ico>;
const IcoClock     = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>;
const IcoTarget    = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ico>;
const IcoTrending  = (p) => <Ico {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></Ico>;
const IcoAward     = (p) => <Ico {...p}><circle cx="12" cy="8" r="6"/><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/></Ico>;
const IcoChat      = (p) => <Ico {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></Ico>;
const IcoId        = (p) => <Ico {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></Ico>;
const IcoArrowR    = (p) => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Ico>;
const IcoSettings  = (p) => <Ico {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></Ico>;

// ── Tag ───────────────────────────────────────────────────────────────────
const Tag = ({ text, color = 'orange' }) => {
  const m = {
    orange: 'bg-orange-500/15 text-orange-400',
    green: 'bg-emerald-500/15 text-emerald-400',
    red: 'bg-red-500/15 text-red-400',
    gray: 'bg-gray-700/40 text-gray-400',
    blue: 'bg-blue-500/15 text-blue-400',
    purple: 'bg-purple-500/15 text-purple-400',
  };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${m[color]||m.orange}`}>{text}</span>;
};

// ── Progress bar ──────────────────────────────────────────────────────────
const ProgressBar = ({ pct, color = 'bg-orange-500', h = 'h-1.5' }) => (
  <div className={`w-full ${h} bg-gray-800 rounded-full overflow-hidden`}>
    <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
  </div>
);

// ── Stat Card ─────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, IconComp, color = 'text-white' }) => (
  <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5">
    <div className="flex justify-between items-start mb-3">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{label}</span>
      {IconComp && <IconComp size={15} cls={color} />}
    </div>
    <div className={`text-2xl font-bold ${color}`}>{value}</div>
    {sub && <div className="text-xs text-gray-500 mt-1.5">{sub}</div>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING STEPS (preserved from original)
// ═══════════════════════════════════════════════════════════════════════════
const ONBOARDING_STEPS = [
  { key: 'account', label: 'Create Account', desc: 'Name, email, and password', check: () => true },
  { key: 'email', label: 'Verify Email', desc: 'Confirm your email address', check: (u) => !!u?.email_verified },
  { key: 'profile', label: 'Profile & Location', desc: 'Phone, zip, skills, and a short bio', check: (u) => !!u?.profile_completed, uiStep: 4 },
  { key: 'plan', label: 'Choose Your Plan', desc: 'Free or Pro — upgrade anytime', check: (u) => !!u?.tier_selected, uiStep: 5 },
  { key: 'tax', label: 'Tax Information', desc: 'Required for Pro tier helpers (W-9)', check: (u) => !!u?.w9_completed || u?.membership_tier === 'tier1' || u?.membership_tier === 'free', onlyFor: (u) => u?.membership_tier === 'tier2' || u?.membership_tier === 'pro', uiStep: 6 },
  { key: 'review', label: 'Review & Complete', desc: 'Accept terms and go live', check: (u) => !!u?.onboarding_completed, uiStep: 7 },
];

function OnboardingProgress({ user, onResume }) {
  const steps = ONBOARDING_STEPS.filter(s => !s.onlyFor || s.onlyFor(user));
  const done = steps.filter(s => s.check(user)).length;
  const pct = Math.round((done / steps.length) * 100);
  const next = steps.find(s => !s.check(user));

  return (
    <div className="bg-gradient-to-br from-orange-500/8 to-gray-900/90 border border-orange-500/30 rounded-2xl p-6 mb-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-bold text-white mb-1">Complete Your Profile to Start Getting Jobs</h2>
          <p className="text-sm text-gray-500">Your profile is hidden from search until setup is finished.</p>
        </div>
        <span className="text-2xl font-extrabold text-orange-400 ml-4">{pct}%</span>
      </div>

      <ProgressBar pct={pct} color="bg-gradient-to-r from-orange-500 to-orange-400" h="h-1.5" />

      <ul className="mt-5 space-y-2">
        {steps.map(s => {
          const isDone = s.check(user);
          return (
            <li key={s.key} className={`flex items-center gap-3 ${isDone ? 'opacity-50' : ''}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/40 text-gray-500 border border-gray-600'
              }`}>
                {isDone ? '✓' : '○'}
              </div>
              <div>
                <span className={`text-sm font-semibold ${isDone ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{s.label}</span>
                <span className="text-xs text-gray-600 ml-2">{s.desc}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {next && (
        <button onClick={onResume}
          className="mt-5 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition text-sm">
          {next.key === 'profile' ? 'Add Profile & Location →' :
           next.key === 'plan'    ? 'Choose a Plan →' :
           next.key === 'tax'     ? 'Add Tax Info →' :
           next.key === 'review'  ? 'Review & Go Live →' :
           'Continue Setup →'}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HELPER DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
export default function HelperDashboard() {
  const { user, isOnboardingComplete } = useAuth();
  const { subscription, openPortal } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();

  const [verification, setVerification] = useState({ backgroundCheck: null, identity: null });
  const [notifications, setNotifications] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [nearbyJobs, setNearbyJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [welcomeMsg] = useState(location.state?.message || null);
  const [tab, setTab] = useState('pulse');

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const promises = [
          api.get('/verification/background-check/status'),
          api.get('/verification/identity/status'),
          api.get('/notifications'),
        ];

        // Only fetch bids and jobs if onboarding is complete
        if (isOnboardingComplete) {
          promises.push(api.get('/bids/me'));
          promises.push(api.get('/jobs?limit=5'));
        }

        const results = await Promise.allSettled(promises);

        setVerification({
          backgroundCheck: results[0].status === 'fulfilled' ? results[0].value.data?.backgroundCheck || null : null,
          identity: results[1].status === 'fulfilled' ? results[1].value.data?.identity || null : null,
        });

        if (results[2].status === 'fulfilled') {
          const notifs = results[2].value.data?.notifications || results[2].value.data || [];
          setNotifications(Array.isArray(notifs) ? notifs : []);
        }

        if (isOnboardingComplete) {
          if (results[3]?.status === 'fulfilled') {
            const bids = results[3].value.data?.bids || results[3].value.data || [];
            setMyBids(Array.isArray(bids) ? bids : []);
          }
          if (results[4]?.status === 'fulfilled') {
            const jobs = results[4].value.data?.jobs || results[4].value.data || [];
            setNearbyJobs(Array.isArray(jobs) ? jobs : []);
          }
        }
      } catch (e) { console.error('Dashboard fetch error:', e); }
      finally { setLoading(false); }
    };
    fetchAll();
  }, [isOnboardingComplete]);

  const startBackgroundCheck = async () => {
    try { await api.post('/verification/background-check'); window.location.reload(); }
    catch (e) { alert(e.response?.data?.error || 'Failed to start background check'); }
  };

  const startIdentityVerification = async () => {
    try { const { data } = await api.post('/verification/identity/session'); window.location.href = data.url; }
    catch (e) { alert(e.response?.data?.error || 'Failed to start identity verification'); }
  };

  // ── Derived ───────────────────────────────────────────────────────
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const isProActive = subscription?.status === 'active';
  const showOnboarding = !isOnboardingComplete;
  const unreadNotifs = notifications.filter(n => !n.read && !n.read_at).length;
  const activeBids = myBids.filter(b => b.status === 'pending' || b.status === 'accepted');
  const wonBids = myBids.filter(b => b.status === 'accepted');

  const tabs = showOnboarding
    ? [{ id: 'pulse', label: 'Get Started' }]
    : [
        { id: 'pulse', label: 'My Pulse' },
        { id: 'jobs', label: 'Find Jobs' },
        { id: 'bids', label: 'My Bids', badge: activeBids.length },
        { id: 'updates', label: 'Updates', badge: unreadNotifs },
      ];

  // ── Loading state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4" />
          <span className="text-sm">Loading your dashboard…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Welcome banner ───────────────────────────────────── */}
        {welcomeMsg && (
          <div className="mb-5 flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm font-medium">
            <span>🎉</span><span>{welcomeMsg}</span>
          </div>
        )}

        {/* ── Greeting ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold">
                {showOnboarding ? `Welcome, ${user?.first_name || 'Helper'}!` : `${greeting}, ${user?.first_name || 'Helper'}.`}
              </h1>
              {!showOnboarding && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F97316"
                  strokeWidth="2" strokeLinecap="round" className="animate-pulse">
                  <path d="M3 12h4l3-9 4 18 3-9h4"/>
                </svg>
              )}
            </div>
            {showOnboarding ? (
              <p className="text-gray-500 mt-1 text-sm">Your account is created — finish setup to go live.</p>
            ) : (
              <p className="text-gray-500 mt-1 text-sm">
                {new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })} — Let's get to work.
              </p>
            )}
          </div>
          <BadgeDisplay badges={user?.badges} size="large" />
        </div>

        {/* ── Tabs ──────────────────────────────────────────────── */}
        {tabs.length > 1 && (
          <div className="flex gap-1 my-6 bg-gray-900/80 rounded-xl p-1 w-fit">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`relative px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  tab === t.id ? 'bg-orange-500 text-gray-950' : 'text-gray-500 hover:text-gray-300'
                }`}>
                {t.label}
                {t.badge > 0 && (
                  <span className={`ml-1.5 text-[10px] w-4 h-4 inline-flex items-center justify-center rounded-full font-bold ${
                    tab === t.id ? 'bg-gray-950 text-orange-400' : 'bg-red-500 text-white'
                  }`}>{t.badge > 9 ? '9+' : t.badge}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ═══════ PULSE TAB / ONBOARDING ═══════ */}
        {tab === 'pulse' && (<>

          {/* ── Onboarding (if incomplete) ──────────────────────── */}
          {showOnboarding && (
            <div className="mt-6">
              <OnboardingProgress user={user} onResume={() => navigate('/register/helper')} />
            </div>
          )}

          {/* ── Stat cards (show always, dimmed if onboarding) ──── */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 ${showOnboarding ? 'opacity-50 pointer-events-none' : ''}`}>
            <StatCard label="Jobs Completed" value={user?.completed_jobs || 0}
              sub={user?.avg_rating ? `${user.avg_rating}★ avg rating` : 'Complete a job to get rated'}
              IconComp={IcoBriefcase} color="text-orange-400" />
            <StatCard label="Active Bids" value={activeBids.length}
              sub={wonBids.length > 0 ? `${wonBids.length} accepted` : 'Browse jobs to start bidding'}
              IconComp={IcoTarget} color="text-blue-400" />
            <StatCard label="Plan"
              value={isProActive ? 'Pro' : 'Free'}
              sub={isProActive ? 'All features unlocked' : null}
              IconComp={IcoStar} color={isProActive ? 'text-orange-400' : 'text-gray-500'} />
            <StatCard label="Your Rating" value={user?.avg_rating || '—'}
              sub={user?.completed_jobs > 0 ? `Based on ${user.completed_jobs} jobs` : 'No reviews yet'}
              IconComp={IcoStar} color={user?.avg_rating >= 4.5 ? 'text-yellow-400' : 'text-gray-400'} />
          </div>

          {/* ── Verification cards (if onboarding done) ─────────── */}
          {!showOnboarding && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              {/* Subscription */}
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <IcoDollar size={16} cls="text-orange-400" />
                  <span className="text-sm font-semibold">Subscription</span>
                </div>
                {isProActive ? (
                  <>
                    <p className="text-lg font-bold text-orange-400 mb-1">Pro</p>
                    <Tag text="Active" color="green" />
                    <p className="text-xs text-gray-500 mt-2">
                      Renews {new Date(subscription.current_period_end).toLocaleDateString()}
                    </p>
                    <button onClick={openPortal}
                      className="mt-3 text-xs text-gray-400 hover:text-gray-200 transition font-medium">
                      Manage Billing →
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-bold text-gray-400 mb-1">Free</p>
                    <p className="text-xs text-gray-500 mb-3">Upgrade for verified badge, background check, and priority placement.</p>
                    <button onClick={() => navigate('/upgrade')}
                      className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">
                      Upgrade to Pro
                    </button>
                  </>
                )}
              </div>

              {/* Background Check */}
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <IcoShield size={16} cls="text-orange-400" />
                  <span className="text-sm font-semibold">Background Check</span>
                </div>
                {verification.backgroundCheck ? (
                  <>
                    <Tag text={verification.backgroundCheck.status}
                      color={verification.backgroundCheck.status === 'passed' ? 'green' :
                             verification.backgroundCheck.status === 'pending' ? 'orange' : 'red'} />
                    {verification.backgroundCheck.completed_at && (
                      <p className="text-xs text-gray-500 mt-2">
                        Completed {new Date(verification.backgroundCheck.completed_at).toLocaleDateString()}
                      </p>
                    )}
                  </>
                ) : isProActive ? (
                  <>
                    <p className="text-xs text-gray-500 mb-3">A passed check adds a verified badge to your profile.</p>
                    <button onClick={startBackgroundCheck}
                      className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">
                      Start Check
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Requires Pro subscription.</p>
                )}
              </div>

              {/* Identity Verification */}
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <IcoId size={16} cls="text-orange-400" />
                  <span className="text-sm font-semibold">ID Verification</span>
                </div>
                {verification.identity ? (
                  <Tag text={verification.identity.status}
                    color={verification.identity.status === 'approved' ? 'green' :
                           verification.identity.status === 'pending' ? 'orange' : 'red'} />
                ) : isProActive ? (
                  <>
                    <p className="text-xs text-gray-500 mb-3">Verify your identity to build trust with customers.</p>
                    <button onClick={startIdentityVerification}
                      className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">
                      Verify ID
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Requires Pro subscription.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Quick actions (if onboarding done) ──────────────── */}
          {!showOnboarding && (
            <>
              <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  { to: '/jobs', IconComp: IcoBriefcase, label: 'Browse Jobs', color: 'text-orange-400' },
                  { to: '/messages', IconComp: IcoChat, label: 'Messages', color: 'text-blue-400' },
                  { to: '/disputes', IconComp: IcoShield, label: 'Disputes', color: 'text-purple-400' },
                  { to: '/settings', IconComp: IcoSettings, label: 'Settings', color: 'text-gray-400' },
                ].map((a, i) => (
                  <Link key={i} to={a.to}
                    className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-4 hover:border-gray-600 hover:-translate-y-0.5 transition-all group flex items-center gap-3">
                    <a.IconComp size={18} cls={a.color} />
                    <span className="text-sm font-medium text-gray-300 group-hover:text-white transition">{a.label}</span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {/* ── Nearby jobs preview (if onboarding done) ────────── */}
          {!showOnboarding && nearbyJobs.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <IcoZap size={18} cls="text-orange-400" />
                  <h3 className="font-semibold text-white">Jobs Near You</h3>
                </div>
                <Link to="/jobs" className="text-xs text-orange-400 hover:text-orange-300 font-medium transition">
                  View All →
                </Link>
              </div>
              <div className="space-y-2">
                {nearbyJobs.slice(0, 4).map(job => (
                  <Link key={job.id} to={`/jobs/${job.id}`}
                    className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl hover:bg-gray-800/60 transition group">
                    <div className="min-w-0 flex-1 mr-4">
                      <p className="text-white font-medium text-sm group-hover:text-orange-400 transition truncate">{job.title}</p>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {job.category_name || job.category}
                        {job.location_city ? ` · ${job.location_city}` : ''}
                        {job.distance_miles ? ` · ${job.distance_miles} mi` : ''}
                        {job.bid_count > 0 ? ` · ${job.bid_count} bids` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {(job.budget_min || job.budget_max) && (
                        <span className="text-sm font-bold text-emerald-400">
                          ${job.budget_min||'?'}–${job.budget_max||'?'}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ── Notifications preview ───────────────────────────── */}
          {!showOnboarding && notifications.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <IcoBell size={18} cls="text-orange-400" />
                  <h3 className="font-semibold text-white">Recent Updates</h3>
                </div>
                {unreadNotifs > 0 && <Tag text={`${unreadNotifs} new`} color="orange" />}
              </div>
              <div className="space-y-1">
                {notifications.slice(0, 4).map(n => (
                  <div key={n.id} className={`p-3 rounded-xl text-sm flex items-start gap-3 ${
                    n.read || n.read_at ? 'text-gray-500' : 'bg-gray-800/30 text-white'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${
                      n.read || n.read_at ? 'bg-gray-700' : 'bg-orange-400'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <p className="leading-relaxed truncate">{n.message || n.title}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Upgrade CTA (if free) ──────────────────────────── */}
          {!showOnboarding && !isProActive && (
            <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <IcoZap size={18} cls="text-orange-400" />
                  <h3 className="text-lg font-bold text-white">Upgrade to Pro</h3>
                </div>
                <p className="text-sm text-gray-400">
                  Get priority placement, verified badge, background check, identity verification, and bid alerts.
                </p>
              </div>
              <button onClick={() => navigate('/upgrade')}
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition whitespace-nowrap text-sm">
                View Plans
              </button>
            </div>
          )}
        </>)}

        {/* ═══════ FIND JOBS TAB ═══════ */}
        {tab === 'jobs' && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white text-lg">Available Jobs</h3>
              <Link to="/jobs" className="text-sm text-orange-400 hover:text-orange-300 font-medium">
                Advanced Search →
              </Link>
            </div>
            {nearbyJobs.length === 0 ? (
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-16 text-center">
                <IcoMap size={36} cls="text-gray-700 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No jobs available in your area right now.</p>
                <p className="text-xs text-gray-600">Check back soon — new jobs are posted every day.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {nearbyJobs.map(job => (
                  <Link key={job.id} to={`/jobs/${job.id}`}
                    className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                    <div className="min-w-0 flex-1 mr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-white font-medium group-hover:text-orange-400 transition truncate">{job.title}</p>
                        {job.is_urgent && <Tag text="Urgent" color="red" />}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {job.category_name || job.category}
                        {job.location_city ? ` · ${job.location_city}` : ''}
                        {job.distance_miles ? ` · ${job.distance_miles} mi away` : ''}
                        {job.bid_count > 0 ? ` · ${job.bid_count} bid${job.bid_count>1?'s':''}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {(job.budget_min || job.budget_max) && (
                        <span className="text-base font-bold text-emerald-400">
                          ${job.budget_min||'?'}–${job.budget_max||'?'}
                        </span>
                      )}
                      <span className="text-xs bg-orange-500/15 text-orange-400 px-3 py-1.5 rounded-lg font-semibold">
                        View
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════ BIDS TAB ═══════ */}
        {tab === 'bids' && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white text-lg">My Bids</h3>
              <div className="flex gap-2">
                <Tag text={`${activeBids.length} active`} color="orange" />
                <Tag text={`${wonBids.length} won`} color="green" />
              </div>
            </div>
            {myBids.length === 0 ? (
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-16 text-center">
                <IcoTarget size={36} cls="text-gray-700 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">You haven't placed any bids yet.</p>
                <Link to="/jobs" className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm">
                  Browse Available Jobs
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {myBids.map(bid => (
                  <Link key={bid.id} to={`/jobs/${bid.job_id}`}
                    className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                    <div className="min-w-0 flex-1 mr-4">
                      <p className="text-white font-medium group-hover:text-orange-400 transition truncate">
                        {bid.job_title || `Job #${bid.job_id}`}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Bid: <span className="text-white font-semibold">${bid.amount}</span>
                        {bid.created_at ? ` · ${new Date(bid.created_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <Tag text={(bid.status||'').replace(/_/g,' ')} color={
                      bid.status === 'accepted' ? 'green' :
                      bid.status === 'pending' ? 'orange' :
                      bid.status === 'rejected' ? 'red' : 'gray'
                    } />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════ UPDATES TAB ═══════ */}
        {tab === 'updates' && (
          <div>
            <h3 className="font-semibold text-white text-lg mb-5">All Notifications</h3>
            {notifications.length === 0 ? (
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-16 text-center">
                <IcoBell size={36} cls="text-gray-700 mx-auto mb-4" />
                <p className="text-gray-500">No notifications yet.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {notifications.map(n => (
                  <div key={n.id} className={`p-4 rounded-xl flex items-start gap-3 ${
                    n.read || n.read_at ? 'text-gray-500' : 'bg-gray-900/60 border border-gray-700/40 text-white'
                  }`}>
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                      n.read || n.read_at ? 'bg-gray-700' : 'bg-orange-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed">{n.message || n.title}</p>
                      <p className="text-xs text-gray-600 mt-1">{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
