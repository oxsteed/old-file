Made with Perplexity
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import PageMeta from '../components/PageMeta';
import useSubscription from '../hooks/useSubscription';
import useLifeDashboard from '../hooks/useLifeDashboard';
import BadgeDisplay from '../components/BadgeDisplay';
import api from '../api/axios';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import TrialBanner from '../components/TrialBanner';
import HelperOffersCard from '../components/HelperOffersCard';
import EditProfileTab from '../components/EditProfileTab';
import { useSocket } from '../hooks/useSocket';
import { ProgressBar, Card, CardHeader, Btn, Input, Select } from '../components/dashboardUI';

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
const IcoHome      = (p) => <Ico {...p}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></Ico>;
const IcoCar       = (p) => <Ico {...p}><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></Ico>;

// ── Shared UI ─────────────────────────────────────────────────────────────
const Tag = ({ text, color = 'orange' }) => {
  const m = { orange:'bg-orange-500/15 text-orange-400', green:'bg-emerald-500/15 text-emerald-400', red:'bg-red-500/15 text-red-400', gray:'bg-gray-700/40 text-gray-400', blue:'bg-blue-500/15 text-blue-400', purple:'bg-purple-500/15 text-purple-400' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${m[color]||m.orange}`}>{text}</span>;
};
const Modal = ({open,onClose,title,children})=>{if(!open)return null;return(<div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}><div className="absolute inset-0 bg-black/60 backdrop-blur-sm"/><div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between mb-5"><h3 className="font-bold text-white">{title}</h3><button onClick={onClose} className="text-gray-500 hover:text-white transition"><IcoX size={18}/></button></div>{children}</div></div>);};

// ── Onboarding ────────────────────────────────────────────────────────────
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
      setSearchParams({},{replace:true});
    }
  },[]);

  const selectedProNoPay = !subscription?.status && user?.effective_tier==='pro' && !!user?.tier_selected;

  // ── Skills & Tools state ─────────────────────────────────────────────────
  const [mySkills, setMySkills] = useState([]);
  const [myTools,  setMyTools]  = useState([]);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showToolModal,  setShowToolModal]  = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [editingTool,  setEditingTool]  = useState(null);
  const [skillLookup,   setSkillLookup]   = useState([]);
  const [catLookup,     setCatLookup]     = useState([]);
  const [toolCatLookup, setToolCatLookup] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [toolsLoading,  setToolsLoading]  = useState(false);
  const emptySkill = { skill_name:'', category:'', hourly_rate:'', years_exp:'', description:'', is_available:true };
  const emptyTool  = { name:'', category:'', description:'', daily_rate:'', hourly_rate:'', deposit_amount:'', condition:'good', brand:'', model:'', is_available:true, requires_deposit:false, delivery_available:false, pickup_only:true, location_city:'', location_state:'' };
  const [skillForm, setSkillForm] = useState(emptySkill);
  const [toolForm,  setToolForm]  = useState(emptyTool);

  // ── Home tab state ───────────────────────────────────────────────────────
  const [homes,             setHomes]             = useState([]);
  const [homesLoaded,       setHomesLoaded]       = useState(false);
  const [homeAddrInput,     setHomeAddrInput]     = useState('');
  const [homeLookup,        setHomeLookup]        = useState(null);
  const [homeLookupLoading, setHomeLookupLoading] = useState(false);
  const [homeLookupError,   setHomeLookupError]   = useState('');
  const [homeNickname,      setHomeNickname]      = useState('');
  const [homeAdding,        setHomeAdding]        = useState(false);
  const [homeDeleteTarget,  setHomeDeleteTarget]  = useState(null);
  const [showHomeTaskModal, setShowHomeTaskModal] = useState(false);
  const [homeTaskForm,      setHomeTaskForm]      = useState({ title:'', due_date:'', urgency:'low', recurrence_days:'' });

  // ── Personal Care state ──────────────────────────────────────────────────
  const [pcTasks,     setPcTasks]     = useState([]);
  const [showPcModal, setShowPcModal] = useState(false);
  const [pcForm,      setPcForm]      = useState({ title:'', due_date:'', urgency:'low', recurrence_days:'' });

  // ── Car Care state ───────────────────────────────────────────────────────
  const [carTasks,     setCarTasks]     = useState([]);
  const [showCarModal, setShowCarModal] = useState(false);
  const [carForm,      setCarForm]      = useState({ title:'', due_date:'', urgency:'low', recurrence_days:'', vehicle_info:'' });

  // ── Modal state ──────────────────────────────────────────────────────────
  const [showExpenseModal,    setShowExpenseModal]    = useState(false);
  const [showGoalModal,       setShowGoalModal]       = useState(false);
  const [showChecklistModal,  setShowChecklistModal]  = useState(false);
  const [showBudgetModal,     setShowBudgetModal]     = useState(false);
  const [showGoalUpdateModal, setShowGoalUpdateModal] = useState(false);
  const [updatingGoal,        setUpdatingGoal]        = useState(null);
  const [goalUpdateValue,     setGoalUpdateValue]     = useState('');
  const [expenseForm, setExpenseForm] = useState({type:'expense',amount:'',category:'',description:'',is_recurring:false,frequency:'one_time',recurring_start_date:'',recurring_end_date:''});
  const [goalForm,    setGoalForm]    = useState({title:'',goal_type:'financial',target_value:'',icon:'🎯',due_date:''});
  const [checklistForm, setChecklistForm] = useState({title:'',due_date:''});
  const [budgetForm,    setBudgetForm]    = useState({category:'',monthly_limit:''});

  // ── Unread messages (socket) ─────────────────────────────────────────────
  const [unreadMessages, setUnreadMessages] = useState(0);
  const { socket } = useSocket();

  // ── Skills & Tools loaders ───────────────────────────────────────────────
  const fetchMySkills = useCallback(async () => {
    setSkillsLoading(true);
    try { const r = await api.get('/user-skills/me'); setMySkills(r.data?.skills || r.data || []); }
    catch { /**/ } finally { setSkillsLoading(false); }
  }, []);

  const fetchMyTools = useCallback(async () => {
    setToolsLoading(true);
    try { const r = await api.get('/tool-rentals/me'); setMyTools(r.data?.tools || r.data || []); }
    catch { /**/ } finally { setToolsLoading(false); }
  }, []);

  const loadSkillsAndTools = useCallback(() => { fetchMySkills(); fetchMyTools(); }, [fetchMySkills, fetchMyTools]);

  const handleSaveSkill = async (e) => {
    e.preventDefault();
    try {
      if (editingSkill) { await api.put(`/user-skills/${editingSkill.id}`, skillForm); toast.success('Skill updated!'); }
      else { await api.post('/user-skills', skillForm); toast.success('Skill added!'); }
      setShowSkillModal(false); setEditingSkill(null); setSkillForm(emptySkill); loadSkillsAndTools();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save skill'); }
  };

  const handleSaveTool = async (e) => {
    e.preventDefault();
    try {
      if (editingTool) { await api.put(`/tool-rentals/${editingTool.id}`, toolForm); toast.success('Tool updated!'); }
      else { await api.post('/tool-rentals', toolForm); toast.success('Tool listed!'); }
      setShowToolModal(false); setEditingTool(null); setToolForm(emptyTool); loadSkillsAndTools();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save tool'); }
  };

  const openSkillLookup = async (q) => {
    if (q.length < 2) { setSkillLookup([]); return; }
    try { const r = await api.get('/user-skills/lookup', { params: { q, limit: 15 } }); setSkillLookup(r.data?.skills || r.data || []); }
    catch { /**/ }
  };

  const openCatLookup = async (q) => {
    if (!q || q.length < 1) { setCatLookup([]); return; }
    try { const r = await api.get('/user-skills/categories', { params: { q, limit: 10 } }); setCatLookup(r.data?.categories || []); }
    catch { setCatLookup([]); }
  };

  const openToolCatLookup = async (q) => {
    if (!q || q.length < 1) { setToolCatLookup([]); return; }
    try { const r = await api.get('/tool-rentals/categories', { params: { q, limit: 10 } }); setToolCatLookup(r.data?.categories || []); }
    catch { setToolCatLookup([]); }
  };

  // ── retryLoad ────────────────────────────────────────────────────────────
  const retryLoad = useCallback(async()=>{
    setLoading(true); setError(false);
    try{
      const p = [api.get('/verification/background-check/status'),api.get('/verification/identity/status'),api.get('/notifications')];
      if(isOnboardingComplete){p.push(api.get('/bids/me'));p.push(api.get('/jobs?limit=5'));p.push(api.get('/messages/conversations'));}
      const r = await Promise.allSettled(p);
      if(r.some(x=>x.status==='rejected')) setError(true);
      setVerification({backgroundCheck:r[0].status==='fulfilled'?r[0].value.data?.backgroundCheck||null:null,identity:r[1].status==='fulfilled'?r[1].value.data?.identity||null:null});
      if(r[2].status==='fulfilled'){const n=r[2].value.data?.notifications||r[2].value.data||[];setNotifications(Array.isArray(n)?n:[]);}
      if(isOnboardingComplete){
        if(r[3]?.status==='fulfilled'){const b=r[3].value.data?.bids||r[3].value.data||[];setMyBids(Array.isArray(b)?b:[]);}
        if(r[4]?.status==='fulfilled'){const j=r[4].value.data?.jobs||r[4].value.data||[];setNearbyJobs(Array.isArray(j)?j:[]);}
        if(r[5]?.status==='fulfilled'){const convs=r[5].value.data||[];setUnreadMessages(convs.reduce((s,c)=>s+(parseInt(c.unread_count)||0),0));}
      }
    }catch(e){console.error(e);setError(true);}finally{setLoading(false);}
  },[isOnboardingComplete]);

  // ── Socket: real-time unread badge ───────────────────────────────────────
  useEffect(()=>{
    if(!socket) return;
    const inc = ()=> setUnreadMessages(prev => prev + 1);
    socket.on('profile_chat:new_message', inc);
    socket.on('message:new', inc);
    return ()=>{ socket.off('profile_chat:new_message', inc); socket.off('message:new', inc); };
  },[socket]);

  // ── fetchPcTasks / fetchCarTasks ─────────────────────────────────────────
  const fetchPcTasks  = useCallback(async()=>{ try{ const r=await api.get('/life/home-tasks',{params:{section:'personalcare',completed:'false'}}); setPcTasks(r.data?.home_tasks||r.data||[]); }catch{/**/} },[]);
  const fetchCarTasks = useCallback(async()=>{ try{ const r=await api.get('/life/home-tasks',{params:{section:'carcare',completed:'false'}}); setCarTasks(r.data?.home_tasks||r.data||[]); }catch{/**/} },[]);

  // ── Main useEffect ───────────────────────────────────────────────────────
  useEffect(()=>{
    retryLoad();
    if(isOnboardingComplete){
      life.fetchSummary();
      life.fetchFinancialPulse('1m');
      life.fetchCommunity();
      life.fetchExpenses();
      life.fetchBudgets();
      life.fetchGoals();
      life.fetchChecklist();
      life.fetchHomeTasks({ completed:'false', section:'home' });
      life.fetchSavedHelpers();
      fetchPcTasks();
      fetchCarTasks();
      loadSkillsAndTools();
      if(!homesLoaded){ api.get('/house/my').then(r=>{setHomes(r.data||[]);setHomesLoaded(true);}).catch(()=>{}); }
    }
  },[isOnboardingComplete]);

  // ── Tab-switch lazy-load ─────────────────────────────────────────────────
  useEffect(()=>{
    if(tab==='skills') loadSkillsAndTools();
    if(tab==='personalcare') fetchPcTasks();
    if(tab==='carcare') fetchCarTasks();
    if(tab==='home'){
      life.fetchHomeTasks({ completed:'false', section:'home' });
      life.fetchSavedHelpers();
      if(!homesLoaded){ api.get('/house/my').then(r=>{setHomes(r.data||[]);setHomesLoaded(true);}).catch(()=>{}); }
    }
  },[tab]);

  const startBackgroundCheck=async()=>{try{await api.post('/verification/background-check');window.location.reload();}catch(e){alert(e.response?.data?.error||'Failed');}};
  const startIdentityVerification=async()=>{try{const{data}=await api.post('/verification/identity/session');window.location.href=data.url;}catch(e){alert(e.response?.data?.error||'Failed');}};

  // ── localDateStr ─────────────────────────────────────────────────────────
  const localDateStr = (d=new Date())=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;};

  // ── Form handlers ─────────────────────────────────────────────────────────
  const handleAddExpense=async(e)=>{e.preventDefault();try{await life.createExpense({...expenseForm,amount:parseFloat(expenseForm.amount)});toast.success(expenseForm.type==='income'?'Income logged!':'Expense logged!');setExpenseForm({type:'expense',amount:'',category:'',description:'',is_recurring:false,frequency:'one_time',recurring_start_date:'',recurring_end_date:''});setShowExpenseModal(false);life.fetchSummary();life.fetchExpenses();}catch{toast.error('Failed.');}};
  const handleAddGoal=async(e)=>{e.preventDefault();try{await life.createGoal({...goalForm,target_value:goalForm.target_value?parseFloat(goalForm.target_value):null});toast.success('Goal created!');setGoalForm({title:'',goal_type:'financial',target_value:'',icon:'🎯',due_date:''});setShowGoalModal(false);life.fetchSummary();}catch{toast.error('Failed.');}};
  const handleAddChecklist=async(e)=>{e.preventDefault();try{await life.createChecklistItem(checklistForm);toast.success('Added!');setChecklistForm({title:'',due_date:''});setShowChecklistModal(false);life.fetchSummary();}catch{toast.error('Failed.');}};
  const toggleChecklist=async(item)=>{try{await life.updateChecklistItem(item.id,{is_completed:!item.is_completed});life.fetchSummary();}catch{toast.error('Failed.');}};
  const updateGoalProgress=async(goal,val)=>{try{const v=parseFloat(val);if(isNaN(v))return;await life.updateGoal(goal.id,{current_value:v,is_completed:goal.target_value&&v>=goal.target_value});life.fetchSummary();toast.success('Updated!');}catch{toast.error('Failed.');}};

  const handleAddHomeTask=async(e)=>{e.preventDefault();try{await life.createHomeTask({...homeTaskForm,recurrence_days:homeTaskForm.recurrence_days?parseInt(homeTaskForm.recurrence_days):null});toast.success('Task added!');setHomeTaskForm({title:'',due_date:'',urgency:'low',recurrence_days:''});setShowHomeTaskModal(false);life.fetchSummary();life.fetchHomeTasks({completed:'false',section:'home'});}catch{toast.error('Failed.');}};
  const toggleHomeTask=async(task)=>{try{await life.updateHomeTask(task.id,{is_completed:!task.is_completed});life.fetchSummary();life.fetchHomeTasks({completed:'false',section:'home'});}catch{toast.error('Failed.');}};
  const handleAddPcTask=async(e)=>{e.preventDefault();try{await api.post('/life/home-tasks',{section:'personalcare',...pcForm,recurrence_days:pcForm.recurrence_days?parseInt(pcForm.recurrence_days):null});toast.success('Task added!');setPcForm({title:'',due_date:'',urgency:'low',recurrence_days:''});setShowPcModal(false);fetchPcTasks();life.fetchSummary();}catch{toast.error('Failed.');}};
  const handleAddCarTask=async(e)=>{e.preventDefault();try{await api.post('/life/home-tasks',{section:'carcare',...carForm,recurrence_days:carForm.recurrence_days?parseInt(carForm.recurrence_days):null});toast.success('Task added!');setCarForm({title:'',due_date:'',urgency:'low',recurrence_days:'',vehicle_info:''});setShowCarModal(false);fetchCarTasks();life.fetchSummary();}catch{toast.error('Failed.');}};

  // ── Home handlers ────────────────────────────────────────────────────────
  const lookupHomeAddress=async()=>{const addr=homeAddrInput.trim();if(!addr)return;setHomeLookupLoading(true);setHomeLookup(null);setHomeLookupError('');try{const res=await api.get('/house/lookup',{params:{address:addr}});setHomeLookup(res.data);}catch(err){setHomeLookupError(err.response?.data?.error||'Address not found.');}finally{setHomeLookupLoading(false);}};
  const addHome=async()=>{if(!homeLookup)return;setHomeAdding(true);try{const payload={address:homeLookup.matchedAddress,city:homeLookup.city,state:homeLookup.state,zip:homeLookup.zip,lat:homeLookup.lat,lng:homeLookup.lng,year_built:homeLookup.building?.yearBuilt?parseInt(homeLookup.building.yearBuilt):undefined,flood_zone:homeLookup.flood?.zone||undefined,osm_building_levels:homeLookup.building?.levels?parseInt(homeLookup.building.levels):undefined,nickname:homeNickname.trim()||undefined,};const res=await api.post('/house/my',payload);setHomes(prev=>[res.data,...prev]);setHomeLookup(null);setHomeAddrInput('');setHomeNickname('');toast.success('Home added!');}catch(err){toast.error(err.response?.data?.error||'Failed to add home.');}finally{setHomeAdding(false);}};
  const deleteHome=async(id)=>{try{await api.delete(`/house/my/${id}`);setHomes(prev=>prev.filter(h=>h.id!==id));setHomeDeleteTarget(null);toast.success('Removed.');}catch{toast.error('Failed to remove.');}};

  // ── Online / offline toggle ───────────────────────────────────────────────
  const [isListed, setIsListed] = useState(user?.is_listed !== false);
  const [listingLoading, setListingLoading] = useState(false);

  useEffect(()=>{ api.get('/helpers/me/listing').then(r=>setIsListed(!!r.data?.is_listed)).catch(()=>{}); },[]);

  const handleToggleListing=async()=>{const next=!isListed;setListingLoading(true);try{const{data}=await api.put('/helpers/me/listing',{is_listed:next});setIsListed(!!data.is_listed);toast.success(data.is_listed?'You are now online — visible in the helper directory.':'You are now offline — hidden from the directory.');}catch(err){toast.error(err?.response?.data?.error||'Failed to update status');}setListingLoading(false);};

  // ── Derived ───────────────────────────────────────────────────────────────
  const hr=new Date().getHours();
  const greeting=hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  const displayName=(()=>{const pref=user?.display_name_preference||'first_name';if(pref==='full_name')return `${user?.first_name||''} ${user?.last_name||''}`.trim();if(pref==='business_name')return user?.business_name||user?.first_name||'';return user?.first_name||'';})();
  const isProActive=subscription?.status==='active';
  const showOnboarding=!isOnboardingComplete;
  const unreadNotifs=notifications.filter(n=>!n.read&&!n.read_at).length;
  const activeBids=myBids.filter(b=>b.status==='pending'||b.status==='accepted');
  const wonBids=myBids.filter(b=>b.status==='accepted');
  const s=life.summary;

  const tabs=showOnboarding
    ?[{id:'pulse',label:'Get Started'}]
    :[{id:'pulse',label:'My Pulse'},{id:'editprofile',label:'Edit Profile'},{id:'earnings',label:'Earnings'},{id:'jobs',label:'Find Jobs'},{id:'goals',label:'Goals'},{id:'home',label:'Home'},{id:'personalcare',label:'Personal Care'},{id:'carcare',label:'Car Care'},{id:'skills',label:'Skills & Tools'},{id:'bids',label:'My Bids'}];

  if(loading) return(<PageShell><div className="min-h-screen text-white"><div className="flex flex-col items-center justify-center py-24 text-gray-500"><div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4"/><span className="text-sm">Loading your dashboard…</span></div></div></PageShell>);

  return(
    <PageShell>
    <div className="min-h-screen text-white">
      <PageMeta title="Helper Dashboard" description="Manage your jobs, earnings, bids, and skills." noIndex={true} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <div className="mb-5"><TrialBanner /></div>
        <HelperOffersCard />

        {welcomeMsg&&<div className="mb-5 flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm font-medium"><span>🎉</span><span>{welcomeMsg}</span></div>}

        {/* Offline notice */}
        {!showOnboarding && !isListed && (
          <div className="mb-4 flex items-center justify-between gap-3 p-3 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-gray-400">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-500 flex-shrink-0"/><span>You are <strong className="text-white">offline</strong> — not visible in the helper directory.</span></div>
            <button onClick={handleToggleListing} disabled={listingLoading} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 whitespace-nowrap">Go Online</button>
          </div>
        )}

        {/* Email verification warning */}
        {user && !user.email_verified && (
          <div className="mb-5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3"><span className="text-2xl">⚠</span><div><p className="text-yellow-400 font-medium text-sm">Email not verified</p><p className="text-xs text-gray-400">Verify your email to unlock all features.</p></div></div>
            <button onClick={async()=>{try{await api.post('/auth/resend-verification');toast.success('Verification email sent!')}catch{toast.error('Failed to send.')}}} className="text-xs bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 px-4 py-2 rounded-lg transition">Resend Email</button>
          </div>
        )}

        {/* Greeting + Online/Offline toggle */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold">{showOnboarding?`Welcome, ${displayName||'Helper'}!`:`${greeting}, ${displayName||'Helper'}.`}</h1>
              {!showOnboarding&&<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" className="animate-pulse"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>}
            </div>
            <p className="text-gray-500 mt-1 text-sm">{showOnboarding?'Finish setup to go live.':`${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})} — Let's get to work.`}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <BadgeDisplay badges={user?.badges} size="large"/>
            {!showOnboarding && (
              <button onClick={handleToggleListing} disabled={listingLoading}
                title={isListed?'Click to go offline':'Click to go online'}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all disabled:opacity-60 border ${isListed?'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25':'bg-gray-700/60 border-gray-600 text-gray-400 hover:bg-gray-700'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isListed?'bg-emerald-400 animate-pulse':'bg-gray-500'}`}/>
                {listingLoading?'Updating…':isListed?'Online':'Offline'}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        {tabs.length>1&&(
          <div className="grid grid-cols-5 sm:flex gap-1 my-6 bg-gray-900/80 rounded-xl p-1">
            {tabs.map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all sm:whitespace-nowrap text-center ${tab===t.id?'bg-orange-500 text-gray-950':'text-gray-500 hover:text-gray-300'}`}>{t.label}</button>))}
          </div>
        )}

        {/* ═══════ PULSE ═══════ */}
        {tab==='pulse'&&(<>
          {error&&(<div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-2"><span>⚠</span><span>Some data failed to load. <button onClick={retryLoad} className="underline hover:text-red-300">Retry</button></span></div>)}
          {showOnboarding&&<div className="mt-6"><OnboardingProgress user={user} onResume={()=>navigate('/settings')}/></div>}

          {/* Financial Pulse Score — dynamic color + breakdown + alerts */}
          {!showOnboarding && (() => {
            const fp = life.financialPulse;
            if (!fp) return null;
            const score = fp.pulse_score ?? s?.pulse_score;
            if (score === undefined) return null;
            const scoreColor = score>=80?'#34d399':score>=60?'#F97316':score>=40?'#facc15':'#f87171';
            const breakdown = fp.score_breakdown || {};
            return (
              <div className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 border border-gray-700/40 rounded-2xl p-6 mb-6">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-6">
                    <div className="relative w-20 h-20 shrink-0">
                      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="#1f2937" strokeWidth="6"/>
                        <circle cx="40" cy="40" r="34" fill="none" stroke={scoreColor} strokeWidth="6"
                          strokeDasharray={`${(score/100)*213.6} 213.6`} strokeLinecap="round" className="transition-all duration-1000"/>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl font-bold" style={{color:scoreColor}}>{score}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold mb-1">Financial Pulse · Next 30 days</p>
                      <p className="text-sm text-gray-400 max-w-xs">
                        {score>=80?"You're on fire. Strong earnings and goals on track.":score>=60?"Solid progress. Keep logging earnings and bids.":score>=40?"Building momentum. Set goals and stay active on jobs.":"Just getting started. Complete your profile and bid on your first job!"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {[{l:'Coverage',v:breakdown.coverage,c:'text-emerald-400'},{l:'Buffer',v:breakdown.buffer,c:'text-blue-400'},{l:'Reliability',v:breakdown.reliability,c:'text-purple-400'},{l:'Obligations',v:breakdown.obligations,c:'text-orange-400'}].map((d,i)=>(
                      <div key={i} className="text-center"><p className={`text-lg font-bold ${d.c}`}>{d.v??'—'}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{d.l}</p></div>
                    ))}
                  </div>
                </div>
                {fp.alerts?.length>0&&(
                  <div className="mt-4 space-y-1.5">{fp.alerts.map((a,i)=>(
                    <div key={i} className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2"><span>⚠</span><span>{a.message||a}</span></div>
                  ))}</div>
                )}
              </div>
            );
          })()}

          {/* Stat cards */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 ${showOnboarding?'opacity-50 pointer-events-none':''}`}>
            <Card>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Jobs Completed</p>
              {loading?<div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1"/>:<p className="text-2xl font-bold text-orange-400">{user?.completed_jobs||0}</p>}
              <p className="text-xs text-gray-500 mt-1">{user?.avg_rating?`${user.avg_rating}★ avg`:'No reviews yet'}</p>
            </Card>
            <Card>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Net This Month</p>
              {loading?<div className="h-8 w-20 bg-gray-800 rounded animate-pulse mt-1"/>:<p className={`text-2xl font-bold ${(s?.finances?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(s?.finances?.net||0).toFixed(2)}</p>}
              <p className="text-xs text-gray-500 mt-1">${(s?.finances?.total_income||0).toFixed(0)} earned</p>
            </Card>
            <Card>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Active Bids</p>
              {loading?<div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1"/>:<p className="text-2xl font-bold text-blue-400">{activeBids.length}</p>}
              <p className="text-xs text-gray-500 mt-1">{wonBids.length} accepted</p>
            </Card>
            <Card>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Goals</p>
              {loading?<div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1"/>:<p className="text-2xl font-bold text-purple-400">{s?.goals?.avg_progress||0}%</p>}
              <p className="text-xs text-gray-500 mt-1">{s?.goals?.active||0} in progress</p>
            </Card>
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
              {[{to:'/jobs',Ic:IcoBriefcase,l:'Find Jobs',c:'text-orange-400'},{to:'/helper/messages',Ic:IcoChat,l:'Messages',c:'text-blue-400',badge:unreadMessages},{to:'/disputes',Ic:IcoShield,l:'Disputes',c:'text-purple-400'},{to:'/settings',Ic:IcoSettings,l:'Settings',c:'text-gray-400'}].map((a,i)=>(
                <Link key={i} to={a.to} onClick={a.badge?()=>setUnreadMessages(0):undefined} className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-4 hover:border-gray-600 hover:-translate-y-0.5 transition-all group flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <a.Ic size={18} cls={a.c}/>
                    {!!a.badge&&<span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">{a.badge>99?'99+':a.badge}</span>}
                  </div>
                  <span className="text-sm font-medium text-gray-300 group-hover:text-white transition">{a.l}</span>
                </Link>
              ))}
            </div>

            {/* Nearby jobs */}
            <Card className="mb-6">
              <CardHeader icon={IcoZap} title="Jobs Near You" right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">View All →</Link>}/>
              {nearbyJobs.length===0
                ?<p className="text-gray-500 text-sm text-center py-6">No nearby jobs right now. Check back soon or <Link to="/jobs" className="text-orange-400 hover:text-orange-300">browse all jobs</Link>.</p>
                :<div className="space-y-2">{nearbyJobs.slice(0,3).map(job=>(
                  <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl hover:bg-gray-800/60 transition group">
                    <div className="min-w-0 flex-1"><p className="text-white text-sm font-medium group-hover:text-orange-400 transition truncate">{job.title}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.distance_miles?` · ${job.distance_miles} mi`:''}</p></div>
                    {(job.budget_min||job.budget_max)&&<span className="text-sm font-bold text-emerald-400">${job.budget_min||'?'}–${job.budget_max||'?'}</span>}
                  </Link>
                ))}</div>
              }
            </Card>

            {/* Community Stats */}
            {life.community&&(
              <Card className="mb-6">
                <CardHeader icon={IcoUsers} title="Springfield Helpers" right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">Browse Jobs →</Link>}/>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[{l:'Jobs This Week',v:life.community.jobs_this_week,c:'text-orange-400'},{l:'Open Now',v:life.community.open_jobs,c:'text-emerald-400'},{l:'Active Helpers',v:life.community.active_helpers,c:'text-blue-400'},{l:'Seekers This Week',v:life.community.active_seekers,c:'text-purple-400'}].map((d,i)=>(
                    <div key={i} className="text-center p-3 bg-gray-800/30 rounded-xl"><p className={`text-xl font-bold ${d.c}`}>{d.v}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{d.l}</p></div>
                  ))}
                </div>
                {life.community.top_categories?.length>0&&(
                  <div className="mt-4 flex items-center gap-2 flex-wrap"><span className="text-xs text-gray-500">Most requested:</span>{life.community.top_categories.slice(0,3).map((c,i)=><Tag key={i} text={`${c.category_name} (${c.job_count})`} color={['orange','green','blue'][i]}/>)}</div>
                )}
              </Card>
            )}

            {/* Upgrade CTA */}
            {!isProActive&&(
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
                  <div className="min-w-0 flex-1"><p className="text-sm text-white truncate">{e.description||e.category}</p><p className="text-xs text-gray-600 mt-0.5">{e.category} · {new Date(e.occurred_at).toLocaleDateString()}{e.is_recurring?` · 🔄 ${e.frequency||'recurring'}`:''}</p></div>
                  <div className="flex items-center gap-2"><span className={`text-sm font-bold ${e.type==='income'?'text-emerald-400':'text-red-400'}`}>{e.type==='income'?'+':'-'}${parseFloat(e.amount).toFixed(2)}</span>
                    <button onClick={async()=>{await life.deleteExpense(e.id);life.fetchSummary();life.fetchExpenses();toast.success('Deleted');}} className="opacity-0 group-hover:opacity-100"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button></div>
                </div>
              ))}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoTarget} title="Budget Categories" right={<Btn variant="secondary" onClick={()=>setShowBudgetModal(true)}>+ Add</Btn>}/>
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
              :(<div className="space-y-4 max-h-96 overflow-y-auto">{life.goals.map(g=>{const pct=g.target_value>0?Math.min((parseFloat(g.current_value||0)/parseFloat(g.target_value))*100,100):0;return(
                <div key={g.id} className={`p-4 border rounded-xl ${g.is_completed?'border-emerald-500/30 bg-emerald-500/5 opacity-60':'border-gray-800'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{g.icon||'🎯'}</span>
                    <span className="font-semibold text-sm text-white flex-1">{g.title}</span>
                    {g.goal_type&&g.goal_type!=='financial'&&<Tag text={g.goal_type} color={g.goal_type==='task'?'blue':g.goal_type==='career'?'purple':'gray'}/>}
                    {g.is_completed?<Tag text="Done" color="green"/>:<span className="text-sm font-bold text-orange-400">{Math.round(pct)}%</span>}
                  </div>
                  {g.due_date&&!g.is_completed&&(()=>{const today=localDateStr();const diff=Math.ceil((new Date(g.due_date)-new Date(today))/86400000);return(<p className={`text-xs mb-2 ${diff<0?'text-red-400':diff===0?'text-yellow-400':'text-gray-500'}`}>{diff<0?`${Math.abs(diff)}d overdue`:diff===0?'Due today':`${diff} days remaining`}</p>);})()}
                  {g.target_value>0&&!g.is_completed&&(<><ProgressBar pct={pct} color="bg-orange-500"/><div className="flex justify-between items-center mt-2"><span className="text-xs text-gray-500">${parseFloat(g.current_value||0).toLocaleString()} of ${parseFloat(g.target_value).toLocaleString()}</span>
                    <button onClick={()=>{setUpdatingGoal(g);setGoalUpdateValue(String(g.current_value||''));setShowGoalUpdateModal(true);}} className="text-[10px] text-orange-400 font-semibold">Update →</button>
                  </div></>)}
                  {!g.target_value&&!g.is_completed&&(<button onClick={async()=>{await life.updateGoal(g.id,{is_completed:true});life.fetchSummary();toast.success('Goal complete! 🎉');}} className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold">Mark complete →</button>)}
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

        {/* ═══════ HOME ═══════ */}
        {tab==='home'&&(<>
          <Card className="mb-5">
            <CardHeader icon={IcoHome} title="My Properties" right={<span className="text-[10px] text-gray-600">Census · OSM · FEMA</span>}/>
            <div className="flex gap-2 mb-3">
              <input type="text" placeholder="Enter address (e.g. 123 Main St, Springfield OH)"
                value={homeAddrInput}
                onChange={e=>{setHomeAddrInput(e.target.value);setHomeLookup(null);setHomeLookupError('');}}
                onKeyDown={e=>e.key==='Enter'&&!homeLookupLoading&&homeAddrInput.length>5&&lookupHomeAddress()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
              <button onClick={lookupHomeAddress} disabled={homeLookupLoading||homeAddrInput.trim().length<5}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                {homeLookupLoading?'Looking up…':'Look Up'}
              </button>
            </div>
            {homeLookupError&&<p className="text-xs text-red-400 mb-2">{homeLookupError}</p>}
            {homeLookup&&(
              <div className="bg-gray-800/80 border border-orange-500/30 rounded-xl p-3 mb-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-white leading-tight">{homeLookup.matchedAddress}</p>
                  <span className="text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">Census verified</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
                  {homeLookup.building?.yearBuilt&&<span>🏠 Built {homeLookup.building.yearBuilt}</span>}
                  {homeLookup.building?.levels&&<span>📐 {homeLookup.building.levels} {parseInt(homeLookup.building.levels)===1?'story':'stories'}</span>}
                  {homeLookup.flood&&<span className={homeLookup.flood.zone&&['A','AE','V','VE'].includes(homeLookup.flood.zone)?'text-red-400 font-semibold':'text-emerald-400'}>💧 {homeLookup.flood.label||`Flood Zone ${homeLookup.flood.zone}`}</span>}
                </div>
                <div className="flex gap-2 pt-1">
                  <input type="text" placeholder='Nickname (optional)' value={homeNickname} maxLength={80} onChange={e=>setHomeNickname(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                  <button onClick={addHome} disabled={homeAdding} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">
                    {homeAdding?'Saving…':'+ Save Property'}
                  </button>
                </div>
              </div>
            )}
            {homes.length===0?<p className="text-xs text-gray-600 text-center py-2">No properties saved yet.</p>
            :(
              <div className="flex flex-wrap gap-2">
                {homes.map(h=>(
                  <div key={h.id} className="flex items-center gap-2 bg-gray-800/70 border border-gray-700 rounded-xl px-3 py-2 max-w-full">
                    <IcoHome size={13} cls="text-orange-400 flex-shrink-0"/>
                    <div className="leading-tight min-w-0">
                      <span className="text-sm text-white font-medium truncate block">{h.nickname||h.address}</span>
                      {h.nickname&&<span className="text-[10px] text-gray-500 truncate block">{h.address}</span>}
                      <div className="flex gap-2 flex-wrap">
                        {h.year_built&&<span className="text-[10px] text-orange-400">{h.year_built}</span>}
                        {h.flood_zone&&<span className={`text-[10px] ${['A','AE','V','VE'].includes(h.flood_zone)?'text-red-400':'text-emerald-400'}`}>Zone {h.flood_zone}</span>}
                      </div>
                    </div>
                    <button onClick={()=>setHomeDeleteTarget(h)} className="text-gray-700 hover:text-red-400 transition ml-1 flex-shrink-0"><IcoX size={12}/></button>
                  </div>
                ))}
              </div>
            )}
            {homeDeleteTarget&&(
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between gap-3">
                <p className="text-sm text-red-300">Remove <strong>{homeDeleteTarget.nickname||homeDeleteTarget.address}</strong>?</p>
                <div className="flex gap-2">
                  <button onClick={()=>setHomeDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg">Cancel</button>
                  <button onClick={()=>deleteHome(homeDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">Remove</button>
                </div>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card className="!p-3 text-center"><p className={`text-2xl font-bold ${(s?.home?.overdue||0)>0?'text-red-400':'text-emerald-400'}`}>{s?.home?.overdue||0}</p><p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">Overdue</p></Card>
            <Card className="!p-3 text-center"><p className="text-2xl font-bold text-orange-400">{s?.home?.due_this_week||0}</p><p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">Due This Week</p></Card>
            <Card className="!p-3 text-center"><p className="text-2xl font-bold text-gray-300">{s?.home?.total_pending||0}</p><p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">Total Pending</p></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader icon={IcoHome} title="Home Maintenance" right={<Btn onClick={()=>setShowHomeTaskModal(true)}>+ Add Task</Btn>}/>
              {(life.homeTasks||[]).length===0?<p className="text-gray-600 text-sm text-center py-8">No home tasks yet.</p>
              :(<div className="space-y-2 max-h-96 overflow-y-auto">{(life.homeTasks||[]).map(t=>{
                const overdue=t.due_date&&t.due_date<localDateStr()&&!t.is_completed;
                return(<div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${t.is_completed?'opacity-40 border-gray-800':overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                  <button onClick={()=>toggleHomeTask(t)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${t.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{t.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${t.is_completed?'line-through text-gray-600':'text-white'}`}>{t.title}</p>
                    <p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-600'}`}>{t.due_date?(overdue?'Overdue · ':'')+new Date(t.due_date).toLocaleDateString():'No due date'}{t.recurrence_days?` · Every ${t.recurrence_days}d`:''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tag text={t.urgency} color={t.urgency==='high'?'red':t.urgency==='medium'?'orange':'gray'}/>
                    <Link to="/post-job" className="text-[10px] text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap">Find Help →</Link>
                  </div>
                </div>);
              })}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoUsers} title="Saved Helpers" right={<Link to="/helpers" className="text-xs text-orange-400 font-medium">Browse →</Link>}/>
              {(life.savedHelpers||[]).length===0?<p className="text-gray-600 text-sm text-center py-8">No saved helpers yet.</p>
              :(<div className="space-y-2">{(life.savedHelpers||[]).map(h=>(
                <div key={h.id} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-xl group">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/30 to-purple-500/30 flex items-center justify-center font-bold text-sm flex-shrink-0">{(h.first_name||'?')[0]}</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-white">{h.first_name} {h.last_name}</p><p className="text-xs text-gray-500 truncate">{h.categories||'Helper'} · {h.avg_rating?`${h.avg_rating}★`:'New'} · {h.completed_jobs||0} jobs</p></div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link to={`/helpers/${h.helper_id}`} className="text-xs text-orange-400 font-medium">View</Link>
                    <button onClick={async()=>{await life.removeSavedHelper(h.id);life.fetchSavedHelpers();toast.success('Removed');}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={13} cls="text-gray-600 hover:text-red-400"/></button>
                  </div>
                </div>
              ))}</div>)}
            </Card>
          </div>
        </>)}

        {/* ═══════ PERSONAL CARE ═══════ */}
        {tab==='personalcare'&&(
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold text-white text-lg">Personal Care</h3><p className="text-xs text-gray-500 mt-0.5">Track health appointments, grooming, wellness, and recurring self-care.</p></div>
              <Btn onClick={()=>setShowPcModal(true)}>+ Add</Btn>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[{label:'Overdue',value:pcTasks.filter(t=>t.due_date&&t.due_date<localDateStr()&&!t.is_completed).length,color:'text-red-400'},{label:'This Week',value:pcTasks.filter(t=>{if(!t.due_date||t.is_completed)return false;const end=localDateStr(new Date(Date.now()+7*864e5));return t.due_date>=localDateStr()&&t.due_date<=end;}).length,color:'text-orange-400'},{label:'Total Pending',value:pcTasks.length,color:'text-blue-400'},{label:'Recurring',value:pcTasks.filter(t=>t.recurrence_days).length,color:'text-purple-400'}].map((st,i)=>(
                <Card key={i} className="!p-3 text-center"><p className={`text-2xl font-bold ${st.color}`}>{st.value}</p><p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{st.label}</p></Card>
              ))}
            </div>
            {pcTasks.length===0?<Card><p className="text-gray-600 text-sm text-center py-8">No personal care tasks yet.</p></Card>
            :(<div className="space-y-2">{pcTasks.map(t=>{const overdue=t.due_date&&t.due_date<localDateStr()&&!t.is_completed;return(
              <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${t.is_completed?'opacity-40 border-gray-800':overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                <button onClick={async()=>{try{await api.put(`/life/home-tasks/${t.id}`,{is_completed:!t.is_completed});fetchPcTasks();life.fetchSummary();}catch{toast.error('Failed.');}}} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${t.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{t.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${t.is_completed?'line-through text-gray-600':'text-white'}`}>{t.title}</p>
                  <p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-600'}`}>{t.due_date?(overdue?'Overdue · ':'')+new Date(t.due_date).toLocaleDateString():'No due date'}{t.recurrence_days?` · Every ${t.recurrence_days}d`:''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {t.urgency&&<Tag text={t.urgency} color={t.urgency==='high'?'red':t.urgency==='medium'?'orange':'gray'}/>}
                  <button onClick={async()=>{try{await api.delete(`/life/home-tasks/${t.id}`);fetchPcTasks();toast.success('Removed');}catch{toast.error('Failed.');}}} className="text-gray-600 hover:text-red-400 transition"><IcoTrash size={13}/></button>
                </div>
              </div>
            );})}</div>)}
          </div>
        )}

        {/* ═══════ CAR CARE ═══════ */}
        {tab==='carcare'&&(
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold text-white text-lg">Car Care</h3><p className="text-xs text-gray-500 mt-0.5">Track oil changes, tire rotations, detailing, and other vehicle maintenance.</p></div>
              <Btn onClick={()=>setShowCarModal(true)}>+ Add</Btn>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[{label:'Overdue',value:carTasks.filter(t=>t.due_date&&t.due_date<localDateStr()&&!t.is_completed).length,color:'text-red-400'},{label:'This Week',value:carTasks.filter(t=>{if(!t.due_date||t.is_completed)return false;const end=localDateStr(new Date(Date.now()+7*864e5));return t.due_date>=localDateStr()&&t.due_date<=end;}).length,color:'text-orange-400'},{label:'Total Pending',value:carTasks.length,color:'text-blue-400'},{label:'Recurring',value:carTasks.filter(t=>t.recurrence_days).length,color:'text-purple-400'}].map((st,i)=>(
                <Card key={i} className="!p-3 text-center"><p className={`text-2xl font-bold ${st.color}`}>{st.value}</p><p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{st.label}</p></Card>
              ))}
            </div>
            {carTasks.length===0?<Card><p className="text-gray-600 text-sm text-center py-8">No car care tasks yet.</p></Card>
            :(<div className="space-y-2">{carTasks.map(t=>{const overdue=t.due_date&&t.due_date<localDateStr()&&!t.is_completed;return(
              <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${t.is_completed?'opacity-40 border-gray-800':overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                <button onClick={async()=>{try{await api.put(`/life/home-tasks/${t.id}`,{is_completed:!t.is_completed});fetchCarTasks();life.fetchSummary();}catch{toast.error('Failed.');}}} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${t.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{t.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${t.is_completed?'line-through text-gray-600':'text-white'}`}>{t.title}</p>
                  <p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-600'}`}>{t.due_date?(overdue?'Overdue · ':'')+new Date(t.due_date).toLocaleDateString():'No due date'}{t.recurrence_days?` · Every ${t.recurrence_days}d`:''}{t.vehicle_info?` · ${t.vehicle_info}`:''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {t.urgency&&<Tag text={t.urgency} color={t.urgency==='high'?'red':t.urgency==='medium'?'orange':'gray'}/>}
                  <button onClick={async()=>{try{await api.delete(`/life/home-tasks/${t.id}`);fetchCarTasks();toast.success('Removed');}catch{toast.error('Failed.');}}} className="text-gray-600 hover:text-red-400 transition"><IcoTrash size={13}/></button>
                </div>
              </div>
            );})}</div>)}
          </div>
        )}

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

        {/* ═══════ EDIT PROFILE ═══════ */}
        {tab==='editprofile'&&<EditProfileTab/>}

        {/* ═══════ SKILLS & TOOLS ═══════ */}
        {tab==='skills'&&(
          <div className="space-y-6">
            <Card>
              <CardHeader icon={IcoZap} title="My Skills" right={<Btn onClick={()=>{setEditingSkill(null);setSkillForm(emptySkill);setShowSkillModal(true);}}>+ Add Skill</Btn>}/>
              {skillsLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              :mySkills.length===0?<p className="text-gray-600 text-sm text-center py-8">No skills listed yet. Add your first skill to get discovered.</p>
              :(<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{mySkills.map(sk=>(
                <div key={sk.id} className="p-4 border border-gray-800 rounded-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-white truncate">{sk.skill_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{sk.category}{sk.years_exp||sk.years_experience?` · ${sk.years_exp||sk.years_experience} yrs`:''}</p>
                      {sk.hourly_rate&&<p className="text-xs text-orange-400 mt-1 font-semibold">${parseFloat(sk.hourly_rate).toFixed(0)}/hr</p>}
                      {sk.description&&<p className="text-xs text-gray-600 mt-1 line-clamp-2">{sk.description}</p>}
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Tag text={sk.is_available?'Available':'Unavailable'} color={sk.is_available?'green':'gray'}/>
                      <div className="flex gap-1 justify-end mt-1">
                        <button onClick={()=>{setEditingSkill(sk);setSkillForm({skill_name:sk.skill_name,category:sk.category||'',hourly_rate:sk.hourly_rate||'',years_exp:sk.years_exp||sk.years_experience||'',description:sk.description||'',is_available:sk.is_available});setShowSkillModal(true);}} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">Edit</button>
                        <button onClick={async()=>{if(!confirm('Delete this skill?'))return;try{await api.delete(`/user-skills/${sk.id}`);toast.success('Removed');fetchMySkills();}catch{toast.error('Failed');}}} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">Del</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}</div>)}
            </Card>

            <Card>
              <CardHeader icon={IcoBriefcase} title="Tools for Rent" right={<Btn onClick={()=>{setEditingTool(null);setToolForm(emptyTool);setShowToolModal(true);}}>+ List a Tool</Btn>}/>
              {toolsLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              :myTools.length===0?<p className="text-gray-600 text-sm text-center py-8">No tools listed yet. List your equipment so others can rent them.</p>
              :(<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{myTools.map(t=>(
                <div key={t.id} className="p-4 border border-gray-800 rounded-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-white truncate">{t.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.category}{t.brand?` · ${t.brand}`:''}{t.model?` ${t.model}`:''}</p>
                      <div className="flex gap-2 mt-1">
                        {t.daily_rate&&<span className="text-xs text-orange-400 font-semibold">${parseFloat(t.daily_rate).toFixed(0)}/day</span>}
                        {t.hourly_rate&&<span className="text-xs text-orange-300 font-semibold">${parseFloat(t.hourly_rate).toFixed(0)}/hr</span>}
                        {t.deposit_amount&&<span className="text-xs text-gray-500">Deposit: ${parseFloat(t.deposit_amount).toFixed(0)}</span>}
                      </div>
                      {t.condition&&<p className="text-xs text-gray-600 mt-1 capitalize">Condition: {t.condition}</p>}
                      {(t.delivery_available||t.pickup_only)&&<p className="text-xs text-gray-600 mt-0.5">{t.delivery_available?'Delivery available':''}{t.pickup_only?'Pickup only':''}{t.location_city?` · ${t.location_city}${t.location_state?`, ${t.location_state}`:''}`:''}</p>}
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Tag text={(t.is_available||t.is_available_for_rent)?'Available':'Unavailable'} color={(t.is_available||t.is_available_for_rent)?'green':'gray'}/>
                      <div className="flex gap-1 justify-end mt-1">
                        <button onClick={()=>{setEditingTool(t);setToolForm({name:t.name,category:t.category||'',description:t.description||'',daily_rate:t.daily_rate||'',hourly_rate:t.hourly_rate||'',deposit_amount:t.deposit_amount||'',condition:t.condition||'good',brand:t.brand||'',model:t.model||'',is_available:t.is_available||t.is_available_for_rent,requires_deposit:t.requires_deposit||false,delivery_available:t.delivery_available||false,pickup_only:t.pickup_only||true,location_city:t.location_city||'',location_state:t.location_state||''});setShowToolModal(true);}} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">Edit</button>
                        <button onClick={async()=>{if(!confirm('Delete this listing?'))return;try{await api.delete(`/tool-rentals/${t.id}`);toast.success('Removed');fetchMyTools();}catch{toast.error('Failed');}}} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">Del</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}</div>)}
            </Card>
          </div>
        )}

        </main>

      {/* ── Modals ── */}
      <Modal open={showSkillModal} onClose={()=>{setShowSkillModal(false);setEditingSkill(null);setSkillLookup([]);}} title={editingSkill?'Edit Skill':'Add Skill'}>
        <form onSubmit={handleSaveSkill} className="space-y-4">
          <div>
            <Input label="Skill Name" required placeholder="e.g. Drywall Repair, Electrical Wiring" value={skillForm.skill_name}
              onChange={e=>{setSkillForm(p=>({...p,skill_name:e.target.value}));openSkillLookup(e.target.value);}}/>
            {skillLookup.length>0&&(<div className="mt-1 border border-gray-700 rounded-lg overflow-hidden">{skillLookup.map(s=><button type="button" key={s.id||s.name} onClick={()=>{setSkillForm(p=>({...p,skill_name:s.skill_name||s.name,category:s.category_name||p.category}));setSkillLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition">{s.skill_name||s.name}{s.category_name?<span className="text-gray-600 ml-2 text-xs">{s.category_name}</span>:null}</button>)}</div>)}
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Category</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition" placeholder="e.g. Plumbing, Electrical, Landscaping" value={skillForm.category} onChange={e=>{setSkillForm(p=>({...p,category:e.target.value}));openCatLookup(e.target.value);}} onBlur={()=>setTimeout(()=>setCatLookup([]),150)}/>
            {catLookup.length>0&&(<div className="mt-1 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">{catLookup.map(c=><button type="button" key={c} onClick={()=>{setSkillForm(p=>({...p,category:c}));setCatLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition">{c}</button>)}</div>)}
          </div>
          <Input label="Hourly Rate ($, optional)" type="number" step="0.01" min="0" placeholder="0.00" value={skillForm.hourly_rate} onChange={e=>setSkillForm(p=>({...p,hourly_rate:e.target.value}))}/>
          <Input label="Years of Experience" type="number" min="0" max="50" placeholder="0" value={skillForm.years_exp} onChange={e=>setSkillForm(p=>({...p,years_exp:e.target.value}))}/>
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
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Category</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition" placeholder="Power Tools, Hand Tools, Landscaping…" value={toolForm.category} onChange={e=>{setToolForm(p=>({...p,category:e.target.value}));openToolCatLookup(e.target.value);}} onBlur={()=>setTimeout(()=>setToolCatLookup([]),150)}/>
            {toolCatLookup.length>0&&(<div className="mt-1 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">{toolCatLookup.map(c=><button type="button" key={c} onClick={()=>{setToolForm(p=>({...p,category:c}));setToolCatLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition">{c}</button>)}</div>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Daily Rate ($)" type="number" step="0.01" min="0" required placeholder="25.00" value={toolForm.daily_rate} onChange={e=>setToolForm(p=>({...p,daily_rate:e.target.value}))}/>
            <Input label="Hourly Rate ($, opt)" type="number" step="0.01" min="0" placeholder="8.00" value={toolForm.hourly_rate} onChange={e=>setToolForm(p=>({...p,hourly_rate:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Deposit ($, optional)" type="number" step="0.01" min="0" placeholder="50.00" value={toolForm.deposit_amount} onChange={e=>setToolForm(p=>({...p,deposit_amount:e.target.value}))}/>
            <Select label="Condition" value={toolForm.condition} onChange={e=>setToolForm(p=>({...p,condition:e.target.value}))}>
              <option value="new">New</option><option value="like_new">Like New</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" placeholder="Springfield" value={toolForm.location_city} onChange={e=>setToolForm(p=>({...p,location_city:e.target.value}))}/>
            <Input label="State" placeholder="OH" maxLength={2} value={toolForm.location_state} onChange={e=>setToolForm(p=>({...p,location_state:e.target.value.toUpperCase()}))}/>
          </div>
          <div><label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Description (optional)</label><textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" rows={2} placeholder="Condition details, what's included, pickup notes…" value={toolForm.description} onChange={e=>setToolForm(p=>({...p,description:e.target.value}))}/></div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.is_available} onChange={e=>setToolForm(p=>({...p,is_available:e.target.checked}))} className="w-4 h-4 accent-orange-500"/><span className="text-sm text-gray-300">Available to rent</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.delivery_available} onChange={e=>setToolForm(p=>({...p,delivery_available:e.target.checked}))} className="w-4 h-4 accent-orange-500"/><span className="text-sm text-gray-300">Delivery available</span></label>
          </div>
          <Btn className="w-full py-3" type="submit">{editingTool?'Save Changes':'List Tool'}</Btn>
        </form>
      </Modal>

      <Modal open={showExpenseModal} onClose={()=>setShowExpenseModal(false)} title="Log Transaction">
        <form onSubmit={handleAddExpense} className="space-y-4">
          <Select label="Type" value={expenseForm.type} onChange={e=>setExpenseForm(p=>({...p,type:e.target.value}))}><option value="expense">Expense</option><option value="income">Income</option></Select>
          <Input label="Amount ($)" type="number" step="0.01" min="0.01" required placeholder="0.00" value={expenseForm.amount} onChange={e=>setExpenseForm(p=>({...p,amount:e.target.value}))}/>
          <Input label="Category" required placeholder="e.g. Gas, Supplies, Gig Payment" value={expenseForm.category} onChange={e=>setExpenseForm(p=>({...p,category:e.target.value}))}/>
          <Input label="Description (optional)" placeholder="Quick note" value={expenseForm.description} onChange={e=>setExpenseForm(p=>({...p,description:e.target.value}))}/>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={expenseForm.is_recurring} onChange={e=>setExpenseForm(p=>({...p,is_recurring:e.target.checked}))} className="w-4 h-4 accent-orange-500"/>
            <span className="text-sm text-gray-300">Recurring transaction</span>
          </label>
          {expenseForm.is_recurring&&(
            <div className="space-y-3 pl-2 border-l-2 border-orange-500/30">
              <Select label="Frequency" value={expenseForm.frequency} onChange={e=>setExpenseForm(p=>({...p,frequency:e.target.value}))}>
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option>
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Start Date" type="date" value={expenseForm.recurring_start_date} onChange={e=>setExpenseForm(p=>({...p,recurring_start_date:e.target.value}))}/>
                <Input label="End Date (opt)" type="date" value={expenseForm.recurring_end_date} onChange={e=>setExpenseForm(p=>({...p,recurring_end_date:e.target.value}))}/>
              </div>
            </div>
          )}
          <Btn className="w-full py-3" type="submit">Save Transaction</Btn>
        </form>
      </Modal>

      <Modal open={showGoalModal} onClose={()=>setShowGoalModal(false)} title="New Goal">
        <form onSubmit={handleAddGoal} className="space-y-4">
          <Input label="Goal Title" required placeholder="e.g. Save $3,000 emergency fund" value={goalForm.title} onChange={e=>setGoalForm(p=>({...p,title:e.target.value}))}/>
          <Select label="Type" value={goalForm.goal_type} onChange={e=>setGoalForm(p=>({...p,goal_type:e.target.value}))}><option value="financial">Financial</option><option value="task">Task</option><option value="career">Career</option></Select>
          {goalForm.goal_type==='financial'&&<Input label="Target Amount ($)" type="number" step="0.01" placeholder="1000" value={goalForm.target_value} onChange={e=>setGoalForm(p=>({...p,target_value:e.target.value}))}/>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Icon (emoji)" placeholder="🎯" value={goalForm.icon} onChange={e=>setGoalForm(p=>({...p,icon:e.target.value}))}/>
            <Input label="Due Date (optional)" type="date" value={goalForm.due_date} onChange={e=>setGoalForm(p=>({...p,due_date:e.target.value}))}/>
          </div>
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

      <Modal open={showBudgetModal} onClose={()=>setShowBudgetModal(false)} title="Add Budget Category">
        <form onSubmit={async(e)=>{e.preventDefault();try{await life.upsertBudget({category:budgetForm.category,monthly_limit:parseFloat(budgetForm.monthly_limit)});life.fetchBudgets();toast.success('Saved!');setShowBudgetModal(false);setBudgetForm({category:'',monthly_limit:''});}catch{toast.error('Failed.');}}} className="space-y-4">
          <Input label="Category" required placeholder="e.g. Gas, Supplies" value={budgetForm.category} onChange={e=>setBudgetForm(p=>({...p,category:e.target.value}))}/>
          <Input label="Monthly Limit ($)" type="number" required step="0.01" min="1" placeholder="200" value={budgetForm.monthly_limit} onChange={e=>setBudgetForm(p=>({...p,monthly_limit:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Save Budget</Btn>
        </form>
      </Modal>

      <Modal open={showGoalUpdateModal} onClose={()=>setShowGoalUpdateModal(false)} title={`Update: ${updatingGoal?.title||''}`}>
        <form onSubmit={async(e)=>{e.preventDefault();await updateGoalProgress(updatingGoal,goalUpdateValue);setShowGoalUpdateModal(false);}} className="space-y-4">
          <Input label="Current Progress ($)" type="number" required step="0.01" min="0" value={goalUpdateValue} onChange={e=>setGoalUpdateValue(e.target.value)}/>
          {updatingGoal?.target_value&&<p className="text-xs text-gray-500">Target: ${parseFloat(updatingGoal.target_value).toLocaleString()}</p>}
          <Btn className="w-full py-3" type="submit">Update Goal</Btn>
        </form>
      </Modal>

      <Modal open={showPcModal} onClose={()=>setShowPcModal(false)} title="Add Personal Care Task">
        <form onSubmit={handleAddPcTask} className="space-y-4">
          <Input label="Task Title" required placeholder="e.g. Dentist appointment" value={pcForm.title} onChange={e=>setPcForm(p=>({...p,title:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due Date" type="date" value={pcForm.due_date} onChange={e=>setPcForm(p=>({...p,due_date:e.target.value}))}/>
            <Select label="Priority" value={pcForm.urgency} onChange={e=>setPcForm(p=>({...p,urgency:e.target.value}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
          </div>
          <Input label="Repeat every N days (optional)" type="number" min="1" placeholder="e.g. 180 for every 6 months" value={pcForm.recurrence_days} onChange={e=>setPcForm(p=>({...p,recurrence_days:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Add Task</Btn>
        </form>
      </Modal>

      <Modal open={showCarModal} onClose={()=>setShowCarModal(false)} title="Add Car Care Task">
        <form onSubmit={handleAddCarTask} className="space-y-4">
          <Input label="Task Title" required placeholder="e.g. Oil change, Tire rotation" value={carForm.title} onChange={e=>setCarForm(p=>({...p,title:e.target.value}))}/>
          <Input label="Vehicle (optional)" placeholder="e.g. 2019 Honda CR-V" value={carForm.vehicle_info} onChange={e=>setCarForm(p=>({...p,vehicle_info:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due Date" type="date" value={carForm.due_date} onChange={e=>setCarForm(p=>({...p,due_date:e.target.value}))}/>
            <Select label="Priority" value={carForm.urgency} onChange={e=>setCarForm(p=>({...p,urgency:e.target.value}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
          </div>
          <Input label="Repeat every N days (optional)" type="number" min="1" placeholder="e.g. 90 for oil change" value={carForm.recurrence_days} onChange={e=>setCarForm(p=>({...p,recurrence_days:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Add Task</Btn>
        </form>
      </Modal>

      <Modal open={showHomeTaskModal} onClose={()=>setShowHomeTaskModal(false)} title="Add Home Task">
        <form onSubmit={handleAddHomeTask} className="space-y-4">
          <Input label="Task Title" required placeholder="e.g. Clean gutters" value={homeTaskForm.title} onChange={e=>setHomeTaskForm(p=>({...p,title:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due Date" type="date" value={homeTaskForm.due_date} onChange={e=>setHomeTaskForm(p=>({...p,due_date:e.target.value}))}/>
            <Select label="Priority" value={homeTaskForm.urgency} onChange={e=>setHomeTaskForm(p=>({...p,urgency:e.target.value}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
          </div>
          <Input label="Repeat every N days (optional)" type="number" min="1" placeholder="e.g. 90 for quarterly" value={homeTaskForm.recurrence_days} onChange={e=>setHomeTaskForm(p=>({...p,recurrence_days:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Add Task</Btn>
        </form>
      </Modal>

    </div>
    </PageShell>
  );
}
