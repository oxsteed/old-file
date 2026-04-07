import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import PageMeta from '../components/PageMeta';
import useSubscription from '../hooks/useSubscription';
import useLifeDashboard from '../hooks/useLifeDashboard';
import BadgeDisplay from '../components/BadgeDisplay';
import api from '../api/axios';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import TrialBanner from '../components/TrialBanner';
import Footer from '../components/Footer';

// ── Icons ─────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoBriefcase = (p) => <Ico {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></Ico>;
const IcoDollar    = (p) => <Ico {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>;
const IcoStar      = (p) => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;
const IcoBell      = (p) => <Ico {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></Ico>;
const IcoShield    = (p) => <Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ico>;
const IcoCheck     = (p) => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoZap       = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;
const IcoMap       = (p) => <Ico {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></Ico>;
const IcoTarget    = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ico>;
const IcoChat      = (p) => <Ico {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></Ico>;
const IcoId        = (p) => <Ico {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></Ico>;
const IcoSettings  = (p) => <Ico {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></Ico>;
const IcoTrash     = (p) => <Ico {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></Ico>;
const IcoUsers     = (p) => <Ico {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>;
const IcoX         = (p) => <Ico {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;

// ── Shared UI ─────────────────────────────────────────────────────────────
const Tag = ({ text, color = 'orange' }) => {
  const m = { orange:'bg-orange-500/15 text-orange-400', green:'bg-emerald-500/15 text-emerald-400', red:'bg-red-500/15 text-red-400', gray:'bg-gray-700/40 text-gray-400', blue:'bg-blue-500/15 text-blue-400', purple:'bg-purple-500/15 text-purple-400' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${m[color]||m.orange}`}>{text}</span>;
};
const ProgressBar = ({ pct, color = 'bg-orange-500' }) => (
  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{width:`${Math.min(pct,100)}%`}}/></div>
);
const Card = ({ children, className = '' }) => <div className={`bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 ${className}`}>{children}</div>;
const CardHeader = ({ icon: Ic, title, right }) => (
  <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2.5">{Ic&&<Ic size={18} cls="text-orange-400"/>}<h3 className="font-semibold text-white text-sm">{title}</h3></div>{right}</div>
);
const Btn = ({ children, onClick, variant='primary', className='', ...r }) => {
  const v = {primary:'bg-orange-500 hover:bg-orange-600 text-white',secondary:'bg-gray-800 hover:bg-gray-700 text-gray-300',danger:'bg-red-500/20 hover:bg-red-500/30 text-red-400'};
  return <button onClick={onClick} className={`text-xs font-semibold px-4 py-2 rounded-lg transition ${v[variant]} ${className}`} {...r}>{children}</button>;
};
const Input = ({label,...r})=>(<div>{label&&<label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}<input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition" {...r}/></div>);
const Select = ({label,children,...r})=>(<div>{label&&<label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}<select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition" {...r}>{children}</select></div>);
const Modal = ({open,onClose,title,children})=>{if(!open)return null;return(<div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}><div className="absolute inset-0 bg-black/60 backdrop-blur-sm"/><div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between mb-5"><h3 className="font-bold text-white">{title}</h3><button onClick={onClose} className="text-gray-500 hover:text-white transition"><IcoX size={18}/></button></div>{children}</div></div>);};

// ── Onboarding (preserved) ────────────────────────────────────────────────
const OB_STEPS = [
  {key:'account',label:'Create Account',desc:'Name, email, and password',check:()=>true},
  {key:'email',label:'Verify Email',desc:'Confirm your email address',check:u=>!!u?.email_verified},
  {key:'profile',label:'Profile & Location',desc:'Phone, zip, skills, and a short bio',check:u=>!!u?.profile_completed},
  {key:'plan',label:'Choose Your Plan',desc:'Free or Pro — upgrade anytime',check:u=>!!u?.tier_selected},
  {key:'tax',label:'Tax Information',desc:'Required for Pro tier helpers (W-9)',check:u=>!!u?.w9_completed||u?.effective_tier==='free',onlyFor:u=>u?.effective_tier==='pro'},
  {key:'review',label:'Review & Complete',desc:'Accept terms and go live',check:u=>!!u?.onboarding_completed},
];

function OnboardingProgress({user,onResume}){
  const steps=OB_STEPS.filter(s=>!s.onlyFor||s.onlyFor(user));
  const done=steps.filter(s=>s.check(user)).length;
  const pct=Math.round((done/steps.length)*100);
  const next=steps.find(s=>!s.check(user));
  return(
    <div className="bg-gradient-to-br from-orange-500/[0.08] to-gray-900/90 border border-orange-500/30 rounded-2xl p-6 mb-6">
      <div className="flex justify-between items-start mb-4"><div><h2 className="text-lg font-bold text-white mb-1">Complete Your Profile to Start Getting Jobs</h2><p className="text-sm text-gray-500">Your profile is hidden until setup is finished.</p></div><span className="text-2xl font-extrabold text-orange-400 ml-4">{pct}%</span></div>
      <ProgressBar pct={pct} color="bg-orange-500"/>
      <ul className="mt-5 space-y-2">{steps.map(s=>{const d=s.check(user);return(<li key={s.key} className={`flex items-center gap-3 ${d?'opacity-50':''}`}><div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${d?'bg-emerald-500/20 text-emerald-400':'bg-gray-700/40 text-gray-500 border border-gray-600'}`}>{d?'✓':'○'}</div><div><span className={`text-sm font-semibold ${d?'text-gray-500 line-through':'text-gray-200'}`}>{s.label}</span><span className="text-xs text-gray-600 ml-2">{s.desc}</span></div></li>);})}</ul>
      {next&&<button onClick={onResume} className="mt-5 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition text-sm">{next.key==='profile'?'Add Profile & Location →':next.key==='plan'?'Choose a Plan →':next.key==='tax'?'Add Tax Info →':next.key==='review'?'Review & Go Live →':'Continue Setup →'}</button>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function HelperDashboard() {
  const { user, isOnboardingComplete, refreshUser } = useAuth();
  const { subscription, openPortal, createCheckout, refresh: refreshSubscription } = useSubscription();
  const life = useLifeDashboard();
  const navigate = useNavigate();
  const location = useLocation();

  const [verification, setVerification] = useState({backgroundCheck:null,identity:null});
  const [notifications, setNotifications] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [nearbyJobs, setNearbyJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [welcomeMsg] = useState(location.state?.message||null);
  const [tab, setTab] = useState('pulse');

  // Handle ?subscribed=true from Stripe redirect
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(()=>{
    if(searchParams.get('subscribed')==='true'){
      toast.success('Pro subscription activated! Welcome to the Pro tier.');
      refreshUser?.();
      refreshSubscription?.();
      setSearchParams({},{replace:true}); // clean the URL
    }
  },[]);

  // Detect "selected Pro during registration but hasn't paid yet"
  const selectedProNoPay = !subscription?.status && user?.effective_tier==='pro' && !!user?.tier_selected;

  // Skills & Tools state
  const [mySkills, setMySkills] = useState([]);
  const [myTools, setMyTools] = useState([]);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [editingTool, setEditingTool] = useState(null);
  const [skillLookup, setSkillLookup] = useState([]);
  const emptySkill = { skill_name:'', category:'', hourly_rate:'', years_experience:'', description:'', is_available:true };
  const emptyTool  = { name:'', category:'', description:'', daily_rate:'', deposit_amount:'', condition:'good', brand:'', model:'', is_available_for_rent:true };
  const [skillForm, setSkillForm] = useState(emptySkill);
  const [toolForm, setToolForm]   = useState(emptyTool);

  const loadSkillsAndTools = useCallback(async () => {
    try {
      const [sRes, tRes] = await Promise.all([api.get('/user-skills/me'), api.get('/tool-rentals/me')]);
      setMySkills(sRes.data || []);
      setMyTools(tRes.data || []);
    } catch { /* non-critical */ }
  }, []);

  const handleSaveSkill = async (e) => {
    e.preventDefault();
    try {
      if (editingSkill) {
        await api.put(`/user-skills/${editingSkill.id}`, skillForm);
        toast.success('Skill updated!');
      } else {
        await api.post('/user-skills', skillForm);
        toast.success('Skill added!');
      }
      setShowSkillModal(false);
      setEditingSkill(null);
      setSkillForm(emptySkill);
      loadSkillsAndTools();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save skill'); }
  };

  const handleSaveTool = async (e) => {
    e.preventDefault();
    try {
      if (editingTool) {
        await api.put(`/tool-rentals/${editingTool.id}`, toolForm);
        toast.success('Tool updated!');
      } else {
        await api.post('/tool-rentals', toolForm);
        toast.success('Tool listed!');
      }
      setShowToolModal(false);
      setEditingTool(null);
      setToolForm(emptyTool);
      loadSkillsAndTools();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save tool'); }
  };

  const openSkillLookup = async (q) => {
    if (q.length < 2) { setSkillLookup([]); return; }
    try { const r = await api.get(`/user-skills/lookup?q=${encodeURIComponent(q)}&limit=8`); setSkillLookup(r.data || []); } catch { /**/ }
  };

  // Modals
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showChecklistModal, setShowChecklistModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({type:'expense',amount:'',category:'',description:''});
  const [goalForm, setGoalForm] = useState({title:'',goal_type:'financial',target_value:'',icon:'🎯'});
  const [checklistForm, setChecklistForm] = useState({title:'',due_date:''});

  const retryLoad = useCallback(async()=>{
    setLoading(true);
    setError(false);
    try{
      const p = [api.get('/verification/background-check/status'),api.get('/verification/identity/status'),api.get('/notifications')];
      if(isOnboardingComplete){p.push(api.get('/bids/me'));p.push(api.get('/jobs?limit=5'));}
      const r = await Promise.allSettled(p);
      const anyFailed = r.some(res=>res.status==='rejected');
      if(anyFailed) setError(true);
      setVerification({backgroundCheck:r[0].status==='fulfilled'?r[0].value.data?.backgroundCheck||null:null,identity:r[1].status==='fulfilled'?r[1].value.data?.identity||null:null});
      if(r[2].status==='fulfilled'){const n=r[2].value.data?.notifications||r[2].value.data||[];setNotifications(Array.isArray(n)?n:[]);}
      if(isOnboardingComplete){
        if(r[3]?.status==='fulfilled'){const b=r[3].value.data?.bids||r[3].value.data||[];setMyBids(Array.isArray(b)?b:[]);}
        if(r[4]?.status==='fulfilled'){const j=r[4].value.data?.jobs||r[4].value.data||[];setNearbyJobs(Array.isArray(j)?j:[]);}
      }
    }catch(e){console.error(e);setError(true);}finally{setLoading(false);}
  },[isOnboardingComplete]);

  useEffect(()=>{
    retryLoad();
    if(isOnboardingComplete){life.fetchSummary();life.fetchCommunity();life.fetchExpenses();life.fetchBudgets();life.fetchGoals();life.fetchChecklist();loadSkillsAndTools();}
  },[isOnboardingComplete]);

  const startBackgroundCheck=async()=>{try{await api.post('/verification/background-check');window.location.reload();}catch(e){alert(e.response?.data?.error||'Failed');}};
  const startIdentityVerification=async()=>{try{const{data}=await api.post('/verification/identity/session');window.location.href=data.url;}catch(e){alert(e.response?.data?.error||'Failed');}};

  // Form handlers
  const handleAddExpense=async(e)=>{e.preventDefault();try{await life.createExpense({...expenseForm,amount:parseFloat(expenseForm.amount)});toast.success('Logged!');setExpenseForm({type:'expense',amount:'',category:'',description:''});setShowExpenseModal(false);life.fetchSummary();life.fetchExpenses();}catch{toast.error('Failed.');}};
  const handleAddGoal=async(e)=>{e.preventDefault();try{await life.createGoal({...goalForm,target_value:goalForm.target_value?parseFloat(goalForm.target_value):null});toast.success('Goal created!');setGoalForm({title:'',goal_type:'financial',target_value:'',icon:'🎯'});setShowGoalModal(false);life.fetchSummary();}catch{toast.error('Failed.');}};
  const handleAddChecklist=async(e)=>{e.preventDefault();try{await life.createChecklistItem(checklistForm);toast.success('Added!');setChecklistForm({title:'',due_date:''});setShowChecklistModal(false);life.fetchSummary();}catch{toast.error('Failed.');}};
  const toggleChecklist=async(item)=>{try{await life.updateChecklistItem(item.id,{is_completed:!item.is_completed});life.fetchSummary();}catch{toast.error('Failed.');}};
  const updateGoalProgress=async(goal,val)=>{try{const v=parseFloat(val);if(isNaN(v))return;await life.updateGoal(goal.id,{current_value:v,is_completed:goal.target_value&&v>=goal.target_value});life.fetchSummary();toast.success('Updated!');}catch{toast.error('Failed.');}};

  // Derived
  const hr=new Date().getHours();
  const greeting=hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  const displayName = (() => {
    const pref = user?.display_name_preference || 'first_name';
    if (pref === 'full_name') return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
    if (pref === 'business_name') return user?.business_name || user?.first_name || '';
    return user?.first_name || '';
  })();
  const isProActive=subscription?.status==='active';
  const showOnboarding=!isOnboardingComplete;
  const unreadNotifs=notifications.filter(n=>!n.read&&!n.read_at).length;
  const activeBids=myBids.filter(b=>b.status==='pending'||b.status==='accepted');
  const wonBids=myBids.filter(b=>b.status==='accepted');
  const s=life.summary;

  const tabs = showOnboarding
    ? [{id:'pulse',label:'Get Started'}]
    : [{id:'pulse',label:'My Pulse'},{id:'jobs',label:'Find Jobs'},{id:'earnings',label:'Earnings'},{id:'goals',label:'Goals'},{id:'bids',label:'My Bids'},{id:'skills',label:'Skills & Tools'}];

  if(loading) return(<div className="min-h-screen bg-gray-950 text-white"><Navbar/><div className="flex flex-col items-center justify-center py-24 text-gray-500"><div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4"/><span className="text-sm">Loading your dashboard…</span></div></div>);

  return(
    <div className="min-h-screen bg-gray-950 text-white">
      <PageMeta title="Helper Dashboard" description="Manage your jobs, earnings, bids, and skills." noIndex={true} />
      <Navbar/>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Trial Banner */}
        <div className="mb-5">
          <TrialBanner />
        </div>

        {welcomeMsg&&<div className="mb-5 flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm font-medium"><span>🎉</span><span>{welcomeMsg}</span></div>}

        {/* Greeting */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold">{showOnboarding?`Welcome, ${displayName||'Helper'}!`:`${greeting}, ${displayName||'Helper'}.`}</h1>
              {!showOnboarding&&<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" className="animate-pulse"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>}
            </div>
            <p className="text-gray-500 mt-1 text-sm">{showOnboarding?'Finish setup to go live.':`${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})} — Let's get to work.`}</p>
          </div>
          <BadgeDisplay badges={user?.badges} size="large"/>
        </div>

        {/* Tabs */}
        {tabs.length>1&&(
          <div className="flex gap-1 my-6 bg-gray-900/80 rounded-xl p-1 w-fit overflow-x-auto">
            {tabs.map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${tab===t.id?'bg-orange-500 text-gray-950':'text-gray-500 hover:text-gray-300'}`}>{t.label}</button>))}
          </div>
        )}

        {/* ═══════ PULSE ═══════ */}
        {tab==='pulse'&&(<>
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-2">
              <span>⚠</span>
              <span>Some data failed to load. <button onClick={retryLoad} className="underline hover:text-red-300">Retry</button></span>
            </div>
          )}
          {showOnboarding&&<div className="mt-6"><OnboardingProgress user={user} onResume={()=>navigate('/settings')}/></div>}

          {/* Life Pulse Score */}
          {!showOnboarding && s?.pulse_score !== undefined && (
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
                    {s.pulse_score >= 80 ? "You're on fire. Strong earnings, great reputation, and goals on track." :
                     s.pulse_score >= 60 ? "Solid progress. Keep bidding and logging your earnings to push higher." :
                     s.pulse_score >= 40 ? "Building momentum. Log expenses, set goals, and stay active on jobs." :
                     "Just getting started. Complete your profile and bid on your first job!"}
                  </p>
                </div>
              </div>
              {s.pulse_breakdown && (
                <div className="grid grid-cols-4 gap-4">
                  {[
                    {l:'Earnings',v:s.pulse_breakdown.finances,c:'text-emerald-400'},
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

          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 ${showOnboarding?'opacity-50 pointer-events-none':''}`}>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Jobs Completed</p><p className="text-2xl font-bold text-orange-400">{user?.completed_jobs||0}</p><p className="text-xs text-gray-500 mt-1">{user?.avg_rating?`${user.avg_rating}★ avg`:'No reviews yet'}</p></Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Net This Month</p><p className={`text-2xl font-bold ${(s?.finances?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(s?.finances?.net||0).toFixed(2)}</p><p className="text-xs text-gray-500 mt-1">${(s?.finances?.total_income||0).toFixed(0)} earned</p></Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Active Bids</p><p className="text-2xl font-bold text-blue-400">{activeBids.length}</p><p className="text-xs text-gray-500 mt-1">{wonBids.length} accepted</p></Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Goals</p><p className="text-2xl font-bold text-purple-400">{s?.goals?.avg_progress||0}%</p><p className="text-xs text-gray-500 mt-1">{s?.goals?.active||0} in progress</p></Card>
          </div>

          {!showOnboarding&&(<>
            {/* Verification cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <Card>
                <div className="flex items-center gap-2 mb-3"><IcoDollar size={16} cls="text-orange-400"/><span className="text-sm font-semibold">Subscription</span></div>
                {isProActive?(<><p className="text-lg font-bold text-orange-400 mb-1">Pro</p><Tag text="Active" color="green"/><button onClick={openPortal} className="mt-2 text-xs text-gray-400 hover:text-gray-200 transition font-medium block">Manage Billing →</button></>)
                :selectedProNoPay?(<><p className="text-lg font-bold text-orange-400 mb-1">Pro</p><Tag text="Payment Pending" color="orange"/><p className="text-xs text-gray-500 my-2">You selected Pro during signup. Complete payment to activate.</p><button onClick={()=>createCheckout('pro')} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">Complete Pro Upgrade</button></>)
                :(<><p className="text-lg font-bold text-gray-400 mb-1">Free</p><p className="text-xs text-gray-500 mb-3">Upgrade for verified badge & priority placement.</p><button onClick={()=>navigate('/upgrade')} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">Upgrade to Pro</button></>)}
              </Card>
              <Card>
                <div className="flex items-center gap-2 mb-3"><IcoShield size={16} cls="text-orange-400"/><span className="text-sm font-semibold">Background Check</span></div>
                {verification.backgroundCheck?<Tag text={verification.backgroundCheck.status} color={verification.backgroundCheck.status==='passed'?'green':'orange'}/>
                :isProActive?(<><p className="text-xs text-gray-500 mb-3">Adds a verified badge to your profile.</p><button onClick={startBackgroundCheck} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">Start Check</button></>)
                :<p className="text-xs text-gray-500">Requires Pro subscription.</p>}
              </Card>
              <Card>
                <div className="flex items-center gap-2 mb-3"><IcoId size={16} cls="text-orange-400"/><span className="text-sm font-semibold">ID Verification</span></div>
                {verification.identity?<Tag text={verification.identity.status} color={verification.identity.status==='approved'?'green':'orange'}/>
                :isProActive?(<><p className="text-xs text-gray-500 mb-3">Build trust with customers.</p><button onClick={startIdentityVerification} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">Verify ID</button></>)
                :<p className="text-xs text-gray-500">Requires Pro subscription.</p>}
              </Card>
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[{to:'/jobs',Ic:IcoBriefcase,l:'Browse Jobs',c:'text-orange-400'},{to:'/messages',Ic:IcoChat,l:'Messages',c:'text-blue-400'},{to:'/disputes',Ic:IcoShield,l:'Disputes',c:'text-purple-400'},{to:'/settings',Ic:IcoSettings,l:'Settings',c:'text-gray-400'}].map((a,i)=>(
                <Link key={i} to={a.to} className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-4 hover:border-gray-600 hover:-translate-y-0.5 transition-all group flex items-center gap-3"><a.Ic size={18} cls={a.c}/><span className="text-sm font-medium text-gray-300 group-hover:text-white transition">{a.l}</span></Link>
              ))}
            </div>

            {/* Nearby jobs */}
            <Card className="mb-6">
              <CardHeader icon={IcoZap} title="Jobs Near You" right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">View All →</Link>}/>
              {nearbyJobs.length===0
                ? <p className="text-gray-500 text-sm text-center py-6">No nearby jobs right now. Check back soon or <Link to="/jobs" className="text-orange-400 hover:text-orange-300">browse all jobs</Link>.</p>
                : <div className="space-y-2">{nearbyJobs.slice(0,3).map(job=>(
                    <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl hover:bg-gray-800/60 transition group">
                      <div className="min-w-0 flex-1"><p className="text-white text-sm font-medium group-hover:text-orange-400 transition truncate">{job.title}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.distance_miles?` · ${job.distance_miles} mi`:''}</p></div>
                      {(job.budget_min||job.budget_max)&&<span className="text-sm font-bold text-emerald-400">${job.budget_min||'?'}–${job.budget_max||'?'}</span>}
                    </Link>
                  ))}</div>
              }
            </Card>

            {/* Community Stats */}
            {life.community && (
              <Card className="mb-6">
                <CardHeader icon={IcoUsers} title="Springfield Helpers" right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">Browse Jobs →</Link>}/>
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
                    <span className="text-xs text-gray-500">Most requested:</span>
                    {life.community.top_categories.slice(0,3).map((c,i) => (
                      <Tag key={i} text={`${c.category_name} (${c.job_count})`} color={['orange','green','blue'][i]}/>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Upgrade CTA */}
            {!isProActive && (
              <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div><div className="flex items-center gap-2 mb-1"><IcoZap size={18} cls="text-orange-400"/><h3 className="text-lg font-bold text-white">Upgrade to Pro</h3></div><p className="text-sm text-gray-400">Get priority placement, verified badge, background check, ID verification, and bid alerts.</p></div>
                <button onClick={()=>navigate('/upgrade')} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition whitespace-nowrap text-sm">View Plans</button>
              </div>
            )}
          </>)}
        </>)}

        {/* ═══════ FIND JOBS ═══════ */}
        {tab==='jobs'&&(
          <div>
            <div className="flex items-center justify-between mb-5"><h3 className="font-semibold text-white text-lg">Available Jobs</h3><Link to="/jobs" className="text-sm text-orange-400 font-medium">Advanced Search →</Link></div>
            {nearbyJobs.length===0?(<Card className="p-16 text-center"><IcoMap size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500">No jobs available right now. Check back soon.</p></Card>)
            :(<div className="space-y-2">{nearbyJobs.map(job=>(
              <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                <div className="min-w-0 flex-1 mr-4"><div className="flex items-center gap-2 mb-1"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{job.title}</p>{job.is_urgent&&<Tag text="Urgent" color="red"/>}</div><p className="text-xs text-gray-500 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.bid_count>0?` · ${job.bid_count} bids`:''}</p></div>
                <div className="flex items-center gap-3 flex-shrink-0">{(job.budget_min||job.budget_max)&&<span className="text-base font-bold text-emerald-400">${job.budget_min||'?'}–${job.budget_max||'?'}</span>}<span className="text-xs bg-orange-500/15 text-orange-400 px-3 py-1.5 rounded-lg font-semibold">View</span></div>
              </Link>
            ))}</div>)}
          </div>
        )}

        {/* ═══════ EARNINGS ═══════ */}
        {tab==='earnings'&&(<>
          <Card className="mb-6">
            <CardHeader icon={IcoDollar} title={`${new Date().toLocaleString('en-US',{month:'long'})} ${new Date().getFullYear()}`} right={<Btn onClick={()=>setShowExpenseModal(true)}>+ Log Transaction</Btn>}/>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Income</p><p className="text-xl font-bold text-emerald-400">${(life.expenseSummary?.total_income||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Expenses</p><p className="text-xl font-bold text-red-400">${(life.expenseSummary?.total_expenses||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Net</p><p className={`text-xl font-bold ${(life.expenseSummary?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(life.expenseSummary?.net||0).toFixed(2)}</p></div>
            </div>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon={IcoDollar} title="Recent Transactions"/>
              {life.expenses.length===0?<p className="text-gray-600 text-sm text-center py-8">No transactions yet.</p>
              :(<div className="space-y-1 max-h-80 overflow-y-auto">{life.expenses.slice(0,15).map(e=>(
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition group">
                  <div className="min-w-0 flex-1"><p className="text-sm text-white truncate">{e.description||e.category}</p><p className="text-xs text-gray-600 mt-0.5">{e.category} · {new Date(e.occurred_at).toLocaleDateString()}</p></div>
                  <div className="flex items-center gap-2"><span className={`text-sm font-bold ${e.type==='income'?'text-emerald-400':'text-red-400'}`}>{e.type==='income'?'+':'-'}${parseFloat(e.amount).toFixed(2)}</span>
                    <button onClick={async()=>{await life.deleteExpense(e.id);life.fetchSummary();life.fetchExpenses();toast.success('Deleted');}} className="opacity-0 group-hover:opacity-100"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button></div>
                </div>
              ))}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoTarget} title="Budget Categories" right={<Btn variant="secondary" onClick={()=>{const c=prompt('Category:');const l=prompt('Monthly limit ($):');if(c&&l)life.upsertBudget({category:c,monthly_limit:parseFloat(l)}).then(()=>{life.fetchBudgets();toast.success('Saved!')})}}>+ Add</Btn>}/>
              {life.budgets.length===0?<p className="text-gray-600 text-sm text-center py-8">No budgets set yet.</p>
              :(<div className="space-y-4">{life.budgets.map(b=>{const spent=parseFloat(b.spent||0);const lim=parseFloat(b.monthly_limit);const pct=lim>0?(spent/lim)*100:0;return(<div key={b.id}><div className="flex justify-between text-sm mb-1"><span className="font-medium text-white">{b.category}</span><span className="text-gray-500">${spent.toFixed(0)} / ${lim.toFixed(0)}</span></div><ProgressBar pct={pct} color={pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-emerald-500'}/></div>);})}</div>)}
            </Card>
          </div>
        </>)}

        {/* ═══════ GOALS ═══════ */}
        {tab==='goals'&&(<>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon={IcoTarget} title="My Goals" right={<Btn onClick={()=>setShowGoalModal(true)}>+ New Goal</Btn>}/>
              {life.goals.length===0?<p className="text-gray-600 text-sm text-center py-8">No goals yet. Set your first one.</p>
              :(<div className="space-y-4 max-h-96 overflow-y-auto">{life.goals.map(g=>{const pct=g.target_value>0?Math.min((parseFloat(g.current_value)/parseFloat(g.target_value))*100,100):0;return(
                <div key={g.id} className={`p-4 border rounded-xl ${g.is_completed?'border-emerald-500/30 bg-emerald-500/5 opacity-60':'border-gray-800'}`}>
                  <div className="flex items-center gap-2 mb-2"><span className="text-lg">{g.icon||'🎯'}</span><span className="font-semibold text-sm text-white flex-1">{g.title}</span>{g.is_completed?<Tag text="Done" color="green"/>:<span className="text-sm font-bold text-orange-400">{Math.round(pct)}%</span>}</div>
                  {g.target_value>0&&!g.is_completed&&(<><ProgressBar pct={pct} color="bg-orange-500"/><div className="flex justify-between items-center mt-2"><span className="text-xs text-gray-500">${parseFloat(g.current_value).toLocaleString()} of ${parseFloat(g.target_value).toLocaleString()}</span><button onClick={()=>{const v=prompt(`Update "${g.title}":`,g.current_value);if(v!==null)updateGoalProgress(g,v);}} className="text-[10px] text-orange-400 font-semibold">Update →</button></div></>)}
                </div>
              );})}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoCheck} title="Life Checklist" right={<Btn onClick={()=>setShowChecklistModal(true)}>+ Add</Btn>}/>
              {life.checklist.length===0?<p className="text-gray-600 text-sm text-center py-8">Your checklist is empty.</p>
              :(<div className="space-y-1.5 max-h-96 overflow-y-auto">{life.checklist.map(item=>(
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition group">
                  <button onClick={()=>toggleChecklist(item)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${item.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{item.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                  <div className="flex-1 min-w-0"><p className={`text-sm ${item.is_completed?'line-through text-gray-600':'text-white'}`}>{item.title}</p>{item.due_date&&<p className={`text-xs mt-0.5 ${new Date(item.due_date)<new Date()&&!item.is_completed?'text-red-400':'text-gray-600'}`}>{new Date(item.due_date).toLocaleDateString()}</p>}</div>
                  <button onClick={async()=>{await life.deleteChecklistItem(item.id);life.fetchSummary();toast.success('Removed');}} className="opacity-0 group-hover:opacity-100"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                </div>
              ))}</div>)}
            </Card>
          </div>
        </>)}

        {/* ═══════ BIDS ═══════ */}
        {tab==='bids'&&(
          <div>
            <div className="flex items-center justify-between mb-5"><h3 className="font-semibold text-white text-lg">My Bids</h3><div className="flex gap-2"><Tag text={`${activeBids.length} active`} color="orange"/><Tag text={`${wonBids.length} won`} color="green"/></div></div>
            {myBids.length===0?(<Card className="p-16 text-center"><IcoTarget size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500 mb-4">No bids yet. Browse available jobs to start bidding.</p><Link to="/jobs" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm inline-block">Browse Jobs</Link></Card>)
            :(<div className="space-y-2">{myBids.map(bid=>(
              <Link key={bid.id} to={`/jobs/${bid.job_id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                <div className="min-w-0 flex-1 mr-4"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{bid.job_title||`Job #${bid.job_id}`}</p><p className="text-xs text-gray-500 mt-1">Bid: <span className="text-white font-semibold">${bid.amount}</span>{bid.created_at?` · ${new Date(bid.created_at).toLocaleDateString()}`:''}</p></div>
                <Tag text={(bid.status||'').replace(/_/g,' ')} color={bid.status==='accepted'?'green':bid.status==='pending'?'orange':bid.status==='rejected'?'red':'gray'}/>
              </Link>
            ))}</div>)}
          </div>
        )}
        {/* ═══════ SKILLS & TOOLS ═══════ */}
        {tab==='skills'&&(
          <div className="space-y-6">
            {/* Skills */}
            <Card>
              <CardHeader icon={IcoZap} title="My Skills" right={<Btn onClick={()=>{setEditingSkill(null);setSkillForm(emptySkill);setShowSkillModal(true);}}>+ Add Skill</Btn>}/>
              {mySkills.length===0
                ?<p className="text-gray-600 text-sm text-center py-8">No skills listed yet. Add your first skill to get discovered for relevant jobs.</p>
                :<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{mySkills.map(sk=>(
                  <div key={sk.id} className="p-4 border border-gray-800 rounded-xl">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-white truncate">{sk.skill_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{sk.category}{sk.years_experience?` · ${sk.years_experience} yrs`:''}</p>
                        {sk.hourly_rate&&<p className="text-xs text-orange-400 mt-1 font-semibold">${parseFloat(sk.hourly_rate).toFixed(0)}/hr</p>}
                        {sk.description&&<p className="text-xs text-gray-600 mt-1 line-clamp-2">{sk.description}</p>}
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <Tag text={sk.is_available?'Available':'Unavailable'} color={sk.is_available?'green':'gray'}/>
                        <div className="flex gap-1 justify-end mt-1">
                          <button onClick={()=>{setEditingSkill(sk);setSkillForm({skill_name:sk.skill_name,category:sk.category||'',hourly_rate:sk.hourly_rate||'',years_experience:sk.years_experience||'',description:sk.description||'',is_available:sk.is_available});setShowSkillModal(true);}} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">Edit</button>
                          <button onClick={async()=>{if(!confirm('Delete this skill?'))return;try{await api.delete(`/user-skills/${sk.id}`);toast.success('Removed');loadSkillsAndTools();}catch{toast.error('Failed');}}} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">Del</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}</div>}
            </Card>

            {/* Tools for Rent */}
            <Card>
              <CardHeader icon={IcoBriefcase} title="Tools for Rent" right={<Btn onClick={()=>{setEditingTool(null);setToolForm(emptyTool);setShowToolModal(true);}}>+ List a Tool</Btn>}/>
              {myTools.length===0
                ?<p className="text-gray-600 text-sm text-center py-8">No tools listed yet. List your equipment so others can rent them.</p>
                :<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{myTools.map(t=>(
                  <div key={t.id} className="p-4 border border-gray-800 rounded-xl">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-white truncate">{t.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{t.category}{t.brand?` · ${t.brand}`:''}{t.model?` ${t.model}`:''}</p>
                        <div className="flex gap-2 mt-1">
                          {t.daily_rate&&<span className="text-xs text-orange-400 font-semibold">${parseFloat(t.daily_rate).toFixed(0)}/day</span>}
                          {t.deposit_amount&&<span className="text-xs text-gray-500">Deposit: ${parseFloat(t.deposit_amount).toFixed(0)}</span>}
                        </div>
                        {t.condition&&<p className="text-xs text-gray-600 mt-1 capitalize">Condition: {t.condition}</p>}
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <Tag text={t.is_available_for_rent?'Available':'Unavailable'} color={t.is_available_for_rent?'green':'gray'}/>
                        <div className="flex gap-1 justify-end mt-1">
                          <button onClick={()=>{setEditingTool(t);setToolForm({name:t.name,category:t.category||'',description:t.description||'',daily_rate:t.daily_rate||'',deposit_amount:t.deposit_amount||'',condition:t.condition||'good',brand:t.brand||'',model:t.model||'',is_available_for_rent:t.is_available_for_rent});setShowToolModal(true);}} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">Edit</button>
                          <button onClick={async()=>{if(!confirm('Delete this listing?'))return;try{await api.delete(`/tool-rentals/${t.id}`);toast.success('Removed');loadSkillsAndTools();}catch{toast.error('Failed');}}} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">Del</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}</div>}
            </Card>
          </div>
        )}
      </main>
      <Footer/>

      {/* Modals */}
      <Modal open={showSkillModal} onClose={()=>{setShowSkillModal(false);setEditingSkill(null);setSkillLookup([]);}} title={editingSkill?'Edit Skill':'Add Skill'}>
        <form onSubmit={handleSaveSkill} className="space-y-4">
          <div>
            <Input label="Skill Name" required placeholder="e.g. Drywall Repair, Electrical Wiring" value={skillForm.skill_name}
              onChange={e=>{setSkillForm(p=>({...p,skill_name:e.target.value}));openSkillLookup(e.target.value);}}/>
            {skillLookup.length>0&&(
              <div className="mt-1 border border-gray-700 rounded-lg overflow-hidden">
                {skillLookup.map(s=><button type="button" key={s.id||s.name} onClick={()=>{setSkillForm(p=>({...p,skill_name:s.skill_name||s.name,category:s.category_name||p.category}));setSkillLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition">{s.skill_name||s.name}{s.category_name?<span className="text-gray-600 ml-2 text-xs">{s.category_name}</span>:null}</button>)}
              </div>
            )}
          </div>
          <Input label="Category" placeholder="e.g. Plumbing, Electrical, Landscaping" value={skillForm.category} onChange={e=>setSkillForm(p=>({...p,category:e.target.value}))}/>
          <Input label="Hourly Rate ($, optional)" type="number" step="0.01" min="0" placeholder="0.00" value={skillForm.hourly_rate} onChange={e=>setSkillForm(p=>({...p,hourly_rate:e.target.value}))}/>
          <Input label="Years of Experience" type="number" min="0" max="50" placeholder="0" value={skillForm.years_experience} onChange={e=>setSkillForm(p=>({...p,years_experience:e.target.value}))}/>
          <div><label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Short Description (optional)</label><textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" rows={2} placeholder="Brief overview of your experience" value={skillForm.description} onChange={e=>setSkillForm(p=>({...p,description:e.target.value}))}/></div>
          <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={skillForm.is_available} onChange={e=>setSkillForm(p=>({...p,is_available:e.target.checked}))} className="w-4 h-4 accent-orange-500"/><span className="text-sm text-gray-300">Available for hire</span></label>
          <Btn className="w-full py-3" type="submit">{editingSkill?'Save Changes':'Add Skill'}</Btn>
        </form>
      </Modal>

      <Modal open={showToolModal} onClose={()=>{setShowToolModal(false);setEditingTool(null);}} title={editingTool?'Edit Tool Listing':'List a Tool for Rent'}>
        <form onSubmit={handleSaveTool} className="space-y-4">
          <Input label="Tool Name" required placeholder="e.g. DeWalt 20V Cordless Drill" value={toolForm.name} onChange={e=>setToolForm(p=>({...p,name:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Brand" placeholder="DeWalt" value={toolForm.brand} onChange={e=>setToolForm(p=>({...p,brand:e.target.value}))}/>
            <Input label="Model" placeholder="DCD777" value={toolForm.model} onChange={e=>setToolForm(p=>({...p,model:e.target.value}))}/>
          </div>
          <Input label="Category" placeholder="Power Tools, Hand Tools, Landscaping…" value={toolForm.category} onChange={e=>setToolForm(p=>({...p,category:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Daily Rate ($)" type="number" step="0.01" min="0" required placeholder="25.00" value={toolForm.daily_rate} onChange={e=>setToolForm(p=>({...p,daily_rate:e.target.value}))}/>
            <Input label="Deposit ($, optional)" type="number" step="0.01" min="0" placeholder="50.00" value={toolForm.deposit_amount} onChange={e=>setToolForm(p=>({...p,deposit_amount:e.target.value}))}/>
          </div>
          <Select label="Condition" value={toolForm.condition} onChange={e=>setToolForm(p=>({...p,condition:e.target.value}))}>
            <option value="new">New</option><option value="like_new">Like New</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option>
          </Select>
          <div><label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Description (optional)</label><textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" rows={2} placeholder="Condition details, what's included, pickup location…" value={toolForm.description} onChange={e=>setToolForm(p=>({...p,description:e.target.value}))}/></div>
          <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={toolForm.is_available_for_rent} onChange={e=>setToolForm(p=>({...p,is_available_for_rent:e.target.checked}))} className="w-4 h-4 accent-orange-500"/><span className="text-sm text-gray-300">Currently available to rent</span></label>
          <Btn className="w-full py-3" type="submit">{editingTool?'Save Changes':'List Tool'}</Btn>
        </form>
      </Modal>

      <Modal open={showExpenseModal} onClose={()=>setShowExpenseModal(false)} title="Log Transaction">
        <form onSubmit={handleAddExpense} className="space-y-4">
          <Select label="Type" value={expenseForm.type} onChange={e=>setExpenseForm(p=>({...p,type:e.target.value}))}><option value="expense">Expense</option><option value="income">Income</option></Select>
          <Input label="Amount ($)" type="number" step="0.01" min="0.01" required placeholder="0.00" value={expenseForm.amount} onChange={e=>setExpenseForm(p=>({...p,amount:e.target.value}))}/>
          <Input label="Category" required placeholder="e.g. Gas, Supplies, Gig Payment" value={expenseForm.category} onChange={e=>setExpenseForm(p=>({...p,category:e.target.value}))}/>
          <Input label="Description (optional)" placeholder="Quick note" value={expenseForm.description} onChange={e=>setExpenseForm(p=>({...p,description:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Save Transaction</Btn>
        </form>
      </Modal>
      <Modal open={showGoalModal} onClose={()=>setShowGoalModal(false)} title="New Goal">
        <form onSubmit={handleAddGoal} className="space-y-4">
          <Input label="Goal Title" required placeholder="e.g. Save $3,000 emergency fund" value={goalForm.title} onChange={e=>setGoalForm(p=>({...p,title:e.target.value}))}/>
          <Select label="Type" value={goalForm.goal_type} onChange={e=>setGoalForm(p=>({...p,goal_type:e.target.value}))}><option value="financial">Financial</option><option value="task">Task</option><option value="career">Career</option></Select>
          {goalForm.goal_type==='financial'&&<Input label="Target Amount ($)" type="number" step="0.01" placeholder="1000" value={goalForm.target_value} onChange={e=>setGoalForm(p=>({...p,target_value:e.target.value}))}/>}
          <Input label="Icon (emoji)" placeholder="🎯" value={goalForm.icon} onChange={e=>setGoalForm(p=>({...p,icon:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Create Goal</Btn>
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


