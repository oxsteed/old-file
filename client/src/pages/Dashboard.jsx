import { useAuth } from '../hooks/useAuth';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import useLifeDashboard from '../hooks/useLifeDashboard';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import TrialBanner from '../components/TrialBanner';

// ── Icons ─────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoBriefcase = (p) => <Ico {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></Ico>;
const IcoPlus      = (p) => <Ico {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Ico>;
const IcoSearch    = (p) => <Ico {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Ico>;
const IcoChat      = (p) => <Ico {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></Ico>;
const IcoBell      = (p) => <Ico {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></Ico>;
const IcoSettings  = (p) => <Ico {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></Ico>;
const IcoShield    = (p) => <Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ico>;
const IcoScale     = (p) => <Ico {...p}><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></Ico>;
const IcoUsers     = (p) => <Ico {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>;
const IcoStar      = (p) => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;
const IcoZap       = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;
const IcoClock     = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>;
const IcoArrowR    = (p) => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Ico>;
const IcoDollar    = (p) => <Ico {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>;
const IcoHome      = (p) => <Ico {...p}><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></Ico>;
const IcoTarget    = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ico>;
const IcoCheck     = (p) => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoTrash     = (p) => <Ico {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></Ico>;
const IcoX         = (p) => <Ico {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;

// ── Shared UI ─────────────────────────────────────────────────────────────
const Tag = ({ text, color = 'orange' }) => {
  const m = { orange:'bg-orange-500/15 text-orange-400', green:'bg-emerald-500/15 text-emerald-400', red:'bg-red-500/15 text-red-400', gray:'bg-gray-700/40 text-gray-400', blue:'bg-blue-500/15 text-blue-400', purple:'bg-purple-500/15 text-purple-400' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${m[color]||m.orange}`}>{text}</span>;
};
const ProgressBar = ({ pct, color = 'bg-orange-500' }) => (
  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width:`${Math.min(pct,100)}%` }}/>
  </div>
);
const Card = ({ children, className = '' }) => (
  <div className={`bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 ${className}`}>{children}</div>
);
const CardHeader = ({ icon: IconComp, title, right }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2.5">
      {IconComp && <IconComp size={18} cls="text-orange-400"/>}
      <h3 className="font-semibold text-white text-sm">{title}</h3>
    </div>
    {right}
  </div>
);
const Btn = ({ children, onClick, variant = 'primary', className = '', ...rest }) => {
  const v = { primary:'bg-orange-500 hover:bg-orange-600 text-white', secondary:'bg-gray-800 hover:bg-gray-700 text-gray-300', danger:'bg-red-500/20 hover:bg-red-500/30 text-red-400' };
  return <button onClick={onClick} className={`text-xs font-semibold px-4 py-2 rounded-lg transition ${v[variant]} ${className}`} {...rest}>{children}</button>;
};
const Input = ({ label, ...rest }) => (
  <div>
    {label && <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}
    <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition" {...rest}/>
  </div>
);
const Select = ({ label, children, ...rest }) => (
  <div>
    {label && <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}
    <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition" {...rest}>{children}</select>
  </div>
);

// ── Modal Wrapper ─────────────────────────────────────────────────────────
const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"/>
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition"><IcoX size={18}/></button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const life = useLifeDashboard();

  const [myJobs, setMyJobs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('pulse');

  // Modal state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showHomeTaskModal, setShowHomeTaskModal] = useState(false);
  const [showChecklistModal, setShowChecklistModal] = useState(false);

  // Form state
  const [expenseForm, setExpenseForm] = useState({ type:'expense', amount:'', category:'', description:'' });
  const [goalForm, setGoalForm] = useState({ title:'', goal_type:'financial', target_value:'', icon:'🎯' });
  const [homeTaskForm, setHomeTaskForm] = useState({ title:'', due_date:'', urgency:'low', recurrence_days:'' });
  const [checklistForm, setChecklistForm] = useState({ title:'', due_date:'' });

  const retryLoad = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [jobsRes, notifRes, msgRes] = await Promise.allSettled([
        api.get('/jobs/me/list'), api.get('/notifications'), api.get('/messages/conversations'),
      ]);
      const anyFailed = [jobsRes, notifRes, msgRes].some(r => r.status === 'rejected');
      if (anyFailed) setError(true);
      if (jobsRes.status === 'fulfilled') setMyJobs(jobsRes.value.data?.jobs || jobsRes.value.data || []);
      if (notifRes.status === 'fulfilled') setNotifications(notifRes.value.data?.notifications || notifRes.value.data || []);
      if (msgRes.status === 'fulfilled') setConversations(msgRes.value.data?.conversations || msgRes.value.data || []);
    } catch (e) { console.error(e); setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    retryLoad();
    life.fetchSummary();
    life.fetchCommunity();
    life.fetchExpenses();
    life.fetchBudgets();
    life.fetchGoals();
    life.fetchHomeTasks({ completed: 'false' });
    life.fetchChecklist();
    life.fetchSavedHelpers();
  }, []);

  // ── Derived ───────────────────────────────────────────────────────
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const displayName = (() => {
    const pref = user?.display_name_preference || 'first_name';
    if (pref === 'full_name') return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
    if (pref === 'business_name') return user?.business_name || user?.first_name || '';
    return user?.first_name || '';
  })();
  const unreadNotifs = Array.isArray(notifications) ? notifications.filter(n => !n.read && !n.read_at).length : 0;
  const unreadMsgs = Array.isArray(conversations) ? conversations.filter(c => c.unread_count > 0).length : 0;
  const activeJobs = Array.isArray(myJobs) ? myJobs.filter(j => ['open','in_progress','published'].includes(j.status)) : [];
  const isFreeTier = !user?.tier || user?.tier === 'free';
  const s = life.summary;

  // ── Form handlers ─────────────────────────────────────────────────
  const handleAddExpense = async (e) => {
    e.preventDefault();
    try {
      await life.createExpense({ ...expenseForm, amount: parseFloat(expenseForm.amount) });
      toast.success('Expense logged!');
      setExpenseForm({ type:'expense', amount:'', category:'', description:'' });
      setShowExpenseModal(false);
      life.fetchSummary();
      life.fetchExpenses();
    } catch { toast.error('Failed to save.'); }
  };
  const handleAddGoal = async (e) => {
    e.preventDefault();
    try {
      await life.createGoal({ ...goalForm, target_value: goalForm.target_value ? parseFloat(goalForm.target_value) : null });
      toast.success('Goal created!');
      setGoalForm({ title:'', goal_type:'financial', target_value:'', icon:'🎯' });
      setShowGoalModal(false);
      life.fetchSummary();
    } catch { toast.error('Failed to save.'); }
  };
  const handleAddHomeTask = async (e) => {
    e.preventDefault();
    try {
      await life.createHomeTask({ ...homeTaskForm, recurrence_days: homeTaskForm.recurrence_days ? parseInt(homeTaskForm.recurrence_days) : null });
      toast.success('Task added!');
      setHomeTaskForm({ title:'', due_date:'', urgency:'low', recurrence_days:'' });
      setShowHomeTaskModal(false);
      life.fetchSummary();
    } catch { toast.error('Failed to save.'); }
  };
  const handleAddChecklist = async (e) => {
    e.preventDefault();
    try {
      await life.createChecklistItem(checklistForm);
      toast.success('Item added!');
      setChecklistForm({ title:'', due_date:'' });
      setShowChecklistModal(false);
      life.fetchSummary();
    } catch { toast.error('Failed to save.'); }
  };
  const toggleChecklist = async (item) => {
    try {
      await life.updateChecklistItem(item.id, { is_completed: !item.is_completed });
      life.fetchSummary();
    } catch { toast.error('Failed to update.'); }
  };
  const toggleHomeTask = async (task) => {
    try {
      await life.updateHomeTask(task.id, { is_completed: !task.is_completed });
      life.fetchSummary();
      life.fetchHomeTasks({ completed: 'false' });
    } catch { toast.error('Failed to update.'); }
  };
  const updateGoalProgress = async (goal, newValue) => {
    try {
      const val = parseFloat(newValue);
      if (isNaN(val)) return;
      await life.updateGoal(goal.id, { current_value: val, is_completed: goal.target_value && val >= goal.target_value });
      life.fetchSummary();
      toast.success('Progress updated!');
    } catch { toast.error('Failed to update.'); }
  };

  const tabs = [
    { id:'pulse', label:'My Pulse' },
    { id:'money', label:'Money' },
    { id:'home', label:'Home' },
    { id:'goals', label:'Goals' },
    { id:'jobs', label:'My Jobs' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Trial Banner */}
        <div className="mb-5">
          <TrialBanner />
        </div>

        {/* Greeting */}
        <div className="mb-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold">{greeting}{displayName ? `, ${displayName}` : ''}!</h1>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" className="animate-pulse"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>
          </div>
          <p className="text-gray-500 mt-1 text-sm">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} — Here's your life at a glance.</p>
        </div>

        {/* Email warning */}
        {user && !user.email_verified && (
          <div className="my-5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3"><span className="text-2xl">⚠</span><div><p className="text-yellow-400 font-medium text-sm">Email not verified</p><p className="text-xs text-gray-400">Verify your email to unlock all features.</p></div></div>
            <button onClick={async()=>{try{await api.post('/auth/resend-verification');toast.success('Sent!')}catch{toast.error('Failed.')}}} className="text-xs bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 px-4 py-2 rounded-lg transition">Resend</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 my-6 bg-gray-900/80 rounded-xl p-1 w-fit overflow-x-auto">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${tab===t.id?'bg-orange-500 text-gray-950':'text-gray-500 hover:text-gray-300'}`}>{t.label}</button>
          ))}
        </div>

        {/* ═══════ PULSE ═══════ */}
        {tab==='pulse' && (<>
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-2">
              <span>⚠</span>
              <span>Some data failed to load. <button onClick={retryLoad} className="underline hover:text-red-300">Retry</button></span>
            </div>
          )}
          {/* Life Pulse Score */}
          {s?.pulse_score !== undefined && (
            <div className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 border border-gray-700/40 rounded-2xl p-6 mb-6 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-6">
                <div className="relative w-20 h-20">
                  <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="#1f2937" strokeWidth="6"/>
                    <circle cx="40" cy="40" r="34" fill="none" stroke="#F97316" strokeWidth="6"
                      strokeDasharray={`${(s.pulse_score / 100) * 213.6} 213.6`} strokeLinecap="round"
                      className="transition-all duration-1000"/>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold text-orange-400">{s.pulse_score}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold mb-1">Life Pulse Score</p>
                  <p className="text-sm text-gray-400 max-w-xs">
                    {s.pulse_score >= 80 ? "You're crushing it. Finances, goals, and home are all in great shape." :
                     s.pulse_score >= 60 ? "Good momentum. A few areas could use attention — check your goals and home tasks." :
                     s.pulse_score >= 40 ? "Room to grow. Focus on logging expenses and tackling overdue items." :
                     "Let's get started. Add some goals and expenses to get your pulse moving."}
                  </p>
                </div>
              </div>
              {s.pulse_breakdown && (
                <div className="grid grid-cols-4 gap-4">
                  {[
                    {l:'Finances',v:s.pulse_breakdown.finances,c:'text-emerald-400'},
                    {l:'Goals',v:s.pulse_breakdown.goals,c:'text-purple-400'},
                    {l:'Home',v:s.pulse_breakdown.home,c:'text-blue-400'},
                    {l:'Activity',v:s.pulse_breakdown.activity,c:'text-orange-400'},
                  ].map((d,i)=>(
                    <div key={i} className="text-center">
                      <p className={`text-lg font-bold ${d.c}`}>{d.v}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{d.l}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Net This Month</p>
              {loading
                ? <div className="h-8 w-20 bg-gray-800 rounded animate-pulse mt-1" />
                : <p className={`text-2xl font-bold ${(s?.finances?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(s?.finances?.net||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
              }
              <p className="text-xs text-gray-500 mt-1">${(s?.finances?.total_income||0).toFixed(0)} in · ${(s?.finances?.total_expenses||0).toFixed(0)} out</p>
            </Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Active Jobs</p>
              {loading
                ? <div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1" />
                : <p className="text-2xl font-bold text-orange-400">{activeJobs.length}</p>
              }
              <p className="text-xs text-gray-500 mt-1">{unreadMsgs>0?`${unreadMsgs} unread messages`:'All caught up'}</p>
            </Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Goals Progress</p>
              {loading
                ? <div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1" />
                : <p className="text-2xl font-bold text-purple-400">{s?.goals?.avg_progress||0}%</p>
              }
              <p className="text-xs text-gray-500 mt-1">{s?.goals?.active||0} active goals</p>
            </Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Home Tasks</p>
              {loading
                ? <div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1" />
                : <p className={`text-2xl font-bold ${(s?.home?.overdue||0)>0?'text-red-400':'text-emerald-400'}`}>{s?.home?.overdue||0}</p>
              }
              <p className="text-xs text-gray-500 mt-1">{(s?.home?.overdue||0)>0?'overdue tasks':'All on track'} · {s?.home?.due_this_week||0} due this week</p>
            </Card>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              {to:'/post-job',Ic:IcoPlus,l:'Post a Job',c:'text-orange-400'},
              {to:'/jobs',Ic:IcoSearch,l:'Find Helpers',c:'text-blue-400'},
              {to:'/messages',Ic:IcoChat,l:'Messages',c:'text-emerald-400',badge:unreadMsgs},
              {to:'/settings',Ic:IcoSettings,l:'Settings',c:'text-gray-400'},
            ].map((a,i)=>(
              <Link key={i} to={a.to} className="relative bg-gray-900/50 border border-gray-700/40 rounded-2xl p-4 hover:border-gray-600 hover:-translate-y-0.5 transition-all group flex items-center gap-3">
                <a.Ic size={18} cls={a.c}/><span className="text-sm font-medium text-gray-300 group-hover:text-white transition">{a.l}</span>
                {a.badge>0&&<span className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold">{a.badge}</span>}
              </Link>
            ))}
          </div>

          {/* Active jobs preview */}
          {activeJobs.length > 0 && (
            <Card className="mb-6">
              <CardHeader icon={IcoBriefcase} title="Active Jobs" right={<Link to="/post-job" className="text-xs text-orange-400 hover:text-orange-300 font-medium">+ Post New</Link>}/>
              <div className="space-y-2">
                {activeJobs.slice(0,3).map(job=>(
                  <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl hover:bg-gray-800/60 transition group">
                    <div className="min-w-0 flex-1"><p className="text-white text-sm font-medium group-hover:text-orange-400 transition truncate">{job.title}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}</p></div>
                    <Tag text={job.status==='open'||job.status==='published'?'Open':'In Progress'} color={job.status==='open'||job.status==='published'?'green':'blue'}/>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {/* Community Pulse */}
          {life.community && (
            <Card className="mb-6">
              <CardHeader icon={IcoUsers} title="Community Pulse" right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">Browse Jobs →</Link>}/>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                  <p className="text-xl font-bold text-orange-400">{life.community.jobs_this_week}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Jobs This Week</p>
                </div>
                <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                  <p className="text-xl font-bold text-emerald-400">{life.community.open_jobs}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Open Now</p>
                </div>
                <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                  <p className="text-xl font-bold text-blue-400">{life.community.active_helpers}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Active Helpers</p>
                </div>
                <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                  <p className="text-xl font-bold text-purple-400">{life.community.active_seekers}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Seekers This Week</p>
                </div>
              </div>
              {life.community.top_categories?.length > 0 && (
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Trending:</span>
                  {life.community.top_categories.slice(0,3).map((c,i) => (
                    <Tag key={i} text={`${c.category_name} (${c.job_count})`} color={['orange','green','blue'][i]}/>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Upgrade CTA */}
          {isFreeTier && (
            <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div><div className="flex items-center gap-2 mb-1"><IcoZap size={18} cls="text-orange-400"/><h3 className="text-lg font-bold text-white">Upgrade to Community+</h3></div><p className="text-sm text-gray-400">Budget tracking, goals, home reminders, saved helpers, and more.</p></div>
              <Link to="/upgrade" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition whitespace-nowrap text-sm">View Plans</Link>
            </div>
          )}
        </>)}

        {/* ═══════ MONEY TAB ═══════ */}
        {tab==='money' && (<>
          {/* Monthly summary */}
          <Card className="mb-6">
            <CardHeader icon={IcoDollar} title={`${new Date().toLocaleString('en-US',{month:'long'})} ${new Date().getFullYear()}`} right={<Btn onClick={()=>setShowExpenseModal(true)}>+ Log Transaction</Btn>}/>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Income</p><p className="text-xl font-bold text-emerald-400">${(life.expenseSummary?.total_income||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Expenses</p><p className="text-xl font-bold text-red-400">${(life.expenseSummary?.total_expenses||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Net</p><p className={`text-xl font-bold ${(life.expenseSummary?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(life.expenseSummary?.net||0).toFixed(2)}</p></div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Recent transactions */}
            <Card>
              <CardHeader icon={IcoDollar} title="Recent Transactions"/>
              {life.expenses.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No transactions yet. Log your first one above.</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {life.expenses.slice(0,15).map(e=>(
                    <div key={e.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition group">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{e.description||e.category}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{e.category} · {new Date(e.occurred_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${e.type==='income'?'text-emerald-400':'text-red-400'}`}>{e.type==='income'?'+':'-'}${parseFloat(e.amount).toFixed(2)}</span>
                        <button onClick={async()=>{await life.deleteExpense(e.id);life.fetchSummary();life.fetchExpenses();toast.success('Deleted');}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Budgets */}
            <Card>
              <CardHeader icon={IcoTarget} title="Budget Categories" right={<Btn variant="secondary" onClick={()=>{const cat=prompt('Category name:');const lim=prompt('Monthly limit ($):');if(cat&&lim)life.upsertBudget({category:cat,monthly_limit:parseFloat(lim)}).then(()=>{life.fetchBudgets();toast.success('Budget set!')})}}>+ Add</Btn>}/>
              {life.budgets.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No budgets set. Add categories to track spending.</p>
              ) : (
                <div className="space-y-4">
                  {life.budgets.map(b=>{
                    const spent = parseFloat(b.spent||0);
                    const limit = parseFloat(b.monthly_limit);
                    const pct = limit>0?(spent/limit)*100:0;
                    return (
                      <div key={b.id}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-white">{b.category}</span>
                          <span className="text-gray-500">${spent.toFixed(0)} / ${limit.toFixed(0)}</span>
                        </div>
                        <ProgressBar pct={pct} color={pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-emerald-500'}/>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>)}

        {/* ═══════ HOME TAB ═══════ */}
        {tab==='home' && (<>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Home maintenance */}
            <Card>
              <CardHeader icon={IcoHome} title="Home Maintenance" right={<Btn onClick={()=>setShowHomeTaskModal(true)}>+ Add Task</Btn>}/>
              {life.homeTasks.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No home tasks yet. Add maintenance reminders.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {life.homeTasks.map(t=>{
                    const overdue = t.due_date && new Date(t.due_date) < new Date() && !t.is_completed;
                    return (
                      <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${t.is_completed?'opacity-40 border-gray-800':overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>toggleHomeTask(t)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${t.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {t.is_completed && <IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${t.is_completed?'line-through text-gray-600':'text-white'}`}>{t.title}</p>
                          <p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-600'}`}>
                            {t.due_date ? (overdue ? 'Overdue · ' : '') + new Date(t.due_date).toLocaleDateString() : 'No due date'}
                            {t.recurrence_days ? ` · Every ${t.recurrence_days}d` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Tag text={t.urgency} color={t.urgency==='high'?'red':t.urgency==='medium'?'orange':'gray'}/>
                          <Link to="/post-job" className="text-[10px] text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap">Find Help →</Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Saved helpers */}
            <Card>
              <CardHeader icon={IcoUsers} title="Saved Helpers" right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">Browse →</Link>}/>
              {life.savedHelpers.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No saved helpers yet. Save helpers you like from job pages.</p>
              ) : (
                <div className="space-y-2">
                  {life.savedHelpers.map(h=>(
                    <div key={h.id} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-xl">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/30 to-purple-500/30 flex items-center justify-center font-bold text-sm">{(h.first_name||'?')[0]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{h.first_name} {h.last_name}</p>
                        <p className="text-xs text-gray-500 truncate">{h.categories||'Helper'} · {h.avg_rating?`${h.avg_rating}★`:'New'} · {h.completed_jobs||0} jobs</p>
                      </div>
                      <Link to={`/profile/${h.helper_id}`} className="text-xs text-orange-400 font-medium">View</Link>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>)}

        {/* ═══════ GOALS TAB ═══════ */}
        {tab==='goals' && (<>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Goals */}
            <Card>
              <CardHeader icon={IcoTarget} title="My Goals" right={<Btn onClick={()=>setShowGoalModal(true)}>+ New Goal</Btn>}/>
              {life.goals.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No goals yet. Set your first financial or life goal.</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {life.goals.map(g=>{
                    const pct = g.target_value > 0 ? Math.min((parseFloat(g.current_value)/parseFloat(g.target_value))*100, 100) : 0;
                    return (
                      <div key={g.id} className={`p-4 border rounded-xl transition ${g.is_completed?'border-emerald-500/30 bg-emerald-500/5 opacity-60':'border-gray-800'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{g.icon||'🎯'}</span>
                          <span className="font-semibold text-sm text-white flex-1">{g.title}</span>
                          {g.is_completed ? <Tag text="Done" color="green"/> : <span className="text-sm font-bold text-orange-400">{Math.round(pct)}%</span>}
                        </div>
                        {g.target_value > 0 && !g.is_completed && (
                          <>
                            <ProgressBar pct={pct} color={g.is_completed?'bg-emerald-500':'bg-orange-500'}/>
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-xs text-gray-500">${parseFloat(g.current_value).toLocaleString()} of ${parseFloat(g.target_value).toLocaleString()}</span>
                              <button onClick={()=>{const v=prompt(`Update progress for "${g.title}":`, g.current_value);if(v!==null)updateGoalProgress(g,v);}} className="text-[10px] text-orange-400 font-semibold">Update →</button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Checklist */}
            <Card>
              <CardHeader icon={IcoCheck} title="Life Checklist" right={<Btn onClick={()=>setShowChecklistModal(true)}>+ Add</Btn>}/>
              <p className="text-xs text-gray-600 mb-3">{life.checklist.filter(i=>i.is_completed).length} of {life.checklist.length} completed</p>
              {life.checklist.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">Your checklist is empty. Add tasks to stay on top of life admin.</p>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {life.checklist.map(item=>(
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition group">
                      <button onClick={()=>toggleChecklist(item)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${item.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                        {item.is_completed && <IcoCheck size={12} cls="text-gray-950"/>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${item.is_completed?'line-through text-gray-600':'text-white'}`}>{item.title}</p>
                        {item.due_date && <p className={`text-xs mt-0.5 ${new Date(item.due_date)<new Date()&&!item.is_completed?'text-red-400':'text-gray-600'}`}>{new Date(item.due_date).toLocaleDateString()}</p>}
                      </div>
                      <button onClick={async()=>{await life.deleteChecklistItem(item.id);life.fetchSummary();toast.success('Removed');}} className="opacity-0 group-hover:opacity-100"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>)}

        {/* ═══════ JOBS TAB ═══════ */}
        {tab==='jobs' && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white text-lg">All My Jobs</h3>
              <Link to="/post-job" className="text-sm bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl transition">+ Post a Job</Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl animate-pulse">
                    <div className="space-y-2 flex-1 mr-4">
                      <div className="h-4 bg-gray-800 rounded w-3/4" />
                      <div className="h-3 bg-gray-800 rounded w-1/2" />
                    </div>
                    <div className="h-5 w-16 bg-gray-800 rounded-full" />
                  </div>
                ))}
              </div>
            ) : !Array.isArray(myJobs)||myJobs.length===0 ? (
              <Card className="p-16 text-center"><IcoBriefcase size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500 mb-4">No jobs posted yet.</p>
                <Link to="/post-job" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm inline-block">Post Your First Job</Link></Card>
            ) : (
              <div className="space-y-2">{myJobs.map(job=>(
                <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                  <div className="min-w-0 flex-1 mr-4"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{job.title}</p>
                    <p className="text-xs text-gray-500 mt-1 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.budget_min||job.budget_max?` · $${job.budget_min||'?'}–$${job.budget_max||'?'}`:''}</p></div>
                  <div className="flex items-center gap-3 flex-shrink-0">{job.bid_count>0&&<span className="text-xs text-gray-500">{job.bid_count} bid{job.bid_count!==1?'s':''}</span>}
                    <Tag text={(job.status||'').replace(/_/g,' ')} color={job.status==='open'||job.status==='published'?'green':job.status==='in_progress'?'blue':job.status==='completed'||job.status==='closed'?'gray':'red'}/></div>
                </Link>
              ))}</div>
            )}
          </div>
        )}

      </main>
      <Footer/>

      {/* ── MODALS ──────────────────────────────────────────────── */}
      <Modal open={showExpenseModal} onClose={()=>setShowExpenseModal(false)} title="Log Transaction">
        <form onSubmit={handleAddExpense} className="space-y-4">
          <Select label="Type" value={expenseForm.type} onChange={e=>setExpenseForm(p=>({...p,type:e.target.value}))}>
            <option value="expense">Expense</option><option value="income">Income</option>
          </Select>
          <Input label="Amount ($)" type="number" step="0.01" min="0.01" required placeholder="0.00" value={expenseForm.amount} onChange={e=>setExpenseForm(p=>({...p,amount:e.target.value}))}/>
          <Input label="Category" required placeholder="e.g. Gas, Supplies, Gig Payment" value={expenseForm.category} onChange={e=>setExpenseForm(p=>({...p,category:e.target.value}))}/>
          <Input label="Description (optional)" placeholder="Quick note" value={expenseForm.description} onChange={e=>setExpenseForm(p=>({...p,description:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Save Transaction</Btn>
        </form>
      </Modal>

      <Modal open={showGoalModal} onClose={()=>setShowGoalModal(false)} title="New Goal">
        <form onSubmit={handleAddGoal} className="space-y-4">
          <Input label="Goal Title" required placeholder="e.g. Save $1,000 emergency fund" value={goalForm.title} onChange={e=>setGoalForm(p=>({...p,title:e.target.value}))}/>
          <Select label="Type" value={goalForm.goal_type} onChange={e=>setGoalForm(p=>({...p,goal_type:e.target.value}))}>
            <option value="financial">Financial</option><option value="task">Task</option><option value="career">Career</option>
          </Select>
          {goalForm.goal_type==='financial' && <Input label="Target Amount ($)" type="number" step="0.01" placeholder="1000" value={goalForm.target_value} onChange={e=>setGoalForm(p=>({...p,target_value:e.target.value}))}/>}
          <Input label="Icon (emoji)" placeholder="🎯" value={goalForm.icon} onChange={e=>setGoalForm(p=>({...p,icon:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Create Goal</Btn>
        </form>
      </Modal>

      <Modal open={showHomeTaskModal} onClose={()=>setShowHomeTaskModal(false)} title="Add Home Task">
        <form onSubmit={handleAddHomeTask} className="space-y-4">
          <Input label="Task" required placeholder="e.g. Replace HVAC filter" value={homeTaskForm.title} onChange={e=>setHomeTaskForm(p=>({...p,title:e.target.value}))}/>
          <Input label="Due Date" type="date" value={homeTaskForm.due_date} onChange={e=>setHomeTaskForm(p=>({...p,due_date:e.target.value}))}/>
          <Select label="Urgency" value={homeTaskForm.urgency} onChange={e=>setHomeTaskForm(p=>({...p,urgency:e.target.value}))}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </Select>
          <Input label="Repeat Every (days, optional)" type="number" placeholder="30 = monthly" value={homeTaskForm.recurrence_days} onChange={e=>setHomeTaskForm(p=>({...p,recurrence_days:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Add Task</Btn>
        </form>
      </Modal>

      <Modal open={showChecklistModal} onClose={()=>setShowChecklistModal(false)} title="Add Checklist Item">
        <form onSubmit={handleAddChecklist} className="space-y-4">
          <Input label="What do you need to do?" required placeholder="e.g. File quarterly taxes" value={checklistForm.title} onChange={e=>setChecklistForm(p=>({...p,title:e.target.value}))}/>
          <Input label="Due Date (optional)" type="date" value={checklistForm.due_date} onChange={e=>setChecklistForm(p=>({...p,due_date:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Add Item</Btn>
        </form>
      </Modal>
    </div>
  );
}
