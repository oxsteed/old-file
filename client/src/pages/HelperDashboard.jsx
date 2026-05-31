import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import useSubscription from '../hooks/useSubscription';
import useLifeDashboard from '../hooks/useLifeDashboard';
import BadgeDisplay from '../components/BadgeDisplay';
import RecommendationFeed from '../components/RecommendationFeed';
import api from '../api/axios';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import TrialBanner from '../components/TrialBanner';
import HelperOffersCard from '../components/HelperOffersCard';
import EditProfileTab from '../components/EditProfileTab';
import AIKnowledgeTab from '../components/AIKnowledgeTab';
import HelperAvailabilityEditor from '../components/HelperAvailabilityEditor';
import { useSocket } from '../hooks/useSocket';
import { ProgressBar, Card, CardHeader, Btn, Input, Select } from '../components/dashboardUI';
import ReviewsList from '../components/reviews/ReviewsList';

// ── Icons ─────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoBriefcase = (p) => <Ico {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></Ico>;
const IcoSearch    = (p) => <Ico {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Ico>;
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
const IcoFileText  = (p) => <Ico {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></Ico>;

// ── Shared UI ─────────────────────────────────────────────────────────────
const Tag = ({ text, color = 'orange' }) => {
  const m = { orange:'bg-orange-500/15 text-orange-400', green:'bg-emerald-500/15 text-emerald-400', red:'bg-red-500/15 text-red-400', gray:'bg-gray-700/40 text-gray-400', blue:'bg-blue-500/15 text-blue-400', purple:'bg-purple-500/15 text-purple-400' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${m[color]||m.orange}`}>{text}</span>;
};
const Modal = ({open,onClose,title,children})=>{
  useEffect(()=>{
    if(!open)return;
    document.body.style.overflow='hidden';
    const onKey=(e)=>{if(e.key==='Escape')onClose();};
    document.addEventListener('keydown',onKey);
    return()=>{document.body.style.overflow='';document.removeEventListener('keydown',onKey);};
  },[open,onClose]);
  if(!open)return null;
  return(<div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}><div className="absolute inset-0 bg-black/60 backdrop-blur-sm"/><div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between mb-5"><h3 className="font-bold text-white">{title}</h3><button onClick={onClose} aria-label="Close" className="p-2 -mr-1 text-gray-500 hover:text-white transition rounded-lg hover:bg-gray-800"><IcoX size={18}/></button></div>{children}</div></div>);
};

// Format a Date as YYYY-MM-DD in local time (avoids UTC-shift from toISOString())
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// ═══════════════════════════════════════════════════════════════════════════
export default function HelperDashboard() {
  const { t } = useTranslation();
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'pulse');
  useEffect(()=>{
    if(searchParams.get('subscribed')==='true'){
      toast.success(t('helperDashboard.proActivated'));
      refreshUser?.();
      refreshSubscription?.();
      setSearchParams({},{replace:true});
    }
    if(searchParams.get('onboarding')==='complete'){
      toast.success('✅ Payment account connected! You can now receive payments for jobs.');
      refreshUser?.();
      setSearchParams({},{replace:true});
    }
  },[]);

  useEffect(() => {
    const urlTab = searchParams.get('tab') || 'pulse';
    if (urlTab === tab) return;
    const n = new URLSearchParams(searchParams);
    if (tab === 'pulse') n.delete('tab');
    else n.set('tab', tab);
    setSearchParams(n, { replace: true });
  }, [tab, searchParams, setSearchParams]);

  // Detect "selected Pro during registration but hasn't paid yet"
  const selectedProNoPay = !subscription?.status && user?.effective_tier==='pro' && !!user?.tier_selected;
  const isIdVerified =
    verification.identity?.status === 'verified' ||
    verification.identity?.status === 'approved' ||
    user?.didit_status === 'verified' ||
    user?.identity_verified === true ||
    user?.is_verified === true;
  const idVerificationStatusLabel = user?.didit_status === 'verified'
    ? 'verified'
    : (verification.identity?.status || 'verified');

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
    if (!productForm.name.trim()) return toast.error(t('helperDashboard.products.nameRequired'));
    if (isNaN(dollars) || dollars <= 0) return toast.error(t('helperDashboard.products.invalidPrice'));
    const payload = { ...productForm, price_cents: Math.round(dollars * 100) };
    try {
      if (editingProduct) {
        await api.patch(`/helper-products/${editingProduct.id}`, payload);
        toast.success(t('helperDashboard.products.updated'));
      } else {
        await api.post('/helper-products', payload);
        toast.success(t('helperDashboard.products.listed'));
      }
      setShowProductModal(false);
      setEditingProduct(null);
      setProductForm(emptyProduct);
      fetchMyProducts();
    } catch (err) { toast.error(err.response?.data?.error || t('helperDashboard.products.saveFailed')); }
  };
  const handleDeleteProduct = async (id) => {
    if (!confirm('Remove this product listing?')) return;
    try {
      await api.delete(`/helper-products/${id}`);
      toast.success(t('helperDashboard.products.removed'));
      fetchMyProducts();
    } catch { toast.error(t('helperDashboard.products.removeFailed')); }
  };
  const handleToggleProductAvailability = async (product) => {
    try {
      await api.patch(`/helper-products/${product.id}`, { is_available: !product.is_available });
      fetchMyProducts();
    } catch { toast.error(t('helperDashboard.failedUpdate')); }
  };

  // ── Invoices state ────────────────────────────────────────────────────────
  const [myInvoices, setMyInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [sendingInvoiceId, setSendingInvoiceId] = useState(null);
  const emptyInvoice = { invoice_number:'', client_email:'', client_name:'', line_items:[], subtotal_cents:0, tax_rate:0, tax_cents:0, total_cents:0, memo:'', due_date:'', status:'draft' };
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoice);
  const [lineItemInput, setLineItemInput] = useState({ description:'', quantity:1, unit_price:'' });

  const fetchMyInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const res = await api.get('/helpers/invoices');
      setMyInvoices(res.data?.invoices || []);
    } catch { /* silent */ }
    finally { setInvoicesLoading(false); }
  }, []);

  const openAddInvoice = () => {
    setEditingInvoice(null);
    setInvoiceForm(emptyInvoice);
    setLineItemInput({ description:'', quantity:1, unit_price:'' });
    setShowInvoiceModal(true);
  };

  const openEditInvoice = (inv) => {
    setEditingInvoice(inv);
    setInvoiceForm({
      invoice_number: inv.invoice_number,
      client_email: inv.client_email || '',
      client_name: inv.client_name || '',
      line_items: inv.line_items || [],
      subtotal_cents: inv.subtotal_cents || 0,
      tax_rate: inv.tax_rate || 0,
      tax_cents: inv.tax_cents || 0,
      total_cents: inv.total_cents || 0,
      memo: inv.memo || '',
      due_date: inv.due_date ? inv.due_date.split('T')[0] : '',
      status: inv.status || 'draft'
    });
    setLineItemInput({ description:'', quantity:1, unit_price:'' });
    setShowInvoiceModal(true);
  };

  const addLineItem = () => {
    const qty = parseFloat(lineItemInput.quantity) || 1;
    const price = parseFloat(lineItemInput.unit_price) || 0;
    if (!lineItemInput.description.trim()) return toast.error(t('helperDashboard.invoices.descriptionRequired'));
    if (qty <= 0 || price < 0) return toast.error(t('helperDashboard.invoices.invalidQtyPrice'));
    const newItem = {
      description: lineItemInput.description,
      quantity: qty,
      unit_price: price,
      total: qty * price
    };
    setInvoiceForm(prev => {
      const items = [...prev.line_items, newItem];
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const taxRate = prev.tax_rate || 0;
      const tax = subtotal * (taxRate / 100);
      return {
        ...prev,
        line_items: items,
        subtotal_cents: Math.round(subtotal * 100),
        tax_rate: taxRate,
        tax_cents: Math.round(tax * 100),
        total_cents: Math.round((subtotal + tax) * 100)
      };
    });
    setLineItemInput({ description:'', quantity:1, unit_price:'' });
  };

  const removeLineItem = (idx) => {
    setInvoiceForm(prev => {
      const items = prev.line_items.filter((_, i) => i !== idx);
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const taxRate = prev.tax_rate || 0;
      const tax = subtotal * (taxRate / 100);
      return {
        ...prev,
        line_items: items,
        subtotal_cents: Math.round(subtotal * 100),
        tax_cents: Math.round(tax * 100),
        total_cents: Math.round((subtotal + tax) * 100)
      };
    });
  };

  const updateTaxRate = (newRate) => {
    const subtotal = (invoiceForm.subtotal_cents || 0) / 100;
    const tax = subtotal * (newRate / 100);
    setInvoiceForm(prev => ({
      ...prev,
      tax_rate: newRate,
      tax_cents: Math.round(tax * 100),
      total_cents: prev.subtotal_cents + Math.round(tax * 100)
    }));
  };

  const handleSaveInvoice = async (e) => {
    e.preventDefault();
    if (!invoiceForm.client_name.trim()) return toast.error(t('helperDashboard.invoices.clientNameRequired'));
    if (!invoiceForm.client_email.trim()) return toast.error(t('helperDashboard.invoices.clientEmailRequired'));
    if (invoiceForm.line_items.length === 0) return toast.error(t('helperDashboard.invoices.lineItemRequired'));

    const payload = {
      client_email: invoiceForm.client_email,
      client_name: invoiceForm.client_name,
      line_items: invoiceForm.line_items,
      tax_rate: invoiceForm.tax_rate || 0,
      memo: invoiceForm.memo || '',
      due_date: invoiceForm.due_date || null,
      status: invoiceForm.status || 'draft'
    };

    try {
      if (editingInvoice) {
        await api.put(`/helpers/invoices/${editingInvoice.id}`, payload);
        toast.success(t('helperDashboard.invoices.updated'));
      } else {
        await api.post('/helpers/invoices', payload);
        toast.success(t('helperDashboard.invoices.created'));
      }
      setShowInvoiceModal(false);
      setEditingInvoice(null);
      setInvoiceForm(emptyInvoice);
      fetchMyInvoices();
    } catch (err) {
      toast.error(err.response?.data?.error || t('helperDashboard.invoices.saveFailed'));
    }
  };

  const handleDeleteInvoice = async (id) => {
    if (!confirm(t('helperDashboard.invoices.deleteConfirm'))) return;
    try {
      await api.delete(`/helpers/invoices/${id}`);
      toast.success(t('helperDashboard.invoices.deleted'));
      fetchMyInvoices();
    } catch { toast.error(t('helperDashboard.invoices.deleteFailed')); }
  };

  const handleSendInvoice = async (id) => {
    setSendingInvoiceId(id);
    try {
      const res = await api.post(`/helpers/invoices/${id}/send`);
      if (res.data?.notification_sent) {
        toast.success(t('helperDashboard.invoices.sentToClient'));
      } else {
        const token = res.data?.public_token;
        const url = `${window.location.origin}/invoice/p/${token}`;
        toast.success(t('helperDashboard.invoices.sentWithLink', { url }));
      }
      fetchMyInvoices();
    } catch (err) {
      toast.error(err.response?.data?.error || t('helperDashboard.invoices.saveFailed'));
    }
    setSendingInvoiceId(null);
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
  const emptyTool  = { name:'', category:'', description:'', daily_rate:'', hourly_rate:'', deposit_amount:'', replacement_value:'', owner_rules:'', owner_custom_terms:'', owner_attestation_accepted:false, condition:'good', brand:'', model:'', image_url:'', is_available:true, requires_deposit:false, delivery_available:false, pickup_only:true, location_city:'', location_state:'' };
  const [skillForm, setSkillForm] = useState(emptySkill);
  const [toolForm, setToolForm]   = useState(emptyTool);
  const [toolImageFile, setToolImageFile] = useState(null);
  const [toolImagePreview, setToolImagePreview] = useState('');

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
        toast.success(t('helperDashboard.skills.updated'));
      } else {
        await api.post('/user-skills', skillForm);
        toast.success(t('helperDashboard.skills.added'));
      }
      setShowSkillModal(false);
      setEditingSkill(null);
      setSkillForm(emptySkill);
      fetchMySkills();
    } catch (err) { toast.error(err.response?.data?.error || t('helperDashboard.skills.saveFailed')); }
  };
  const handleDeleteSkill = async (id) => {
    if (!confirm('Remove this skill listing?')) return;
    try {
      await api.delete(`/user-skills/${id}`);
      toast.success(t('helperDashboard.skills.removed'));
      fetchMySkills();
    } catch { toast.error(t('helperDashboard.skills.removeFailed')); }
  };

  const openAddTool = () => {
    setEditingTool(null);
    setToolCatLookup([]);
    setToolForm(emptyTool);
    setToolImageFile(null);
    setToolImagePreview('');
    setShowToolModal(true);
  };
  const openEditTool = (tool) => {
    setEditingTool(tool);
    setToolForm({ name:tool.name, category:tool.category||'', description:tool.description||'', daily_rate:tool.daily_rate||'', hourly_rate:tool.hourly_rate||'', deposit_amount:tool.deposit_amount||'', replacement_value:tool.replacement_value||'', owner_rules:tool.owner_rules||'', owner_custom_terms:tool.owner_custom_terms||'', owner_attestation_accepted:false, condition:tool.condition||'good', brand:tool.brand||'', model:tool.model||'', image_url:tool.image_url||'', is_available:tool.is_available, requires_deposit:tool.requires_deposit, delivery_available:tool.delivery_available, pickup_only:tool.pickup_only, location_city:tool.location_city||'', location_state:tool.location_state||'' });
    setToolImageFile(null);
    setToolImagePreview(tool.image_url||'');
    setShowToolModal(true);
  };
  const buildToolPayload = () => {
    const dailyRate = Number(toolForm.daily_rate);
    const hourlyRate = toolForm.hourly_rate === '' ? null : Number(toolForm.hourly_rate);
    const depositAmount = toolForm.deposit_amount === '' ? null : Number(toolForm.deposit_amount);
    const replacementValue = toolForm.replacement_value === '' ? null : Number(toolForm.replacement_value);

    if (!toolForm.name.trim()) throw new Error(t('dashboard.skillsTools.toolNameRequired', { defaultValue: 'Tool name is required' }));
    if (!toolForm.category.trim()) throw new Error(t('dashboard.skillsTools.toolCategoryRequired', { defaultValue: 'Tool category is required' }));
    if (!toolForm.location_city.trim()) throw new Error(t('dashboard.skillsTools.toolCityRequired', { defaultValue: 'City is required so renters know where pickup happens' }));
    if (!Number.isFinite(dailyRate) || dailyRate <= 0) throw new Error(t('dashboard.skillsTools.dailyRateRequired', { defaultValue: 'Daily rate must be greater than 0' }));
    if (toolForm.hourly_rate !== '' && (!Number.isFinite(hourlyRate) || hourlyRate <= 0)) throw new Error(t('dashboard.skillsTools.hourlyRateInvalid', { defaultValue: 'Hourly rate must be greater than 0' }));
    if (toolForm.deposit_amount !== '' && (!Number.isFinite(depositAmount) || depositAmount < 0)) throw new Error(t('dashboard.skillsTools.depositInvalid', { defaultValue: 'Deposit cannot be negative' }));
    if (toolForm.replacement_value !== '' && (!Number.isFinite(replacementValue) || replacementValue < 0)) throw new Error(t('dashboard.skillsTools.replacementInvalid', { defaultValue: 'Replacement value cannot be negative' }));
    if (toolForm.requires_deposit && !(depositAmount > 0)) throw new Error(t('dashboard.skillsTools.depositRequired', { defaultValue: 'Enter a deposit amount or turn off required deposit' }));
    if (!toolForm.owner_attestation_accepted) throw new Error(t('dashboard.skillsTools.ownerAttestationRequired', { defaultValue: 'Confirm the peer rental acknowledgement before listing this tool' }));

    return {
      ...toolForm,
      name: toolForm.name.trim(),
      category: toolForm.category.trim(),
      description: toolForm.description.trim(),
      brand: toolForm.brand.trim(),
      model: toolForm.model.trim(),
      location_city: toolForm.location_city.trim(),
      location_state: toolForm.location_state.trim(),
      owner_rules: toolForm.owner_rules.trim(),
      owner_custom_terms: toolForm.owner_custom_terms.trim(),
      daily_rate: dailyRate,
      hourly_rate: hourlyRate,
      deposit_amount: depositAmount,
      replacement_value: replacementValue,
      owner_attestation_accepted: toolForm.owner_attestation_accepted,
    };
  };
  const buildToolFormData = (payload) => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) formData.append(key, String(value));
    });
    if (toolImageFile) {
      formData.append('image', toolImageFile);
    } else if (payload.image_url) {
      formData.append('image_url', payload.image_url);
    }
    if (editingTool?.image_url && !toolImagePreview && !toolImageFile) {
      formData.append('remove_image', 'true');
    }
    return formData;
  };
  const handleToolImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('dashboard.skillsTools.toolImageInvalid', { defaultValue: 'Choose a JPG, PNG, GIF, or WebP image.' }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('dashboard.skillsTools.toolImageTooLarge', { defaultValue: 'Tool photo must be 10MB or smaller.' }));
      return;
    }
    setToolImageFile(file);
    setToolImagePreview(URL.createObjectURL(file));
  };
  const handleSaveTool = async (e) => {
    e.preventDefault();
    try {
      const payload = buildToolPayload();
      const formData = buildToolFormData(payload);
      if (editingTool) {
        await api.put(`/tool-rentals/${editingTool.id}`, formData);
        toast.success(t('helperDashboard.tools.updated'));
      } else {
        await api.post('/tool-rentals', formData);
        toast.success(t('helperDashboard.tools.listed'));
      }
      setShowToolModal(false);
      setEditingTool(null);
      setToolForm(emptyTool);
      setToolImageFile(null);
      setToolImagePreview('');
      fetchMyTools();
    } catch (err) { toast.error(err.response?.data?.error || t('helperDashboard.tools.saveFailed')); }
  };
  const handleDeleteTool = async (id) => {
    if (!confirm('Remove this tool listing?')) return;
    try {
      await api.delete(`/tool-rentals/${id}`);
      toast.success(t('helperDashboard.tools.removed'));
      fetchMyTools();
    } catch { toast.error(t('helperDashboard.tools.removeFailed')); }
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
      toast.success(t('helperDashboard.personalCare.added'));
      setPcForm({ title:'', category:'Medical', due_date:'', urgency:'medium', recurrence_days:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'' });
      setShowPcModal(false);
      fetchPersonalCareTasks();
    } catch { toast.error(t('helperDashboard.failedSave')); }
  };
  const togglePcTask = async (task) => {
    try {
      await api.put(`/life/home-tasks/${task.id}`, { is_completed: !task.is_completed });
      fetchPersonalCareTasks();
    } catch { toast.error(t('helperDashboard.failedUpdate')); }
  };
  const deletePcTask = async (id) => {
    try {
      await api.delete(`/life/home-tasks/${id}`);
      setPersonalCareTasks(prev => prev.filter(item => item.id !== id));
      toast.success(t('helperDashboard.removed'));
    } catch { toast.error(t('helperDashboard.failedRemove')); }
  };
  const quickAddPcTask = async (template) => {
    try {
      const due = new Date();
      due.setDate(due.getDate() + (template.recurrence_days || 30));
      await api.post('/life/home-tasks', { title: template.title, description: template.category, urgency: template.urgency, recurrence_days: template.recurrence_days, due_date: localDateStr(due), section: 'personal_care' });
      toast.success(t('helperDashboard.taskAdded', { title: template.title }));
      fetchPersonalCareTasks();
    } catch { toast.error(t('helperDashboard.failedAdd')); }
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
      toast.success(t('dashboard.carCare.vehicleAdded'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('dashboard.carCare.failedAdd'));
    } finally { setGarageAdding(false); }
  };

  const deleteFromGarage = async (id) => {
    try {
      await api.delete(`/vehicles/my/${id}`);
      setGarage(prev => prev.filter(v => v.id !== id));
      setGarageDeleteTarget(null);
      toast.success(t('helperDashboard.removed'));
    } catch { toast.error(t('helperDashboard.failedRemove')); }
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
      setVinError(err.response?.data?.error || t('dashboard.carCare.vinDecodeFailed'));
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
        model_name: vinResult.model || t('dashboard.carCare.unknownModel'),
        year:       vinResult.year  || undefined,
        nickname:   garageForm.nickname.trim() || undefined,
        notes:      vinResult.vin,
      });
      setGarage(prev => [res.data, ...prev]);
      setVinInput('');
      setVinResult(null);
      setGarageForm(p => ({...p, nickname:''}));
      toast.success(t('dashboard.carCare.vehicleAddedVin'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('dashboard.carCare.failedAdd'));
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
        vehicle_id: vehiclePayload.vehicle_id || null,
      });
      toast.success(t('helperDashboard.carCare.added'));
      setCcForm({ title:'', category:'Oil Change', due_date:'', urgency:'medium', recurrence_days:'', description:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', vehicle_id:'' });
      setShowCcModal(false);
      fetchCarCareTasks();
    } catch { toast.error(t('helperDashboard.failedSave')); }
  };
  const toggleCcTask = async (task) => {
    try {
      await api.put(`/life/home-tasks/${task.id}`, { is_completed: !task.is_completed });
      fetchCarCareTasks();
    } catch { toast.error(t('helperDashboard.failedUpdate')); }
  };
  const deleteCcTask = async (id) => {
    try {
      await api.delete(`/life/home-tasks/${id}`);
      setCarCareTasks(prev => prev.filter(item => item.id !== id));
      toast.success(t('helperDashboard.removed'));
    } catch { toast.error(t('helperDashboard.failedRemove')); }
  };
  const quickAddCcTask = async (template) => {
    try {
      const due = new Date();
      due.setDate(due.getDate() + (template.recurrence_days || 90));
      await api.post('/life/home-tasks', { title: template.title, description: template.category, urgency: template.urgency, recurrence_days: template.recurrence_days, due_date: localDateStr(due), section: 'car_care' });
      toast.success(t('helperDashboard.taskAdded', { title: template.title }));
      fetchCarCareTasks();
    } catch { toast.error(t('helperDashboard.failedAdd')); }
  };

  // ── Modal state ────────────────────────────────────────────────────────
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showChecklistModal, setShowChecklistModal] = useState(false);
  const [showHomeTaskModal, setShowHomeTaskModal] = useState(false);

  // Budget modal - replaces window.prompt
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ category:'', period_amount:'', period:'monthly' });

  // Goal update modal - replaces window.prompt
  const [showGoalUpdateModal, setShowGoalUpdateModal] = useState(false);
  const [updatingGoal, setUpdatingGoal] = useState(null);
  const [goalUpdateValue, setGoalUpdateValue] = useState('');

  // Expense form with recurring support
  const [expenseForm, setExpenseForm] = useState({ type:'expense', amount:'', category:'', description:'', frequency:'one_time', is_recurring:false, recurring_start_date:'', recurring_end_date:'' });
  const [goalForm, setGoalForm] = useState({ title:'', goal_type:'financial', target_value:'', icon:'🎯' });
  const [homeTaskForm, setHomeTaskForm] = useState({ title:'', due_date:'', urgency:'low', frequency:'one_time', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', home_id:'' });
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

  // ── Money tab - sinking funds snapshot ───────────────────────────────────
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
    if (tab === 'invoices') fetchMyInvoices();
    if (tab === 'personalcare') fetchPersonalCareTasks();
    if (tab === 'carcare') { fetchCarCareTasks(); if (!garageFetched) fetchGarage(); }
    if (tab === 'money') {
      api.get('/planned-needs', { params: { status: 'planned,funding,activating_soon', limit: 5 } })
        .then(r => setMoneyPlannedNeeds(r.data?.planned_needs || []))
        .catch(() => {});
    }
  }, [tab]);

  const startBackgroundCheck = async () => {
    try {
      const { data } = await api.post('/verification/background-check');
      toast.success(data?.message || 'Background check started. Check your email for next steps.');
      window.location.reload();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to start background check.');
    }
  };

  const startIdentityVerification = () => {
    navigate('/verify-identity');
  };

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
      toast.success(expenseForm.type === 'income' ? t('helperDashboard.incomeLogged') : t('helperDashboard.expenseLogged'));
      setExpenseForm({ type:'expense', amount:'', category:'', description:'', frequency:'one_time', is_recurring:false, recurring_start_date:'', recurring_end_date:'' });
      setShowExpenseModal(false);
      life.fetchSummary();
      life.fetchExpenses();
    } catch { toast.error(t('helperDashboard.failedSave')); }
  };
  const handleAddGoal = async (e) => {
    e.preventDefault();
    try {
      await life.createGoal({ ...goalForm, target_value: goalForm.target_value ? parseFloat(goalForm.target_value) : null });
      toast.success(t('helperDashboard.goalCreated'));
      setGoalForm({ title:'', goal_type:'financial', target_value:'', icon:'🎯' });
      setShowGoalModal(false);
      life.fetchSummary();
    } catch { toast.error(t('helperDashboard.failed')); }
  };
  const handleAddHomeTask = async (e) => {
    e.preventDefault();
    try {
      await life.createHomeTask({
        ...homeTaskForm,
        frequency: homeTaskForm.frequency || null,
        estimated_cost: homeTaskForm.estimated_cost ? parseFloat(homeTaskForm.estimated_cost) : null,
        recurring_start_date: homeTaskForm.is_recurring && homeTaskForm.recurring_start_date ? homeTaskForm.recurring_start_date : null,
        recurring_end_date: homeTaskForm.is_recurring && homeTaskForm.recurring_end_date ? homeTaskForm.recurring_end_date : null,
        home_id: homeTaskForm.home_id ? parseInt(homeTaskForm.home_id) : null,
      });
      toast.success(t('helperDashboard.taskAdded2'));
      setHomeTaskForm({ title:'', due_date:'', urgency:'low', frequency:'one_time', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', home_id:'' });
      setShowHomeTaskModal(false);
      life.fetchSummary();
      life.fetchHomeTasks({ completed:'false', section:'home' });
    } catch { toast.error(t('helperDashboard.failedSave')); }
  };
  const toggleHomeTask = async (task) => {
    try {
      await life.updateHomeTask(task.id, { is_completed: !task.is_completed });
      life.fetchSummary();
      life.fetchHomeTasks({ completed:'false', section:'home' });
    } catch { toast.error(t('helperDashboard.failedUpdate')); }
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
      setHomeLookupError(err.response?.data?.error || t('helperDashboard.addressNotFound'));
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
      toast.success(t('helperDashboard.homeAdded'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('helperDashboard.failedAddHome'));
    } finally { setHomeAdding(false); }
  };
  const deleteHome = async (id) => {
    try {
      await api.delete(`/house/my/${id}`);
      setHomes(prev => prev.filter(h => h.id !== id));
      setHomeDeleteTarget(null);
      toast.success(t('helperDashboard.removed'));
    } catch { toast.error(t('helperDashboard.failedRemove')); }
  };

  const handleAddChecklist = async (e) => {
    e.preventDefault();
    try {
      await life.createChecklistItem(checklistForm);
      toast.success(t('helperDashboard.checklistAdded'));
      setChecklistForm({ title:'', due_date:'' });
      setShowChecklistModal(false);
      life.fetchSummary();
    } catch { toast.error(t('helperDashboard.failed')); }
  };
  const toggleChecklist = async (item) => {
    try { await life.updateChecklistItem(item.id,{is_completed:!item.is_completed}); life.fetchSummary(); }
    catch { toast.error(t('helperDashboard.failed')); }
  };
  const updateGoalProgress = async (goal, newValue) => {
    try {
      const val = parseFloat(newValue);
      if (isNaN(val)) return;
      await life.updateGoal(goal.id,{ current_value:val, is_completed: goal.target_value && val >= goal.target_value });
      life.fetchSummary();
      toast.success(t('helperDashboard.progressUpdated'));
    } catch { toast.error(t('helperDashboard.failed')); }
  };

  // ── Directory listing toggle ──────────────────────────────────────────────
  const [isListed, setIsListed] = useState(user?.is_listed !== false);
  const [listingLoading, setListingLoading] = useState(false);

  useEffect(() => {
    api.get('/helpers/me/listing')
      .then(r => setIsListed(!!r.data?.is_listed))
      .catch(() => {});
  }, []);

  const handleToggleListing = async (newStatus) => {
    setListingLoading(true);
    try {
      const { data } = await api.put('/helpers/me/listing', { is_listed: newStatus });
      setIsListed(!!data.is_listed);
      toast.success(data.is_listed ? t('dashboard.status.online') : t('dashboard.status.offline'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('helperDashboard.failedUpdateStatus'));
    }
    setListingLoading(false);
  };

  // ── Live chat availability toggle ──────────────────────────────────────────
  const [isLiveAvailable, setIsLiveAvailable] = useState(false);
  const [liveAvailLoading, setLiveAvailLoading] = useState(false);

  useEffect(() => {
    api.get('/helpers/me/availability')
      .then(r => setIsLiveAvailable(!!r.data?.is_available_now))
      .catch(() => {});
  }, []);

  const handleToggleLiveAvailability = async (newStatus) => {
    setLiveAvailLoading(true);
    try {
      const { data } = await api.put('/helpers/me/availability', { is_available_now: newStatus });
      setIsLiveAvailable(!!data.is_available_now);
      toast.success(data.is_available_now ? t('helperDashboard.goingLive') : t('helperDashboard.goingOffline'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('helperDashboard.failedUpdateAvailability'));
    }
    setLiveAvailLoading(false);
  };

  /** True until helper finishes onboarding - dims pulse-dependent UI and gates some blocks */
  const showOnboarding = !isOnboardingComplete;

    // ── Derived ───────────────────────────────────────────────────────────
  const hr = new Date().getHours();
  const greeting = hr < 12 ? t('dashboard.morning') : hr < 17 ? t('dashboard.afternoon') : t('dashboard.evening');
  const displayName = (() => {
    const pref = user?.display_name_preference || 'first_name';
    if (pref === 'full_name') return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
    if (pref === 'business_name') return user?.business_name || user?.first_name || '';
    return user?.first_name || '';
  })();
  const isTrialActive = !!user?.is_trial_active;
  const trialDaysLeft = user?.trial_days_left ?? 0;
  const hasProAccess = isTrialActive || user?.effective_tier === 'pro' || subscription?.status === 'active' || subscription?.status === 'trialing';
  const isProActive = subscription?.status === 'active';
  const unreadNotifs = notifications.filter(n => !n.read && !n.read_at).length;
  const activeBids = myBids.filter(b => b.status === 'pending' || b.status === 'accepted');
  const wonBids = myBids.filter(b => b.status === 'accepted');
  const s = life.summary;
  const fp = life.financialPulse;

  const tabs = [
    { id: 'pulse',        label: t('helperDashboard.tabs.overview', { defaultValue: 'Overview' }) },
    { id: 'editprofile',  label: t('helperDashboard.tabs.editProfile') },
    { id: 'availability', label: t('helperDashboard.tabs.availability', { defaultValue: 'Availability' }) },
    { id: 'aiKnowledge',  label: t('helperDashboard.tabs.aiKnowledge') },
    { id: 'earnings',     label: t('helperDashboard.tabs.earnings') },
    { id: 'jobs',         label: t('helperDashboard.tabs.findJobs') },
    { id: 'money',        label: t('dashboard.tabs.money') },
    { id: 'home',         label: t('dashboard.tabs.home') },
    { id: 'goals',        label: t('dashboard.tabs.goals') },
    { id: 'personalcare', label: t('dashboard.tabs.personalCare') },
    { id: 'carcare',      label: t('dashboard.tabs.carCare') },
    { id: 'skills',       label: t('dashboard.tabs.skillsTools') },
    { id: 'products',     label: t('dashboard.tabs.products') },
    { id: 'invoices',     label: t('helperDashboard.tabs.invoices') },
    { id: 'bids',         label: t('helperDashboard.tabs.myBids') },
    { id: 'reviews',      label: t('helperDashboard.tabs.reviews') },
  ];

  if (loading) return (
    <PageShell>
      <div className="min-h-screen text-white">
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4" />
          <span className="text-sm">{t('helperDashboard.loadingDashboard')}</span>
        </div>
      </div>
    </PageShell>
  );

  return (
    <PageShell>
      <div className="min-h-screen text-white">
        <PageMeta title={t('helperDashboard.title')} description={t('helperDashboard.metaDesc')} noIndex={true} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
            <div>
              <h1 className="text-4xl font-black text-white tracking-tight mb-2">
                {t('dashboard.welcome', { name: user?.first_name || 'there' })}
              </h1>
              <p className="text-gray-400 font-medium">
                {t('dashboard.atAGlanceHelper')}
              </p>
            </div>
            <TrialBanner />
          </div>
          <HelperOffersCard />

          <RecommendationFeed title="What to do next" />

          {welcomeMsg&&<div className="mb-5 flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm font-medium"><span>🎉</span><span>{welcomeMsg}</span></div>}

          {/* Directory listing status */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4 bg-gray-900/60 border border-gray-700/40 rounded-2xl p-4">
            <div className="flex items-center gap-4">
              <div className={`w-3 h-3 rounded-full ${isListed ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`} />
              <div>
                <p className="text-sm font-bold text-white">
                  {isListed ? t('helperDashboard.online') : t('helperDashboard.offline')}
                </p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mt-0.5">
                  {t('helperDashboard.directoryStatus')}
                </p>
              </div>
            </div>
            <Btn
              variant={isListed ? 'secondary' : 'primary'}
              onClick={() => handleToggleListing(!isListed)}
              disabled={listingLoading}
            >
              {isListed ? t('helperDashboard.goOffline') : t('helperDashboard.goOnline')}
            </Btn>
          </div>

          {/* Live chat availability status */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8 bg-sky-900/30 border border-sky-700/40 rounded-2xl p-4">
            <div className="flex items-center gap-4">
              <div className={`w-3 h-3 rounded-full ${isLiveAvailable ? 'bg-blue-500 animate-pulse' : 'bg-gray-600'}`} />
              <div>
                <p className="text-sm font-bold text-white">
                  {isLiveAvailable ? t('helperDashboard.liveNow') : t('helperDashboard.notLive')}
                </p>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mt-0.5">
                  {t('helperDashboard.liveStatus')}
                </p>
              </div>
            </div>
            <Btn
              variant={isLiveAvailable ? 'secondary' : 'primary'}
              onClick={() => handleToggleLiveAvailability(!isLiveAvailable)}
              disabled={liveAvailLoading}
            >
              {isLiveAvailable ? t('helperDashboard.goOffline') : t('helperDashboard.goLive')}
            </Btn>
          </div>

          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-8 bg-orange-500/10 border border-orange-500/25 rounded-2xl p-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold mb-1">Growth Center</p>
              <h2 className="text-base font-bold text-white mb-1">Promote your services with ready-made links, QR codes, and local posts.</h2>
              <p className="text-sm text-gray-400 max-w-2xl">
                Turn your profile, services, availability, and booking link into shareable posts, texts, emails, and flyers.
              </p>
            </div>
            <Link to="/promote" className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-orange-500 text-gray-950 text-sm font-bold hover:bg-orange-400 transition">
              Open Growth Center
            </Link>
          </div>

          {/* Tabs */}
          {tabs.length>1&&(
            <div className="grid grid-cols-4 sm:flex gap-1 my-6 bg-gray-900/80 rounded-xl p-1 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900">
              {tabs.map(tb=>(<button key={tb.id} onClick={()=>setTab(tb.id)} className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all sm:whitespace-nowrap text-center flex-shrink-0 ${tab===tb.id?'bg-orange-500 text-gray-950':'text-gray-500 hover:text-gray-300'}`}>{tb.label}</button>))}
            </div>
          )}

          {/* ═══════ PULSE ═══════ */}
          {tab==='pulse'&&(<>
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-2">
                <span>⚠</span>
                <span>{t('helperDashboard.someDataFailed')} <button onClick={retryLoad} className="underline hover:text-red-300">{t('common.retry')}</button></span>
              </div>
            )}

            {/* Stripe Connect onboarding banner */}
            {isOnboardingComplete && !user?.stripe_connect_ready && (
              <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-center justify-between gap-4">
                <div>
                  <p className="text-yellow-400 font-semibold text-sm">💳 Connect your payment account</p>
                  <p className="text-gray-400 text-xs mt-0.5">You need a Stripe account to receive payments for jobs. It only takes a few minutes.</p>
                </div>
                <button
                  className="shrink-0 px-4 py-2 bg-yellow-500 text-gray-900 font-semibold text-sm rounded-lg hover:bg-yellow-400 transition-colors"
                  onClick={async () => {
                    try {
                      const { data } = await api.post('/payments/connect');
                      if (data.url) window.location.href = data.url;
                    } catch (e) { toast.error('Could not start payment setup. Try again.'); }
                  }}
                >
                  Set Up Payments
                </button>
              </div>
            )}

          {/* Financial Pulse Score - upgraded to match customer dashboard */}
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
                      <p className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold mb-0.5">{t('dashboard.financialHealth')}</p>
                      <p className="text-[10px] text-gray-600 mb-1">{t('helperDashboard.next30Days')}</p>
                      <p className="text-sm text-gray-400 max-w-xs">
                        {score >= 80 ? t('dashboard.pulse.strong') :
                         score >= 60 ? t('dashboard.pulse.good') :
                         score >= 40 ? t('dashboard.pulse.someGaps') :
                         t('dashboard.pulse.needsAttention')}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 shrink-0">
                    {[
                      { l:t('dashboard.pulse.coverage'),    v:breakdown.coverage,    c:'text-emerald-400' },
                      { l:t('dashboard.pulse.buffer'),      v:breakdown.buffer,      c:'text-blue-400'    },
                      { l:t('dashboard.pulse.reliability'), v:breakdown.reliability, c:'text-purple-400'  },
                      { l:t('dashboard.pulse.obligations'), v:breakdown.obligations, c:'text-orange-400'  },
                    ].map((d,i) => (
                      <div key={i} className="text-center">
                        <p className={`text-lg font-bold ${d.c}`}>{d.v ?? '-'}</p>
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
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t('helperDashboard.jobsCompleted')}</p><p className="text-2xl font-bold text-orange-400">{user?.completed_jobs||0}</p><p className="text-xs text-gray-500 mt-1">{user?.avg_rating?`${user.avg_rating}★ avg`:t('helperDashboard.noReviewsYet')}</p></Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t('dashboard.summary.netThisMonth')}</p><p className={`text-2xl font-bold ${(s?.finances?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(s?.finances?.net||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p><p className="text-xs text-gray-500 mt-1">${(s?.finances?.total_income||0).toFixed(0)} in · ${(s?.finances?.total_expenses||0).toFixed(0)} out</p></Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t('helperDashboard.activeBids')}</p><p className="text-2xl font-bold text-blue-400">{activeBids.length}</p><p className="text-xs text-gray-500 mt-1">{wonBids.length} {t('helperDashboard.accepted')}</p></Card>
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t('helperDashboard.goalsLabel')}</p><p className="text-2xl font-bold text-purple-400">{s?.goals?.avg_progress||0}%</p><p className="text-xs text-gray-500 mt-1">{s?.goals?.active||0} {t('helperDashboard.inProgress')}</p></Card>
          </div>

          {!showOnboarding&&(<>
            {/* Verification cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <Card>
                <div className="flex items-center gap-2 mb-3"><IcoDollar size={16} cls="text-orange-400"/><span className="text-sm font-semibold">{t('helperDashboard.subscription')}</span></div>
                {isProActive?(<><p className="text-lg font-bold text-orange-400 mb-1">{t('common.pro')}</p><Tag text={t('helperDashboard.active')} color="green"/><button onClick={openPortal} className="mt-2 text-xs text-gray-400 hover:text-gray-200 transition font-medium block">{t('helperDashboard.manageBilling')} →</button></>)
                :isTrialActive?(<><p className="text-lg font-bold text-orange-400 mb-1">{t('common.pro')}</p><Tag text={`${t('trial.active', { defaultValue: 'Trial Active' })} · ${trialDaysLeft} ${trialDaysLeft === 1 ? t('trial.dayLeft', { defaultValue: 'day left' }) : t('trial.daysLeft', { defaultValue: 'days left' })}`} color="purple"/><p className="text-xs text-gray-500 my-2">All new accounts start with free Pro access, including verification and background check tools.</p><button onClick={()=>navigate('/upgrade')} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">{t('helperDashboard.viewPlans')}</button></>)
                :selectedProNoPay?(<><p className="text-lg font-bold text-orange-400 mb-1">{t('common.pro')}</p><Tag text={t('helperDashboard.paymentPending')} color="orange"/><p className="text-xs text-gray-500 my-2">{t('helperDashboard.selectedProNoPay')}</p><button onClick={()=>createCheckout('pro')} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">{t('helperDashboard.completeUpgrade')}</button></>)
                :(<><p className="text-lg font-bold text-gray-400 mb-1">{t('helperDashboard.free')}</p><p className="text-xs text-gray-500 mb-3">{t('helperDashboard.upgradeHint')}</p><button onClick={()=>{ try{window.gtag&&window.gtag('event','upgrade_clicked',{from_tier:'free',source:'helper_dashboard'});}catch(_){} navigate('/upgrade');}} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">{t('helperDashboard.upgradeToPro')}</button></>)}
              </Card>
              <Card>
                <div className="flex items-center gap-2 mb-3"><IcoShield size={16} cls="text-orange-400"/><span className="text-sm font-semibold">{t('helperDashboard.backgroundCheck')}</span></div>
                {verification.backgroundCheck?<Tag text={verification.backgroundCheck.status} color={verification.backgroundCheck.status==='passed'?'green':'orange'}/>
                :(<><p className="text-xs text-gray-500 mb-3">{t('helperDashboard.bgCheckHint')} Available on every account, with or without Pro.</p><button onClick={startBackgroundCheck} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">{t('helperDashboard.startCheck')}</button></>)}
              </Card>
                <Card>
                  <div className="flex items-center gap-2 mb-3"><IcoId size={16} cls="text-orange-400"/><span className="text-sm font-semibold">{t('helperDashboard.idVerification')}</span></div>
                  {isIdVerified
                    ? <Tag text={idVerificationStatusLabel} color="green"/>
                    : (<><p className="text-xs text-gray-500 mb-3">{t('helperDashboard.idVerificationHint')} Available on every account, with or without Pro.</p><button onClick={startIdentityVerification} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">{t('helperDashboard.verifyId')}</button></>)}
                </Card>
              </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
              {[{to:'/jobs',Ic:IcoBriefcase,l:t('helperDashboard.findJobs'),c:'text-orange-400'},{to:'/my-bids',Ic:IcoCheck,l:t('helperDashboard.myBids',{defaultValue:'My Bids'}),c:'text-yellow-400',badge:myBids.filter(b=>b.status==='pending').length||0},{to:'/calendar',Ic:IcoCalendar,l:t('nav.calendar'),c:'text-emerald-400'},{to:'/helper/messages',Ic:IcoChat,l:t('nav.messages'),c:'text-blue-400',badge:unreadMessages},{to:'/tool-rentals',Ic:IcoSearch,l:t('toolRentals.browsePage'),c:'text-indigo-400'},{to:'/disputes',Ic:IcoShield,l:t('helperDashboard.disputes'),c:'text-purple-400'},{to:'/settings',Ic:IcoSettings,l:t('nav.settings'),c:'text-gray-400'},{to:'/templates?type=helper',Ic:IcoFileText,l:t('helperDashboard.templates'),c:'text-pink-400'}].map((a,i)=>(
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
              <CardHeader icon={IcoZap} title={t('helperDashboard.jobsNearYou')} right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">{t('common.viewAll')} →</Link>}/>
              {nearbyJobs.length===0
                ? <p className="text-gray-500 text-sm text-center py-6">{t('helperDashboard.noNearbyJobs')} <Link to="/jobs" className="text-orange-400 hover:text-orange-300">{t('helperDashboard.browseAllJobs')}</Link>.</p>
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
                <CardHeader icon={IcoUsers} title={t('dashboard.community.title')} right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">{t('dashboard.community.browseJobs')}</Link>}/>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-orange-400">{life.community.jobs_this_week}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.jobsThisWeek')}</p></div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-emerald-400">{life.community.open_jobs}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.openNow')}</p></div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-blue-400">{life.community.active_helpers}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.activeHelpers')}</p></div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl"><p className="text-xl font-bold text-purple-400">{life.community.active_seekers}</p><p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.seekersThisWeek')}</p></div>
                </div>
                {life.community.top_categories?.length > 0 && (
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">{t('dashboard.community.trending')}</span>
                    {life.community.top_categories.slice(0,3).map((c,i) => <Tag key={i} text={`${c.category_name} (${c.job_count})`} color={['orange','green','blue'][i]}/>)}
                  </div>
                )}
              </Card>
            )}

            {/* Pro upgrade CTA */}
            {!hasProAccess && (
              <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div><div className="flex items-center gap-2 mb-1"><IcoZap size={18} cls="text-orange-400"/><h3 className="text-lg font-bold text-white">{t('helperDashboard.upgradeToPro')}</h3></div><p className="text-sm text-gray-400">{t('helperDashboard.upgradeProDesc')}</p></div>
                <button onClick={()=>navigate('/upgrade')} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition whitespace-nowrap text-sm">{t('helperDashboard.viewPlans')}</button>
              </div>
            )}
          </>)}
        </>)}

        {/* ═══════ EDIT PROFILE ═══════ */}
        {tab==='editprofile'&&<EditProfileTab />}

        {tab==='availability' && (
          <div className="max-w-2xl">
            <HelperAvailabilityEditor />
          </div>
        )}

        {tab==='aiKnowledge'&& user?.id && (
          <div className="max-w-4xl">
            <AIKnowledgeTab profileType="helper" profileId={user.id} />
          </div>
        )}

        {/* ═══════ EARNINGS ═══════ */}
        {tab==='earnings'&&(<>
          <Card className="mb-6">
            <CardHeader icon={IcoDollar} title={`${new Date().toLocaleString('en-US',{month:'long'})} ${new Date().getFullYear()}`} right={<Btn onClick={()=>setShowExpenseModal(true)}>{t('dashboard.money.logTransaction')}</Btn>}/>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.income')}</p><p className="text-xl font-bold text-emerald-400">${(life.expenseSummary?.total_income||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.expenses')}</p><p className="text-xl font-bold text-red-400">${(life.expenseSummary?.total_expenses||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.net')}</p><p className={`text-xl font-bold ${(life.expenseSummary?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(life.expenseSummary?.net||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.savingsRate')}</p>
                {(life.expenseSummary?.total_income||0) > 0
                  ? <p className={`text-xl font-bold ${((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=20?'text-emerald-400':((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=0?'text-yellow-400':'text-red-400'}`}>{Math.round((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)}%</p>
                  : <p className="text-xl font-bold text-gray-600">-</p>
                }
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon={IcoDollar} title={t('dashboard.money.recentTransactions')}/>
              {(life.expenses || []).length===0?<p className="text-gray-600 text-sm text-center py-8">{t('dashboard.money.noTransactions')}</p>
              :(<div className="space-y-1 max-h-80 overflow-y-auto">{(life.expenses || []).slice(0,15).map(e=>(
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
                    <button onClick={async()=>{await life.deleteExpense(e.id);life.fetchSummary();life.fetchExpenses();toast.success(t('helperDashboard.deleted'));}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                  </div>
                </div>
              ))}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoTarget} title={t('dashboard.money.budgets')} right={<Btn variant="secondary" onClick={()=>setShowBudgetModal(true)}>{t('dashboard.money.addBudget')}</Btn>}/>
              {(life.budgets || []).length===0?<p className="text-gray-600 text-sm text-center py-8">{t('dashboard.money.noBudgets')}</p>
              :(<div className="space-y-4">{(life.budgets || []).map(b=>{const spent=parseFloat(b.spent||0);const lim=parseFloat(b.monthly_limit);const pct=lim>0?(spent/lim)*100:0;const periodLabel=b.period&&b.period!=='monthly'?` /mo (${b.period.replace('_','-')})`:'/mo';return(<div key={b.id}><div className="flex justify-between text-sm mb-1"><span className="font-medium text-white">{b.category}</span><span className="text-gray-500">${spent.toFixed(0)} / ${lim.toFixed(0)}{periodLabel}</span></div><ProgressBar pct={pct} color={pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-emerald-500'}/></div>);})}</div>)}
            </Card>
          </div>
        </>)}

        {/* ═══════ FIND JOBS ═══════ */}
        {tab==='jobs'&&(
          <div>
            <div className="flex items-center justify-between mb-5"><h3 className="font-semibold text-white text-lg">{t('helperDashboard.availableJobsTitle')}</h3><Link to="/jobs" className="text-sm text-orange-400 font-medium">{t('helperDashboard.advancedSearch')}</Link></div>
            {nearbyJobs.length===0?<Card className="p-16 text-center"><IcoMap size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500">{t('helperDashboard.noJobsAvailable')}</p></Card>
            :<div className="space-y-2">{nearbyJobs.map(job=>(
              <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                <div className="min-w-0 flex-1 mr-4"><div className="flex items-center gap-2 mb-1"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{job.title}</p>{job.is_urgent&&<Tag text={t('jobDetail.urgencyASAP')} color="red"/>}</div><p className="text-xs text-gray-500 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.bid_count>0?` · ${job.bid_count} bids`:''}</p></div>
                <div className="flex items-center gap-3 flex-shrink-0">{(job.budget_min||job.budget_max)&&<span className="text-base font-bold text-emerald-400">${job.budget_min||'?'}–${job.budget_max||'?'}</span>}<span className="text-xs bg-orange-500/15 text-orange-400 px-3 py-1.5 rounded-lg font-semibold">{t('helperDashboard.viewJobBtn')}</span></div>
              </Link>
            ))}</div>}
          </div>
        )}

        {/* ═══════ AFFILIATE CTA (earnings tab) ═══════ */}
        {tab==='earnings'&&(
          <Link to="/affiliate" className="block mb-4 bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 hover:bg-orange-500/15 transition group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-400 font-semibold text-sm mb-0.5">Affiliate earnings dashboard</p>
                <p className="text-gray-400 text-xs">Track commissions, conversion funnel, top products, and request payouts</p>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-orange-400 group-hover:translate-x-0.5 transition-transform"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </div>
          </Link>
        )}

        {/* ═══════ MONEY ═══════ */}
        {tab==='money'&&(<>
          {/* Monthly summary */}
          <Card className="mb-6">
            <CardHeader icon={IcoDollar} title={`${new Date().toLocaleString('en-US',{month:'long'})} ${new Date().getFullYear()}`} right={<Btn onClick={()=>setShowExpenseModal(true)}>{t('dashboard.money.logTransaction')}</Btn>}/>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.income')}</p><p className="text-xl font-bold text-emerald-400">${(life.expenseSummary?.total_income||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.expenses')}</p><p className="text-xl font-bold text-red-400">${(life.expenseSummary?.total_expenses||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.net')}</p><p className={`text-xl font-bold ${(life.expenseSummary?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>${(life.expenseSummary?.net||0).toFixed(2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.savingsRate')}</p>
                {(life.expenseSummary?.total_income||0)>0
                  ?<p className={`text-xl font-bold ${((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=20?'text-emerald-400':((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)>=0?'text-yellow-400':'text-red-400'}`}>{Math.round((life.expenseSummary?.net||0)/(life.expenseSummary?.total_income||1)*100)}%</p>
                  :<p className="text-xl font-bold text-gray-600">-</p>
                }
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Recent transactions */}
            <Card>
              <CardHeader icon={IcoDollar} title={t('dashboard.money.recentTransactions')}/>
              {life.expenses.length===0?(
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.money.noTransactions')}</p>
              ):(
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {(life.expenses || []).slice(0,15).map(e=>(
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
                        <button onClick={async()=>{await life.deleteExpense(e.id);life.fetchSummary();life.fetchExpenses();toast.success(t('helperDashboard.deleted'));}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Budgets */}
            <Card>
              <CardHeader icon={IcoTarget} title={t('dashboard.money.budgets')} right={<Btn variant="secondary" onClick={()=>setShowBudgetModal(true)}>{t('dashboard.money.addBudget')}</Btn>}/>
              {(life.budgets || []).length===0?(
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.money.noBudgets')}</p>
              ):(
                <div className="space-y-4">
                  {(life.budgets || []).map(b=>{
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
            <CardHeader icon={IcoClock} title={t('dashboard.money.sinkingFunds')} right={
              <Link to="/planned-needs" className="text-xs text-orange-400 hover:text-orange-300 font-medium">{t('dashboard.plannedNeeds.manage')}</Link>
            }/>
            {moneyPlannedNeeds.length===0?(
              <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl">
                <p className="text-sm text-gray-500">{t('dashboard.plannedNeeds.noPlannedNeeds')}</p>
                <Link to="/planned-needs" className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap ml-3">{t('dashboard.plannedNeeds.addOne')}</Link>
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
            <CardHeader icon={IcoHome} title={t('dashboard.home.myProperties')}
              right={<span className="text-[10px] text-gray-600">Census · OSM · FEMA</span>}/>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder={t('dashboard.home.addrPlaceholder')}
                value={homeAddrInput}
                onChange={e=>{setHomeAddrInput(e.target.value);setHomeLookup(null);setHomeLookupError('');}}
                onKeyDown={e=>e.key==='Enter'&&!homeLookupLoading&&homeAddrInput.length>5&&lookupHomeAddress()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              />
              <button onClick={lookupHomeAddress}
                disabled={homeLookupLoading||homeAddrInput.trim().length<5}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                {homeLookupLoading?t('dashboard.home.lookingUp'):t('dashboard.home.lookUp')}
              </button>
            </div>

            {homeLookupError&&<p className="text-xs text-red-400 mb-2">{homeLookupError}</p>}

            {homeLookup&&(
              <div className="bg-gray-800/80 border border-orange-500/30 rounded-xl p-3 mb-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-white leading-tight">{homeLookup.matchedAddress}</p>
                  <span className="text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">{t('dashboard.home.censusVerified')}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
                  {homeLookup.building?.yearBuilt  &&<span>🏠 Built {homeLookup.building.yearBuilt}</span>}
                  {homeLookup.building?.levels      &&<span>📐 {homeLookup.building.levels} {parseInt(homeLookup.building.levels)===1?'story':'stories'}</span>}
                  {homeLookup.building?.roofShape   &&<span>🔺 {homeLookup.building.roofShape} roof</span>}
                  {homeLookup.building?.buildingType&&<span>🏗️ {homeLookup.building.buildingType}</span>}
                  {homeLookup.flood&&(
                    <span className={homeLookup.flood.zone&&['A','AE','V','VE','AH','AO'].includes(homeLookup.flood.zone)?'text-red-400 font-semibold':'text-emerald-400'}>
                      💧 {homeLookup.flood.label || t('dashboard.home.floodZone', { zone: homeLookup.flood.zone })}
                    </span>
                  )}
                  {!homeLookup.building&&!homeLookup.flood&&(
                    <span className="text-gray-600">{t('dashboard.home.noOsmData')}</span>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <input type="text" placeholder={t('dashboard.home.nicknamePlaceholder')}
                    value={homeNickname} maxLength={80}
                    onChange={e=>setHomeNickname(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                  <button onClick={addHome} disabled={homeAdding}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">
                    {homeAdding?t('dashboard.carCare.saving'):t('dashboard.home.saveProperty')}
                  </button>
                </div>
              </div>
            )}

            {homes.length===0?(
              <p className="text-xs text-gray-600 text-center py-2">{t('dashboard.home.noProperties')}</p>
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
                <p className="text-sm text-red-300">{t('dashboard.home.removeConfirm', { name: homeDeleteTarget.nickname||homeDeleteTarget.address })}</p>
                <div className="flex gap-2">
                  <button onClick={()=>setHomeDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white transition px-2 py-1 rounded-lg">{t('common.cancel')}</button>
                  <button onClick={()=>deleteHome(homeDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">{t('common.remove')}</button>
                </div>
              </div>
            )}
          </Card>

          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card className="!p-3 text-center">
              <p className={`text-2xl font-bold ${(s?.home?.overdue||0)>0?'text-red-400':'text-emerald-400'}`}>{s?.home?.overdue||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{t('common.overdue')}</p>
            </Card>
            <Card className="!p-3 text-center">
              <p className="text-2xl font-bold text-orange-400">{s?.home?.due_this_week||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{t('dashboard.summary.dueThisWeek_one', { count: '' }).trim()}</p>
            </Card>
            <Card className="!p-3 text-center">
              <p className="text-2xl font-bold text-gray-300">{s?.home?.total_pending||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{t('dashboard.summary.totalPending')}</p>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Home maintenance tasks */}
            <Card>
              <CardHeader icon={IcoHome} title={t('dashboard.home.maintenance')} right={<Btn onClick={()=>setShowHomeTaskModal(true)}>{t('dashboard.home.addTask')}</Btn>}/>
              {(life.homeTasks || []).length===0?(
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.home.noTasks')}</p>
              ):(
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {(life.homeTasks || []).map(task=>{
                    const overdue=task.due_date&&new Date(task.due_date)<new Date()&&!task.is_completed;
                    return(
                      <div key={task.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${task.is_completed?'opacity-40 border-gray-800':overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>toggleHomeTask(task)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${task.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {task.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${task.is_completed?'line-through text-gray-600':'text-white'}`}>{task.title}</p>
                          <p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-600'}`}>
                            {task.due_date?(overdue?'Overdue · ':'')+new Date(task.due_date).toLocaleDateString():'No due date'}
                            {task.recurrence_days?` · Every ${task.recurrence_days}d`:''}
                            {task.home_name?` · ${task.home_name}`:''}
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
              <CardHeader icon={IcoUsers} title={t('dashboard.home.savedHelpers')} right={<Link to="/helpers" className="text-xs text-orange-400 font-medium">{t('helperDashboard.browseCTA')}</Link>}/>
              {(life.savedHelpers || []).length===0?(
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.home.noSavedHelpers')}</p>
              ):(
                <div className="space-y-2">
                  {(life.savedHelpers || []).map(h=>(
                    <div key={h.id} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-xl group">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/30 to-purple-500/30 flex items-center justify-center font-bold text-sm flex-shrink-0">{(h.first_name||'?')[0]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{h.display_name || h.first_name}</p>
                        <p className="text-xs text-gray-500 truncate">{h.categories || t('dashboard.home.savedHelperFallback')} · {h.avg_rating?`${h.avg_rating}★`:t('dashboard.home.newHelper')} · {h.completed_jobs||0} {t('dashboard.home.jobsLabel')}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Link to={`/helpers/${h.helper_id}`} className="text-xs text-orange-400 font-medium">View</Link>
                        <button onClick={async()=>{await life.removeSavedHelper(h.id);toast.success(t('helperDashboard.removed'));}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={13} cls="text-gray-600 hover:text-red-400"/></button>
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
              <CardHeader icon={IcoTarget} title={t('dashboard.goals.title')} right={<Btn onClick={()=>setShowGoalModal(true)}>{t('dashboard.goals.newGoal')}</Btn>}/>
              {(life.goals || []).length===0?<p className="text-gray-600 text-sm text-center py-8">{t('dashboard.goals.noGoals')}</p>
              :(<div className="space-y-4 max-h-96 overflow-y-auto">{(life.goals || []).map(g=>{const pct=g.target_value>0?Math.min((parseFloat(g.current_value)/parseFloat(g.target_value))*100,100):0;return(
                <div key={g.id} className={`p-4 border rounded-xl ${g.is_completed?'border-emerald-500/30 bg-emerald-500/5 opacity-60':'border-gray-800'}`}>
                  <div className="flex items-center gap-2 mb-2"><span className="text-lg">{g.icon||'🎯'}</span><span className="font-semibold text-sm text-white flex-1">{g.title}</span>{g.is_completed?<Tag text="Done" color="green"/>:<span className="text-sm font-bold text-orange-400">{Math.round(pct)}%</span>}</div>
                  {g.target_value>0&&!g.is_completed&&(<><ProgressBar pct={pct} color="bg-orange-500"/><div className="flex justify-between items-center mt-2"><span className="text-xs text-gray-500">${parseFloat(g.current_value).toLocaleString()} of ${parseFloat(g.target_value).toLocaleString()}</span>
                    {/* Uses proper modal instead of window.prompt */}
                    <button onClick={()=>{setUpdatingGoal(g);setGoalUpdateValue(g.current_value||'');setShowGoalUpdateModal(true);}} className="text-[10px] text-orange-400 font-semibold">{t('dashboard.goals.updateProgress')}</button>
                  </div></>)}
                </div>
              );})}</div>)}
            </Card>
            <Card>
              <CardHeader icon={IcoCheck} title={t('dashboard.goals.checklist')} right={<Btn onClick={()=>setShowChecklistModal(true)}>{t('common.add')}</Btn>}/>
              <p className="text-xs text-gray-600 mb-3">{t('dashboard.goals.completedOf', { completed: (life.checklist || []).filter(i=>i.is_completed).length, total: (life.checklist || []).length })}</p>
              {(life.checklist || []).length===0?<p className="text-gray-600 text-sm text-center py-8">{t('dashboard.goals.noChecklist')}</p>
              :(<div className="space-y-1.5 max-h-96 overflow-y-auto">{(life.checklist || []).map(item=>(
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition group">
                  <button onClick={()=>toggleChecklist(item)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${item.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{item.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                  <div className="flex-1 min-w-0"><p className={`text-sm ${item.is_completed?'line-through text-gray-600':'text-white'}`}>{item.title}</p>{item.due_date&&<p className={`text-xs mt-0.5 ${new Date(item.due_date)<new Date()&&!item.is_completed?'text-red-400':'text-gray-600'}`}>{new Date(item.due_date).toLocaleDateString()}</p>}</div>
                  <button onClick={async()=>{await life.deleteChecklistItem(item.id);life.fetchSummary();toast.success(t('helperDashboard.removed'));}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                </div>
              ))}</div>)}
            </Card>
          </div>
        </>)}

        {/* ═══════ PERSONAL CARE ═══════ */}
        {tab==='personalcare'&&(
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold text-white text-lg">{t('dashboard.personalCare.title')}</h3><p className="text-xs text-gray-500 mt-0.5">{t('helperDashboard.personalCareDesc')}</p></div>
              <Btn onClick={()=>setShowPcModal(true)}>{t('dashboard.personalCare.addAppointment')}</Btn>
            </div>
            {/* Quick-add templates */}
            <div>
              <p className="text-xs text-gray-600 mb-2">{t('dashboard.personalCare.quickAdd')}:</p>
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
            :personalCareTasks.length===0?<Card className="p-12 text-center"><IcoHeart size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500">{t('dashboard.personalCare.noAppointments')}</p></Card>
            :<div className="space-y-2">{personalCareTasks.map(task=>{const overdue=task.due_date&&new Date(task.due_date)<new Date()&&!task.is_completed;return(
              <div key={task.id} className={`flex items-center gap-3 p-4 border rounded-2xl transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                <button onClick={()=>togglePcTask(task)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${task.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{task.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                <div className="flex-1 min-w-0"><p className={`text-sm font-medium ${task.is_completed?'line-through text-gray-600':'text-white'}`}>{task.title}</p><p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-500'}`}>{task.description}{task.due_date?` · ${overdue?'Overdue · ':''}${new Date(task.due_date).toLocaleDateString()}`:''}{task.recurrence_days?` · Every ${task.recurrence_days}d`:''}{task.estimated_cost?` · $${parseFloat(task.estimated_cost).toFixed(0)} est.`:''}{task.home_name?` · ${task.home_name}`:''}</p></div>
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
              <CardHeader icon={IcoCar} title={t('dashboard.carCare.myGarage')} right={<span className="text-[10px] text-gray-600">{t('dashboard.carCare.nhtsaData')}</span>}/>
              <div className="flex gap-2 mb-4">
                {['search','vin'].map(m=><button key={m} onClick={()=>setGarageMode(m)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${garageMode===m?'bg-orange-500 text-white':'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>{m==='search'?t('dashboard.carCare.garageModeSummary'):t('dashboard.carCare.garageModeVin')}</button>)}
              </div>
              {garageMode==='search'?(
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                      <input placeholder={t('dashboard.carCare.makePlaceholder')} value={garageForm.makeSearch}
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
                      <input placeholder={t('dashboard.carCare.modelPlaceholder')} value={garageForm.modelSearch} disabled={!garageForm.selectedMake}
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
                    <input type="number" placeholder={t('dashboard.carCare.yearOptional')} min="1900" max={new Date().getFullYear()+1} value={garageForm.year} onChange={e=>setGarageForm(p=>({...p,year:e.target.value}))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                    <input placeholder={t('dashboard.carCare.nickname')} value={garageForm.nickname} onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                    <button onClick={addToGarage} disabled={!garageForm.selectedMake||!garageForm.selectedModel||garageAdding} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">{garageAdding?t('dashboard.carCare.adding'):t('dashboard.carCare.addToGarageShort')}</button>
                  </div>
                </div>
              ):(
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input placeholder={t('dashboard.carCare.vinPlaceholder')} value={vinInput} onChange={e=>setVinInput(e.target.value)} maxLength={17} className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                    <button onClick={decodeVin} disabled={vinDecoding||vinInput.trim().length!==17} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">{vinDecoding?t('dashboard.carCare.decoding'):t('dashboard.carCare.decode')}</button>
                  </div>
                  {vinError&&<p className="text-xs text-red-400">{vinError}</p>}
                  {vinResult&&(
                    <div className="bg-gray-800/80 border border-orange-500/30 rounded-xl p-3 space-y-2">
                      <p className="text-sm font-semibold text-white">{vinResult.year} {vinResult.make} {vinResult.model}</p>
                      <div className="flex gap-2">
                        <input placeholder={t('dashboard.carCare.nickname')} value={garageForm.nickname} onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))} className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                        <button onClick={addVinVehicle} disabled={garageAdding} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">{garageAdding?t('dashboard.carCare.adding'):t('dashboard.carCare.addVinSave')}</button>
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
                  <p className="text-sm text-red-300">{t('dashboard.carCare.removeConfirm',{name:garageDeleteTarget.nickname||`${garageDeleteTarget.make_name} ${garageDeleteTarget.model_name}`})}</p>
                  <div className="flex gap-2">
                    <button onClick={()=>setGarageDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg transition">{t('dashboard.carCare.keepIt')}</button>
                    <button onClick={()=>deleteFromGarage(garageDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">{t('dashboard.carCare.removeBtn')}</button>
                  </div>
                </div>
              )}
            </Card>

            {/* Car Care Tasks */}
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold text-white text-lg">{t('dashboard.carCare.scheduleTitle')}</h3><p className="text-xs text-gray-500 mt-0.5">{t('dashboard.carCare.scheduleSub')}</p></div>
              <Btn onClick={()=>setShowCcModal(true)}>+ Add Service</Btn>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-2">{t('dashboard.carCare.quickAddLabel')}</p>
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
            :carCareTasks.length===0?<Card className="p-12 text-center"><IcoCar size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500">{t('dashboard.carCare.noTasksYet')}</p></Card>
            :<div className="space-y-2">{carCareTasks.map(task=>{const overdue=task.due_date&&new Date(task.due_date)<new Date()&&!task.is_completed;return(
              <div key={task.id} className={`flex items-center gap-3 p-4 border rounded-2xl transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                <button onClick={()=>toggleCcTask(task)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${task.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>{task.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}</button>
                <div className="flex-1 min-w-0"><p className={`text-sm font-medium ${task.is_completed?'line-through text-gray-600':'text-white'}`}>{task.title}</p><p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-500'}`}>{task.description}{task.due_date?` · ${overdue?'Overdue · ':''}${new Date(task.due_date).toLocaleDateString()}`:''}{task.recurrence_days?` · Every ${task.recurrence_days}d`:''}{task.estimated_cost?` · $${parseFloat(task.estimated_cost).toFixed(0)} est.`:''}{task.vehicle_name?` · ${task.vehicle_name}`:''}{task.home_name?` · ${task.home_name}`:''}</p></div>
                <div className="flex items-center gap-2"><Tag text={task.urgency} color={task.urgency==='high'?'red':task.urgency==='medium'?'orange':'gray'}/><button onClick={()=>deleteCcTask(task.id)} className="opacity-0 hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button></div>
              </div>
            );})}</div>}
          </div>
        )}

        {/* ═══════ SKILLS & TOOLS ═══════ */}
        {tab==='skills' && (
          <div className="space-y-8">
            <div className="flex justify-end">
              <button onClick={()=>navigate(`/helpers/${user?.id}`)} className="text-sm text-orange-400 hover:text-orange-300 underline underline-offset-2 transition">{t('helperDashboard.viewPublicProfile')}</button>
            </div>
            {/* My Skills */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="font-semibold text-white text-lg">{t('dashboard.skillsTools.skillsTitle')}</h3><p className="text-xs text-gray-500 mt-0.5">{t('dashboard.skillsTools.skillsSub')}</p></div>
                <Btn onClick={openAddSkill}>{t('dashboard.skillsTools.addSkill')}</Btn>
              </div>
              {skillsLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              :mySkills.length===0?<p className="text-gray-600 text-sm text-center py-8">{t('dashboard.skillsTools.noSkills')}</p>
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
                      <Tag text={sk.is_available?t('dashboard.skillsTools.available'):t('dashboard.skillsTools.unavailable')} color={sk.is_available?'green':'gray'}/>
                      <div className="flex gap-1 justify-end mt-1">
                        <button onClick={()=>openEditSkill(sk)} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">{t('common.edit')}</button>
                        <button onClick={()=>handleDeleteSkill(sk.id)} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">{t('helperDashboard.delete')}</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}</div>}
            </div>

            {/* Tools for Rent */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="font-semibold text-white text-lg">{t('dashboard.skillsTools.toolsForRentTitle')}</h3><p className="text-xs text-gray-500 mt-0.5">{t('dashboard.skillsTools.toolsForRentSub')}</p></div>
                <Btn onClick={openAddTool}>{t('dashboard.skillsTools.listToolBtn')}</Btn>
              </div>
              {toolsLoading?<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              :myTools.length===0?<p className="text-gray-600 text-sm text-center py-8">{t('dashboard.skillsTools.noTools')}</p>
              :<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{myTools.map(tool=>(
                <div key={tool.id} className="p-4 border border-gray-800 rounded-xl">
                  <div className="flex items-start justify-between gap-2">
                    {tool.image_url&&<img src={tool.image_url} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-800 flex-shrink-0"/>}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-white truncate">{tool.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{tool.category}{tool.brand?` · ${tool.brand}`:''}{tool.model?` ${tool.model}`:''}</p>
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {tool.daily_rate&&<span className="text-xs text-orange-400 font-semibold">${parseFloat(tool.daily_rate).toFixed(0)}/day</span>}
                        {tool.hourly_rate&&<span className="text-xs text-gray-400">${parseFloat(tool.hourly_rate).toFixed(0)}/hr</span>}
                        {tool.deposit_amount&&<span className="text-xs text-gray-500">Deposit ${parseFloat(tool.deposit_amount).toFixed(0)}</span>}
                      </div>
                      {tool.condition&&<p className="text-xs text-gray-600 mt-1 capitalize">{t('dashboard.skillsTools.conditionPrefix')} {tool.condition}</p>}
                      {(tool.location_city||tool.location_state)&&<p className="text-xs text-gray-600 mt-0.5">{[tool.location_city,tool.location_state].filter(Boolean).join(', ')}</p>}
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {tool.delivery_available&&<span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full font-semibold">{t('dashboard.skillsTools.delivery')}</span>}
                        {tool.requires_deposit&&<span className="text-[10px] bg-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded-full font-semibold">{t('dashboard.skillsTools.depositRequired')}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Tag text={tool.is_available?t('dashboard.skillsTools.available'):t('dashboard.skillsTools.unavailable')} color={tool.is_available?'green':'gray'}/>
                      <div className="flex gap-1 justify-end mt-1">
                        {tool.is_available&&<button onClick={()=>navigate(`/tool-rentals/${tool.id}`)} className="text-xs text-orange-400 hover:text-orange-300 transition px-2 py-1 rounded hover:bg-orange-500/10">{t('common.view')}</button>}
                        <button onClick={()=>openEditTool(tool)} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">{t('common.edit')}</button>
                        <button onClick={()=>handleDeleteTool(tool.id)} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">{t('helperDashboard.delete')}</button>
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
                <h3 className="font-semibold text-white text-lg">{t('dashboard.products.titleHelper')}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{t('dashboard.products.subHelper')}</p>
              </div>
              <Btn onClick={openAddProduct}>{t('dashboard.products.listProductBtn')}</Btn>
            </div>
            {productsLoading
              ? <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              : myProducts.length === 0
                ? <Card className="p-16 text-center"><p className="text-gray-500 mb-4">{t('dashboard.products.noProducts')}</p><Btn onClick={openAddProduct}>{t('dashboard.products.listProductTitle')}</Btn></Card>
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
                            >{p.is_available ? t('dashboard.skillsTools.available') : t('dashboard.skillsTools.unavailable')}</button>
                            <div className="flex gap-1 justify-end mt-1">
                              <button onClick={() => openEditProduct(p)} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">{t('common.edit')}</button>
                              <button onClick={() => handleDeleteProduct(p.id)} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">{t('helperDashboard.delete')}</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
            }
          </div>
        )}

        {/* ═══════ INVOICES ═══════ */}
        {tab==='invoices'&&(
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-white text-lg">{t('helperDashboard.invoices.title')}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{t('helperDashboard.invoices.subtitle')}</p>
              </div>
              <Btn onClick={openAddInvoice}>{t('helperDashboard.invoices.createNew')}</Btn>
            </div>
            {invoicesLoading
              ? <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"/></div>
              : myInvoices.length === 0
                ? <Card className="p-16 text-center"><p className="text-gray-500 mb-4">{t('helperDashboard.invoices.none')}</p><Btn onClick={openAddInvoice}>{t('helperDashboard.invoices.createNew')}</Btn></Card>
                : <div className="space-y-3">
                    {myInvoices.map(inv => (
                      <div key={inv.id} className="p-4 border border-gray-800 rounded-xl">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-white">#{inv.invoice_number}</p>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                inv.status === 'draft' ? 'bg-gray-700/40 text-gray-400' :
                                inv.status === 'sent' ? 'bg-blue-500/15 text-blue-400' :
                                inv.status === 'paid' ? 'bg-emerald-500/15 text-emerald-400' :
                                'bg-orange-500/15 text-orange-400'
                              }`}>{inv.status}</span>
                            </div>
                            <p className="text-sm text-gray-400 mb-2">{inv.client_name} • {inv.client_email}</p>
                            <p className="text-xs text-gray-500">{inv.line_items?.length || 0} items • Total: <span className="text-orange-400 font-semibold">${(inv.total_cents / 100).toFixed(2)}</span></p>
                            {inv.due_date && <p className="text-xs text-gray-600 mt-1">Due: {new Date(inv.due_date).toLocaleDateString()}</p>}
                          </div>
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            {inv.status === 'draft' && (
                              <button
                                onClick={() => handleSendInvoice(inv.id)}
                                disabled={sendingInvoiceId === inv.id}
                                className="text-xs bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded-lg transition whitespace-nowrap"
                              >
                                {sendingInvoiceId === inv.id ? 'Sending...' : t('helperDashboard.invoices.send')}
                              </button>
                            )}
                            <div className="flex gap-1 justify-end">
                              {inv.status === 'draft' && (
                                <button onClick={() => openEditInvoice(inv)} className="text-xs text-gray-500 hover:text-white transition px-2 py-1 rounded hover:bg-gray-800">{t('common.edit')}</button>
                              )}
                              <button onClick={() => window.open(`/invoice/p/${inv.public_token}`, '_blank', 'noopener,noreferrer')} className="text-xs text-blue-500 hover:text-blue-400 transition px-2 py-1 rounded hover:bg-blue-500/10">{t('common.view')}</button>
                              <button onClick={() => handleDeleteInvoice(inv.id)} className="text-xs text-red-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-500/10">{t('helperDashboard.delete')}</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
            }
          </div>
        )}

        {/* ═══════ MY REVIEWS ═══════ */}
        {tab==='reviews'&&(
          <div>
            <h3 className="font-semibold text-white text-lg mb-5">{t('helperDashboard.tabs.reviews')}</h3>
            <ReviewsList userId={user?.id} />
          </div>
        )}

        {/* ═══════ MY BIDS ═══════ */}
        {tab==='bids'&&(
          <div>
            <div className="flex items-center justify-between mb-5"><h3 className="font-semibold text-white text-lg">{t('helperDashboard.myBids')}</h3><div className="flex gap-2"><Tag text={t('helperDashboard.activeBidsCount',{count:activeBids.length})} color="orange"/><Tag text={t('helperDashboard.wonBidsCount',{count:wonBids.length})} color="green"/></div></div>
            {myBids.length===0?<Card className="p-16 text-center"><IcoTarget size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500 mb-4">{t('helperDashboard.noBidsYet')}</p><Link to="/jobs" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm inline-block">{t('helperDashboard.browseJobs')}</Link></Card>
            :<div className="space-y-2">{myBids.map(bid=>(
              <Link key={bid.id} to={`/jobs/${bid.job_id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                <div className="min-w-0 flex-1 mr-4"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{bid.job_title || t('helperDashboard.jobNumber', { id: bid.job_id })}</p><p className="text-xs text-gray-500 mt-1">Bid <span className="text-white font-semibold">${bid.amount}</span>{bid.created_at?` · ${new Date(bid.created_at).toLocaleDateString()}`:''}</p></div>
                <Tag text={bid.status.replace(/_/g,' ')} color={bid.status==='accepted'?'green':bid.status==='pending'?'orange':bid.status==='rejected'?'red':'gray'}/>
              </Link>
            ))}</div>}
          </div>
        )}

      </main>

      {/* ════════════════════ MODALS ════════════════════ */}

      {/* Log Transaction - with recurring support */}
      <Modal open={showExpenseModal} onClose={()=>setShowExpenseModal(false)} title={t('dashboard.money.modalLogTransaction')}>
        <form onSubmit={handleAddExpense} className="space-y-4">
          <Select label={t('dashboard.money.typeLabel')} value={expenseForm.type} onChange={e=>setExpenseForm(p=>({...p,type:e.target.value}))}>
            <option value="expense">{t('dashboard.money.expenseOption')}</option><option value="income">{t('dashboard.money.incomeOption')}</option>
          </Select>
          <Input label={t('dashboard.money.amountLabel')} type="number" step="0.01" min="0.01" required placeholder="0.00" value={expenseForm.amount} onChange={e=>setExpenseForm(p=>({...p,amount:e.target.value}))}/>
          <Input label={t('dashboard.money.categoryLabel')} required placeholder={t('dashboard.money.categoryPlaceholder')} value={expenseForm.category} onChange={e=>setExpenseForm(p=>({...p,category:e.target.value}))}/>
          <Input label={t('dashboard.money.descriptionOptLabel')} placeholder={t('dashboard.money.quickNotePlaceholder')} value={expenseForm.description} onChange={e=>setExpenseForm(p=>({...p,description:e.target.value}))}/>
          <Select label={t('dashboard.money.frequencyLabel')} value={expenseForm.frequency} onChange={e=>setExpenseForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!=='one_time'}))}>
            <option value="one_time">{t('dashboard.money.freqOneTime')}</option>
            <option value="daily">{t('dashboard.money.freqDaily')}</option>
            <option value="weekly">{t('dashboard.money.freqWeekly')}</option>
            <option value="bi_weekly">{t('dashboard.money.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.money.freqMonthly')}</option>
            <option value="quarterly">{t('dashboard.money.freqQuarterly')}</option>
            <option value="yearly">{t('dashboard.money.freqYearly')}</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.money.recurringLabel')}</label>
            <button type="button" onClick={()=>setExpenseForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&p.frequency==='one_time'?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${expenseForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${expenseForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{expenseForm.is_recurring?t('common.yes'):t('common.no')}</span>
          </div>
          {expenseForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('dashboard.money.startDateLabel')} type="date" value={expenseForm.recurring_start_date} onChange={e=>setExpenseForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label={t('dashboard.money.endDateLabel')} type="date" value={expenseForm.recurring_end_date} onChange={e=>setExpenseForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Btn className="w-full py-3" type="submit">{t('dashboard.money.saveTransaction')}</Btn>
        </form>
      </Modal>

      {/* New Goal */}
      <Modal open={showGoalModal} onClose={()=>setShowGoalModal(false)} title={t('dashboard.goals.modalNewGoal')}>
        <form onSubmit={handleAddGoal} className="space-y-4">
          <Input label={t('dashboard.goals.goalTitleLabel')} required placeholder={t('dashboard.goals.goalTitlePlaceholder')} value={goalForm.title} onChange={e=>setGoalForm(p=>({...p,title:e.target.value}))}/>
          <Select label={t('dashboard.goals.goalTypeLabel')} value={goalForm.goal_type} onChange={e=>setGoalForm(p=>({...p,goal_type:e.target.value}))}>
            <option value="financial">{t('dashboard.goals.goalTypeFinancial')}</option><option value="task">{t('dashboard.goals.goalTypeTask')}</option><option value="career">{t('dashboard.goals.goalTypeCareer')}</option>
          </Select>
          {goalForm.goal_type==='financial'&&<Input label={t('dashboard.goals.targetAmountLabel')} type="number" step="0.01" placeholder="1000" value={goalForm.target_value} onChange={e=>setGoalForm(p=>({...p,target_value:e.target.value}))}/>}
          <Input label={t('dashboard.goals.iconLabel')} placeholder="🎯" value={goalForm.icon} onChange={e=>setGoalForm(p=>({...p,icon:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">{t('dashboard.goals.createGoal')}</Btn>
        </form>
      </Modal>

      {/* Goal Update Modal - replaces window.prompt */}
      <Modal open={showGoalUpdateModal} onClose={()=>{setShowGoalUpdateModal(false);setUpdatingGoal(null);}} title={t('dashboard.goals.modalUpdateProgress')}>
        {updatingGoal&&(
          <form onSubmit={async(e)=>{e.preventDefault();await updateGoalProgress(updatingGoal,goalUpdateValue);setShowGoalUpdateModal(false);setUpdatingGoal(null);}} className="space-y-4">
            <p className="text-sm text-gray-400 bg-gray-800/50 px-3 py-2 rounded-lg">{updatingGoal.icon} {updatingGoal.title}</p>
            <Input label={t('dashboard.goals.currentAmountLabel')} type="number" step="0.01" min="0" required autoFocus value={goalUpdateValue} onChange={e=>setGoalUpdateValue(e.target.value)} placeholder={`Was: $${parseFloat(updatingGoal.current_value||0).toLocaleString()}`}/>
            {updatingGoal.target_value&&<p className="text-xs text-gray-500">{t('dashboard.goals.targetProgress',{target:parseFloat(updatingGoal.target_value).toLocaleString(),pct:Math.round(Math.min((parseFloat(goalUpdateValue||0)/parseFloat(updatingGoal.target_value))*100,100))})}</p>}
            <div className="flex gap-2">
              <Btn className="flex-1 py-3" type="submit">{t('dashboard.goals.saveProgress')}</Btn>
              <Btn variant="secondary" className="py-3" type="button" onClick={async()=>{await life.updateGoal(updatingGoal.id,{is_completed:true});life.fetchSummary();toast.success(t('dashboard.money.goalComplete'));setShowGoalUpdateModal(false);setUpdatingGoal(null);}}>{t('dashboard.goals.markDone')}</Btn>
            </div>
          </form>
        )}
      </Modal>

      {/* Product Modal */}
      <Modal open={showProductModal} onClose={()=>{setShowProductModal(false);setEditingProduct(null);setProductForm(emptyProduct);}} title={editingProduct ? t('dashboard.products.editProductTitle') : t('dashboard.products.listProductTitle')}>
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <Input label={t('dashboard.products.productNameLabel')} required placeholder={t('dashboard.products.productNamePlaceholder')} value={productForm.name} onChange={e=>setProductForm(p=>({...p,name:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.money.categoryLabel')}</label>
            <select value={productForm.category} onChange={e=>setProductForm(p=>({...p,category:e.target.value}))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500">
              {PRODUCT_CATEGORIES.map(c=><option key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
          </div>
          <Input label={t('dashboard.products.priceLabel')} type="number" step="0.01" min="0.01" required placeholder="0.00" value={productForm.price_cents} onChange={e=>setProductForm(p=>({...p,price_cents:e.target.value}))}/>
          <Input label={t('dashboard.products.descriptionOptLabel')} placeholder={t('dashboard.products.descriptionShortPlaceholder')} value={productForm.description} onChange={e=>setProductForm(p=>({...p,description:e.target.value}))}/>
          <Input label={t('dashboard.products.imageUrlOptLabel')} placeholder="https://..." value={productForm.image_url} onChange={e=>setProductForm(p=>({...p,image_url:e.target.value}))}/>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.products.availableNowLabel')}</label>
            <button type="button" onClick={()=>setProductForm(p=>({...p,is_available:!p.is_available}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${productForm.is_available?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${productForm.is_available?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{productForm.is_available?t('common.yes'):t('common.no')}</span>
          </div>
          <Btn className="w-full py-3" type="submit">{editingProduct ? t('dashboard.skillsTools.saveChanges') : t('dashboard.products.listProductSubmitBtn')}</Btn>
        </form>
      </Modal>
      {/* Home Task */}
      <Modal open={showHomeTaskModal} onClose={()=>setShowHomeTaskModal(false)} title={t('dashboard.goals.addHomeTaskModal')}>
        <form onSubmit={handleAddHomeTask} className="space-y-4">
          <Input label={t('dashboard.goals.taskLabel')} required placeholder={t('dashboard.goals.taskPlaceholder')} value={homeTaskForm.title} onChange={e=>setHomeTaskForm(p=>({...p,title:e.target.value}))}/>
          <Input label={t('dashboard.goals.dueDateLabel')} type="date" value={homeTaskForm.due_date} onChange={e=>setHomeTaskForm(p=>({...p,due_date:e.target.value}))}/>
          <Select label={t('dashboard.goals.urgencyLabel')} value={homeTaskForm.urgency} onChange={e=>setHomeTaskForm(p=>({...p,urgency:e.target.value}))}>
            <option value="low">{t('dashboard.goals.urgencyLow')}</option><option value="medium">{t('dashboard.goals.urgencyMedium')}</option><option value="high">{t('dashboard.goals.urgencyHigh')}</option>
          </Select>
          <Select label={t('dashboard.goals.freqLabel')} value={homeTaskForm.frequency} onChange={e=>setHomeTaskForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!=='one_time'}))}>
            <option value="one_time">{t('dashboard.goals.freqOneTime')}</option>
            <option value="weekly">{t('dashboard.goals.freqWeekly')}</option>
            <option value="bi_weekly">{t('dashboard.goals.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.goals.freqMonthly')}</option>
            <option value="quarterly">{t('dashboard.goals.freqQuarterly')}</option>
            <option value="yearly">{t('dashboard.goals.freqYearly')}</option>
          </Select>
          {homeTaskForm.is_recurring && (<>
            <Input label={t('dashboard.goals.repeatStartLabel')} type="date" value={homeTaskForm.recurring_start_date} onChange={e=>setHomeTaskForm(p=>({...p,recurring_start_date:e.target.value}))}/>
            <Input label={t('dashboard.goals.repeatEndLabel')} type="date" value={homeTaskForm.recurring_end_date} onChange={e=>setHomeTaskForm(p=>({...p,recurring_end_date:e.target.value}))}/>
          </>)}
          <Input label={t('dashboard.goals.estimatedCostLabel')} type="number" min="0" step="0.01" placeholder={t('dashboard.goals.estimatedCostPlaceholder')} value={homeTaskForm.estimated_cost} onChange={e=>setHomeTaskForm(p=>({...p,estimated_cost:e.target.value}))}/>
          {homes.length > 0 && (
            <Select label={t('dashboard.goals.propertyOptLabel')} value={homeTaskForm.home_id} onChange={e=>setHomeTaskForm(p=>({...p,home_id:e.target.value}))}>
              <option value="">{t('dashboard.goals.noSpecificProperty')}</option>
              {homes.map(h=><option key={h.id} value={h.id}>{h.nickname || h.address}</option>)}
            </Select>
          )}
          <Btn className="w-full py-3" type="submit">{t('dashboard.goals.addTaskBtn')}</Btn>
        </form>
      </Modal>

      {/* Checklist Item */}
      <Modal open={showChecklistModal} onClose={()=>setShowChecklistModal(false)} title={t('dashboard.goals.addChecklistModal')}>
        <form onSubmit={handleAddChecklist} className="space-y-4">
          <Input label={t('dashboard.goals.checklistItemLabel')} required placeholder={t('dashboard.goals.checklistItemPlaceholder')} value={checklistForm.title} onChange={e=>setChecklistForm(p=>({...p,title:e.target.value}))}/>
          <Input label={t('dashboard.goals.dueDateOptLabel')} type="date" value={checklistForm.due_date} onChange={e=>setChecklistForm(p=>({...p,due_date:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">{t('dashboard.goals.addItemBtn')}</Btn>
        </form>
      </Modal>

      {/* Budget Modal - replaces window.prompt */}
      <Modal open={showBudgetModal} onClose={()=>{setShowBudgetModal(false);setBudgetForm({category:'',period_amount:'',period:'monthly'})}} title={t('dashboard.money.modalSetBudget')}>
        <form onSubmit={async(e)=>{e.preventDefault();try{await life.upsertBudget({category:budgetForm.category,period_amount:parseFloat(budgetForm.period_amount),period:budgetForm.period});life.fetchBudgets();toast.success(t('dashboard.money.budgetSaved'));setShowBudgetModal(false);setBudgetForm({category:'',period_amount:'',period:'monthly'});}catch{toast.error(t('dashboard.money.budgetSaveFailed'));}}} className="space-y-4">
          <Select label={t('dashboard.money.categoryLabel')} required value={budgetForm.category} onChange={e=>setBudgetForm(p=>({...p,category:e.target.value}))}>
            <option value="">{t('dashboard.money.selectCategoryPlaceholder')}</option>
            {['Housing / Rent','Food & Dining','Transportation','Utilities','Healthcare','Entertainment','Shopping','Personal Care','Auto','Education','Subscriptions','Savings','Other'].map(c=><option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.money.amountLabel')} type="number" step="0.01" min="0.01" required placeholder="0.00" value={budgetForm.period_amount} onChange={e=>setBudgetForm(p=>({...p,period_amount:e.target.value}))}/>
            <Select label={t('dashboard.money.frequencyLabel')} value={budgetForm.period} onChange={e=>setBudgetForm(p=>({...p,period:e.target.value}))}>
              <option value="daily">{t('dashboard.money.freqDaily')}</option>
              <option value="weekly">{t('dashboard.money.freqWeekly')}</option>
              <option value="bi_weekly">{t('dashboard.money.freqBiweekly')}</option>
              <option value="monthly">{t('dashboard.money.freqMonthly')}</option>
              <option value="quarterly">{t('dashboard.money.freqQuarterly')}</option>
              <option value="yearly">{t('dashboard.money.freqYearly')}</option>
            </Select>
          </div>
          {budgetForm.period_amount && budgetForm.period !== 'monthly' && (
            <p className="text-xs text-gray-500">
              ≈ ${(parseFloat(budgetForm.period_amount||0) * ({daily:30,weekly:30/7,bi_weekly:30/14,monthly:1,quarterly:1/3,yearly:1/12}[budgetForm.period]||1)).toFixed(2)}/month
            </p>
          )}
          <Btn className="w-full py-3" type="submit">{t('dashboard.money.saveBudget')}</Btn>
        </form>
      </Modal>

      {/* Personal Care Task Modal */}
      <Modal open={showPcModal} onClose={()=>setShowPcModal(false)} title={t('dashboard.personalCare.addModal')}>
        <form onSubmit={addPcTask} className="space-y-4">
          <Input label={t('dashboard.personalCare.apptServiceLabel')} required placeholder={t('dashboard.personalCare.apptServicePlaceholder')} value={pcForm.title} onChange={e=>setPcForm(p=>({...p,title:e.target.value}))}/>
          <Select label={t('dashboard.personalCare.categoryLabel')} value={pcForm.category} onChange={e=>setPcForm(p=>({...p,category:e.target.value}))}>
            <option value="Medical">{t('dashboard.personalCare.catMedical')}</option><option value="Dental">{t('dashboard.personalCare.catDental')}</option><option value="Vision">{t('dashboard.personalCare.catVision')}</option><option value="Mental Health">{t('dashboard.personalCare.catMentalHealth')}</option><option value="Grooming">{t('dashboard.personalCare.catGrooming')}</option><option value="Fitness">{t('dashboard.personalCare.catFitness')}</option><option value="Pharmacy">{t('dashboard.personalCare.catPharmacy')}</option><option value="Other">{t('dashboard.personalCare.catOther')}</option>
          </Select>
          <Input label={t('dashboard.personalCare.dateDueLabel')} type="date" value={pcForm.due_date} onChange={e=>setPcForm(p=>({...p,due_date:e.target.value}))}/>
          <Select label={t('dashboard.personalCare.priorityLabel')} value={pcForm.urgency} onChange={e=>setPcForm(p=>({...p,urgency:e.target.value}))}>
            <option value="low">{t('dashboard.goals.urgencyLow')}</option><option value="medium">{t('dashboard.goals.urgencyMedium')}</option><option value="high">{t('dashboard.goals.urgencyHigh')}</option>
          </Select>
          <Select label={t('dashboard.personalCare.freqLabel')} value={pcForm.frequency} onChange={e=>setPcForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!==''&&e.target.value!=='one_time'}))}>
            <option value="">{t('dashboard.personalCare.freqOneTimeUnspecified')}</option>
            <option value="daily">{t('dashboard.personalCare.freqDaily')}</option><option value="weekly">{t('dashboard.personalCare.freqWeekly')}</option><option value="bi_weekly">{t('dashboard.personalCare.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.personalCare.freqMonthly')}</option><option value="quarterly">{t('dashboard.personalCare.freqQuarterly')}</option><option value="yearly">{t('dashboard.personalCare.freqYearly')}</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.personalCare.recurringLabel')}</label>
            <button type="button" onClick={()=>setPcForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&!p.frequency?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${pcForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pcForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{pcForm.is_recurring?t('common.yes'):t('common.no')}</span>
          </div>
          {pcForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('dashboard.personalCare.startDateLabel')} type="date" value={pcForm.recurring_start_date} onChange={e=>setPcForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label={t('dashboard.personalCare.endDateLabel')} type="date" value={pcForm.recurring_end_date} onChange={e=>setPcForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Input label={t('dashboard.personalCare.estimatedCostLabel')} type="number" step="0.01" min="0" placeholder={t('dashboard.personalCare.estimatedCostPlaceholder')} value={pcForm.estimated_cost} onChange={e=>setPcForm(p=>({...p,estimated_cost:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">{t('dashboard.personalCare.addApptBtn')}</Btn>
        </form>
      </Modal>

      {/* Car Care Task Modal */}
      <Modal open={showCcModal} onClose={()=>setShowCcModal(false)} title={t('dashboard.carCare.addModal')}>
        <form onSubmit={addCcTask} className="space-y-4">
          {garage.length > 0 && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.carCare.vehicleOptLabel')}</label>
              <select value={ccForm.vehicle_id} onChange={e=>setCcForm(p=>({...p,vehicle_id:e.target.value}))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition">
                <option value="">{t('dashboard.carCare.allVehicles')}</option>
                {garage.map(v=><option key={v.id} value={v.id}>{v.nickname||`${v.make_name} ${v.model_name}`}{v.year?` (${v.year})`:''}</option>)}
              </select>
            </div>
          )}
          <Input label={t('dashboard.carCare.serviceNameLabel')} required placeholder={t('dashboard.carCare.serviceNamePlaceholder')} value={ccForm.title} onChange={e=>setCcForm(p=>({...p,title:e.target.value}))}/>
          <Select label={t('dashboard.carCare.categoryLabel')} value={ccForm.category} onChange={e=>setCcForm(p=>({...p,category:e.target.value}))}>
            <option value="Oil Change">{t('dashboard.carCare.catOilChange')}</option><option value="Tires">{t('dashboard.carCare.catTires')}</option><option value="Brakes">{t('dashboard.carCare.catBrakes')}</option><option value="Inspection">{t('dashboard.carCare.catInspection')}</option><option value="Registration">{t('dashboard.carCare.catRegistration')}</option><option value="Detailing">{t('dashboard.carCare.catDetailing')}</option><option value="Battery">{t('dashboard.carCare.catBattery')}</option><option value="Fluids">{t('dashboard.carCare.catFluids')}</option><option value="AC / Heating">{t('dashboard.carCare.catAcHeating')}</option><option value="Other">{t('dashboard.carCare.catOther')}</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.carCare.dueDateLabel')} type="date" value={ccForm.due_date} onChange={e=>setCcForm(p=>({...p,due_date:e.target.value}))}/>
            <Select label={t('dashboard.carCare.priorityLabel')} value={ccForm.urgency} onChange={e=>setCcForm(p=>({...p,urgency:e.target.value}))}>
              <option value="low">{t('dashboard.goals.urgencyLow')}</option><option value="medium">{t('dashboard.goals.urgencyMedium')}</option><option value="high">{t('dashboard.goals.urgencyHigh')}</option>
            </Select>
          </div>
          <Select label={t('dashboard.carCare.freqLabel')} value={ccForm.frequency} onChange={e=>setCcForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!==''&&e.target.value!=='one_time'}))}>
            <option value="">{t('dashboard.carCare.freqOneTimeUnspecified')}</option>
            <option value="daily">{t('dashboard.carCare.freqDaily')}</option><option value="weekly">{t('dashboard.carCare.freqWeekly')}</option><option value="bi_weekly">{t('dashboard.carCare.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.carCare.freqMonthly')}</option><option value="quarterly">{t('dashboard.carCare.freqQuarterly')}</option><option value="yearly">{t('dashboard.carCare.freqYearly')}</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.carCare.recurringLabel')}</label>
            <button type="button" onClick={()=>setCcForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&!p.frequency?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${ccForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${ccForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{ccForm.is_recurring?t('common.yes'):t('common.no')}</span>
          </div>
          {ccForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('dashboard.carCare.startDateLabel')} type="date" value={ccForm.recurring_start_date} onChange={e=>setCcForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label={t('dashboard.carCare.endDateLabel')} type="date" value={ccForm.recurring_end_date} onChange={e=>setCcForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Input label={t('dashboard.carCare.estimatedCostLabel')} type="number" step="0.01" min="0" placeholder={t('dashboard.carCare.estimatedCostPlaceholder')} value={ccForm.estimated_cost} onChange={e=>setCcForm(p=>({...p,estimated_cost:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.carCare.notesOptLabel')}</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.carCare.notesPlaceholder')} value={ccForm.description} onChange={e=>setCcForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <Btn className="w-full py-3" type="submit">{t('dashboard.carCare.addServiceBtn')}</Btn>
        </form>
      </Modal>

      {/* Add / Edit Skill Modal */}
      <Modal open={showSkillModal} onClose={()=>{setShowSkillModal(false);setEditingSkill(null);setSkillLookup([]);}} title={editingSkill ? t('dashboard.skillsTools.modalEditSkill') : t('dashboard.skillsTools.modalAddSkill')}>
        <form onSubmit={handleSaveSkill} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.skillNameLabel')}</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder={t('dashboard.skillsTools.skillNamePlaceholderLong')} required value={skillForm.skill_name}
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
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.categoryLabel')}</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder={t('dashboard.skillsTools.catSearchPlaceholder')} value={skillForm.category}
              onChange={e=>{setSkillForm(p=>({...p,category:e.target.value}));searchCatLookup(e.target.value);}}
              onBlur={()=>setTimeout(()=>setCatLookup([]),150)}/>
            {catLookup.length>0&&(
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {catLookup.map(c=><button key={c} type="button" onClick={()=>{setSkillForm(p=>({...p,category:c}));setCatLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition">{c}</button>)}
              </div>
            )}
          </div>
          <Input label={t('dashboard.skillsTools.hourlyRateOptLabel')} type="number" step="0.01" min="0" placeholder="0.00" value={skillForm.hourly_rate} onChange={e=>setSkillForm(p=>({...p,hourly_rate:e.target.value}))}/>
          <Input label={t('dashboard.skillsTools.yearsExpLabel')} type="number" min="0" max="50" placeholder="0" value={skillForm.years_exp} onChange={e=>setSkillForm(p=>({...p,years_exp:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.shortDescLabel')}</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.skillsTools.descSearchPlaceholder')} value={skillForm.description} onChange={e=>setSkillForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.skillsTools.availableForHireToggle')}</label>
            <button type="button" onClick={()=>setSkillForm(p=>({...p,is_available:!p.is_available}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${skillForm.is_available?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${skillForm.is_available?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{skillForm.is_available?t('common.yes'):t('common.no')}</span>
          </div>
          <Btn className="w-full py-3" type="submit">{editingSkill?t('dashboard.skillsTools.updateSkillBtn'):t('dashboard.skillsTools.addSkillBtn')}</Btn>
        </form>
      </Modal>

      {/* Add / Edit Tool Modal - upgraded with richer fields */}
      <Modal open={showToolModal} onClose={()=>{setShowToolModal(false);setEditingTool(null);setToolCatLookup([]);setToolImageFile(null);setToolImagePreview('');}} title={editingTool ? t('dashboard.skillsTools.modalEditTool') : t('dashboard.skillsTools.modalAddTool')}>
        <form onSubmit={handleSaveTool} className="space-y-4">
          <Input label={t('dashboard.skillsTools.toolNameLabel')} required maxLength={200} placeholder={t('dashboard.skillsTools.toolNamePlaceholder')} value={toolForm.name} onChange={e=>setToolForm(p=>({...p,name:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">
              {t('dashboard.skillsTools.toolPhotoLabel', { defaultValue: 'Tool photo' })}
            </label>
            <div className="flex gap-3 items-stretch">
              <div className="w-28 h-24 rounded-xl border border-gray-700 bg-gray-800 overflow-hidden flex items-center justify-center flex-shrink-0">
                {toolImagePreview ? (
                  <img src={toolImagePreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] text-gray-500 text-center px-3">{t('dashboard.skillsTools.toolPhotoEmpty', { defaultValue: 'No photo yet' })}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handleToolImageChange}
                  className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-orange-600"
                />
                <p className="text-xs text-gray-500 mt-2">
                  {t('dashboard.skillsTools.toolPhotoHint', { defaultValue: 'Add a clear photo so renters can inspect the tool before booking.' })}
                </p>
                {toolImagePreview&&(
                  <button type="button" onClick={()=>{setToolImageFile(null);setToolImagePreview('');setToolForm(p=>({...p,image_url:''}));}} className="text-xs text-red-400 hover:text-red-300 mt-2">
                    {t('common.remove', { defaultValue: 'Remove' })}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.categoryLabel')}</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              required maxLength={100}
              placeholder={t('dashboard.skillsTools.toolCatPlaceholder')} value={toolForm.category}
              onChange={e=>{setToolForm(p=>({...p,category:e.target.value}));searchToolCatLookup(e.target.value);}}
              onBlur={()=>setTimeout(()=>setToolCatLookup([]),150)}/>
            {toolCatLookup.length>0&&(
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {toolCatLookup.map(c=><button key={c} type="button" onClick={()=>{setToolForm(p=>({...p,category:c}));setToolCatLookup([]);}} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition">{c}</button>)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.dailyRateLabel')} type="number" step="0.01" min="0.01" required placeholder="0.00" value={toolForm.daily_rate} onChange={e=>setToolForm(p=>({...p,daily_rate:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.hourlyRateToolOptLabel')} type="number" step="0.01" min="0.01" placeholder="0.00" value={toolForm.hourly_rate} onChange={e=>setToolForm(p=>({...p,hourly_rate:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.brandOptLabel')} maxLength={100} placeholder={t('dashboard.skillsTools.brandPlaceholder')} value={toolForm.brand} onChange={e=>setToolForm(p=>({...p,brand:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.modelOptLabel')} maxLength={100} placeholder={t('dashboard.skillsTools.modelPlaceholder')} value={toolForm.model} onChange={e=>setToolForm(p=>({...p,model:e.target.value}))}/>
          </div>
          <Select label={t('dashboard.skillsTools.conditionLabel')} value={toolForm.condition} onChange={e=>setToolForm(p=>({...p,condition:e.target.value}))}>
            <option value="excellent">{t('dashboard.skillsTools.conditionExcellent')}</option><option value="good">{t('dashboard.skillsTools.conditionGood')}</option><option value="fair">{t('dashboard.skillsTools.conditionFair')}</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.depositAmtOptLabel')} type="number" step="0.01" min="0" required={toolForm.requires_deposit} placeholder="0.00" value={toolForm.deposit_amount} onChange={e=>setToolForm(p=>({...p,deposit_amount:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.replacementValueLabel', { defaultValue: 'Replacement value' })} type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.replacement_value} onChange={e=>setToolForm(p=>({...p,replacement_value:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.cityOptLabel')} required maxLength={100} placeholder={t('dashboard.skillsTools.cityPlaceholder')} value={toolForm.location_city} onChange={e=>setToolForm(p=>({...p,location_city:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.stateOptLabel')} maxLength={50} placeholder={t('dashboard.skillsTools.statePlaceholder')} value={toolForm.location_state} onChange={e=>setToolForm(p=>({...p,location_state:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.descriptionOptLabel')}</label>
            <textarea rows={2} maxLength={4000} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.skillsTools.toolDescPlaceholderShort')} value={toolForm.description} onChange={e=>setToolForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.ownerRulesLabel', { defaultValue: 'Owner rules / handling notes' })}</label>
            <textarea rows={3} maxLength={4000} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.skillsTools.ownerRulesPlaceholder', { defaultValue: 'Example: return clean, use only with wood, do not use in rain, include batteries/charger.' })} value={toolForm.owner_rules} onChange={e=>setToolForm(p=>({...p,owner_rules:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.ownerCustomTermsLabel', { defaultValue: 'Owner-provided rental terms' })}</label>
            <textarea rows={4} maxLength={4000} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.skillsTools.ownerCustomTermsPlaceholder', { defaultValue: 'Optional. Add the agreement terms you want renters to accept, such as late return expectations, cleaning rules, missing accessory responsibility, or replacement expectations.' })} value={toolForm.owner_custom_terms} onChange={e=>setToolForm(p=>({...p,owner_custom_terms:e.target.value}))}/>
            <p className="mt-1 text-[11px] text-gray-500">{t('dashboard.skillsTools.ownerCustomTermsHint', { defaultValue: 'Renters will see these as owner-provided terms. OxSteed does not draft, review, validate, or guarantee them.' })}</p>
          </div>
          <div className="space-y-3">
            {[
              {label:t('dashboard.skillsTools.availableForRentToggle'), key:'is_available'},
              {label:t('dashboard.skillsTools.requiresDepositToggle'), key:'requires_deposit'},
              {label:t('dashboard.skillsTools.deliveryAvailableToggle'), key:'delivery_available'},
            ].map(({label,key})=>(
              <div key={key} className="flex items-center gap-3">
                <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 flex-1">{label}</label>
                <button type="button" onClick={()=>setToolForm(p=>({...p,[key]:!p[key]}))}
                  className={`w-10 h-5 rounded-full transition-colors relative ${toolForm[key]?'bg-orange-500':'bg-gray-700'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${toolForm[key]?'translate-x-5':'translate-x-0.5'}`}/>
                </button>
                <span className="text-xs text-gray-400 w-6">{toolForm[key]?t('common.yes'):t('common.no')}</span>
              </div>
            ))}
          </div>
          <label className="flex items-start gap-3 p-3 rounded-xl border border-orange-500/30 bg-orange-500/10 text-sm text-gray-200">
            <input
              type="checkbox"
              className="mt-1 accent-orange-500"
              checked={toolForm.owner_attestation_accepted}
              onChange={e=>setToolForm(p=>({...p,owner_attestation_accepted:e.target.checked}))}
            />
            <span>
              {t('dashboard.skillsTools.ownerAttestationText', {
                defaultValue: 'I understand this is a neighbor-to-neighbor rental. I am responsible for accurately describing the tool, setting rules/deposit expectations, and handling condition, damage, return, and payment issues with the renter. OxSteed only helps document the listing, booking, messages, reports, and agreement records.',
              })}
            </span>
          </label>
          <Btn className="w-full py-3" type="submit">{editingTool?t('dashboard.skillsTools.updateToolBtn'):t('dashboard.skillsTools.listTool')}</Btn>
        </form>
      </Modal>

      {/* Invoice Modal */}
      <Modal open={showInvoiceModal} onClose={() => setShowInvoiceModal(false)} title={editingInvoice ? t('helperDashboard.invoices.editTitle') : t('helperDashboard.invoices.createTitle')}>
        <form onSubmit={handleSaveInvoice} className="space-y-4">
          <Input label={t('helperDashboard.invoices.clientName')} placeholder="John Doe" value={invoiceForm.client_name} onChange={e => setInvoiceForm(p => ({...p, client_name: e.target.value}))} required />
          <Input label={t('helperDashboard.invoices.clientEmail')} type="email" placeholder="john@example.com" value={invoiceForm.client_email} onChange={e => setInvoiceForm(p => ({...p, client_email: e.target.value}))} required />

          <div className="border-t border-gray-700 pt-4">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-2">{t('helperDashboard.invoices.lineItems')}</label>
            {invoiceForm.line_items.length > 0 && (
              <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
                {invoiceForm.line_items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-gray-800/50 p-2 rounded text-xs">
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate">{item.description}</p>
                      <p className="text-gray-400">{item.quantity} × ${item.unit_price.toFixed(2)} = ${item.total.toFixed(2)}</p>
                    </div>
                    <button type="button" onClick={() => removeLineItem(idx)} className="text-red-500 hover:text-red-400 ml-2 flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Input label={t('helperDashboard.invoices.description')} placeholder={t('helperDashboard.invoices.descriptionPlaceholder')} value={lineItemInput.description} onChange={e => setLineItemInput(p => ({...p, description: e.target.value}))} />
              <div className="grid grid-cols-3 gap-2">
                <Input label={t('helperDashboard.invoices.qty')} type="number" step="0.01" min="0.01" placeholder="1" value={lineItemInput.quantity} onChange={e => setLineItemInput(p => ({...p, quantity: e.target.value}))} />
                <Input label={t('helperDashboard.invoices.unitPrice')} type="number" step="0.01" min="0" placeholder="0.00" value={lineItemInput.unit_price} onChange={e => setLineItemInput(p => ({...p, unit_price: e.target.value}))} />
                <button type="button" onClick={addLineItem} className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition align-bottom self-end">{t('helperDashboard.invoices.addItem')}</button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('helperDashboard.invoices.subtotal')}</span>
              <span className="text-white font-semibold">${(invoiceForm.subtotal_cents / 100).toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400 flex-1">{t('helperDashboard.invoices.taxRate')}</label>
              <input type="number" step="0.01" min="0" max="100" value={invoiceForm.tax_rate} onChange={e => updateTaxRate(parseFloat(e.target.value) || 0)} className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white" />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('helperDashboard.invoices.tax')}</span>
              <span className="text-white font-semibold">${(invoiceForm.tax_cents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg border-t border-gray-700 pt-3">
              <span className="text-white font-bold">{t('helperDashboard.invoices.total')}</span>
              <span className="text-orange-400 font-bold">${(invoiceForm.total_cents / 100).toFixed(2)}</span>
            </div>
          </div>

          <Input label={t('helperDashboard.invoices.dueDate')} type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm(p => ({...p, due_date: e.target.value}))} />

          <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('helperDashboard.invoices.memo')} value={invoiceForm.memo} onChange={e => setInvoiceForm(p => ({...p, memo: e.target.value}))} />

          <div className="flex gap-2">
            <button type="button" onClick={() => setShowInvoiceModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2 rounded-lg transition">{t('common.cancel')}</button>
            <button type="submit" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-lg transition">{editingInvoice ? t('helperDashboard.invoices.editTitle') : t('helperDashboard.invoices.createTitle')}</button>
          </div>
        </form>
      </Modal>

    </div>
    </PageShell>
  );
}
