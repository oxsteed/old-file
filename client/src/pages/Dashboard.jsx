import { useAuth } from '../hooks/useAuth';
import { useNavigate, Link } from 'react-router-dom';
import PageMeta from '../components/PageMeta';
import toast from 'react-hot-toast';
import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import useLifeDashboard from '../hooks/useLifeDashboard';
import PageShell from '../components/PageShell';
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
const IcoHeart     = (p) => <Ico {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></Ico>;
const IcoCar       = (p) => <Ico {...p}><rect x="1" y="11" width="22" height="9" rx="2"/><path d="M3 11l2.5-7h13L21 11"/><circle cx="7" cy="20" r="2"/><circle cx="17" cy="20" r="2"/></Ico>;
const IcoCalendar  = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Ico>;
const IcoWrench    = (p) => <Ico {...p}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></Ico>;

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

// Format a Date as YYYY-MM-DD in local time (avoids UTC-shift from toISOString())
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

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

  // ── Skills & Tools state ──────────────────────────────────────────────────
  const [mySkills, setMySkills] = useState([]);
  const [myTools, setMyTools] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [editingTool, setEditingTool] = useState(null);
  const [skillLookup,    setSkillLookup]    = useState([]);
  const [skillSearch,    setSkillSearch]    = useState('');
  const [catLookup,      setCatLookup]      = useState([]);
  const [toolCatLookup,  setToolCatLookup]  = useState([]);
  const [skillForm, setSkillForm] = useState({ skill_name:'', category:'', hourly_rate:'', description:'', years_exp:'', is_available:true });
  const [toolForm, setToolForm] = useState({ name:'', category:'', description:'', daily_rate:'', hourly_rate:'', deposit_amount:'', condition:'good', brand:'', model:'', is_available:true, requires_deposit:false, delivery_available:false, pickup_only:true, location_city:'', location_state:'' });

  // Budget modal (replaces prompt)
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ category:'', period_amount:'', period:'monthly' });

  // Goal update modal (replaces prompt)
  const [showGoalUpdateModal, setShowGoalUpdateModal] = useState(false);
  const [updatingGoal, setUpdatingGoal] = useState(null);
  const [goalUpdateValue, setGoalUpdateValue] = useState('');

  // Personal Care
  const [personalCareTasks, setPersonalCareTasks] = useState([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [showPcModal, setShowPcModal] = useState(false);
  const [pcForm, setPcForm] = useState({ title:'', category:'Medical', due_date:'', urgency:'medium', recurrence_days:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'' });

  // Car Care
  const [carCareTasks, setCarCareTasks] = useState([]);
  const [ccLoading, setCcLoading] = useState(false);
  const [showCcModal, setShowCcModal] = useState(false);
  const [ccForm, setCcForm] = useState({ title:'', category:'Oil Change', due_date:'', urgency:'medium', recurrence_days:'', description:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', vehicle_id:'' });

  // My Garage (NHTSA vehicle data)
  const [garage,        setGarage]        = useState([]);
  const [garageLoading, setGarageLoading] = useState(false);
  const [garageFetched, setGarageFetched] = useState(false);
  const [allMakes,      setAllMakes]      = useState([]);
  const [makesFetched,  setMakesFetched]  = useState(false);
  const [garageModels,  setGarageModels]  = useState([]);
  const [garageModelsLoading, setGarageModelsLoading] = useState(false);
  const [garageForm,    setGarageForm]    = useState({ makeSearch:'', selectedMake:null, modelSearch:'', selectedModel:null, year:'', nickname:'' });
  const [showMakeDD,    setShowMakeDD]    = useState(false);
  const [showModelDD,   setShowModelDD]   = useState(false);
  const [garageAdding,  setGarageAdding]  = useState(false);
  const [garageDeleteTarget, setGarageDeleteTarget] = useState(null);
  const [garageMode,     setGarageMode]     = useState('search'); // 'search' | 'vin'
  const [vinInput,       setVinInput]        = useState('');
  const [vinDecoding,    setVinDecoding]     = useState(false);
  const [vinResult,      setVinResult]       = useState(null);   // decoded data
  const [vinError,       setVinError]        = useState('');

  // Money tab — individual planned needs for sinking fund card
  const [moneyPlannedNeeds, setMoneyPlannedNeeds] = useState([]);

  // My Jobs filter
  const [jobsFilter, setJobsFilter] = useState('all');

  const fetchMySkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const res = await api.get('/user-skills/me');
      setMySkills(res.data?.skills || []);
    } catch { /* silent */ }
    finally { setSkillsLoading(false); }
  }, []);

  const fetchMyTools = useCallback(async () => {
    setToolsLoading(true);
    try {
      const res = await api.get('/tool-rentals/me');
      setMyTools(res.data?.tools || []);
    } catch { /* silent */ }
    finally { setToolsLoading(false); }
  }, []);

  const searchSkillLookup = useCallback(async (q) => {
    try {
      const res = await api.get('/user-skills/lookup', { params: { q, limit: 15 } });
      setSkillLookup(res.data?.skills || []);
    } catch { setSkillLookup([]); }
  }, []);

  const searchCatLookup = useCallback(async (q) => {
    if (!q || q.length < 1) { setCatLookup([]); return; }
    try {
      const res = await api.get('/user-skills/categories', { params: { q, limit: 10 } });
      setCatLookup(res.data?.categories || []);
    } catch { setCatLookup([]); }
  }, []);

  const searchToolCatLookup = useCallback(async (q) => {
    if (!q || q.length < 1) { setToolCatLookup([]); return; }
    try {
      const res = await api.get('/tool-rentals/categories', { params: { q, limit: 10 } });
      setToolCatLookup(res.data?.categories || []);
    } catch { setToolCatLookup([]); }
  }, []);

  const fetchPersonalCareTasks = useCallback(async () => {
    setPcLoading(true);
    try {
      const res = await api.get('/life/home-tasks', { params: { section: 'personal_care', completed: 'false' } });
      setPersonalCareTasks(res.data?.home_tasks || []);
    } catch { /* silent */ }
    finally { setPcLoading(false); }
  }, []);

  const fetchCarCareTasks = useCallback(async () => {
    setCcLoading(true);
    try {
      const res = await api.get('/life/home-tasks', { params: { section: 'car_care', completed: 'false' } });
      setCarCareTasks(res.data?.home_tasks || []);
    } catch { /* silent */ }
    finally { setCcLoading(false); }
  }, []);

  // Fetch tab-specific data when tab opens
  useEffect(() => {
    if (tab === 'skills') { fetchMySkills(); fetchMyTools(); }
    if (tab === 'personalcare') fetchPersonalCareTasks();
    if (tab === 'carcare') { fetchCarCareTasks(); if (!garageFetched) fetchGarage(); }
    if (tab === 'money') {
      api.get('/planned-needs', { params: { status: 'planned,funding,activating_soon', limit: 10 } })
        .then(r => setMoneyPlannedNeeds(r.data?.planned_needs || []))
        .catch(() => {});
    }
  }, [tab]);

  const openAddSkill = () => {
    setEditingSkill(null);
    setSkillSearch('');
    setSkillLookup([]);
    setCatLookup([]);
    setSkillForm({ skill_name:'', category:'', hourly_rate:'', description:'', years_exp:'', is_available:true });
    setShowSkillModal(true);
  };
  const openEditSkill = (s) => {
    setEditingSkill(s);
    setSkillSearch(s.skill_name);
    setSkillLookup([]);
    setSkillForm({ skill_name:s.skill_name, category:s.category||'', hourly_rate:s.hourly_rate||'', description:s.description||'', years_exp:s.years_exp||'', is_available:s.is_available });
    setShowSkillModal(true);
  };
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
      fetchMySkills();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save skill.');
    }
  };
  const handleDeleteSkill = async (id) => {
    if (!confirm('Remove this skill listing?')) return;
    try {
      await api.delete(`/user-skills/${id}`);
      toast.success('Skill removed.');
      fetchMySkills();
    } catch { toast.error('Failed to remove skill.'); }
  };

  const openAddTool = () => {
    setEditingTool(null);
    setToolCatLookup([]);
    setToolForm({ name:'', category:'', description:'', daily_rate:'', hourly_rate:'', deposit_amount:'', condition:'good', brand:'', model:'', is_available:true, requires_deposit:false, delivery_available:false, pickup_only:true, location_city:'', location_state:'' });
    setShowToolModal(true);
  };
  const openEditTool = (t) => {
    setEditingTool(t);
    setToolForm({ name:t.name, category:t.category||'', description:t.description||'', daily_rate:t.daily_rate||'', hourly_rate:t.hourly_rate||'', deposit_amount:t.deposit_amount||'', condition:t.condition||'good', brand:t.brand||'', model:t.model||'', is_available:t.is_available, requires_deposit:t.requires_deposit, delivery_available:t.delivery_available, pickup_only:t.pickup_only, location_city:t.location_city||'', location_state:t.location_state||'' });
    setShowToolModal(true);
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
      fetchMyTools();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save tool.');
    }
  };
  const handleDeleteTool = async (id) => {
    if (!confirm('Remove this tool listing?')) return;
    try {
      await api.delete(`/tool-rentals/${id}`);
      toast.success('Tool removed.');
      fetchMyTools();
    } catch { toast.error('Failed to remove tool.'); }
  };

  // ── Personal Care handlers ────────────────────────────────────────────────
  const addPcTask = async (e) => {
    e.preventDefault();
    try {
      await api.post('/life/home-tasks', {
        title: pcForm.title,
        description: pcForm.category,
        due_date: pcForm.due_date || null,
        urgency: pcForm.urgency,
        recurrence_days: pcForm.recurrence_days ? parseInt(pcForm.recurrence_days) : null,
        section: 'personal_care',
        frequency: pcForm.frequency || null,
        is_recurring: pcForm.is_recurring,
        estimated_cost: pcForm.estimated_cost ? parseFloat(pcForm.estimated_cost) : null,
        recurring_start_date: pcForm.is_recurring && pcForm.recurring_start_date ? pcForm.recurring_start_date : null,
        recurring_end_date: pcForm.is_recurring && pcForm.recurring_end_date ? pcForm.recurring_end_date : null,
      });
      toast.success('Appointment added!');
      setPcForm({ title:'', category:'Medical', due_date:'', urgency:'medium', recurrence_days:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'' });
      setShowPcModal(false);
      fetchPersonalCareTasks();
    } catch { toast.error('Failed to save.'); }
  };
  const togglePcTask = async (task) => {
    try {
      await api.put(`/life/home-tasks/${task.id}`, { is_completed: !task.is_completed });
      fetchPersonalCareTasks();
    } catch { toast.error('Failed to update.'); }
  };
  const deletePcTask = async (id) => {
    try {
      await api.delete(`/life/home-tasks/${id}`);
      setPersonalCareTasks(prev => prev.filter(t => t.id !== id));
      toast.success('Removed.');
    } catch { toast.error('Failed to remove.'); }
  };
  const quickAddPcTask = async (template) => {
    try {
      const due = new Date();
      due.setDate(due.getDate() + (template.recurrence_days || 30));
      await api.post('/life/home-tasks', { title: template.title, description: template.category, urgency: template.urgency, recurrence_days: template.recurrence_days, due_date: localDateStr(due), section: 'personal_care' });
      toast.success(`${template.title} added!`);
      fetchPersonalCareTasks();
    } catch { toast.error('Failed to add.'); }
  };

  // ── Car Care handlers ─────────────────────────────────────────────────────
  const addCcTask = async (e) => {
    e.preventDefault();
    try {
      const vehiclePayload = ccForm.vehicle_id ? (() => {
        const v = garage.find(g=>String(g.id)===String(ccForm.vehicle_id));
        return v ? { vehicle_id: v.id, vehicle_label: v.nickname || `${v.make_name} ${v.model_name}` } : {};
      })() : {};
      await api.post('/life/home-tasks', {
        title: ccForm.title,
        description: [ccForm.category, ccForm.description, vehiclePayload.vehicle_label].filter(Boolean).join(' · '),
        due_date: ccForm.due_date || null,
        urgency: ccForm.urgency,
        recurrence_days: ccForm.recurrence_days ? parseInt(ccForm.recurrence_days) : null,
        section: 'car_care',
        frequency: ccForm.frequency || null,
        is_recurring: ccForm.is_recurring,
        estimated_cost: ccForm.estimated_cost ? parseFloat(ccForm.estimated_cost) : null,
        recurring_start_date: ccForm.is_recurring && ccForm.recurring_start_date ? ccForm.recurring_start_date : null,
        recurring_end_date: ccForm.is_recurring && ccForm.recurring_end_date ? ccForm.recurring_end_date : null,
      });
      toast.success('Service added!');
      setCcForm({ title:'', category:'Oil Change', due_date:'', urgency:'medium', recurrence_days:'', description:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', vehicle_id:'' });
      setShowCcModal(false);
      fetchCarCareTasks();
    } catch { toast.error('Failed to save.'); }
  };
  const toggleCcTask = async (task) => {
    try {
      await api.put(`/life/home-tasks/${task.id}`, { is_completed: !task.is_completed });
      fetchCarCareTasks();
    } catch { toast.error('Failed to update.'); }
  };
  const deleteCcTask = async (id) => {
    try {
      await api.delete(`/life/home-tasks/${id}`);
      setCarCareTasks(prev => prev.filter(t => t.id !== id));
      toast.success('Removed.');
    } catch { toast.error('Failed to remove.'); }
  };
  const quickAddCcTask = async (template) => {
    try {
      const due = new Date();
      due.setDate(due.getDate() + (template.recurrence_days || 90));
      await api.post('/life/home-tasks', { title: template.title, description: template.category, urgency: template.urgency, recurrence_days: template.recurrence_days, due_date: localDateStr(due), section: 'car_care' });
      toast.success(`${template.title} added!`);
      fetchCarCareTasks();
    } catch { toast.error('Failed to add.'); }
  };

  // Garage handlers
  const fetchGarage = useCallback(async () => {
    setGarageLoading(true);
    try {
      const res = await api.get('/vehicles/my');
      setGarage(res.data || []);
      setGarageFetched(true);
    } catch { /* silent */ }
    finally { setGarageLoading(false); }
  }, []);

  const loadMakesForGarage = useCallback(async () => {
    if (makesFetched) return;
    try {
      const res = await api.get('/vehicles/makes');
      setAllMakes(res.data || []);
      setMakesFetched(true);
    } catch { /* silent */ }
  }, [makesFetched]);

  const loadModelsForGarage = useCallback(async (makeName) => {
    if (!makeName) { setGarageModels([]); return; }
    setGarageModelsLoading(true);
    try {
      const res = await api.get('/vehicles/models', { params: { make: makeName } });
      setGarageModels(res.data || []);
    } catch { setGarageModels([]); }
    finally { setGarageModelsLoading(false); }
  }, []);

  const addToGarage = async () => {
    const { selectedMake, selectedModel, year, nickname } = garageForm;
    if (!selectedMake || !selectedModel) return;
    setGarageAdding(true);
    try {
      const res = await api.post('/vehicles/my', {
        make_id:    selectedMake.id,
        make_name:  selectedMake.name,
        model_id:   selectedModel.modelId,
        model_name: selectedModel.modelName,
        year:       year || undefined,
        nickname:   nickname.trim() || undefined,
      });
      setGarage(prev => [res.data, ...prev]);
      setGarageForm({ makeSearch:'', selectedMake:null, modelSearch:'', selectedModel:null, year:'', nickname:'' });
      setGarageModels([]);
      toast.success('Vehicle added!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add vehicle.');
    } finally { setGarageAdding(false); }
  };

  const deleteFromGarage = async (id) => {
    try {
      await api.delete(`/vehicles/my/${id}`);
      setGarage(prev => prev.filter(v => v.id !== id));
      setGarageDeleteTarget(null);
      toast.success('Removed.');
    } catch { toast.error('Failed to remove.'); }
  };

  const decodeVin = async () => {
    const vin = vinInput.trim().toUpperCase();
    if (!vin) return;
    setVinDecoding(true);
    setVinResult(null);
    setVinError('');
    try {
      const res = await api.get(`/vehicles/vin/${vin}`);
      setVinResult(res.data);
    } catch (err) {
      setVinError(err.response?.data?.error || 'Could not decode VIN.');
    } finally { setVinDecoding(false); }
  };

  const addVinVehicle = async () => {
    if (!vinResult?.make) return;
    setGarageAdding(true);
    try {
      // We need make_id — look it up from allMakes, or fall back to 0
      await loadMakesForGarage();
      const matchedMake = allMakes.find(m => m.name.toLowerCase() === vinResult.make.toLowerCase());
      const res = await api.post('/vehicles/my', {
        make_id:    matchedMake?.id || 0,
        make_name:  vinResult.make,
        model_id:   0,
        model_name: vinResult.model || 'Unknown Model',
        year:       vinResult.year  || undefined,
        nickname:   garageForm.nickname.trim() || undefined,
        notes:      vinResult.vin,
      });
      setGarage(prev => [res.data, ...prev]);
      setVinInput('');
      setVinResult(null);
      setGarageForm(p => ({...p, nickname:''}));
      toast.success('Vehicle added from VIN!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add vehicle.');
    } finally { setGarageAdding(false); }
  };

  // Form state
  const [expenseForm, setExpenseForm] = useState({ type:'expense', amount:'', category:'', description:'', frequency:'one_time', is_recurring:false, recurring_start_date:'', recurring_end_date:'' });
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
    life.fetchFinancialPulse('1m'); // dashboard default: 30-day horizon
    life.fetchCommunity();
    life.fetchExpenses();
    life.fetchBudgets();
    life.fetchGoals();
    life.fetchHomeTasks({ completed: 'false', section: 'home' });
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
      await life.createExpense({
        ...expenseForm,
        amount: parseFloat(expenseForm.amount),
        is_recurring: expenseForm.is_recurring,
        recurring_start_date: expenseForm.is_recurring && expenseForm.recurring_start_date ? expenseForm.recurring_start_date : null,
        recurring_end_date: expenseForm.is_recurring && expenseForm.recurring_end_date ? expenseForm.recurring_end_date : null,
      });
      toast.success(expenseForm.type === 'income' ? 'Income logged!' : 'Expense logged!');
      setExpenseForm({ type:'expense', amount:'', category:'', description:'', frequency:'one_time', is_recurring:false, recurring_start_date:'', recurring_end_date:'' });
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
      life.fetchHomeTasks({ completed: 'false', section: 'home' });
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
    { id:'personalcare', label:'Personal Care' },
    { id:'carcare', label:'Car Care' },
    { id:'skills', label:'Skills & Tools' },
    { id:'jobs', label:'My Jobs' },
  ];

  return (
    <PageShell>
    <div className="min-h-screen text-white">
      <PageMeta title="My Dashboard" description="Manage your jobs, payments, and account." noIndex={true} />
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
        <div className="grid grid-cols-4 sm:flex gap-1 my-6 bg-gray-900/80 rounded-xl p-1">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all sm:whitespace-nowrap text-center ${tab===t.id?'bg-orange-500 text-gray-950':'text-gray-500 hover:text-gray-300'}`}>{t.label}</button>
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
          {/* Life Pulse Score — powered by the unified engine (30-day horizon) */}
          {life.financialPulse && (() => {
            const fp = life.financialPulse;
            const score = fp.pulse_score;
            const scoreColor = score >= 80 ? '#34d399' : score >= 60 ? '#F97316' : score >= 40 ? '#facc15' : '#f87171';
            const breakdown = fp.score_breakdown || {};
            return (
              <div className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 border border-gray-700/40 rounded-2xl p-6 mb-6">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                  {/* Score ring + description */}
                  <div className="flex items-center gap-6">
                    <div className="relative w-20 h-20 shrink-0">
                      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="#1f2937" strokeWidth="6"/>
                        <circle cx="40" cy="40" r="34" fill="none" stroke={scoreColor} strokeWidth="6"
                          strokeDasharray={`${(score / 100) * 213.6} 213.6`} strokeLinecap="round"
                          className="transition-all duration-1000"/>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl font-bold" style={{ color: scoreColor }}>{score}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold mb-0.5">Financial Pulse</p>
                      <p className="text-[10px] text-gray-600 mb-1">Next 30 days</p>
                      <p className="text-sm text-gray-400 max-w-xs">
                        {score >= 80 ? 'Strong coverage, solid runway, reliable income.' :
                         score >= 60 ? 'Good shape — watch sinking funds and upcoming expenses.' :
                         score >= 40 ? 'Some gaps. Review coverage and buffer strength.' :
                         'Needs attention. Income may not cover near-term obligations.'}
                      </p>
                    </div>
                  </div>
                  {/* Breakdown */}
                  <div className="grid grid-cols-4 gap-3 shrink-0">
                    {[
                      { l: 'Coverage',    v: breakdown.coverage,    c: 'text-emerald-400' },
                      { l: 'Buffer',      v: breakdown.buffer,      c: 'text-blue-400'    },
                      { l: 'Reliability', v: breakdown.reliability, c: 'text-purple-400'  },
                      { l: 'Obligations', v: breakdown.obligations, c: 'text-orange-400'  },
                    ].map((d, i) => (
                      <div key={i} className="text-center">
                        <p className={`text-lg font-bold ${d.c}`}>{d.v ?? '—'}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">{d.l}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Alerts */}
                {fp.alerts?.length > 0 && (
                  <div className="mt-4 space-y-1.5 border-t border-gray-700/40 pt-4">
                    {fp.alerts.map((alert, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
                        <span className="shrink-0 mt-0.5">⚠</span>
                        <span>{alert}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

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
              {to:'/post-job',       Ic:IcoPlus,   l:'Post a Job',      c:'text-orange-400'},
              {to:'/helpers',        Ic:IcoSearch,  l:'Find Helpers',    c:'text-blue-400'},
              {to:'/messages',       Ic:IcoChat,    l:'Messages',        c:'text-emerald-400', badge:unreadMsgs},
              {to:'/planned-needs',  Ic:IcoClock,   l:'Planned Needs',   c:'text-purple-400',
                badge: s?.planned_needs?.activating_soon_count || 0},
            ].map((a,i)=>(
              <Link key={i} to={a.to} className="relative bg-gray-900/50 border border-gray-700/40 rounded-2xl p-4 hover:border-gray-600 hover:-translate-y-0.5 transition-all group flex items-center gap-3">
                <a.Ic size={18} cls={a.c}/><span className="text-sm font-medium text-gray-300 group-hover:text-white transition">{a.l}</span>
                {a.badge>0&&<span className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold">{a.badge}</span>}
              </Link>
            ))}
          </div>

          {/* Planned Needs snapshot */}
          {(s?.planned_needs?.active_count > 0 || !loading) && (
            <Card className="mb-6">
              <CardHeader
                icon={IcoClock}
                title="Planned Needs"
                right={
                  <Link to="/planned-needs" className="text-xs text-orange-400 hover:text-orange-300 font-medium">
                    Manage →
                  </Link>
                }
              />
              {loading ? (
                <div className="h-12 bg-gray-800 rounded-xl animate-pulse" />
              ) : s?.planned_needs?.active_count > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className="text-xl font-bold text-purple-400">{s.planned_needs.active_count}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Active</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className={`text-xl font-bold ${s.planned_needs.activating_soon_count > 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                      {s.planned_needs.activating_soon_count}
                    </p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Publishing Soon</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className="text-xl font-bold text-emerald-400">
                      ${parseFloat(s.planned_needs.total_planned_cost || 0).toLocaleString(undefined,{maximumFractionDigits:0})}
                    </p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Total Planned</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className="text-sm font-bold text-gray-300">
                      {s.planned_needs.next_due_date
                        ? new Date(s.planned_needs.next_due_date + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
                        : '—'}
                    </p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Next Due</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl">
                  <p className="text-sm text-gray-400">No planned needs yet — schedule future services and fund them gradually.</p>
                  <Link to="/planned-needs" className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap ml-3">
                    + Add One
                  </Link>
                </div>
              )}
            </Card>
          )}

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Income</p><p className="text-xl font-bold text-emerald-400">${(life.expenseSummary?.total_income||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Expenses</p><p className="text-xl font-bold text-red-400">${(life.expenseSummary?.total_expenses||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Net</p><p className={`text-xl font-bold ${(life.expenseSummary?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(life.expenseSummary?.net||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Savings Rate</p>
                {(life.expenseSummary?.total_income||0) > 0
                  ? <p className={`text-xl font-bold ${((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=20?'text-emerald-400':((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=0?'text-yellow-400':'text-red-400'}`}>{Math.round((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)}%</p>
                  : <p className="text-xl font-bold text-gray-600">—</p>
                }
              </div>
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
                        <p className="text-xs text-gray-600 mt-0.5">
                          {e.category} · {new Date(e.occurred_at).toLocaleDateString()}
                          {e.is_recurring && e.frequency && e.frequency !== 'one_time' && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-400">
                              {e.frequency.replace('_','-')}
                            </span>
                          )}
                        </p>
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
              <CardHeader icon={IcoTarget} title="Budget Categories" right={<Btn variant="secondary" onClick={()=>setShowBudgetModal(true)}>+ Add Budget</Btn>}/>
              {life.budgets.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No budgets set. Add categories to track spending.</p>
              ) : (
                <div className="space-y-4">
                  {life.budgets.map(b=>{
                    const spent = parseFloat(b.spent||0);
                    const limit = parseFloat(b.monthly_limit);
                    const pct = limit>0?(spent/limit)*100:0;
                    const periodLabel = b.period && b.period !== 'monthly' ? ` /mo (${b.period.replace('_','-')})` : '/mo';
                    return (
                      <div key={b.id}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-white">{b.category}</span>
                          <span className="text-gray-500">${spent.toFixed(0)} / ${limit.toFixed(0)}{periodLabel}</span>
                        </div>
                        <ProgressBar pct={pct} color={pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-emerald-500'}/>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Planned Needs – sinking funds */}
          <Card className="mb-6">
            <CardHeader icon={IcoClock} title="Sinking Funds" right={
              <Link to="/planned-needs" className="text-xs text-orange-400 hover:text-orange-300 font-medium">Manage →</Link>
            }/>
            {moneyPlannedNeeds.length === 0 ? (
              <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl">
                <p className="text-sm text-gray-500">No planned needs yet — schedule future expenses and save toward them gradually.</p>
                <Link to="/planned-needs" className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap ml-3">+ Add One</Link>
              </div>
            ) : (
              <div className="space-y-4">
                {moneyPlannedNeeds.slice(0,5).map(pn => {
                  const cost = parseFloat(pn.estimated_cost || 0);
                  const saved = parseFloat(pn.reserved_amount || 0);
                  const pct = cost > 0 ? Math.min(100, (saved / cost) * 100) : 0;
                  const perMonth = parseFloat(pn.sinking_fund_per_month || 0);
                  return (
                    <div key={pn.id}>
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span className="font-medium text-white">{pn.title || pn.category}</span>
                        <div className="flex items-center gap-3">
                          {perMonth > 0 && <span className="text-[10px] text-purple-400">${perMonth.toFixed(0)}/mo needed</span>}
                          <span className="text-gray-500 text-xs">${saved.toFixed(0)} / ${cost.toFixed(0)}</span>
                        </div>
                      </div>
                      <ProgressBar pct={pct} color={pct>=100?'bg-emerald-500':pct>=50?'bg-blue-500':'bg-orange-500'}/>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>)}

        {/* ═══════ HOME TAB ═══════ */}
        {tab==='home' && (<>
          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card className="!p-3 text-center">
              <p className={`text-2xl font-bold ${(s?.home?.overdue||0)>0?'text-red-400':'text-emerald-400'}`}>{s?.home?.overdue||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">Overdue</p>
            </Card>
            <Card className="!p-3 text-center">
              <p className="text-2xl font-bold text-orange-400">{s?.home?.due_this_week||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">Due This Week</p>
            </Card>
            <Card className="!p-3 text-center">
              <p className="text-2xl font-bold text-gray-300">{s?.home?.total_pending||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">Total Pending</p>
            </Card>
          </div>
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
                    <div key={h.id} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-xl group">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/30 to-purple-500/30 flex items-center justify-center font-bold text-sm flex-shrink-0">{(h.first_name||'?')[0]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{h.first_name} {h.last_name}</p>
                        <p className="text-xs text-gray-500 truncate">{h.categories||'Helper'} · {h.avg_rating?`${h.avg_rating}★`:'New'} · {h.completed_jobs||0} jobs</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Link to={`/helpers/${h.helper_id}`} className="text-xs text-orange-400 font-medium">View</Link>
                        <button onClick={async()=>{await life.removeSavedHelper(h.id);toast.success('Removed');}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={13} cls="text-gray-600 hover:text-red-400"/></button>
                      </div>
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
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-lg">{g.icon||'🎯'}</span>
                          <span className="font-semibold text-sm text-white flex-1">{g.title}</span>
                          <Tag text={g.goal_type||'financial'} color={g.goal_type==='task'?'blue':g.goal_type==='career'?'purple':'green'}/>
                          {g.is_completed ? <Tag text="Done" color="green"/> : g.target_value > 0 ? <span className="text-sm font-bold text-orange-400">{Math.round(pct)}%</span> : null}
                        </div>
                        {g.due_date && !g.is_completed && (() => {
                          const days = Math.ceil((new Date(g.due_date) - new Date()) / 86400000);
                          return <p className={`text-[10px] mb-2 ${days < 0 ? 'text-red-400' : days <= 7 ? 'text-orange-400' : 'text-gray-600'}`}>{days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d remaining`}</p>;
                        })()}
                        {g.target_value > 0 && !g.is_completed && (
                          <>
                            <ProgressBar pct={pct} color="bg-orange-500"/>
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-xs text-gray-500">${parseFloat(g.current_value).toLocaleString()} of ${parseFloat(g.target_value).toLocaleString()}</span>
                              <button onClick={()=>{setUpdatingGoal(g);setGoalUpdateValue(String(g.current_value||''));setShowGoalUpdateModal(true);}} className="text-[10px] text-orange-400 font-semibold">Update →</button>
                            </div>
                          </>
                        )}
                        {!g.is_completed && !g.target_value && (
                          <button onClick={()=>life.updateGoal(g.id,{is_completed:true}).then(()=>{life.fetchSummary();toast.success('Goal complete! 🎉');})} className="text-[10px] text-emerald-400 font-semibold mt-1">Mark complete →</button>
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-lg">My Jobs</h3>
              <Link to="/post-job" className="text-sm bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl transition">+ Post a Job</Link>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                {label:'Total',       value:myJobs.length,                                                                  color:'text-white'},
                {label:'Open',        value:myJobs.filter(j=>['open','published'].includes(j.status)).length,               color:'text-emerald-400'},
                {label:'In Progress', value:myJobs.filter(j=>j.status==='in_progress').length,                              color:'text-blue-400'},
                {label:'Completed',   value:myJobs.filter(j=>['completed','closed'].includes(j.status)).length,             color:'text-gray-400'},
              ].map((s,i)=>(
                <Card key={i} className="!p-3 text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{s.label}</p>
                </Card>
              ))}
            </div>
            {/* Filter buttons */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {[
                {id:'all',          label:'All'},
                {id:'open',         label:'Open'},
                {id:'in_progress',  label:'In Progress'},
                {id:'completed',    label:'Completed'},
                {id:'cancelled',    label:'Cancelled'},
              ].map(f=>(
                <button key={f.id} onClick={()=>setJobsFilter(f.id)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${jobsFilter===f.id?'bg-orange-500 text-white':'bg-gray-800 text-gray-400 hover:text-gray-300'}`}>
                  {f.label}
                </button>
              ))}
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
              <div className="space-y-2">{myJobs.filter(job=>{
                if(jobsFilter==='all') return true;
                if(jobsFilter==='open') return ['open','published'].includes(job.status);
                if(jobsFilter==='completed') return ['completed','closed'].includes(job.status);
                return job.status===jobsFilter;
              }).map(job=>(
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

        {/* ═══════ SKILLS & TOOLS ═══════ */}
        {tab==='skills' && (
          <div className="space-y-8">

            {/* ── My Skills ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white text-lg">My Skills for Hire</h3>
                  <p className="text-xs text-gray-500 mt-0.5">List the skills you offer so customers can find and hire you directly.</p>
                </div>
                <Btn onClick={openAddSkill}><IcoPlus size={14} cls="text-white inline mr-1"/>Add Skill</Btn>
              </div>

              {skillsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[1,2,3,4].map(i=>(
                    <div key={i} className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-4 animate-pulse">
                      <div className="h-4 bg-gray-800 rounded w-2/3 mb-2"/><div className="h-3 bg-gray-800 rounded w-1/2"/>
                    </div>
                  ))}
                </div>
              ) : mySkills.length === 0 ? (
                <Card className="p-12 text-center">
                  <IcoZap size={36} cls="text-gray-700 mx-auto mb-3"/>
                  <p className="text-gray-500 mb-1 font-medium">No skills listed yet</p>
                  <p className="text-xs text-gray-600 mb-4">Add your skills and set your rate so customers know what you offer.</p>
                  <Btn onClick={openAddSkill}>List Your First Skill</Btn>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {mySkills.map(s => (
                    <Card key={s.id} className="relative group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-white text-sm truncate">{s.skill_name}</p>
                            {s.category && <span className="text-[10px] font-semibold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">{s.category}</span>}
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.is_available ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700/40 text-gray-500'}`}>
                              {s.is_available ? 'Available' : 'Unavailable'}
                            </span>
                          </div>
                          {s.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.description}</p>}
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            {s.hourly_rate && <span className="text-xs text-emerald-400 font-semibold">${parseFloat(s.hourly_rate).toFixed(0)}/hr</span>}
                            {s.years_exp !== null && s.years_exp !== undefined && <span className="text-xs text-gray-500">{s.years_exp} yr{s.years_exp!==1?'s':''} exp</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={()=>openEditSkill(s)} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700/50 transition"><IcoSettings size={14}/></button>
                          <button onClick={()=>handleDeleteSkill(s.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"><IcoTrash size={14}/></button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* ── My Tools for Rental ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white text-lg">My Tools for Rental</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Rent out your equipment to earn extra income when you're not using it.</p>
                </div>
                <Btn onClick={openAddTool}><IcoPlus size={14} cls="text-white inline mr-1"/>Add Tool</Btn>
              </div>

              {toolsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[1,2,3].map(i=>(
                    <div key={i} className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-4 animate-pulse">
                      <div className="h-4 bg-gray-800 rounded w-3/4 mb-2"/><div className="h-3 bg-gray-800 rounded w-1/2 mb-2"/><div className="h-3 bg-gray-800 rounded w-1/3"/>
                    </div>
                  ))}
                </div>
              ) : myTools.length === 0 ? (
                <Card className="p-12 text-center">
                  <IcoSettings size={36} cls="text-gray-700 mx-auto mb-3"/>
                  <p className="text-gray-500 mb-1 font-medium">No tools listed yet</p>
                  <p className="text-xs text-gray-600 mb-4">List a tool — power washer, trailer, scaffolding — and earn when others rent it.</p>
                  <Btn onClick={openAddTool}>List Your First Tool</Btn>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {myTools.map(t => (
                    <Card key={t.id}>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-white text-sm truncate">{t.name}</p>
                          {(t.brand||t.model) && <p className="text-[11px] text-gray-500 truncate">{[t.brand,t.model].filter(Boolean).join(' · ')}</p>}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={()=>openEditTool(t)} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700/50 transition"><IcoSettings size={14}/></button>
                          <button onClick={()=>handleDeleteTool(t.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"><IcoTrash size={14}/></button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {t.category && <span className="text-[10px] font-semibold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">{t.category}</span>}
                        {t.condition && <span className="text-[10px] font-semibold text-gray-400 bg-gray-800/60 px-2 py-0.5 rounded-full capitalize">{t.condition}</span>}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.is_available ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700/40 text-gray-500'}`}>
                          {t.is_available ? 'Available' : 'Unavailable'}
                        </span>
                      </div>

                      {t.description && <p className="text-xs text-gray-500 mb-3 line-clamp-2">{t.description}</p>}

                      <div className="flex items-center gap-3 flex-wrap text-sm">
                        {t.daily_rate  && <span className="text-emerald-400 font-semibold">${parseFloat(t.daily_rate).toFixed(0)}/day</span>}
                        {t.hourly_rate && <span className="text-emerald-400 font-semibold">${parseFloat(t.hourly_rate).toFixed(0)}/hr</span>}
                        {!t.daily_rate && !t.hourly_rate && <span className="text-gray-600 text-xs">Contact for pricing</span>}
                      </div>

                      {(t.location_city||t.location_state) && (
                        <p className="text-[10px] text-gray-600 mt-2">{[t.location_city,t.location_state].filter(Boolean).join(', ')}</p>
                      )}

                      <div className="flex gap-2 mt-2 flex-wrap">
                        {t.delivery_available && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">Delivery available</span>}
                        {t.requires_deposit  && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">Deposit required</span>}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

                {tab==='personalcare' && (
          <div className="space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {label:'Overdue',     value:personalCareTasks.filter(t=>t.due_date&&t.due_date<localDateStr()&&!t.is_completed).length, color:'text-red-400'},
                {label:'This Week',   value:personalCareTasks.filter(t=>{if(!t.due_date||t.is_completed)return false;const end=localDateStr(new Date(Date.now()+7*864e5));return t.due_date>=localDateStr()&&t.due_date<=end;}).length, color:'text-orange-400'},
                {label:'Total Pending',value:personalCareTasks.length, color:'text-blue-400'},
                {label:'Recurring',   value:personalCareTasks.filter(t=>t.recurrence_days).length, color:'text-purple-400'},
              ].map((s,i)=>(
                <Card key={i} className="!p-3 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{s.label}</p>
                </Card>
              ))}
            </div>

            {/* My Garage */}
            <Card>
              <CardHeader icon={IcoCar} title="My Garage"
                right={<span className="text-[10px] text-gray-600">NHTSA · free gov data</span>}/>

              {/* Mode tabs */}
              <div className="flex gap-1 mb-3 bg-gray-900 rounded-lg p-0.5 w-fit">
                <button onClick={()=>{setGarageMode('search');setVinResult(null);setVinError('');}}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${garageMode==='search'?'bg-gray-700 text-white':'text-gray-500 hover:text-gray-300'}`}>
                  🔍 Search
                </button>
                <button onClick={()=>setGarageMode('vin')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${garageMode==='vin'?'bg-gray-700 text-white':'text-gray-500 hover:text-gray-300'}`}>
                  📷 Scan / Enter VIN
                </button>
              </div>

              {garageMode === 'search' ? (
                /* ── Search mode: make → model typeahead ─────────────── */
                <div className="flex flex-wrap gap-2 mb-3">
                  <div className="relative flex-1 min-w-[140px]">
                    <input type="text" placeholder="Make (e.g. Toyota)"
                      value={garageForm.makeSearch}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
                      onFocus={() => { loadMakesForGarage(); setShowMakeDD(true); }}
                      onChange={e => { setGarageForm(p=>({...p, makeSearch:e.target.value, selectedMake:null})); setShowMakeDD(true); }}
                      onBlur={() => setTimeout(()=>setShowMakeDD(false), 150)}
                      autoComplete="off"/>
                    {showMakeDD && allMakes.filter(m=>!garageForm.makeSearch||m.name.toLowerCase().includes(garageForm.makeSearch.toLowerCase())).slice(0,60).length > 0 && (
                      <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg max-h-48 overflow-y-auto shadow-xl text-sm">
                        {allMakes.filter(m=>!garageForm.makeSearch||m.name.toLowerCase().includes(garageForm.makeSearch.toLowerCase())).slice(0,60).map(m=>(
                          <li key={m.id} onMouseDown={()=>{ setGarageForm(p=>({...p,makeSearch:m.name,selectedMake:m,modelSearch:'',selectedModel:null})); setShowMakeDD(false); loadModelsForGarage(m.name); }}
                            className="px-3 py-2 hover:bg-gray-800 cursor-pointer text-gray-200 truncate">{m.name}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="relative flex-1 min-w-[140px]">
                    <input type="text"
                      placeholder={!garageForm.selectedMake ? 'Select make first' : garageModelsLoading ? 'Loading…' : 'Model'}
                      value={garageForm.modelSearch}
                      disabled={!garageForm.selectedMake || garageModelsLoading}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition disabled:opacity-50"
                      onFocus={() => garageForm.selectedMake && setShowModelDD(true)}
                      onChange={e => { setGarageForm(p=>({...p, modelSearch:e.target.value, selectedModel:null})); setShowModelDD(true); }}
                      onBlur={() => setTimeout(()=>setShowModelDD(false), 150)}
                      autoComplete="off"/>
                    {showModelDD && garageModels.filter(m=>!garageForm.modelSearch||m.modelName.toLowerCase().includes(garageForm.modelSearch.toLowerCase())).length > 0 && (
                      <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg max-h-48 overflow-y-auto shadow-xl text-sm">
                        {garageModels.filter(m=>!garageForm.modelSearch||m.modelName.toLowerCase().includes(garageForm.modelSearch.toLowerCase())).map(m=>(
                          <li key={m.modelId} onMouseDown={()=>{ setGarageForm(p=>({...p,modelSearch:m.modelName,selectedModel:m})); setShowModelDD(false); }}
                            className="px-3 py-2 hover:bg-gray-800 cursor-pointer text-gray-200 truncate">{m.modelName}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <select value={garageForm.year} onChange={e=>setGarageForm(p=>({...p,year:e.target.value}))}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition w-24">
                    <option value="">Year</option>
                    {Array.from({length: new Date().getFullYear()-1885},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={y}>{y}</option>)}
                  </select>
                  <input type="text" placeholder='Nickname (optional)' value={garageForm.nickname} maxLength={80}
                    onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition flex-1 min-w-[120px]"/>
                  <button onClick={addToGarage} disabled={garageAdding||!garageForm.selectedMake||!garageForm.selectedModel}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                    {garageAdding ? 'Adding…' : '+ Add'}
                  </button>
                </div>
              ) : (
                /* ── VIN mode ────────────────────────────────────────── */
                <div className="mb-3 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Enter 17-character VIN"
                      value={vinInput}
                      maxLength={17}
                      onChange={e => { setVinInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'')); setVinResult(null); setVinError(''); }}
                      onKeyDown={e => e.key==='Enter' && vinInput.length===17 && decodeVin()}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition font-mono tracking-widest uppercase"
                    />
                    <button onClick={decodeVin}
                      disabled={vinDecoding || vinInput.length !== 17}
                      className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                      {vinDecoding ? 'Decoding…' : 'Decode'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-600">
                    VIN is usually on the driver-side dashboard (visible through windshield), door jamb sticker, or insurance/registration card.
                    {typeof BarcodeDetector !== 'undefined' && ' Your browser supports camera scanning — use your phone camera app to scan the barcode and paste here.'}
                  </p>
                  {vinError && <p className="text-xs text-red-400">{vinError}</p>}
                  {vinResult && vinResult.make && (
                    <div className="bg-gray-800/80 border border-orange-500/30 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">
                          {[vinResult.year, vinResult.make, vinResult.model].filter(Boolean).join(' ')}
                        </p>
                        <span className="text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">NHTSA verified</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
                        {vinResult.bodyClass    && <span>Body: {vinResult.bodyClass}</span>}
                        {vinResult.cylinders    && <span>Cylinders: {vinResult.cylinders}</span>}
                        {vinResult.displacement && <span>Engine: {vinResult.displacement}L</span>}
                        {vinResult.fuelType     && <span>Fuel: {vinResult.fuelType}</span>}
                        {vinResult.driveType    && <span>Drive: {vinResult.driveType}</span>}
                        {vinResult.trim         && <span>Trim: {vinResult.trim}</span>}
                      </div>
                      <p className="text-[10px] text-gray-600 font-mono">{vinResult.vin}</p>
                      <div className="flex gap-2 pt-1">
                        <input type="text" placeholder='Nickname (optional)' value={garageForm.nickname} maxLength={80}
                          onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))}
                          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                        <button onClick={addVinVehicle} disabled={garageAdding}
                          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">
                          {garageAdding ? 'Adding…' : '+ Add to Garage'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Saved vehicles */}
              {garageLoading ? (
                <div className="space-y-2">{[1,2].map(i=><div key={i} className="h-10 bg-gray-800 rounded-xl animate-pulse"/>)}</div>
              ) : garage.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-3">No vehicles saved yet — add one above.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {garage.map(v=>(
                    <div key={v.id} className="flex items-center gap-2 bg-gray-800/70 border border-gray-700 rounded-xl px-3 py-2">
                      <IcoCar size={13} cls="text-orange-400"/>
                      <div className="leading-tight">
                        <span className="text-sm text-white font-medium">{v.nickname || `${v.make_name} ${v.model_name}`}</span>
                        {v.nickname && <span className="text-[10px] text-gray-500 ml-1.5">{v.make_name} {v.model_name}</span>}
                        {v.year && <span className="text-[10px] text-orange-400 ml-1.5">{v.year}</span>}
                      </div>
                      <button onClick={()=>setGarageDeleteTarget(v)} className="text-gray-700 hover:text-red-400 transition ml-1"><IcoX size={12}/></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Delete confirm inline */}
              {garageDeleteTarget && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between gap-3">
                  <p className="text-sm text-red-300">Remove <strong>{garageDeleteTarget.nickname||`${garageDeleteTarget.make_name} ${garageDeleteTarget.model_name}`}</strong>?</p>
                  <div className="flex gap-2">
                    <button onClick={()=>setGarageDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white transition px-2 py-1 rounded-lg">Cancel</button>
                    <button onClick={()=>deleteFromGarage(garageDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">Remove</button>
                  </div>
                </div>
              )}
            </Card>

            {/* Quick templates */}
            <Card>
              <CardHeader icon={IcoCalendar} title="Quick Add"/>
              <div className="flex flex-wrap gap-2">
                {[
                  {title:'Annual Physical',     category:'Medical',       recurrence_days:365, urgency:'medium'},
                  {title:'Dentist Checkup',     category:'Dental',        recurrence_days:180, urgency:'medium'},
                  {title:'Eye Exam',            category:'Vision',        recurrence_days:365, urgency:'low'},
                  {title:'Therapy Session',     category:'Mental Health', recurrence_days:7,   urgency:'medium'},
                  {title:'Haircut',             category:'Grooming',      recurrence_days:30,  urgency:'low'},
                  {title:'Prescription Refill', category:'Pharmacy',      recurrence_days:30,  urgency:'high'},
                  {title:'Dermatologist',       category:'Medical',       recurrence_days:365, urgency:'low'},
                  {title:'Gym / Workout',       category:'Fitness',       recurrence_days:3,   urgency:'low'},
                ].map((t,i)=>(
                  <button key={i} onClick={()=>quickAddPcTask(t)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition">
                    {t.category==='Medical'?'🩺':t.category==='Dental'?'🦷':t.category==='Vision'?'👁️':t.category==='Mental Health'?'🧠':t.category==='Grooming'?'💇':t.category==='Pharmacy'?'💊':t.category==='Fitness'?'💪':'✨'} {t.title}
                  </button>
                ))}
              </div>
            </Card>

            {/* Appointment list */}
            <Card>
              <CardHeader icon={IcoHeart} title="My Health & Wellness" right={<Btn onClick={()=>setShowPcModal(true)}>+ Add</Btn>}/>
              {pcLoading ? (
                <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-800 rounded-xl animate-pulse"/>)}</div>
              ) : personalCareTasks.length===0 ? (
                <div className="text-center py-10">
                  <p className="text-4xl mb-3">💆</p>
                  <p className="text-gray-500 text-sm mb-1">No appointments tracked yet.</p>
                  <p className="text-xs text-gray-600">Use the quick-add buttons above or add your own.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {personalCareTasks.map(t=>{
                    const overdue=t.due_date&&t.due_date<localDateStr()&&!t.is_completed;
                    const recLabel=t.recurrence_days===7?'weekly':t.recurrence_days===30?'monthly':t.recurrence_days===180?'every 6 mo':t.recurrence_days===365?'annually':t.recurrence_days?`every ${t.recurrence_days}d`:null;
                    return (
                      <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>togglePcTask(t)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${t.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {t.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{t.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {t.description&&<span className="text-[10px] bg-gray-800/60 text-gray-400 px-1.5 py-0.5 rounded-full">{t.description}</span>}
                            {t.due_date&&<span className={`text-[10px] ${overdue?'text-red-400 font-semibold':'text-gray-600'}`}>{overdue?'Overdue · ':''}{new Date(t.due_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>}
                            {recLabel&&<span className="text-[10px] text-purple-400">↻ {recLabel}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Tag text={t.urgency} color={t.urgency==='high'?'red':t.urgency==='medium'?'orange':'gray'}/>
                          <Link to="/post-job" className="text-[10px] text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap">Book →</Link>
                          <button onClick={()=>deletePcTask(t.id)} className="text-gray-700 hover:text-red-400 transition"><IcoTrash size={13}/></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
        {tab==='carcare' && (
          <div className="space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {label:'Overdue',   value:carCareTasks.filter(t=>t.due_date&&t.due_date<localDateStr()&&!t.is_completed).length, color:'text-red-400'},
                {label:'This Week', value:carCareTasks.filter(t=>{if(!t.due_date||t.is_completed)return false;const end=localDateStr(new Date(Date.now()+7*864e5));return t.due_date>=localDateStr()&&t.due_date<=end;}).length, color:'text-orange-400'},
                {label:'Total Pending',value:carCareTasks.length, color:'text-blue-400'},
                {label:'Recurring', value:carCareTasks.filter(t=>t.recurrence_days).length, color:'text-purple-400'},
              ].map((s,i)=>(
                <Card key={i} className="!p-3 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{s.label}</p>
                </Card>
              ))}
            </div>

            {/* Quick templates */}
            <Card>
              <CardHeader icon={IcoCalendar} title="Quick Add"/>
              <div className="flex flex-wrap gap-2">
                {[
                  {title:'Oil Change',           category:'Oil Change',  recurrence_days:90,  urgency:'medium'},
                  {title:'Tire Rotation',         category:'Tires',       recurrence_days:180, urgency:'medium'},
                  {title:'Registration Renewal',  category:'Registration',recurrence_days:365, urgency:'high'},
                  {title:'State Inspection',      category:'Inspection',  recurrence_days:365, urgency:'high'},
                  {title:'Car Wash',              category:'Detailing',   recurrence_days:14,  urgency:'low'},
                  {title:'Battery Check',         category:'Battery',     recurrence_days:365, urgency:'medium'},
                  {title:'Brake Inspection',      category:'Brakes',      recurrence_days:365, urgency:'high'},
                  {title:'Check Tire Pressure',   category:'Tires',       recurrence_days:30,  urgency:'low'},
                ].map((t,i)=>(
                  <button key={i} onClick={()=>quickAddCcTask(t)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition">
                    {t.category==='Oil Change'?'🛢️':t.category==='Tires'?'🔄':t.category==='Registration'?'📋':t.category==='Inspection'?'🔍':t.category==='Detailing'?'🧼':t.category==='Battery'?'🔋':t.category==='Brakes'?'🔧':'🚗'} {t.title}
                  </button>
                ))}
              </div>
            </Card>

            {/* Maintenance log */}
            <Card>
              <CardHeader icon={IcoWrench} title="Maintenance Log" right={<Btn onClick={()=>setShowCcModal(true)}>+ Add Service</Btn>}/>
              {ccLoading ? (
                <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-800 rounded-xl animate-pulse"/>)}</div>
              ) : carCareTasks.length===0 ? (
                <div className="text-center py-10">
                  <p className="text-4xl mb-3">🚗</p>
                  <p className="text-gray-500 text-sm mb-1">No services tracked yet.</p>
                  <p className="text-xs text-gray-600">Use the quick-add buttons above or add your own.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {carCareTasks.map(t=>{
                    const overdue=t.due_date&&t.due_date<localDateStr()&&!t.is_completed;
                    const recLabel=t.recurrence_days===90?'quarterly':t.recurrence_days===180?'every 6 mo':t.recurrence_days===365?'annually':t.recurrence_days===14?'biweekly':t.recurrence_days===30?'monthly':t.recurrence_days?`every ${t.recurrence_days}d`:null;
                    return (
                      <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>toggleCcTask(t)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${t.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {t.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{t.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {t.description&&<span className="text-[10px] bg-gray-800/60 text-gray-400 px-1.5 py-0.5 rounded-full">{t.description}</span>}
                            {t.due_date&&<span className={`text-[10px] ${overdue?'text-red-400 font-semibold':'text-gray-600'}`}>{overdue?'Overdue · ':''}{new Date(t.due_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>}
                            {recLabel&&<span className="text-[10px] text-purple-400">↻ {recLabel}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Tag text={t.urgency} color={t.urgency==='high'?'red':t.urgency==='medium'?'orange':'gray'}/>
                          <Link to="/post-job" className="text-[10px] text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap">Get Help →</Link>
                          <button onClick={()=>deleteCcTask(t.id)} className="text-gray-700 hover:text-red-400 transition"><IcoTrash size={13}/></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
        </main>
      

      {/* ── MODALS ──────────────────────────────────────────────── */}
      <Modal open={showExpenseModal} onClose={()=>setShowExpenseModal(false)} title="Log Transaction">
        <form onSubmit={handleAddExpense} className="space-y-4">
          <Select label="Type" value={expenseForm.type} onChange={e=>setExpenseForm(p=>({...p,type:e.target.value}))}>
            <option value="expense">Expense</option><option value="income">Income</option>
          </Select>
          <Input label="Amount ($)" type="number" step="0.01" min="0.01" required placeholder="0.00" value={expenseForm.amount} onChange={e=>setExpenseForm(p=>({...p,amount:e.target.value}))}/>
          <Input label="Category" required placeholder="e.g. Gas, Supplies, Gig Payment" value={expenseForm.category} onChange={e=>setExpenseForm(p=>({...p,category:e.target.value}))}/>
          <Input label="Description (optional)" placeholder="Quick note" value={expenseForm.description} onChange={e=>setExpenseForm(p=>({...p,description:e.target.value}))}/>
          <Select label="Frequency" value={expenseForm.frequency} onChange={e=>setExpenseForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!=='one_time'}))}>
            <option value="one_time">One-time</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="bi_weekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">Recurring</label>
            <button type="button" onClick={()=>setExpenseForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&p.frequency==='one_time'?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${expenseForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${expenseForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{expenseForm.is_recurring?'Yes':'No'}</span>
          </div>
          {expenseForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start Date (optional)" type="date" value={expenseForm.recurring_start_date} onChange={e=>setExpenseForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label="End Date (optional)" type="date" value={expenseForm.recurring_end_date} onChange={e=>setExpenseForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
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

      {/* ── Budget Modal ── */}
      <Modal open={showBudgetModal} onClose={()=>{setShowBudgetModal(false);setBudgetForm({category:'',period_amount:'',period:'monthly'})}} title="Set Budget">
        <form onSubmit={async(e)=>{e.preventDefault();try{await life.upsertBudget({category:budgetForm.category,period_amount:parseFloat(budgetForm.period_amount),period:budgetForm.period});life.fetchBudgets();toast.success('Budget saved!');setShowBudgetModal(false);setBudgetForm({category:'',period_amount:'',period:'monthly'});}catch{toast.error('Failed to save budget.');}}} className="space-y-4">
          <Select label="Category" required value={budgetForm.category} onChange={e=>setBudgetForm(p=>({...p,category:e.target.value}))}>
            <option value="">Select a category...</option>
            {['Housing / Rent','Food & Dining','Transportation','Utilities','Healthcare','Entertainment','Shopping','Personal Care','Auto','Education','Subscriptions','Savings','Other'].map(c=><option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Budget Amount ($)" type="number" step="0.01" min="0.01" required placeholder="0.00" value={budgetForm.period_amount} onChange={e=>setBudgetForm(p=>({...p,period_amount:e.target.value}))}/>
            <Select label="Period" value={budgetForm.period} onChange={e=>setBudgetForm(p=>({...p,period:e.target.value}))}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="bi_weekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </div>
          {budgetForm.period_amount && budgetForm.period !== 'monthly' && (
            <p className="text-xs text-gray-500">
              ≈ ${(parseFloat(budgetForm.period_amount||0) * ({daily:30,weekly:30/7,bi_weekly:30/14,monthly:1,quarterly:1/3,yearly:1/12}[budgetForm.period]||1)).toFixed(2)}/month
            </p>
          )}
          <Btn className="w-full py-3" type="submit">Save Budget</Btn>
        </form>
      </Modal>

      {/* ── Goal Update Modal ── */}
      <Modal open={showGoalUpdateModal} onClose={()=>{setShowGoalUpdateModal(false);setUpdatingGoal(null);}} title="Update Goal Progress">
        {updatingGoal&&(
          <form onSubmit={async(e)=>{e.preventDefault();await updateGoalProgress(updatingGoal,goalUpdateValue);setShowGoalUpdateModal(false);setUpdatingGoal(null);}} className="space-y-4">
            <p className="text-sm text-gray-400 bg-gray-800/50 px-3 py-2 rounded-lg">{updatingGoal.icon} {updatingGoal.title}</p>
            <Input label="Current Amount ($)" type="number" step="0.01" min="0" required autoFocus value={goalUpdateValue} onChange={e=>setGoalUpdateValue(e.target.value)} placeholder={`Was: $${parseFloat(updatingGoal.current_value||0).toLocaleString()}`}/>
            {updatingGoal.target_value&&<p className="text-xs text-gray-500">Target: ${parseFloat(updatingGoal.target_value).toLocaleString()} · {Math.round(Math.min((parseFloat(goalUpdateValue||0)/parseFloat(updatingGoal.target_value))*100,100))}% complete</p>}
            <div className="flex gap-2">
              <Btn className="flex-1 py-3" type="submit">Save Progress</Btn>
              <Btn variant="secondary" className="py-3" type="button" onClick={async()=>{await life.updateGoal(updatingGoal.id,{is_completed:true});life.fetchSummary();toast.success('Goal complete! 🎉');setShowGoalUpdateModal(false);setUpdatingGoal(null);}}>Mark Done ✓</Btn>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Personal Care Task Modal ── */}
      <Modal open={showPcModal} onClose={()=>setShowPcModal(false)} title="Add Health Appointment">
        <form onSubmit={addPcTask} className="space-y-4">
          <Input label="Appointment / Service" required placeholder="e.g. Annual Physical" value={pcForm.title} onChange={e=>setPcForm(p=>({...p,title:e.target.value}))}/>
          <Select label="Category" value={pcForm.category} onChange={e=>setPcForm(p=>({...p,category:e.target.value}))}>
            <option>Medical</option><option>Dental</option><option>Vision</option><option>Mental Health</option><option>Grooming</option><option>Fitness</option><option>Pharmacy</option><option>Other</option>
          </Select>
          <Input label="Date / Due" type="date" value={pcForm.due_date} onChange={e=>setPcForm(p=>({...p,due_date:e.target.value}))}/>
          <Select label="Priority" value={pcForm.urgency} onChange={e=>setPcForm(p=>({...p,urgency:e.target.value}))}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </Select>
          <Select label="Frequency" value={pcForm.frequency} onChange={e=>setPcForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!==''&&e.target.value!=='one_time'}))}>
            <option value="">One-time / unspecified</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="bi_weekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">Recurring</label>
            <button type="button" onClick={()=>setPcForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&!p.frequency?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${pcForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pcForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{pcForm.is_recurring?'Yes':'No'}</span>
          </div>
          {pcForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start Date (optional)" type="date" value={pcForm.recurring_start_date} onChange={e=>setPcForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label="End Date (optional)" type="date" value={pcForm.recurring_end_date} onChange={e=>setPcForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Input label="Estimated Cost ($, optional)" type="number" step="0.01" min="0" placeholder="e.g. 25.00 — feeds into Life Pulse score" value={pcForm.estimated_cost} onChange={e=>setPcForm(p=>({...p,estimated_cost:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Add Appointment</Btn>
        </form>
      </Modal>

      {/* ── Car Care Task Modal ── */}
      <Modal open={showCcModal} onClose={()=>setShowCcModal(false)} title="Add Car Service">
        <form onSubmit={addCcTask} className="space-y-4">
          {/* Link to a vehicle */}
          {garage.length > 0 && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Vehicle (optional)</label>
              <select value={ccForm.vehicle_id} onChange={e=>setCcForm(p=>({...p,vehicle_id:e.target.value}))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition">
                <option value="">All vehicles / unspecified</option>
                {garage.map(v=>(
                  <option key={v.id} value={v.id}>{v.nickname || `${v.make_name} ${v.model_name}`}{v.year ? ` (${v.year})` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <Input label="Service Name" required placeholder="e.g. Oil Change" value={ccForm.title} onChange={e=>setCcForm(p=>({...p,title:e.target.value}))}/>
          <Select label="Category" value={ccForm.category} onChange={e=>setCcForm(p=>({...p,category:e.target.value}))}>
            <option>Oil Change</option><option>Tires</option><option>Brakes</option><option>Inspection</option><option>Registration</option><option>Detailing</option><option>Battery</option><option>Fluids</option><option>AC / Heating</option><option>Other</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due Date" type="date" value={ccForm.due_date} onChange={e=>setCcForm(p=>({...p,due_date:e.target.value}))}/>
            <Select label="Priority" value={ccForm.urgency} onChange={e=>setCcForm(p=>({...p,urgency:e.target.value}))}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </Select>
          </div>
          <Select label="Frequency" value={ccForm.frequency} onChange={e=>setCcForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!==''&&e.target.value!=='one_time'}))}>
            <option value="">One-time / unspecified</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="bi_weekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">Recurring</label>
            <button type="button" onClick={()=>setCcForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&!p.frequency?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${ccForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${ccForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{ccForm.is_recurring?'Yes':'No'}</span>
          </div>
          {ccForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start Date (optional)" type="date" value={ccForm.recurring_start_date} onChange={e=>setCcForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label="End Date (optional)" type="date" value={ccForm.recurring_end_date} onChange={e=>setCcForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Input label="Estimated Cost ($, optional)" type="number" step="0.01" min="0" placeholder="e.g. 45.00 — feeds into Life Pulse score" value={ccForm.estimated_cost} onChange={e=>setCcForm(p=>({...p,estimated_cost:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Notes (optional)</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder="Shop name, current mileage, etc." value={ccForm.description} onChange={e=>setCcForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <Btn className="w-full py-3" type="submit">Add Service</Btn>
        </form>
      </Modal>

      {/* ── Add / Edit Skill Modal ── */}
      <Modal open={showSkillModal} onClose={()=>setShowSkillModal(false)} title={editingSkill ? 'Edit Skill' : 'Add a Skill'}>
        <form onSubmit={handleSaveSkill} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Skill Name</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder="e.g. Drywall Repair"
              required
              value={skillForm.skill_name}
              onChange={e => {
                setSkillForm(p => ({ ...p, skill_name: e.target.value }));
                setSkillSearch(e.target.value);
                if (e.target.value.length >= 2) searchSkillLookup(e.target.value);
                else setSkillLookup([]);
              }}
            />
            {skillLookup.length > 0 && (
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {skillLookup.map(s => (
                  <button key={s.id} type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition"
                    onClick={() => {
                      setSkillForm(p => ({ ...p, skill_name: s.name, category: s.category || p.category }));
                      setSkillSearch(s.name);
                      setSkillLookup([]);
                    }}
                  >
                    <span className="font-medium">{s.name}</span>
                    {s.category && <span className="text-[10px] text-gray-500 ml-2">{s.category}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Category</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder="e.g. Electrical, Plumbing, HVAC"
              value={skillForm.category}
              onChange={e => {
                setSkillForm(p => ({ ...p, category: e.target.value }));
                searchCatLookup(e.target.value);
              }}
              onBlur={() => setTimeout(() => setCatLookup([]), 150)}
            />
            {catLookup.length > 0 && (
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {catLookup.map(c => (
                  <button key={c} type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition"
                    onClick={() => { setSkillForm(p => ({ ...p, category: c })); setCatLookup([]); }}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Hourly Rate ($/hr)" type="number" step="0.01" min="0" placeholder="0.00" value={skillForm.hourly_rate} onChange={e=>setSkillForm(p=>({...p,hourly_rate:e.target.value}))}/>
            <Input label="Years Experience" type="number" min="0" max="99" placeholder="0" value={skillForm.years_exp} onChange={e=>setSkillForm(p=>({...p,years_exp:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Description (optional)</label>
            <textarea rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder="Briefly describe what you offer..." value={skillForm.description} onChange={e=>setSkillForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={skillForm.is_available} onChange={e=>setSkillForm(p=>({...p,is_available:e.target.checked}))} className="accent-orange-500"/>
            <span className="text-sm text-gray-400">Currently available for hire</span>
          </label>
          <Btn className="w-full py-3" type="submit">{editingSkill ? 'Save Changes' : 'Add Skill'}</Btn>
        </form>
      </Modal>

      {/* ── Add / Edit Tool Modal ── */}
      <Modal open={showToolModal} onClose={()=>setShowToolModal(false)} title={editingTool ? 'Edit Tool Listing' : 'List a Tool for Rental'}>
        <form onSubmit={handleSaveTool} className="space-y-4">
          <Input label="Tool Name" required placeholder="e.g. Pressure Washer 3200 PSI" value={toolForm.name} onChange={e=>setToolForm(p=>({...p,name:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Brand" placeholder="e.g. DeWalt, Milwaukee" value={toolForm.brand} onChange={e=>setToolForm(p=>({...p,brand:e.target.value}))}/>
            <Input label="Model" placeholder="e.g. DWE7491RS" value={toolForm.model} onChange={e=>setToolForm(p=>({...p,model:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Category</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder="e.g. Power Tools, Landscaping, Lifting"
              value={toolForm.category}
              onChange={e => {
                setToolForm(p => ({ ...p, category: e.target.value }));
                searchToolCatLookup(e.target.value);
              }}
              onBlur={() => setTimeout(() => setToolCatLookup([]), 150)}
            />
            {toolCatLookup.length > 0 && (
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {toolCatLookup.map(c => (
                  <button key={c} type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition"
                    onClick={() => { setToolForm(p => ({ ...p, category: c })); setToolCatLookup([]); }}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Daily Rate ($/day)" type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.daily_rate} onChange={e=>setToolForm(p=>({...p,daily_rate:e.target.value}))}/>
            <Input label="Hourly Rate ($/hr)" type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.hourly_rate} onChange={e=>setToolForm(p=>({...p,hourly_rate:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Condition" value={toolForm.condition} onChange={e=>setToolForm(p=>({...p,condition:e.target.value}))}>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </Select>
            <Input label="Deposit Amount ($)" type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.deposit_amount} onChange={e=>setToolForm(p=>({...p,deposit_amount:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" placeholder="Springfield" value={toolForm.location_city} onChange={e=>setToolForm(p=>({...p,location_city:e.target.value}))}/>
            <Input label="State" placeholder="OH" value={toolForm.location_state} onChange={e=>setToolForm(p=>({...p,location_state:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Description</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder="Condition notes, included accessories, usage requirements..." value={toolForm.description} onChange={e=>setToolForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.is_available} onChange={e=>setToolForm(p=>({...p,is_available:e.target.checked}))} className="accent-orange-500"/><span className="text-sm text-gray-400">Currently available for rental</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.requires_deposit} onChange={e=>setToolForm(p=>({...p,requires_deposit:e.target.checked}))} className="accent-orange-500"/><span className="text-sm text-gray-400">Require a deposit</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.delivery_available} onChange={e=>setToolForm(p=>({...p,delivery_available:e.target.checked}))} className="accent-orange-500"/><span className="text-sm text-gray-400">Offer delivery</span></label>
          </div>
          <Btn className="w-full py-3" type="submit">{editingTool ? 'Save Changes' : 'List Tool'}</Btn>
        </form>
      </Modal>
    </div>
    </PageShell>
  );
}
