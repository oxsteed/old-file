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
const IcoHome      = (p) => <Ico {...p}><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></Ico>;
const IcoClock     = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>;
const IcoCar       = (p) => <Ico {...p}><rect x="1" y="11" width="22" height="9" rx="2"/><path d="M3 11l2.5-7h13L21 11"/><circle cx="7" cy="20" r="2"/><circle cx="17" cy="20" r="2"/></Ico>;
const IcoHeart     = (p) => <Ico {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></Ico>;
const IcoCalendar  = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Ico>;
const IcoWrench    = (p) => <Ico {...p}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></Ico>;

// ── Shared UI ─────────────────────────────────────────────────────────────
const Tag = ({ text, color = 'orange' }) => {
  const m = { orange:'bg-orange-500/15 text-orange-400', green:'bg-emerald-500/15 text-emerald-400', red:'bg-red-500/15 text-red-400', gray:'bg-gray-700/40 text-gray-400', blue:'bg-blue-500/15 text-blue-400', purple:'bg-purple-500/15 text-purple-400' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${m[color]||m.orange}`}>{text}</span>;
};
const Modal = ({open,onClose,title,children})=>{if(!open)return null;return(<div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}><div className="absolute inset-0 bg-black/60 backdrop-blur-sm"/><div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between mb-5"><h3 className="font-bold text-white">{title}</h3><button onClick={onClose} className="text-gray-500 hover:text-white transition"><IcoX size={18}/></button></div>{children}</div></div>);};

// Format a Date as YYYY-MM-DD in local time (avoids UTC-shift from toISOString())
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// ── Onboarding ─────────────────────────────────────────────────────────────
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

  // Detect "selected Pro during registration but hasn't paid yet"
  const selectedProNoPay = !subscription?.status && user?.effective_tier==='pro' && !!user?.tier_selected;

  // ── Products state ────────────────────────────────────────────────────────
  const [myProducts, setMyProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const emptyProduct = { name:'', description:'', price_cents:'', category:'food', image_url:'', is_available:true };
  const [productForm, setProductForm] = useState(emptyProduct);

  const PRODUCT_CATEGORIES = ['food', 'supply', 'gear', 'other'];

  const fetchMyProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await api.get('/helper-products/me');
      setMyProducts(res.data?.products || []);
    } catch { /* silent */ }
    finally { setProductsLoading(false); }
  }, []);

  const openAddProduct = () => {
    setEditingProduct(null);
    setProductForm(emptyProduct);
    setShowProductModal(true);
  };
  const openEditProduct = (p) => {
    setEditingProduct(p);
    setProductForm({ name:p.name, description:p.description||'', price_cents: p.price_cents ? String(Math.round(p.price_cents/100)) : '', category:p.category||'food', image_url:p.image_url||'', is_available:p.is_available });
    setShowProductModal(true);
  };
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    const dollars = parseFloat(productForm.price_cents);
    if (!productForm.name.trim()) return toast.error('Name is required.');
    if (isNaN(dollars) || dollars <= 0) return toast.error('Enter a valid price.');
    const payload = { ...productForm, price_cents: Math.round(dollars * 100) };
    try {
      if (editingProduct) {
        await api.patch(`/helper-products/${editingProduct.id}`, payload);
        toast.success('Product updated!');
      } else {
        await api.post('/helper-products', payload);
        toast.success('Product listed!');
      }
      setShowProductModal(false);
      setEditingProduct(null);
      setProductForm(emptyProduct);
      fetchMyProducts();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save product.'); }
  };
  const handleDeleteProduct = async (id) => {
    if (!confirm('Remove this product listing?')) return;
    try {
      await api.delete(`/helper-products/${id}`);
      toast.success('Product removed.');
      fetchMyProducts();
    } catch { toast.error('Failed to remove product.'); }
  };
  const handleToggleProductAvailability = async (product) => {
    try {
      await api.patch(`/helper-products/${product.id}`, { is_available: !product.is_available });
      fetchMyProducts();
    } catch { toast.error('Failed to update.'); }
  };

  // ── Skills & Tools state ──────────────────────────────────────────────────
  const [mySkills, setMySkills] = useState([]);
  const [myTools, setMyTools] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [editingTool, setEditingTool] = useState(null);
  const [skillLookup, setSkillLookup] = useState([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [catLookup, setCatLookup] = useState([]);
  const [toolCatLookup, setToolCatLookup] = useState([]);
  const emptySkill = { skill_name:'', category:'', hourly_rate:'', years_exp:'', description:'', is_available:true };
  const emptyTool  = { name:'', category:'', description:'', daily_rate:'', hourly_rate:'', deposit_amount:'', condition:'good', brand:'', model:'', is_available:true, requires_deposit:false, delivery_available:false, pickup_only:true, location_city:'', location_state:'' };
  const [skillForm, setSkillForm] = useState(emptySkill);
  const [toolForm, setToolForm]   = useState(emptyTool);

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
    if (q.length < 2) { setSkillLookup([]); return; }
    try {
      const r = await api.get('/user-skills/lookup', { params: { q, limit: 15 } });
      setSkillLookup(r.data?.skills || r.data || []);
    } catch { setSkillLookup([]); }
  }, []);

  const searchCatLookup = useCallback(async (q) => {
    if (!q || q.length < 1) { setCatLookup([]); return; }
    try {
      const r = await api.get('/user-skills/categories', { params: { q, limit: 10 } });
      setCatLookup(r.data?.categories || []);
    } catch { setCatLookup([]); }
  }, []);

  const searchToolCatLookup = useCallback(async (q) => {
    if (!q || q.length < 1) { setToolCatLookup([]); return; }
    try {
      const r = await api.get('/tool-rentals/categories', { params: { q, limit: 10 } });
      setToolCatLookup(r.data?.categories || []);
    } catch { setToolCatLookup([]); }
  }, []);

  const openAddSkill = () => {
    setEditingSkill(null);
    setSkillSearch('');
    setSkillLookup([]);
    setCatLookup([]);
    setSkillForm(emptySkill);
    setShowSkillModal(true);
  };
  const openEditSkill = (s) => {
    setEditingSkill(s);
    setSkillSearch(s.skill_name);
    setSkillLookup([]);
    setSkillForm({ skill_name:s.skill_name, category:s.category||'', hourly_rate:s.hourly_rate||'', years_exp:s.years_exp||'', description:s.description||'', is_available:s.is_available });
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
      setEditingSkill(null);
      setSkillForm(emptySkill);
      fetchMySkills();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save skill.'); }
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
    setToolForm(emptyTool);
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
      setEditingTool(null);
      setToolForm(emptyTool);
      fetchMyTools();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save tool.'); }
  };
  const handleDeleteTool = async (id) => {
    if (!confirm('Remove this tool listing?')) return;
    try {
      await api.delete(`/tool-rentals/${id}`);
      toast.success('Tool removed.');
      fetchMyTools();
    } catch { toast.error('Failed to remove tool.'); }
  };

  // ── Personal Care state & handlers ──────────────────────────────────────
  const [personalCareTasks, setPersonalCareTasks] = useState([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [showPcModal, setShowPcModal] = useState(false);
  const [pcForm, setPcForm] = useState({ title:'', category:'Medical', due_date:'', urgency:'medium', recurrence_days:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'' });

  const fetchPersonalCareTasks = useCallback(async () => {
    setPcLoading(true);
    try {
      const res = await api.get('/life/home-tasks', { params: { section: 'personal_care', completed: 'false' } });
      setPersonalCareTasks(res.data?.home_tasks || []);
    } catch { /* silent */ }
    finally { setPcLoading(false); }
  }, []);

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

  // ── Car Care state & handlers ────────────────────────────────────────────
  const [carCareTasks, setCarCareTasks] = useState([]);
  const [ccLoading, setCcLoading] = useState(false);
  const [showCcModal, setShowCcModal] = useState(false);
  const [ccForm, setCcForm] = useState({ title:'', category:'Oil Change', due_date:'', urgency:'medium', recurrence_days:'', description:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', vehicle_id:'' });

  // ── My Garage (NHTSA) ────────────────────────────────────────────────────
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
  const [garageMode,    setGarageMode]    = useState('search'); // 'search' | 'vin'
  const [vinInput,      setVinInput]      = useState('');
  const [vinDecoding,   setVinDecoding]   = useState(false);
  const [vinResult,     setVinResult]     = useState(null);
  const [vinError,      setVinError]      = useState('');

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

  const fetchCarCareTasks = useCallback(async () => {
    setCcLoading(true);
    try {
      const res = await api.get('/life/home-tasks', { params: { section: 'car_care', completed: 'false' } });
      setCarCareTasks(res.data?.home_tasks || []);
    } catch { /* silent */ }
    finally { setCcLoading(false); }
  }, []);

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

  // ── Modal state ────────────────────────────────────────────────────────
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showChecklistModal, setShowChecklistModal] = useState(false);
  const [showHomeTaskModal, setShowHomeTaskModal] = useState(false);

  // Budget modal — replaces window.prompt
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ category:'', period_amount:'', period:'monthly' });

  // Goal update modal — replaces window.prompt
  const [showGoalUpdateModal, setShowGoalUpdateModal] = useState(false);
  const [updatingGoal, setUpdatingGoal] = useState(null);
  const [goalUpdateValue, setGoalUpdateValue] = useState('');

  // Expense form with recurring support
  const [expenseForm, setExpenseForm] = useState({ type:'expense', amount:'', category:'', description:'', frequency:'one_time', is_recurring:false, recurring_start_date:'', recurring_end_date:'' });
  const [goalForm, setGoalForm] = useState({ title:'', goal_type:'financial', target_value:'', icon:'🎯' });
  const [homeTaskForm, setHomeTaskForm] = useState({ title:'', due_date:'', urgency:'low', recurrence_days:'' });
  const [checklistForm, setChecklistForm] = useState({ title:'', due_date:'' });

  // ── Home / Properties state ───────────────────────────────────────────────
  const [homes,             setHomes]             = useState([]);
  const [homesLoaded,       setHomesLoaded]       = useState(false);
  const [homeAddrInput,     setHomeAddrInput]     = useState('');
  const [homeLookup,        setHomeLookup]        = useState(null);
  const [homeLookupLoading, setHomeLookupLoading] = useState(false);
  const [homeLookupError,   setHomeLookupError]   = useState('');
  const [homeNickname,      setHomeNickname]      = useState('');
  const [homeAdding,        setHomeAdding]        = useState(false);
  const [homeDeleteTarget,  setHomeDeleteTarget]  = useState(null);

  // ── Money tab — sinking funds snapshot ───────────────────────────────────
  const [moneyPlannedNeeds, setMoneyPlannedNeeds] = useState([]);

  // ── Unread messages / socket ───────────────────────────────────────────
  const [unreadMessages, setUnreadMessages] = useState(0);
  const { socket } = useSocket();

  const retryLoad = useCallback(async()=>{
    setLoading(true);
    setError(false);
    try{
      const p = [api.get('/verification/background-check/status'),api.get('/verification/identity/status'),api.get('/notifications')];
      if(isOnboardingComplete){p.push(api.get('/bids/me'));p.push(api.get('/jobs?limit=5'));p.push(api.get('/messages/conversations'));}
      const r = await Promise.allSettled(p);
      const anyFailed = r.some(res=>res.status==='rejected');
      if(anyFailed) setError(true);
      setVerification({backgroundCheck:r[0].status==='fulfilled'?r[0].value.data?.backgroundCheck||null:null,identity:r[1].status==='fulfilled'?r[1].value.data?.identity||null:null});
      if(r[2].status==='fulfilled'){const n=r[2].value.data?.notifications||r[2].value.data||[];setNotifications(Array.isArray(n)?n:[]);}
      if(isOnboardingComplete){
        if(r[3]?.status==='fulfilled'){const b=r[3].value.data?.bids||r[3].value.data||[];setMyBids(Array.isArray(b)?b:[]);}
        if(r[4]?.status==='fulfilled'){const j=r[4].value.data?.jobs||r[4].value.data||[];setNearbyJobs(Array.isArray(j)?j:[]);}
        if(r[5]?.status==='fulfilled'){const convs=r[5].value.data||[];const total=convs.reduce((s,c)=>s+(parseInt(c.unread_count)||0),0);setUnreadMessages(total);}
      }
    }catch(e){console.error(e);setError(true);}finally{setLoading(false);}
  },[isOnboardingComplete]);

  // Real-time unread badge
  useEffect(()=>{
    if(!socket) return;
    const inc = ()=> setUnreadMessages(prev => prev + 1);
    socket.on('profile_chat:new_message', inc);
    socket.on('message:new', inc);
    return ()=>{
      socket.off('profile_chat:new_message', inc);
      socket.off('message:new', inc);
    };
  },[socket]);

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
      life.fetchSavedHelpers();
      life.fetchHomeTasks({ completed:'false', section:'home' });
      if (!homesLoaded) {
        api.get('/house/my').then(r=>{ setHomes(r.data||[]); setHomesLoaded(true); }).catch(()=>{});
      }
    }
  },[isOnboardingComplete]);

  // Fetch tab-specific data on tab switch
  useEffect(() => {
    if (tab === 'skills') { fetchMySkills(); fetchMyTools(); }
    if (tab === 'products') fetchMyProducts();
    if (tab === 'personalcare') fetchPersonalCareTasks();
    if (tab === 'carcare') { fetchCarCareTasks(); if (!garageFetched) fetchGarage(); }
    if (tab === 'money') {
      api.get('/planned-needs', { params: { status: 'planned,funding,activating_soon', limit: 5 } })
        .then(r => setMoneyPlannedNeeds(r.data?.planned_needs || []))
        .catch(() => {});
    }
  }, [tab]);

  const startBackgroundCheck=async()=>{try{await api.post('/verification/background-check');window.location.reload();}catch(e){alert(e.response?.data?.error||'Failed');}};
  const startIdentityVerification=async()=>{try{const{data}=await api.post('/verification/identity/session');window.location.href=data.url;}catch(e){alert(e.response?.data?.error||'Failed');}};

  // Form handlers
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
    } catch { toast.error('Failed.'); }
  };
  const handleAddHomeTask = async (e) => {
    e.preventDefault();
    try {
      await life.createHomeTask({ ...homeTaskForm, recurrence_days: homeTaskForm.recurrence_days ? parseInt(homeTaskForm.recurrence_days) : null });
      toast.success('Task added!');
      setHomeTaskForm({ title:'', due_date:'', urgency:'low', recurrence_days:'' });
      setShowHomeTaskModal(false);
      life.fetchSummary();
      life.fetchHomeTasks({ completed:'false', section:'home' });
    } catch { toast.error('Failed to save.'); }
  };
  const toggleHomeTask = async (task) => {
    try {
      await life.updateHomeTask(task.id, { is_completed: !task.is_completed });
      life.fetchSummary();
      life.fetchHomeTasks({ completed:'false', section:'home' });
    } catch { toast.error('Failed to update.'); }
  };
  const lookupHomeAddress = async () => {
    const addr = homeAddrInput.trim();
    if (!addr) return;
    setHomeLookupLoading(true);
    setHomeLookup(null);
    setHomeLookupError('');
    try {
      const res = await api.get('/house/lookup', { params: { address: addr } });
      setHomeLookup(res.data);
    } catch (err) {
      setHomeLookupError(err.response?.data?.error || 'Address not found.');
    } finally { setHomeLookupLoading(false); }
  };
  const addHome = async () => {
    if (!homeLookup) return;
    setHomeAdding(true);
    try {
      const payload = {
        address:             homeLookup.matchedAddress,
        city:                homeLookup.city,
        state:               homeLookup.state,
        zip:                 homeLookup.zip,
        lat:                 homeLookup.lat,
        lng:                 homeLookup.lng,
        year_built:          homeLookup.building?.yearBuilt ? parseInt(homeLookup.building.yearBuilt) : undefined,
        flood_zone:          homeLookup.flood?.zone || undefined,
        osm_building_levels: homeLookup.building?.levels ? parseInt(homeLookup.building.levels) : undefined,
        nickname:            homeNickname.trim() || undefined,
      };
      const res = await api.post('/house/my', payload);
      setHomes(prev => [res.data, ...prev]);
      setHomeLookup(null);
      setHomeAddrInput('');
      setHomeNickname('');
      toast.success('Home added!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add home.');
    } finally { setHomeAdding(false); }
  };
  const deleteHome = async (id) => {
    try {
      await api.delete(`/house/my/${id}`);
      setHomes(prev => prev.filter(h => h.id !== id));
      setHomeDeleteTarget(null);
      toast.success('Removed.');
    } catch { toast.error('Failed to remove.'); }
  };

  const handleAddChecklist = async (e) => {
    e.preventDefault();
    try {
      await life.createChecklistItem(checklistForm);
      toast.success('Added!');
      setChecklistForm({ title:'', due_date:'' });
      setShowChecklistModal(false);
      life.fetchSummary();
    } catch { toast.error('Failed.'); }
  };
  const toggleChecklist = async (item) => {
    try { await life.updateChecklistItem(item.id,{is_completed:!item.is_completed}); life.fetchSummary(); }
    catch { toast.error('Failed.'); }
  };
  const updateGoalProgress = async (goal, newValue) => {
    try {
      const val = parseFloat(newValue);
      if (isNaN(val)) return;
      await life.updateGoal(goal.id,{ current_value:val, is_completed: goal.target_value && val >= goal.target_value });
      life.fetchSummary();
      toast.success('Progress updated!');
    } catch { toast.error('Failed.'); }
  };

  // ── Online / Offline toggle ────────────────────────────────────────────
  const [isListed, setIsListed] = useState(user?.is_listed !== false);
  const [listingLoading, setListingLoading] = useState(false);

  useEffect(() => {
    api.get('/helpers/me/listing')
      .then(r => setIsListed(!!r.data?.is_listed))
      .catch(() => {});
  }, []);

  const handleToggleListing = async () => {
    const next = !isListed;
    setListingLoading(true);
    try {
      const { data } = await api.put('/helpers/me/listing', { is_listed: next });
      setIsListed(!!data.is_listed);
      toast.success(data.is_listed ? 'You are now online — visible in the helper directory.' : 'You are now offline — hidden from the directory.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update status');
    }
    setListingLoading(false);
  };

  // ── Derived ───────────────────────────────────────────────────────────
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
  const fp=life.financialPulse;

  const tabs = showOnboarding
    ? [{id:'pulse',label:'Get Started'}]
    : [
        {id:'pulse',      label:'My Pulse'},
        {id:'editprofile',label:'Edit Profile'},
        {id:'earnings',   label:'Earnings'},
        {id:'jobs',       label:'Find Jobs'},
        {id:'money',      label:'Money'},
        {id:'home',       label:'Home'},
        {id:'goals',      label:'Goals'},
        {id:'personalcare',label:'Personal Care'},
        {id:'carcare',label:'Car Care'},
        {id:'skills',label:'Skills & Tools'},
        {id:'products',label:'My Products'},
        {id:'bids',label:'My Bids'},
      ];

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
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-500 flex-shrink-0"/>
              <span>You are <strong className="text-white">offline</strong> — you are not visible in the helper directory right now.</span>
            </div>
            <button onClick={handleToggleListing} disabled={listingLoading}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 whitespace-nowrap">
              Go Online
            </button>
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
                title={isListed ? 'Click to go offline' : 'Click to go online'}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all disabled:opacity-60 border ${
                  isListed ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25'
                           : 'bg-gray-700/60 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isListed ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}/>
                {listingLoading ? 'Updating…' : isListed ? 'Online' : 'Offline'}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        {tabs.length>1&&(
          <div className="grid grid-cols-4 sm:flex gap-1 my-6 bg-gray-900/80 rounded-xl p-1">
            {tabs.map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all sm:whitespace-nowrap text-center ${tab===t.id?'bg-orange-500 text-gray-950':'text-gray-500 hover:text-gray-300'}`}>{t.label}</button>))}
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

          {/* Financial Pulse Score — upgraded to match customer dashboard */}
          {!showOnboarding && fp && (() => {
            const score = fp.pulse_score;
            const scoreColor = score >= 80 ? '#34d399' : score >= 60 ? '#F97316' : score >= 40 ? '#facc15' : '#f87171';
            const breakdown = fp.score_breakdown || {};
            return (
              <div className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 border border-gray-700/40 rounded-2xl p-6 mb-6">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
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
                  <div className="grid grid-cols-4 gap-3 shrink-0">
                    {[
                      { l:'Coverage',    v:breakdown.coverage,    c:'text-emerald-400' },
                      { l:'Buffer',      v:breakdown.buffer,      c:'text-blue-400'    },
                      { l:'Reliability', v:breakdown.reliability, c:'text-purple-400'  },
                      { l:'Obligations', v:breakdown.obligations, c:'text-orange-400'  },
                    ].map((d,i) => (
                      <div key={i} className="text-center">
                        <p className={`text-lg font-bold ${d.c}`}>{d.v ?? '—'}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">{d.l}</p>
                      </div>
                    ))}
                  </div>
                </div>
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

          {/* Summary stat cards */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 ${showOnboarding?'opacity-50 pointer-events-none':''}`}>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Jobs Completed</p><p className="text-2xl font-bold text-orange-400">{user?.completed_jobs||0}</p><p className="text-xs text-gray-500 mt-1">{user?.avg_rating?`${user.avg_rating}★ avg`:'No reviews yet'}</p></Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Net This Month</p><p className={`text-2xl font-bold ${(s?.finances?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(s?.finances?.net||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p><p className="text-xs text-gray-500 mt-1">${(s?.finances?.total_income||0).toFixed(0)} in · ${(s?.finances?.total_expenses||0).toFixed(0)} out</p></Card>
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
                ? <p className="text-gray-500 text-sm text-center py-6">No nearby jobs right now. Check back soon or <Link to="/jobs" className="text-orange-400 hover:text-orange-300">browse all jobs</Link>.</p>
                : <div className="space-y-2">{nearbyJobs.slice(0,3).map(job=>(
                    <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl hover:bg-gray-800/60 transition group">
                      <div className="min-w-0 flex-1"><p className="text-white text-sm font-medium group-hover:text-orange-400 transition truncate">{job.title}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.distance_miles?` · ${job.distance_miles} mi`:''}</p></div>
                      {(job.budget_min||job.budget_max)&&<span className="text-sm font-bold text-emerald-400">${job.budget_min||'?'}–${job.budget_max||'?'}</span>}
                    </Link>
                  ))}</div>
              }
            </Card>

            {/* Community stats */}
            {life.community && (
              <Card className="mb-6">
                <CardHeader icon={IcoUsers} title="Springfield Helpers" right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">Browse Jobs →</Link>}/>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-orange-400">{life.community.jobs_this_week}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Jobs This Week</p></div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-emerald-400">{life.community.open_jobs}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Open Now</p></div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-blue-400">{life.community.active_helpers}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Active Helpers</p></div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-purple-400">{life.community.active_seekers}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Seekers This Week</p></div>
                </div>
                {life.community.top_categories?.length > 0 && (
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">Most requested:</span>
                    {life.community.top_categories.slice(0,3).map((c,i) => <Tag key={i} text={`${c.category_name} (${c.job_count})`} color={['orange','green','blue'][i]}/>)}
                  </div>
                )}
              </Card>
            )}

            {/* Pro upgrade CTA */}
            {!isProActive && (
              <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div><div className="flex items-center gap-2 mb-1"><IcoZap size={18} cls="text-orange-400"/><h3 className="text-lg font-bold text-white">Upgrade to Pro</h3></div><p className="text-sm text-gray-400">Get priority placement, verified badge, background check, ID verification, and bid alerts.</p></div>
                <button onClick={()=>navigate('/upgrade')} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition whitespace-nowrap text-sm">View Plans</button>
              </div>
            )}
          </>)}
        </>)}

        {/* ═══════ EDIT PROFILE ═══════ */}
        {tab==='editprofile'&&<EditProfileTab />}

        {/* ═══════ EARNINGS ═══════ */}
        {tab==='earnings'&&(<>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon={IcoDollar} title="Recent Transactions"/>
              {life.expenses.length===0?<p className="text-gray-600 text-sm text-center py-8">No transactions yet.</p>
              :(<div className="space-y-1 max-h-80 overflow-y-auto">{life.expenses.slice(0,15).map(e=>(
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition group">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{e.description||e.category}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {e.category} · {new Date(e.occurred_at).toLocaleDateString()}
                      {e.is_recurring && e.frequency && e.frequency !== 'one_time' && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-400">{e.frequency.replace('_','-')}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${e.type==='income'?'text-emerald-400':'text-red-400'}`}>{e.type==='income'?'+':'-'}${parseFloat(e.amount).toFixed(2)}</span>
                    <button onClick={async()=>{await life.deleteExpense(e.id);life.fetchSummary();life.fetchExpenses();toast.success('Deleted');}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                  </div>
                </div>
              ))}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoTarget} title="Budget Categories" right={<Btn variant="secondary" onClick={()=>setShowBudgetModal(true)}>+ Add Budget</Btn>}/>
              {life.budgets.length===0?<p className="text-gray-600 text-sm text-center py-8">No budgets set yet.</p>
              :(<div className="space-y-4">{life.budgets.map(b=>{const spent=parseFloat(b.spent||0);const lim=parseFloat(b.monthly_limit);const pct=lim>0?(spent/lim)*100:0;const periodLabel=b.period&&b.period!=='monthly'?` /mo (${b.period.replace('_','-')})`:'/mo';return(<div key={b.id}><div className="flex justify-between text-sm mb-1"><span className="font-medium text-white">{b.category}</span><span className="text-gray-500">${spent.toFixed(0)} / ${lim.toFixed(0)}{periodLabel}</span></div><ProgressBar pct={pct} color={pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-emerald-500'}/></div>);})}</div>)}
            </Card>
          </div>
        </>)}

        {/* ═══════ FIND JOBS ═══════ */}
        {tab==='jobs'&&(
          <div>
            <div className="flex items-center justify-between mb-5"><h3 className="font-semibold text-white text-lg">Available Jobs</h3><Link to="/jobs" className="text-sm text-orange-400 font-medium">Advanced Search →</Link></div>
            {nearbyJobs.length===0?<Card className="p-16 text-center"><IcoMap size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500">No jobs available right now. Check back soon.</p></Card>
            :<div className="space-y-2">{nearbyJobs.map(job=>(
              <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                <div className="min-w-0 flex-1 mr-4"><div className="flex items-center gap-2 mb-1"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{job.title}</p>{job.is_urgent&&<Tag text="Urgent" color="red"/>}</div><p className="text-xs text-gray-500 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.bid_count>0?` · ${job.bid_count} bids`:''}</p></div>
                <div className="flex items-center gap-3 flex-shrink-0">{(job.budget_min||job.budget_max)&&<span className="text-base font-bold text-emerald-400">${job.budget_min||'?'}–${job.budget_max||'?'}</span>}<span className="text-xs bg-orange-500/15 text-orange-400 px-3 py-1.5 rounded-lg font-semibold">View</span></div>
              </Link>
            ))}</div>}
          </div>
        )}

        {/* ═══════ MONEY ═══════ */}
        {tab==='money'&&(<>
          {/* Monthly summary */}
          <Card className="mb-6">
            <CardHeader icon={IcoDollar} title={`${new Date().toLocaleString('en-US',{month:'long'})} ${new Date().getFullYear()}`} right={<Btn onClick={()=>setShowExpenseModal(true)}>+ Log Transaction</Btn>}/>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Income</p><p className="text-xl font-bold text-emerald-400">${(life.expenseSummary?.total_income||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Expenses</p><p className="text-xl font-bold text-red-400">${(life.expenseSummary?.total_expenses||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Net</p><p className={`text-xl font-bold ${(life.expenseSummary?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(life.expenseSummary?.net||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Savings Rate</p>
                {(life.expenseSummary?.total_income||0)>0
                  ?<p className={`text-xl font-bold ${((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=20?'text-emerald-400':((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=0?'text-yellow-400':'text-red-400'}`}>{Math.round((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)}%</p>
                  :<p className="text-xl font-bold text-gray-600">—</p>
                }
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Recent transactions */}
            <Card>
              <CardHeader icon={IcoDollar} title="Recent Transactions"/>
              {life.expenses.length===0?(
                <p className="text-gray-600 text-sm text-center py-8">No transactions yet. Log your first one above.</p>
              ):(
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {life.expenses.slice(0,15).map(e=>(
                    <div key={e.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition group">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{e.description||e.category}</p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {e.category} · {new Date(e.occurred_at).toLocaleDateString()}
                          {e.is_recurring&&e.frequency&&e.frequency!=='one_time'&&(
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-400">{e.frequency.replace('_','-')}</span>
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
              {life.budgets.length===0?(
                <p className="text-gray-600 text-sm text-center py-8">No budgets set. Add categories to track spending.</p>
              ):(
                <div className="space-y-4">
                  {life.budgets.map(b=>{
                    const spent=parseFloat(b.spent||0);
                    const limit=parseFloat(b.monthly_limit);
                    const pct=limit>0?(spent/limit)*100:0;
                    const periodLabel=b.period&&b.period!=='monthly'?` /mo (${b.period.replace('_','-')})`:'/mo';
                    return(
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

          {/* Sinking funds */}
          <Card className="mb-6">
            <CardHeader icon={IcoClock} title="Sinking Funds" right={
              <Link to="/planned-needs" className="text-xs text-orange-400 hover:text-orange-300 font-medium">Manage →</Link>
            }/>
            {moneyPlannedNeeds.length===0?(
              <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl">
                <p className="text-sm text-gray-500">No planned needs yet — schedule future expenses and save toward them gradually.</p>
                <Link to="/planned-needs" className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap ml-3">+ Add One</Link>
              </div>
            ):(
              <div className="space-y-4">
                {moneyPlannedNeeds.slice(0,5).map(pn=>{
                  const cost=parseFloat(pn.estimated_cost||0);
                  const saved=parseFloat(pn.reserved_amount||0);
                  const pct=cost>0?Math.min(100,(saved/cost)*100):0;
                  const perMonth=parseFloat(pn.sinking_fund_per_month||0);
                  return(
                    <div key={pn.id}>
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span className="font-medium text-white">{pn.title||pn.category}</span>
                        <div className="flex items-center gap-3">
                          {perMonth>0&&<span className="text-[10px] text-purple-400">${perMonth.toFixed(0)}/mo needed</span>}
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

        {/* ═══════ HOME ═══════ */}
        {tab==='home'&&(<>
          {/* My Properties */}
          <Card className="mb-5">
            <CardHeader icon={IcoHome} title="My Properties"
              right={<span className="text-[10px] text-gray-600">Census · OSM · FEMA</span>}/>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Enter your address (e.g. 123 Main St, Springfield OH)"
                value={homeAddrInput}
                onChange={e=>{setHomeAddrInput(e.target.value);setHomeLookup(null);setHomeLookupError('');}}
                onKeyDown={e=>e.key==='Enter'&&!homeLookupLoading&&homeAddrInput.length>5&&lookupHomeAddress()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              />
              <button onClick={lookupHomeAddress}
                disabled={homeLookupLoading||homeAddrInput.trim().length<5}
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
                  {homeLookup.building?.yearBuilt  &&<span>🏠 Built {homeLookup.building.yearBuilt}</span>}
                  {homeLookup.building?.levels      &&<span>📐 {homeLookup.building.levels} {parseInt(homeLookup.building.levels)===1?'story':'stories'}</span>}
                  {homeLookup.building?.roofShape   &&<span>🔺 {homeLookup.building.roofShape} roof</span>}
                  {homeLookup.building?.buildingType&&<span>🏗️ {homeLookup.building.buildingType}</span>}
                  {homeLookup.flood&&(
                    <span className={homeLookup.flood.zone&&['A','AE','V','VE','AH','AO'].includes(homeLookup.flood.zone)?'text-red-400 font-semibold':'text-emerald-400'}>
                      💧 {homeLookup.flood.label||`Flood Zone ${homeLookup.flood.zone}`}
                    </span>
                  )}
                  {!homeLookup.building&&!homeLookup.flood&&(
                    <span className="text-gray-600">No OSM/FEMA data yet for this address — you can still save it.</span>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <input type="text" placeholder='Nickname (optional — e.g. "Primary Home")'
                    value={homeNickname} maxLength={80}
                    onChange={e=>setHomeNickname(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                  <button onClick={addHome} disabled={homeAdding}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">
                    {homeAdding?'Saving…':'+ Save Property'}
                  </button>
                </div>
              </div>
            )}

            {homes.length===0?(
              <p className="text-xs text-gray-600 text-center py-2">No properties saved yet. Enter an address above.</p>
            ):(
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
                        {h.osm_building_levels&&<span className="text-[10px] text-gray-500">{h.osm_building_levels}fl</span>}
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
                  <button onClick={()=>setHomeDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white transition px-2 py-1 rounded-lg">Cancel</button>
                  <button onClick={()=>deleteHome(homeDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">Remove</button>
                </div>
              </div>
            )}
          </Card>

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
            {/* Home maintenance tasks */}
            <Card>
              <CardHeader icon={IcoHome} title="Home Maintenance" right={<Btn onClick={()=>setShowHomeTaskModal(true)}>+ Add Task</Btn>}/>
              {life.homeTasks.length===0?(
                <p className="text-gray-600 text-sm text-center py-8">No home tasks yet. Add maintenance reminders.</p>
              ):(
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {life.homeTasks.map(t=>{
                    const overdue=t.due_date&&new Date(t.due_date)<new Date()&&!t.is_completed;
                    return(
                      <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${t.is_completed?'opacity-40 border-gray-800':overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>toggleHomeTask(t)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${t.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {t.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${t.is_completed?'line-through text-gray-600':'text-white'}`}>{t.title}</p>
                          <p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-600'}`}>
                            {t.due_date?(overdue?'Overdue · ':'')+new Date(t.due_date).toLocaleDateString():'No due date'}
                            {t.recurrence_days?` · Every ${t.recurrence_days}d`:''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <IcoWrench size={13} cls="text-gray-700"/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Saved helpers */}
            <Card>
              <CardHeader icon={IcoUsers} title="Saved Helpers" right={<Link to="/helpers" className="text-xs text-orange-400 font-medium">Browse →</Link>}/>
              {life.savedHelpers.length===0?(
                <p className="text-gray-600 text-sm text-center py-8">No saved helpers yet. Save helpers you like from profile pages.</p>
              ):(
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

        {/* ═══════ GOALS ═══════ */}
        {tab==='goals'&&(<>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon={IcoTarget} title="My Goals" right={<Btn onClick={()=>setShowGoalModal(true)}>+ New Goal</Btn>}/>
              {life.goals.length===0?<p className="text-gray-600 text-sm text-center py-8">No goals yet. Set your first one.</p>
              :(<div className="space-y-4 max-h-96 overflow-y-auto">{life.goals.map(g=>{const pct=g.target_value>0?Math.min((parseFloat(g.current_value)/parseFloat(g.target_value))*100,100):0;return(
                <div key={g.id} className={`p-4 border rounded-xl ${g.is_completed?'border-emerald-500/30 bg-emerald-500/5 opacity-60':'border-gray-800'}`}>
                  <div className="flex items-center gap-2 mb-2"><span className="text-lg">{g.icon||'🎯'}</span><span className="font-semibold text-sm text-white flex-1">{g.title}</span>{g.is_completed?<Tag text="Done" color="green"/>:<span className="text-sm font-bold text-orange-400">{Math.round(pct)}%</span>}</div>
                  {g.target_value>0&&!g.is_completed&&(<><ProgressBar pct={pct} color="bg-orange-500"/><div className="flex justify-between items-center mt-2"><span className="text-xs text-gray-500">${parseFloat(g.current_value).toLocaleString()} of ${parseFloat(g.target_value).toLocaleString()}</span>
                    {/* Uses proper modal instead of window.prompt */}
                    <button onClick={()=>{setUpdatingGoal(g);setGoalUpdateValue(g.current_value||'');setShowGoalUpdateModal(true);}} className="text-[10px] text-orange-400 font-semibold">Update →</button>
                  </div></>)}
                </div>
              );})}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoCheck} title="Life Checklist" right={<Btn onClick={()=>setShowChecklistModal(true)}>+ Add</Btn>}/>
              <p className="text-xs text-gray-600 mb-3">{life.checklist.filter(i=>i.is_completed).length} of {life.checklist.length} completed</p>
              {life.checklist.length===0?<p className="text-gray-600 text-sm text-center py-8">Your checklist is empty.</p>
              :(<div className="space-y-1.5 max-h-96 overflow-y-auto">{life.checklist.map(item=>(
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition group">
                  <button onClick={()=>toggleChecklist(item)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${item.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{item.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                  <div className="flex-1 min-w-0"><p className={`text-sm ${item.is_completed?'line-through text-gray-600':'text-white'}`}>{item.title}</p>{item.due_date&&<p className={`text-xs mt-0.5 ${new Date(item.due_date)<new Date()&&!item.is_completed?'text-red-400':'text-gray-600'}`}>{new Date(item.due_date).toLocaleDateString()}</p>}</div>
                  <button onClick={async()=>{await life.deleteChecklistItem(item.id);life.fetchSummary();toast.success('Removed');}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
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
            {/* Quick-add templates */}
            <div>
              <p className="text-xs text-gray-600 mb-2">Quick add:</p> 
              <div className="flex gap-2 flex-wrap">
                {[
                  {title:'Annual Physical',     category:'Medical',       urgency:'medium', recurrence_days:365},
                  {title:'Dentist Checkup',     category:'Dental',        urgency:'medium', recurrence_days:180},
                  {title:'Eye Exam',            category:'Vision',        urgency:'low',    recurrence_days:365},
                  {title:'Haircut',             category:'Grooming',      urgency:'low',    recurrence_days:30},
                  {title:'Prescription Refill', category:'Pharmacy',      urgency:'high',   recurrence_days:30},
                ].map((t,i)=>(
                  <button key={i} onClick={()=>quickAddPcTask(t)} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition border border-gray-700 hover:border-orange-500/40">+ {t.title}</button>
                ))}
              </div>
            </div>
            {pcLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
            :personalCareTasks.length===0?<Card className="p-12 text-center"><IcoHeart size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500">No personal care tasks yet.</p></Card>
            :<div className="space-y-2">{personalCareTasks.map(task=>{const overdue=task.due_date&&new Date(task.due_date)<new Date()&&!task.is_completed;return(
              <div key={task.id} className={`flex items-center gap-3 p-4 border rounded-2xl transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                <button onClick={()=>togglePcTask(task)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${task.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{task.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                <div className="flex-1 min-w-0"><p className={`text-sm font-medium ${task.is_completed?'line-through text-gray-600':'text-white'}`}>{task.title}</p><p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-500'}`}>{task.description}{task.due_date?` · ${overdue?'Overdue · ':''}${new Date(task.due_date).toLocaleDateString()}`:''}{task.recurrence_days?` · Every ${task.recurrence_days}d`:''}{task.estimated_cost?` · $${parseFloat(task.estimated_cost).toFixed(0)} est.`:''}</p></div>
                <div className="flex items-center gap-2"><Tag text={task.urgency} color={task.urgency==='high'?'red':task.urgency==='medium'?'orange':'gray'}/><button onClick={()=>deletePcTask(task.id)} className="opacity-0 hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button></div>
              </div>
            );})}</div>}
          </div>
        )}

        {/* ═══════ CAR CARE ═══════ */}
        {tab==='carcare'&&(
          <div className="space-y-6">
            {/* My Garage */}
            <Card>
              <CardHeader icon={IcoCar} title="My Garage" right={<span className="text-[10px] text-gray-600">NHTSA Vehicle Data</span>}/>
              <div className="flex gap-2 mb-4">
                {['search','vin'].map(m=><button key={m} onClick={()=>setGarageMode(m)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${garageMode===m?'bg-orange-500 text-white':'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>{m==='search'?'Search by Make/Model':'Decode VIN'}</button>)}
              </div>
              {garageMode==='search'?(
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                      <input placeholder="Make (e.g. Toyota)" value={garageForm.makeSearch}
                        onFocus={()=>loadMakesForGarage()}
                        onChange={e=>{setGarageForm(p=>({...p,makeSearch:e.target.value,selectedMake:null}));setShowMakeDD(true);}}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                      {showMakeDD && garageForm.makeSearch && allMakes.filter(m=>m.name.toLowerCase().includes(garageForm.makeSearch.toLowerCase())).length>0&&(
                        <div className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                          {allMakes.filter(m=>m.name.toLowerCase().includes(garageForm.makeSearch.toLowerCase())).slice(0,8).map(m=>(
                            <button key={m.id} type="button" onClick={()=>{setGarageForm(p=>({...p,makeSearch:m.name,selectedMake:m,modelSearch:'',selectedModel:null}));setShowMakeDD(false);loadModelsForGarage(m.name);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition">{m.name}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <input placeholder="Model" value={garageForm.modelSearch} disabled={!garageForm.selectedMake}
                        onChange={e=>{setGarageForm(p=>({...p,modelSearch:e.target.value,selectedModel:null}));setShowModelDD(true);}}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition disabled:opacity-40"/>
                      {showModelDD && garageForm.modelSearch && garageModels.filter(m=>m.modelName.toLowerCase().includes(garageForm.modelSearch.toLowerCase())).length>0&&(
                        <div className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                          {garageModels.filter(m=>m.modelName.toLowerCase().includes(garageForm.modelSearch.toLowerCase())).slice(0,8).map(m=>(
                            <button key={m.modelId} type="button" onClick={()=>{setGarageForm(p=>({...p,modelSearch:m.modelName,selectedModel:m}));setShowModelDD(false);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition">{m.modelName}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <input type="number" placeholder="Year (optional)" min="1900" max={new Date().getFullYear()+1} value={garageForm.year} onChange={e=>setGarageForm(p=>({...p,year:e.target.value}))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                    <input placeholder='Nickname (optional)' value={garageForm.nickname} onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                    <button onClick={addToGarage} disabled={!garageForm.selectedMake||!garageForm.selectedModel||garageAdding} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">{garageAdding?'Adding…':'+ Add'}</button>
                  </div>
                </div>
              ):(
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input placeholder="Enter VIN (17 characters)" value={vinInput} onChange={e=>setVinInput(e.target.value)} maxLength={17} className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                    <button onClick={decodeVin} disabled={vinDecoding||vinInput.trim().length!==17} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">{vinDecoding?'Decoding…':'Decode'}</button>
                  </div>
                  {vinError&&<p className="text-xs text-red-400">{vinError}</p>}
                  {vinResult&&(
                    <div className="bg-gray-800/80 border border-orange-500/30 rounded-xl p-3 space-y-2">
                      <p className="text-sm font-semibold text-white">{vinResult.year} {vinResult.make} {vinResult.model}</p>
                      <div className="flex gap-2">
                        <input placeholder='Nickname (optional)' value={garageForm.nickname} onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))} className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                        <button onClick={addVinVehicle} disabled={garageAdding} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">{garageAdding?'Adding…':'+ Save'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {garage.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {garage.map(v=>(
                    <div key={v.id} className="flex items-center gap-2 bg-gray-800/70 border border-gray-700 rounded-xl px-3 py-2">
                      <IcoCar size={13} cls="text-orange-400 flex-shrink-0"/>
                      <div className="leading-tight min-w-0">
                        <span className="text-sm text-white font-medium truncate block">{v.nickname||`${v.make_name} ${v.model_name}`}</span>
                        {v.nickname&&<span className="text-[10px] text-gray-500">{v.make_name} {v.model_name}{v.year?` · ${v.year}`:''}</span>}
                      </div>
                      <button onClick={()=>setGarageDeleteTarget(v)} className="text-gray-700 hover:text-red-400 transition ml-1"><IcoX size={12}/></button>
                    </div>
                  ))}
                </div>
              )}
              {garageDeleteTarget&&(
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between gap-3">
                  <p className="text-sm text-red-300">Remove <strong>{garageDeleteTarget.nickname||`${garageDeleteTarget.make_name} ${garageDeleteTarget.model_name}`}</strong>?</p>
                  <div className="flex gap-2">
                    <button onClick={()=>setGarageDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg transition">Cancel</button>
                    <button onClick={()=>deleteFromGarage(garageDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">Remove</button>
                  </div>
                </div>
              )}
            </Card>

            {/* Car Care Tasks */}
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold text-white text-lg">Car Care Schedule</h3><p className="text-xs text-gray-500 mt-0.5">Track oil changes, tires, inspections, and recurring vehicle services.</p></div>
              <Btn onClick={()=>setShowCcModal(true)}>+ Add Service</Btn>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-2">Quick add:</p>
              <div className="flex gap-2 flex-wrap">
                {[
                  {title:'Oil Change',       category:'Oil Change',  urgency:'medium', recurrence_days:90},
                  {title:'Tire Rotation',    category:'Tires',       urgency:'low',    recurrence_days:180},
                  {title:'State Inspection', category:'Inspection',  urgency:'medium', recurrence_days:365},
                  {title:'Car Wash',         category:'Detailing',   urgency:'low',    recurrence_days:14},
                ].map((t,i)=>(
                  <button key={i} onClick={()=>quickAddCcTask(t)} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition border border-gray-700 hover:border-orange-500/40">+ {t.title}</button>
                ))}
              </div>
            </div>
            {ccLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
            :carCareTasks.length===0?<Card className="p-12 text-center"><IcoCar size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500">No car care tasks yet.</p></Card>
            :<div className="space-y-2">{carCareTasks.map(task=>{const overdue=task.due_date&&new Date(task.due_date)<new Date()&&!task.is_completed;return(
              <div key={task.id} className={`flex items-center gap-3 p-4 border rounded-2xl transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                <button onClick={()=>toggleCcTask(task)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${task.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{task.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                <div className="flex-1 min-w-0"><p className={`text-sm font-medium ${task.is_completed?'line-through text-gray-600':'text-white'}`}>{task.title}</p><p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-500'}`}>{task.description}{task.due_date?` · ${overdue?'Overdue · ':''}${new Date(task.due_date).toLocaleDateString()}`:''}{task.recurrence_days?` · Every ${task.recurrence_days}d`:''}{task.estimated_cost?` · $${parseFloat(task.estimated_cost).toFixed(0)} est.`:''}</p></div>
                <div className="flex items-center gap-2"><Tag text={task.urgency} color={task.urgency==='high'?'red':task.urgency==='medium'?'orange':'gray'}/><button onClick={()=>deleteCcTask(task.id)} className="opacity-0 hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button></div>
              </div>
            );})}</div>}
          </div>
        )}

        {/* ═══════ SKILLS & TOOLS ═══════ */}
        {tab==='skills' && (
          <div className="space-y-8">
            {/* My Skills */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="font-semibold text-white text-lg">My Skills for Hire</h3><p className="text-xs text-gray-500 mt-0.5">List the skills you offer so customers can find and hire you directly.</p></div>
                <Btn onClick={openAddSkill}>+ Add Skill</Btn>
              </div>
              {skillsLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              :mySkills.length===0?<p className="text-gray-600 text-sm text-center py-8">No skills listed yet. Add your first skill to get discovered for relevant jobs.</p>
              :<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{mySkills.map(sk=>(
                <div key={sk.id} className="p-4 border border-gray-800 rounded-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-white truncate">{sk.skill_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{sk.category}{sk.years_exp?` · ${sk.years_exp} yrs`:''}</p>
                      {sk.hourly_rate&&<p className="text-xs text-orange-400 mt-1 font-semibold">${parseFloat(sk.hourly_rate).toFixed(0)}/hr</p>}
                      {sk.description&&<p className="text-xs text-gray-600 mt-1 line-clamp-2">{sk.description}</p>}
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Tag text={sk.is_available?'Available':'Unavailable'} color={sk.is_available?'green':'gray'}/>
                      <div className="flex gap-1 justify-end mt-1">
                        <button onClick={()=>openEditSkill(sk)} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">Edit</button>
                        <button onClick={()=>handleDeleteSkill(sk.id)} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">Del</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}</div>}
            </div>

            {/* Tools for Rent */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="font-semibold text-white text-lg">Tools for Rent</h3><p className="text-xs text-gray-500 mt-0.5">List your equipment so others can rent them.</p></div>
                <Btn onClick={openAddTool}>+ List a Tool</Btn>
              </div>
              {toolsLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              :myTools.length===0?<p className="text-gray-600 text-sm text-center py-8">No tools listed yet.</p>
              :<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{myTools.map(t=>(
                <div key={t.id} className="p-4 border border-gray-800 rounded-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-white truncate">{t.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.category}{t.brand?` · ${t.brand}`:''}{t.model?` ${t.model}`:''}</p>
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {t.daily_rate&&<span className="text-xs text-orange-400 font-semibold">${parseFloat(t.daily_rate).toFixed(0)}/day</span>}
                        {t.hourly_rate&&<span className="text-xs text-gray-400">${parseFloat(t.hourly_rate).toFixed(0)}/hr</span>}
                        {t.deposit_amount&&<span className="text-xs text-gray-500">Deposit ${parseFloat(t.deposit_amount).toFixed(0)}</span>}
                      </div>
                      {t.condition&&<p className="text-xs text-gray-600 mt-1 capitalize">Condition: {t.condition}</p>}
                      {(t.location_city||t.location_state)&&<p className="text-xs text-gray-600 mt-0.5">{[t.location_city,t.location_state].filter(Boolean).join(', ')}</p>}
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {t.delivery_available&&<span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full font-semibold">Delivery</span>}
                        {t.requires_deposit&&<span className="text-[10px] bg-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded-full font-semibold">Deposit Required</span>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Tag text={t.is_available?'Available':'Unavailable'} color={t.is_available?'green':'gray'}/>
                      <div className="flex gap-1 justify-end mt-1">
                        <button onClick={()=>openEditTool(t)} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">Edit</button>
                        <button onClick={()=>handleDeleteTool(t.id)} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">Del</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}</div>}
            </div>
          </div>
        )}

        {/* ═══════ MY PRODUCTS ═══════ */}
        {tab==='products'&&(
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-white text-lg">My Products for Sale</h3>
                <p className="text-xs text-gray-500 mt-0.5">List food, supplies, gear, or other items you sell. Shown on your public profile.</p>
              </div>
              <Btn onClick={openAddProduct}>+ List Product</Btn>
            </div>
            {productsLoading
              ? <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              : myProducts.length === 0
                ? <Card className="p-16 text-center"><p className="text-gray-500 mb-4">No products listed yet. Add your first product to showcase what you sell.</p><Btn onClick={openAddProduct}>List a Product</Btn></Card>
                : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {myProducts.map(p => (
                      <div key={p.id} className="p-4 border border-gray-800 rounded-xl">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-sm text-white truncate">{p.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5 capitalize">{p.category}</p>
                            <p className="text-xs text-orange-400 mt-1 font-semibold">${(p.price_cents/100).toFixed(2)}</p>
                            {p.description && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{p.description}</p>}
                          </div>
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleToggleProductAvailability(p)}
                              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition ${p.is_available ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30' : 'bg-gray-700/40 text-gray-500 hover:bg-gray-700'}`}
                            >{p.is_available ? 'Available' : 'Unavailable'}</button>
                            <div className="flex gap-1 justify-end mt-1">
                              <button onClick={() => openEditProduct(p)} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">Edit</button>
                              <button onClick={() => handleDeleteProduct(p.id)} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">Del</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
            }
          </div>
        )}

        {/* ═══════ MY BIDS ═══════ */}
        {tab==='bids'&&(
          <div>
            <div className="flex items-center justify-between mb-5"><h3 className="font-semibold text-white text-lg">My Bids</h3><div className="flex gap-2"><Tag text={`${activeBids.length} active`} color="orange"/><Tag text={`${wonBids.length} won`} color="green"/></div></div>
            {myBids.length===0?<Card className="p-16 text-center"><IcoTarget size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500 mb-4">No bids yet. Browse available jobs to start bidding.</p><Link to="/jobs" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm inline-block">Browse Jobs</Link></Card>
            :<div className="space-y-2">{myBids.map(bid=>(
              <Link key={bid.id} to={`/jobs/${bid.job_id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                <div className="min-w-0 flex-1 mr-4"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{bid.job_title||`Job #${bid.job_id}`}</p><p className="text-xs text-gray-500 mt-1">Bid <span className="text-white font-semibold">${bid.amount}</span>{bid.created_at?` · ${new Date(bid.created_at).toLocaleDateString()}`:''}</p></div>
                <Tag text={bid.status.replace(/_/g,' ')} color={bid.status==='accepted'?'green':bid.status==='pending'?'orange':bid.status==='rejected'?'red':'gray'}/>
              </Link>
            ))}</div>}
          </div>
        )}

      </main>

      {/* ════════════════════ MODALS ════════════════════ */}

      {/* Log Transaction — with recurring support */}
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

      {/* New Goal */}
      <Modal open={showGoalModal} onClose={()=>setShowGoalModal(false)} title="New Goal">
        <form onSubmit={handleAddGoal} className="space-y-4">
          <Input label="Goal Title" required placeholder="e.g. Save $1,000 emergency fund" value={goalForm.title} onChange={e=>setGoalForm(p=>({...p,title:e.target.value}))}/>
          <Select label="Type" value={goalForm.goal_type} onChange={e=>setGoalForm(p=>({...p,goal_type:e.target.value}))}>
            <option value="financial">Financial</option><option value="task">Task</option><option value="career">Career</option>
          </Select>
          {goalForm.goal_type==='financial'&&<Input label="Target Amount ($)" type="number" step="0.01" placeholder="1000" value={goalForm.target_value} onChange={e=>setGoalForm(p=>({...p,target_value:e.target.value}))}/>}
          <Input label="Icon (emoji)" placeholder="🎯" value={goalForm.icon} onChange={e=>setGoalForm(p=>({...p,icon:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Create Goal</Btn>
        </form>
      </Modal>

      {/* Goal Update Modal — replaces window.prompt */}
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

      {/* Product Modal */}
      <Modal open={showProductModal} onClose={()=>{setShowProductModal(false);setEditingProduct(null);setProductForm(emptyProduct);}} title={editingProduct ? 'Edit Product' : 'List a Product'}>
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <Input label="Product Name" required placeholder="e.g. Home-cooked Meal Delivery" value={productForm.name} onChange={e=>setProductForm(p=>({...p,name:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Category</label>
            <select value={productForm.category} onChange={e=>setProductForm(p=>({...p,category:e.target.value}))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500">
              {PRODUCT_CATEGORIES.map(c=><option key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
          </div>
          <Input label="Price ($)" type="number" step="0.01" min="0.01" required placeholder="0.00" value={productForm.price_cents} onChange={e=>setProductForm(p=>({...p,price_cents:e.target.value}))}/>
          <Input label="Description (optional)" placeholder="Short description of what you're selling" value={productForm.description} onChange={e=>setProductForm(p=>({...p,description:e.target.value}))}/>
          <Input label="Image URL (optional)" placeholder="https://..." value={productForm.image_url} onChange={e=>setProductForm(p=>({...p,image_url:e.target.value}))}/>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">Available Now</label>
            <button type="button" onClick={()=>setProductForm(p=>({...p,is_available:!p.is_available}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${productForm.is_available?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${productForm.is_available?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{productForm.is_available?'Yes':'No'}</span>
          </div>
          <Btn className="w-full py-3" type="submit">{editingProduct ? 'Save Changes' : 'List Product'}</Btn>
        </form>
      </Modal>
      {/* Home Task */}
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

      {/* Checklist Item */}
      <Modal open={showChecklistModal} onClose={()=>setShowChecklistModal(false)} title="Add Checklist Item">
        <form onSubmit={handleAddChecklist} className="space-y-4">
          <Input label="What do you need to do?" required placeholder="e.g. File quarterly taxes" value={checklistForm.title} onChange={e=>setChecklistForm(p=>({...p,title:e.target.value}))}/>
          <Input label="Due Date (optional)" type="date" value={checklistForm.due_date} onChange={e=>setChecklistForm(p=>({...p,due_date:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">Add Item</Btn>
        </form>
      </Modal>

      {/* Budget Modal — replaces window.prompt */}
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

      {/* Personal Care Task Modal */}
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
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="bi_weekly">Bi-weekly</option>
            <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
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

      {/* Car Care Task Modal */}
      <Modal open={showCcModal} onClose={()=>setShowCcModal(false)} title="Add Car Service">
        <form onSubmit={addCcTask} className="space-y-4">
          {garage.length > 0 && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Vehicle (optional)</label>
              <select value={ccForm.vehicle_id} onChange={e=>setCcForm(p=>({...p,vehicle_id:e.target.value}))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition">
                <option value="">All vehicles / unspecified</option>
                {garage.map(v=><option key={v.id} value={v.id}>{v.nickname||`${v.make_name} ${v.model_name}`}{v.year?` (${v.year})`:''}</option>)}
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
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="bi_weekly">Bi-weekly</option>
            <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
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

      {/* Add / Edit Skill Modal */}
      <Modal open={showSkillModal} onClose={()=>{setShowSkillModal(false);setEditingSkill(null);setSkillLookup([]);}} title={editingSkill ? 'Edit Skill' : 'Add a Skill'}>
        <form onSubmit={handleSaveSkill} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Skill Name</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder="e.g. Drywall Repair, Electrical Wiring" required value={skillForm.skill_name}
              onChange={e=>{setSkillForm(p=>({...p,skill_name:e.target.value}));setSkillSearch(e.target.value);if(e.target.value.length>=2)searchSkillLookup(e.target.value);else setSkillLookup([]);}}/>
            {skillLookup.length>0&&(
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {skillLookup.map(s=>(
                  <button key={s.id||s.name} type="button" className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition"
                    onClick={()=>{setSkillForm(p=>({...p,skill_name:s.name||s.skill_name,category:s.category_name||s.category||p.category}));setSkillSearch(s.name||s.skill_name);setSkillLookup([]);}}>
                    <span className="font-medium">{s.name||s.skill_name}</span>
                    {(s.category_name||s.category)&&<span className="text-[10px] text-gray-500 ml-2">{s.category_name||s.category}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Category</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder="e.g. Plumbing, Electrical, Landscaping" value={skillForm.category}
              onChange={e=>{setSkillForm(p=>({...p,category:e.target.value}));searchCatLookup(e.target.value);}}
              onBlur={()=>setTimeout(()=>setCatLookup([]),150)}/>
            {catLookup.length>0&&(
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {catLookup.map(c=><button key={c} type="button" onClick={()=>{setSkillForm(p=>({...p,category:c}));setCatLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition">{c}</button>)}
              </div>
            )}
          </div>
          <Input label="Hourly Rate ($, optional)" type="number" step="0.01" min="0" placeholder="0.00" value={skillForm.hourly_rate} onChange={e=>setSkillForm(p=>({...p,hourly_rate:e.target.value}))}/>
          <Input label="Years of Experience" type="number" min="0" max="50" placeholder="0" value={skillForm.years_exp} onChange={e=>setSkillForm(p=>({...p,years_exp:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Short Description (optional)</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder="Describe what you offer..." value={skillForm.description} onChange={e=>setSkillForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">Available for hire</label>
            <button type="button" onClick={()=>setSkillForm(p=>({...p,is_available:!p.is_available}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${skillForm.is_available?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${skillForm.is_available?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{skillForm.is_available?'Yes':'No'}</span>
          </div>
          <Btn className="w-full py-3" type="submit">{editingSkill?'Update Skill':'Add Skill'}</Btn>
        </form>
      </Modal>

      {/* Add / Edit Tool Modal — upgraded with richer fields */}
      <Modal open={showToolModal} onClose={()=>{setShowToolModal(false);setEditingTool(null);setToolCatLookup([]);}} title={editingTool ? 'Edit Tool Listing' : 'List a Tool'}>
        <form onSubmit={handleSaveTool} className="space-y-4">
          <Input label="Tool Name" required placeholder="e.g. DeWalt Drill, Pressure Washer" value={toolForm.name} onChange={e=>setToolForm(p=>({...p,name:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Category</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder="e.g. Power Tools, Landscaping, Cleaning" value={toolForm.category}
              onChange={e=>{setToolForm(p=>({...p,category:e.target.value}));searchToolCatLookup(e.target.value);}}
              onBlur={()=>setTimeout(()=>setToolCatLookup([]),150)}/>
            {toolCatLookup.length>0&&(
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {toolCatLookup.map(c=><button key={c} type="button" onClick={()=>{setToolForm(p=>({...p,category:c}));setToolCatLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition">{c}</button>)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Daily Rate ($)" type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.daily_rate} onChange={e=>setToolForm(p=>({...p,daily_rate:e.target.value}))}/>
            <Input label="Hourly Rate ($, optional)" type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.hourly_rate} onChange={e=>setToolForm(p=>({...p,hourly_rate:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Brand (optional)" placeholder="e.g. DeWalt, Honda" value={toolForm.brand} onChange={e=>setToolForm(p=>({...p,brand:e.target.value}))}/>
            <Input label="Model (optional)" placeholder="e.g. DCD777" value={toolForm.model} onChange={e=>setToolForm(p=>({...p,model:e.target.value}))}/>
          </div>
          <Select label="Condition" value={toolForm.condition} onChange={e=>setToolForm(p=>({...p,condition:e.target.value}))}>
            <option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option>
          </Select>
          <Input label="Deposit Amount ($, optional)" type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.deposit_amount} onChange={e=>setToolForm(p=>({...p,deposit_amount:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label="City (optional)" placeholder="e.g. Springfield" value={toolForm.location_city} onChange={e=>setToolForm(p=>({...p,location_city:e.target.value}))}/>
            <Input label="State (optional)" placeholder="e.g. OH" value={toolForm.location_state} onChange={e=>setToolForm(p=>({...p,location_state:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Description (optional)</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder="Condition details, usage notes, etc." value={toolForm.description} onChange={e=>setToolForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <div className="space-y-3">
            {[
              {label:'Available for rent', key:'is_available'},
              {label:'Requires deposit', key:'requires_deposit'},
              {label:'Delivery available', key:'delivery_available'},
            ].map(({label,key})=>(
              <div key={key} className="flex items-center gap-3">
                <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 flex-1">{label}</label>
                <button type="button" onClick={()=>setToolForm(p=>({...p,[key]:!p[key]}))}
                  className={`w-10 h-5 rounded-full transition-colors relative ${toolForm[key]?'bg-orange-500':'bg-gray-700'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${toolForm[key]?'translate-x-5':'translate-x-0.5'}`}/>
                </button>
                <span className="text-xs text-gray-400 w-6">{toolForm[key]?'Yes':'No'}</span>
              </div>
            ))}
          </div>
          <Btn className="w-full py-3" type="submit">{editingTool?'Update Tool':'List Tool'}</Btn>
        </form>
      </Modal>

    </div>
    </PageShell>
  );
}
