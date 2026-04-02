import { useAuth } from '../hooks/useAuth';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

// ── Inline SVG Icons ──────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400', ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cls} {...rest}>{children}</svg>
);
const IcoBriefcase  = (p) => <Ico {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></Ico>;
const IcoPlus       = (p) => <Ico {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Ico>;
const IcoSearch     = (p) => <Ico {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Ico>;
const IcoChat       = (p) => <Ico {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></Ico>;
const IcoBell       = (p) => <Ico {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></Ico>;
const IcoSettings   = (p) => <Ico {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></Ico>;
const IcoShield     = (p) => <Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ico>;
const IcoScale      = (p) => <Ico {...p}><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></Ico>;
const IcoUsers      = (p) => <Ico {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>;
const IcoStar       = (p) => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;
const IcoClock      = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>;
const IcoArrowR     = (p) => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Ico>;
const IcoZap        = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;

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

// ── Quick Action ──────────────────────────────────────────────────────────
const QuickAction = ({ to, IconComp, label, desc, highlight, badge }) => (
  <Link to={to} className={`group relative rounded-2xl p-5 border transition-all hover:-translate-y-0.5 ${
    highlight
      ? 'bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/30 hover:border-orange-500/60'
      : 'bg-gray-900/50 border-gray-700/40 hover:border-gray-600'
  }`}>
    <div className="mb-3">
      <IconComp size={20} cls={highlight ? 'text-orange-400' : 'text-gray-500'} />
    </div>
    <h3 className="font-semibold text-white group-hover:text-orange-400 transition text-sm">{label}</h3>
    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{desc}</p>
    {badge > 0 && (
      <span className="absolute top-3 right-3 bg-orange-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">{badge}</span>
    )}
  </Link>
);

// ═══════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [myJobs, setMyJobs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pulse');

  useEffect(() => {
    const fetch = async () => {
      try {
        const [jobsRes, notifRes, msgRes] = await Promise.allSettled([
          api.get('/jobs/me/list'),
          api.get('/notifications'),
          api.get('/messages/conversations'),
        ]);
        if (jobsRes.status === 'fulfilled') setMyJobs(jobsRes.value.data?.jobs || jobsRes.value.data || []);
        if (notifRes.status === 'fulfilled') setNotifications(notifRes.value.data?.notifications || notifRes.value.data || []);
        if (msgRes.status === 'fulfilled') setConversations(msgRes.value.data?.conversations || msgRes.value.data || []);
      } catch (e) { console.error('Dashboard fetch error:', e); }
      finally { setLoading(false); }
    };
    fetch();
  }, []);

  // ── Derived data ──────────────────────────────────────────────────
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const displayName = user?.first_name || '';
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

  const unreadNotifs = Array.isArray(notifications) ? notifications.filter(n => !n.read && !n.read_at).length : 0;
  const unreadMsgs = Array.isArray(conversations) ? conversations.filter(c => c.unread_count > 0).length : 0;
  const activeJobs = Array.isArray(myJobs) ? myJobs.filter(j => j.status === 'open' || j.status === 'in_progress' || j.status === 'published') : [];
  const completedJobs = Array.isArray(myJobs) ? myJobs.filter(j => j.status === 'completed' || j.status === 'closed') : [];
  const isFreeTier = !user?.tier || user?.tier === 'free';

  const tabs = [
    { id: 'pulse', label: 'My Pulse' },
    { id: 'jobs', label: 'My Jobs' },
    { id: 'updates', label: 'Updates', badge: unreadNotifs },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Greeting ─────────────────────────────────────────── */}
        <div className="mb-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold">
              {greeting}{displayName ? `, ${displayName}` : ''}!
            </h1>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F97316"
              strokeWidth="2" strokeLinecap="round" className="animate-pulse">
              <path d="M3 12h4l3-9 4 18 3-9h4"/>
            </svg>
          </div>
          <p className="text-gray-500 mt-1 text-sm">
            {new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })}
            {' — '}Here's your life at a glance.
          </p>
        </div>

        {/* ── Email verification ────────────────────────────────── */}
        {user && !user.email_verified && (
          <div className="my-5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠</span>
              <div>
                <p className="text-yellow-400 font-medium text-sm">Email not verified</p>
                <p className="text-xs text-gray-400">Verify your email to unlock all features.</p>
              </div>
            </div>
            <button onClick={async () => {
              try { await api.post('/auth/resend-verification'); toast.success('Verification email sent!'); }
              catch { toast.error('Could not send verification email.'); }
            }} className="text-xs bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 px-4 py-2 rounded-lg transition whitespace-nowrap">
              Resend Verification
            </button>
          </div>
        )}

        {/* ── Tabs ──────────────────────────────────────────────── */}
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
                }`}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* ═══════ PULSE TAB ═══════ */}
        {tab === 'pulse' && (<>

          {/* ── Stat cards ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Active Jobs" value={loading ? '...' : activeJobs.length}
              sub={completedJobs.length > 0 ? `${completedJobs.length} completed total` : 'Post your first job'}
              IconComp={IcoBriefcase} color="text-orange-400" />
            <StatCard label="Unread Messages" value={loading ? '...' : unreadMsgs}
              sub={unreadMsgs > 0 ? 'Tap to view' : 'All caught up'}
              IconComp={IcoChat} color={unreadMsgs > 0 ? 'text-blue-400' : 'text-gray-600'} />
            <StatCard label="Subscription" value={isFreeTier ? 'Free' : 'Community+'}
              sub={isFreeTier ? null : 'All features unlocked'}
              IconComp={IcoStar} color={isFreeTier ? 'text-gray-500' : 'text-orange-400'} />
            <StatCard label="Member Since" value={memberSince || '—'}
              IconComp={IcoClock} color="text-gray-400" />
          </div>

          {/* ── Quick actions ───────────────────────────────────── */}
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
            <QuickAction to="/post-job" IconComp={IcoPlus} label="Post a Job"
              desc="Describe what you need and get bids from local helpers." highlight />
            <QuickAction to="/jobs" IconComp={IcoSearch} label="Browse Helpers"
              desc="Find trusted helpers in your area for any project." />
            <QuickAction to="/messages" IconComp={IcoChat} label="Messages"
              desc={unreadMsgs > 0 ? `${unreadMsgs} unread conversation${unreadMsgs > 1 ? 's' : ''}` : 'Chat with helpers.'}
              badge={unreadMsgs} />
            <QuickAction to="/disputes" IconComp={IcoScale} label="Disputes"
              desc="View and manage any open disputes." />
            <QuickAction to="/settings" IconComp={IcoSettings} label="Settings"
              desc="Edit profile, password, and preferences." />
            <QuickAction to="/settings/2fa" IconComp={IcoShield} label="Security"
              desc="Set up two-factor authentication." />
          </div>

          {/* ── Active jobs ─────────────────────────────────────── */}
          <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <IcoBriefcase size={18} cls="text-orange-400" />
                <h3 className="font-semibold text-white">Active Jobs</h3>
              </div>
              <Link to="/post-job" className="text-xs text-orange-400 hover:text-orange-300 font-medium transition">+ Post New</Link>
            </div>
            {loading ? (
              <div className="text-center py-8 text-gray-600 text-sm">Loading...</div>
            ) : activeJobs.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-gray-500 mb-3 text-sm">You haven't posted any jobs yet.</p>
                <Link to="/post-job" className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium">
                  Post your first job <IcoArrowR size={14} cls="text-orange-400" />
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {activeJobs.slice(0, 5).map(job => (
                  <Link key={job.id} to={`/jobs/${job.id}`}
                    className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl hover:bg-gray-800/60 transition group">
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium text-sm group-hover:text-orange-400 transition truncate">{job.title}</p>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {job.category_name || job.category}
                        {(job.location_city || job.city) ? ` · ${job.location_city || job.city}` : ''}
                        {job.bid_count > 0 ? ` · ${job.bid_count} bid${job.bid_count > 1 ? 's' : ''}` : ''}
                      </p>
                    </div>
                    <Tag text={job.status === 'open' || job.status === 'published' ? 'Open' : 'In Progress'}
                      color={job.status === 'open' || job.status === 'published' ? 'green' : 'blue'} />
                  </Link>
                ))}
                {activeJobs.length > 5 && <p className="text-xs text-gray-500 text-center pt-2">+ {activeJobs.length - 5} more</p>}
              </div>
            )}
          </div>

          {/* ── Notifications preview ───────────────────────────── */}
          <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <IcoBell size={18} cls="text-orange-400" />
                <h3 className="font-semibold text-white">Recent Updates</h3>
              </div>
              {unreadNotifs > 0 && <Tag text={`${unreadNotifs} new`} color="orange" />}
            </div>
            {loading ? (
              <div className="text-center py-6 text-gray-600 text-sm">Loading...</div>
            ) : !Array.isArray(notifications) || notifications.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">No notifications yet.</p>
            ) : (
              <div className="space-y-1">
                {notifications.slice(0, 4).map(n => (
                  <div key={n.id} className={`p-3 rounded-xl text-sm flex items-start gap-3 transition ${
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
                {notifications.length > 4 && (
                  <button onClick={() => setTab('updates')} className="w-full text-center text-xs text-orange-400 hover:text-orange-300 pt-2 font-medium">
                    View all {notifications.length} notifications →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Account details ─────────────────────────────────── */}
          <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <IcoUsers size={18} cls="text-orange-400" />
                <h3 className="font-semibold text-white">Account Details</h3>
              </div>
              <Link to="/settings" className="text-xs text-orange-400 hover:text-orange-300 transition font-medium">Edit →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1">Full Name</p>
                <p className="text-white text-sm">{user?.first_name || user?.last_name ? `${user?.first_name||''} ${user?.last_name||''}`.trim() : <span className="text-gray-600 italic">Not set</span>}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1">Email</p>
                <p className="text-white text-sm">{user?.email}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1">Phone</p>
                <p className="text-white text-sm">{user?.phone || <span className="text-gray-600 italic">Not set</span>}</p>
              </div>
            </div>
          </div>

          {/* ── Upgrade CTA ────────────────────────────────────── */}
          {isFreeTier && (
            <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <IcoZap size={18} cls="text-orange-400" />
                  <h3 className="text-lg font-bold text-white">Upgrade to Community+</h3>
                </div>
                <p className="text-sm text-gray-400">
                  Unlock your life dashboard — budget tracking, goal setting, home maintenance reminders, saved helpers, and more.
                </p>
              </div>
              <Link to="/upgrade" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition whitespace-nowrap text-sm">
                View Plans
              </Link>
            </div>
          )}
        </>)}

        {/* ═══════ JOBS TAB ═══════ */}
        {tab === 'jobs' && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white text-lg">All My Jobs</h3>
              <Link to="/post-job" className="text-sm bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl transition">
                + Post a Job
              </Link>
            </div>
            {loading ? (
              <div className="text-center py-16 text-gray-600">Loading your jobs...</div>
            ) : !Array.isArray(myJobs) || myJobs.length === 0 ? (
              <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-16 text-center">
                <IcoBriefcase size={36} cls="text-gray-700 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No jobs posted yet.</p>
                <Link to="/post-job" className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm">
                  Post Your First Job
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {myJobs.map(job => (
                  <Link key={job.id} to={`/jobs/${job.id}`}
                    className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                    <div className="min-w-0 flex-1 mr-4">
                      <p className="text-white font-medium group-hover:text-orange-400 transition truncate">{job.title}</p>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {job.category_name || job.category}
                        {job.location_city ? ` · ${job.location_city}` : ''}
                        {(job.budget_min || job.budget_max) ? ` · $${job.budget_min||'?'}–$${job.budget_max||'?'}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {job.bid_count > 0 && <span className="text-xs text-gray-500">{job.bid_count} bid{job.bid_count!==1?'s':''}</span>}
                      <Tag text={(job.status||'').replace(/_/g,' ')} color={
                        job.status==='open'||job.status==='published' ? 'green' :
                        job.status==='in_progress' ? 'blue' :
                        job.status==='completed'||job.status==='closed' ? 'gray' :
                        job.status==='cancelled' ? 'red' : 'gray'
                      } />
                    </div>
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
            {loading ? (
              <div className="text-center py-16 text-gray-600">Loading...</div>
            ) : !Array.isArray(notifications) || notifications.length === 0 ? (
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
