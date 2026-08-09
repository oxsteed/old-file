import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import BusinessSkillsSelector from '../components/BusinessSkillsSelector';
import CountrySelect from '../components/CountrySelect';
import RegionInput from '../components/RegionInput';
import PostalCodeInput from '../components/PostalCodeInput';
import AIKnowledgeTab from '../components/AIKnowledgeTab';
import RoleMenu from '../components/businessHub/RoleMenu';
import BusinessCalendarView from '../components/calendar/BusinessCalendarView';
import BusinessClientsTab from '../components/businessHub/BusinessClientsTab';
import { BusinessMessagingTab } from '../components/businessHub/BusinessMessagingTab';
import { AppointmentCalendarView } from '../components/businessHub/AppointmentCalendarView';
import { BusinessServicesTab } from '../components/businessHub/BusinessServicesTab';
import { PricingRulesManager } from '../components/businessHub/PricingRulesManager';
import { ProductManagement } from '../components/businessHub/ProductManagement';
import { ProductPricingManager } from '../components/businessHub/ProductPricingManager';
import { BusinessAnalyticsTab } from '../components/businessHub/BusinessAnalyticsTab';
import { CustomerLoyaltyManager } from '../components/businessHub/CustomerLoyaltyManager';
import { BusinessIntegrations } from '../components/businessHub/BusinessIntegrations';
import { ExpenseTracker } from '../components/businessHub/ExpenseTracker';
import { QuoteBuilder } from '../components/businessHub/QuoteBuilder';
import { RecurringBillingManager } from '../components/businessHub/RecurringBillingManager';
import { StaffScheduler } from '../components/businessHub/StaffScheduler';
import { ReviewManager } from '../components/businessHub/ReviewManager';
import { MarketingTools } from '../components/businessHub/MarketingTools';
import { WaitlistManager } from '../components/businessHub/WaitlistManager';
import { ServicePackagesManager } from '../components/businessHub/ServicePackagesManager';
import { HealthAlertsDashboard } from '../components/businessHub/HealthAlertsDashboard';
import { LeadPipeline } from '../components/businessHub/LeadPipeline';
import { MessageTemplatesManager } from '../components/businessHub/MessageTemplatesManager';
import PropertyOperationsTab from '../components/businessHub/PropertyOperationsTab';
import TradesOperationsTab from '../components/businessHub/TradesOperationsTab';
import BeautyOperationsTab from '../components/businessHub/BeautyOperationsTab';
import CreativeOperationsTab from '../components/businessHub/CreativeOperationsTab';
import ProfessionalOperationsTab from '../components/businessHub/ProfessionalOperationsTab';
import ContinuityOperationsTab from '../components/businessHub/ContinuityOperationsTab';
import TemplateWorkflowSystemTab from '../components/businessHub/TemplateWorkflowSystemTab';
import {
  listBusinesses, createBusiness, updateBusiness, uploadBusinessPhotos,
  getAnalytics,
  listInvoices, createInvoice, updateInvoice, markInvoicePaid, deleteInvoice, sendInvoice,
  getTax, refreshTax, markTaxPaid,
  listGoals, createGoal, updateGoal, deleteGoal,
  listMembers, inviteMember, revokeMember,
  listMyInvitations, acceptInvitation, declineInvitation,
  listManagedBusinesses,
  listVortexTokens, generateVortexToken, revokeVortexToken,
  getBusinessProfileForEditor,
  // Business content (services, gallery, policies, faqs, hours)
  listBusinessServices, createBusinessService, updateBusinessService, deleteBusinessService,
  listBusinessGallery, addBusinessPhoto, updateBusinessPhoto, deleteBusinessPhoto,
  listBusinessPolicies, createBusinessPolicy, updateBusinessPolicy, deleteBusinessPolicy,
  listBusinessFAQs, createBusinessFAQ, updateBusinessFAQ, deleteBusinessFAQ,
  listBusinessHours, updateBusinessHours,
  listBusinessSkills,
  getBusinessCalendarSummary,
} from '../api/businesses';
import {
  convertMaintenanceRequestToJob,
  listBusinessMaintenanceRequests,
  updateMaintenanceRequest,
} from '../api/maintenanceRequests';
import {
  createAccessCode,
  listAccessCodes,
  revokeAccessCode,
} from '../api/vortex';
import { getPropertyOperationsWorkspace } from '../api/propertyOperations';
import { getTradesOperationsWorkspace } from '../api/tradesOperations';
import { getBeautyOperationsWorkspace } from '../api/beautyOperations';
import { getCreativeOperationsWorkspace } from '../api/creativeOperations';
import { getProfessionalOperationsWorkspace } from '../api/professionalOperations';
import { getContinuityOperationsWorkspace } from '../api/continuityOperations';
import { formatDate, formatMoney } from '../lib/format';
import { getDefaultCurrency } from '../lib/countries';
import { LAUNCH_BUSINESS_HUB_TABS, LAUNCH_VISIBILITY } from '../utils/launchScope';
import '../styles/BusinessHubPage.css';

const LS_KEY = 'oxs:bh:lastBusinessId';
const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];

// ── formatters ────────────────────────────────────────────────────────────────
function fmt$(n, currency = 'USD') {
  return formatMoney(n, { currency });
}
function fmtDate(d) {
  if (!d) return '-';
  const dateOnly = String(d).split('T')[0];
  return formatDate(`${dateOnly}T00:00:00`, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtMonth(m) {
  // m = "2025-03"
  if (!m) return '';
  const [y, mo] = m.split('-');
  return formatDate(new Date(+y, +mo - 1), { month: 'short', day: undefined, year: undefined });
}

// ── default forms ─────────────────────────────────────────────────────────────
const DEFAULT_BIZ_FORM   = { business_name: '', description: '', website: '', phone: '', tax_rate: '' };
const DEFAULT_INV_FORM   = {
  client_name: '', client_email: '', client_company: '',
  due_date: '', invoice_tax_rate: '', notes: '', status: 'draft',
  line_items: [{ description: '', quantity: 1, unit_price: '' }],
};
const DEFAULT_GOAL_FORM  = { title: '', goal_type: 'revenue', period: 'monthly', target_value: '', current_value: '' };

// ── main component ────────────────────────────────────────────────────────────
export default function BusinessHubPage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  // guard
  if (!user || !HELPER_ROLES.includes(user.role)) {
    return (
      <PageShell>
        <PageMeta title={t('businessHub.metaTitle')} description={t('businessHub.metaDesc')} />
        <div className="bh-page">
          <div className="bh-empty" style={{ marginTop: '3rem' }}>
            <p style={{ fontWeight: 700 }}>{t('businessHub.helpersOnly')}</p>
            <p>{t('businessHub.helpersOnlyDesc')}</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return <BusinessHubInner />;
}

function BusinessHubInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currency = user?.preferred_currency
    || (user?.country ? getDefaultCurrency(user.country) : null)
    || 'USD';
  const [businesses, setBusinesses]   = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  // URL params take precedence over localStorage when the page is opened at
  // /business/:businessId/workspace or /business/:businessId/workspace/:tab
  const routeParams = useParams();
  const routeBusinessId = routeParams.businessId ? String(routeParams.businessId) : null;
  const routeTab = routeParams.tab ? String(routeParams.tab) : null;
  const navigate = useNavigate();
  const [bizId, setBizId]             = useState(() => routeBusinessId || localStorage.getItem(LS_KEY) || '');
  const [tab, setTab]                 = useState(() => routeTab || searchParams.get('tab') || 'overview');
  const [loadingBiz, setLoadingBiz]   = useState(true);

  // modal state
  const [modal, setModal]     = useState(null); // 'add-biz' | 'add-inv' | 'edit-inv' | 'pay-inv' | 'add-goal' | 'edit-goal' | 'pay-tax'
  const [selected, setSelected] = useState(null);
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState(false);
  const [formErr, setFormErr] = useState('');

  // tab data
  const [analytics, setAnalytics]   = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  /** True only after GET /analytics fails - avoids flashing error while bizId is set but fetch has not started yet */
  const [analyticsError, setAnalyticsError] = useState(false);
  const [invoiceData, setInvoiceData] = useState(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [taxData, setTaxData]       = useState(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const [goals, setGoals]           = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [maintenanceData, setMaintenanceData] = useState({ requests: [], stats: null });
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [propertyOpsData, setPropertyOpsData] = useState(null);
  const [propertyOpsLoading, setPropertyOpsLoading] = useState(false);
  const [tradesOpsData, setTradesOpsData] = useState(null);
  const [tradesOpsLoading, setTradesOpsLoading] = useState(false);
  const [beautyOpsData, setBeautyOpsData] = useState(null);
  const [beautyOpsLoading, setBeautyOpsLoading] = useState(false);
  const [creativeOpsData, setCreativeOpsData] = useState(null);
  const [creativeOpsLoading, setCreativeOpsLoading] = useState(false);
  const [professionalOpsData, setProfessionalOpsData] = useState(null);
  const [professionalOpsLoading, setProfessionalOpsLoading] = useState(false);
  const [continuityOpsData, setContinuityOpsData] = useState(null);
  const [continuityOpsLoading, setContinuityOpsLoading] = useState(false);

  // team tab
  const [members, setMembers]             = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitations, setInvitations]     = useState([]);
  const [managedBiz, setManagedBiz]       = useState([]);

  // vortex tokens
  const [vortexTokens, setVortexTokens]   = useState([]);
  const [tokenForm, setTokenForm]         = useState({ role: 'representative', expires_in: '7d' });
  const [generatingToken, setGeneratingToken] = useState(false);
  const [accessCodes, setAccessCodes]     = useState([]);
  const [accessCodeForm, setAccessCodeForm] = useState({ role: 'employee', label: '', requires_approval: true });
  const [generatingAccessCode, setGeneratingAccessCode] = useState(false);

  // profile tab
  const [profileForm, setProfileForm] = useState(null);   // null = not loaded
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving]   = useState(false);
  const [profileErr, setProfileErr]         = useState('');

  // content tabs (services, gallery, policies, faqs, hours, skills)
  const [services, setServices]             = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [gallery, setGallery]               = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [policies, setPolicies]             = useState([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [faqs, setFAQs]                     = useState([]);
  const [faqsLoading, setFAQsLoading]       = useState(false);
  const [hours, setHours]                   = useState([]);
  const [hoursLoading, setHoursLoading]     = useState(false);
  const [skills, setSkills]                 = useState([]);
  const [skillsLoading, setSkillsLoading]   = useState(false);
  const [logoPreview, setLogoPreview]     = useState(null);
  const [coverPreview, setCoverPreview]   = useState(null);
  const [logoFile, setLogoFile]           = useState(null);
  const [coverFile, setCoverFile]         = useState(null);
  // Snapshot of helper-linked fields from last loadProfile - omit from PUT when unchanged
  // so the server skips helper_profiles UPSERT (see businessController updateBusiness).
  const profileFieldsBaselineRef = useRef(null);

  // ── load businesses (owned + managed) ───────────────────────────────────
  const loadBusinesses = useCallback(async () => {
    setLoadingBiz(true);
    try {
      const [owned, managed] = await Promise.all([
        listBusinesses(),
        listManagedBusinesses().catch(() => []),
      ]);
      const ownedTagged   = owned.map(b   => ({ ...b, _role: 'owner'    }));
      const managedTagged = managed.map(b => ({ ...b, _role: b.role }));
      const seen = new Set(ownedTagged.map(b => String(b.id)));
      const merged = [
        ...ownedTagged,
        ...managedTagged.filter(b => !seen.has(String(b.id))),
      ];
      setBusinesses(merged);
      if (merged.length === 0) {
        // Stale oxs:bh:lastBusinessId would otherwise keep tab effects calling /api/businesses/:id/* → 404
        setBizId('');
        localStorage.removeItem(LS_KEY);
        setAnalytics(null);
        setAnalyticsError(false);
        setInvoiceData(null);
        setTaxData(null);
        setGoals([]);
        setMaintenanceData({ requests: [], stats: null });
        setMembers([]);
        setVortexTokens([]);
        setAccessCodes([]);
      } else {
        // URL param (routeBusinessId) wins; fall back to localStorage, then first owned.
        const fromUrl = routeBusinessId && merged.find(b => String(b.id) === routeBusinessId) ? routeBusinessId : null;
        const saved = localStorage.getItem(LS_KEY);
        const fromLs = saved && merged.find(b => String(b.id) === String(saved)) ? String(saved) : null;
        const chosen = fromUrl || fromLs || String(merged[0].id);
        setBizId(chosen);
        localStorage.setItem(LS_KEY, chosen);
      }
    } catch { toast.error(t('businessHub.toastLoadBizFail')); }
    finally { setLoadingBiz(false); }
  }, [t, routeBusinessId]);

  useEffect(() => { loadBusinesses(); }, [loadBusinesses]);

  useEffect(() => {
    const b = searchParams.get('biz');
    if (!b || !businesses.length) return;
    if (!businesses.some(x => String(x.id) === String(b))) return;
    if (String(bizId) === String(b)) return;
    setBizId(String(b));
    localStorage.setItem(LS_KEY, String(b));
  }, [searchParams, businesses, bizId]);

  useEffect(() => {
    // Only mirror tab into ?tab= when we're on /business-hub (legacy URL).
    // When on /business/:id/workspace, the tab lives in the path itself.
    if (routeBusinessId) return;
    const urlTab = searchParams.get('tab') || 'overview';
    if (urlTab === tab) return;
    const n = new URLSearchParams(searchParams);
    if (tab === 'overview') n.delete('tab');
    else n.set('tab', tab);
    setSearchParams(n, { replace: true });
  }, [tab, searchParams, setSearchParams, routeBusinessId]);

  // When on the per-business workspace URL, keep state and URL in sync.
  useEffect(() => {
    if (!routeBusinessId) return;
    if (String(bizId) !== routeBusinessId) setBizId(routeBusinessId);
    if (routeTab && routeTab !== tab) setTab(routeTab);
  }, [routeBusinessId, routeTab]); // intentionally ignore bizId/tab to avoid feedback loop

  // When the user switches business or tab via in-page controls AND we're on
  // the workspace URL, push the new path so refresh/back/share works.
  useEffect(() => {
    if (!routeBusinessId) return;
    if (!bizId) return;
    const desiredPath = tab === 'overview'
      ? `/business/${bizId}/workspace`
      : `/business/${bizId}/workspace/${tab}`;
    // Only navigate if the URL actually needs to change
    if (window.location.pathname !== desiredPath) {
      navigate(desiredPath, { replace: true });
    }
  }, [bizId, tab, routeBusinessId, navigate]);

  // ── load tab data when bizId or tab changes ──────────────────────────────
  const loadOverview = useCallback(async () => {
    if (!bizId) return;
    setAnalyticsLoading(true);
    setAnalyticsError(false);
    try {
      setAnalytics(await getAnalytics(bizId));
    } catch {
      setAnalytics(null);
      setAnalyticsError(true);
      toast.error(t('businessHub.errorAnalytics'));
    } finally {
      setAnalyticsLoading(false);
    }
  }, [bizId, t]);

  const loadInvoices = useCallback(async () => {
    if (!bizId) return;
    setInvoicesLoading(true);
    try { setInvoiceData(await listInvoices(bizId)); }
    catch { toast.error(t('businessHub.toastLoadInvoicesFail')); }
    finally { setInvoicesLoading(false); }
  }, [bizId, t]);

  const loadTax = useCallback(async () => {
    if (!bizId) return;
    setTaxLoading(true);
    try { setTaxData(await getTax(bizId)); }
    catch { toast.error(t('businessHub.toastLoadTaxFail')); }
    finally { setTaxLoading(false); }
  }, [bizId, t]);

  const loadGoals = useCallback(async () => {
    if (!bizId) return;
    setGoalsLoading(true);
    try { setGoals(await listGoals(bizId)); }
    catch { toast.error(t('businessHub.toastLoadGoalsFail')); }
    finally { setGoalsLoading(false); }
  }, [bizId, t]);

  const loadMaintenance = useCallback(async () => {
    if (!bizId) return;
    setMaintenanceLoading(true);
    try {
      setMaintenanceData(await listBusinessMaintenanceRequests(bizId));
    } catch {
      toast.error('Could not load maintenance requests');
    } finally {
      setMaintenanceLoading(false);
    }
  }, [bizId]);

  const loadPropertyOperations = useCallback(async () => {
    if (!bizId) return;
    setPropertyOpsLoading(true);
    try {
      setPropertyOpsData(await getPropertyOperationsWorkspace(bizId));
    } catch {
      toast.error('Could not load property operations');
    } finally {
      setPropertyOpsLoading(false);
    }
  }, [bizId]);

  const loadTradesOperations = useCallback(async () => {
    if (!bizId) return;
    setTradesOpsLoading(true);
    try {
      setTradesOpsData(await getTradesOperationsWorkspace(bizId));
    } catch {
      toast.error('Could not load trades operations');
    } finally {
      setTradesOpsLoading(false);
    }
  }, [bizId]);

  const loadBeautyOperations = useCallback(async () => {
    if (!bizId) return;
    setBeautyOpsLoading(true);
    try {
      setBeautyOpsData(await getBeautyOperationsWorkspace(bizId));
    } catch {
      toast.error('Could not load beauty operations');
    } finally {
      setBeautyOpsLoading(false);
    }
  }, [bizId]);

  const loadCreativeOperations = useCallback(async () => {
    if (!bizId) return;
    setCreativeOpsLoading(true);
    try {
      setCreativeOpsData(await getCreativeOperationsWorkspace(bizId));
    } catch {
      toast.error('Could not load creative operations');
    } finally {
      setCreativeOpsLoading(false);
    }
  }, [bizId]);

  const loadProfessionalOperations = useCallback(async () => {
    if (!bizId) return;
    setProfessionalOpsLoading(true);
    try {
      setProfessionalOpsData(await getProfessionalOperationsWorkspace(bizId));
    } catch {
      toast.error('Could not load professional operations');
    } finally {
      setProfessionalOpsLoading(false);
    }
  }, [bizId]);

  const loadContinuityOperations = useCallback(async () => {
    if (!bizId) return;
    setContinuityOpsLoading(true);
    try {
      setContinuityOpsData(await getContinuityOperationsWorkspace(bizId));
    } catch {
      toast.error('Could not load continuity operations');
    } finally {
      setContinuityOpsLoading(false);
    }
  }, [bizId]);

  const loadTeam = useCallback(async () => {
    if (!bizId) return;
    setMembersLoading(true);
    try {
      const [m, inv, managed, tokens, codes] = await Promise.all([
        listMembers(bizId),
        listMyInvitations(),
        listManagedBusinesses(),
        LAUNCH_VISIBILITY.businessHubVortexAccess ? listVortexTokens(bizId).catch(() => []) : Promise.resolve([]),
        LAUNCH_VISIBILITY.businessHubVortexAccess ? listAccessCodes(bizId).catch(() => []) : Promise.resolve([]),
      ]);
      setMembers(m);
      setInvitations(inv);
      setManagedBiz(managed);
      setVortexTokens(tokens);
      setAccessCodes(codes);
    } catch { toast.error(t('businessHub.toastLoadTeamFail')); }
    finally { setMembersLoading(false); }
  }, [bizId, t]);

  const loadProfile = useCallback(async () => {
    if (!bizId) return;
    setProfileLoading(true);
    setProfileErr('');
    try {
      const data = await getBusinessProfileForEditor(bizId);
      const biz = data.business;
      const nextForm = {
        business_name:       biz.business_name   || '',
        business_type:       biz.business_type   || '',
        profile_headline:    biz.profile_headline || '',
        description:         biz.description     || biz.bio_short || '',
        phone:               biz.phone           || '',
        website:             biz.website         || '',
        address_street:      biz.address_street  || '',
        address_city:        biz.address_city    || '',
        address_state:       biz.address_state   || '',
        address_zip:         biz.address_zip     || '',
        address_country:     biz.address_country || 'US',
        service_radius_miles: biz.service_radius_miles || '',
        logo_url:            biz.logo_url        || '',
        cover_photo_url:     biz.cover_photo_url || '',
      };
      setProfileForm(nextForm);
      profileFieldsBaselineRef.current = {
        profile_headline: nextForm.profile_headline,
        service_radius_miles: nextForm.service_radius_miles,
      };
      setLogoPreview(biz.logo_url || null);
      setCoverPreview(biz.cover_photo_url || null);
      setLogoFile(null);
      setCoverFile(null);
    } catch { setProfileErr(t('businessHub.errorProfileLoad')); }
    finally { setProfileLoading(false); }
  }, [bizId, t]);

  const handleSaveProfile = useCallback(async () => {
    if (!profileForm) return;
    setProfileSaving(true);
    setProfileErr('');
    try {
      if (logoFile || coverFile) {
        await uploadBusinessPhotos(bizId, logoFile || null, coverFile || null);
      }
      const photoPatch = {};
      if (!logoFile) {
        if (profileForm.logo_url)
          photoPatch.logo_url = profileForm.logo_url;
        else
          photoPatch.clear_logo_url = true;
      }
      if (!coverFile) {
        if (profileForm.cover_photo_url)
          photoPatch.cover_photo_url = profileForm.cover_photo_url;
        else
          photoPatch.clear_cover_photo_url = true;
      }
      const bl = profileFieldsBaselineRef.current;
      const body = {
        business_name:        profileForm.business_name       || undefined,
        business_type:        profileForm.business_type       || undefined,
        description:          profileForm.description ?? '',
        phone:                profileForm.phone ?? '',
        website:              profileForm.website ?? '',
        address_street:       profileForm.address_street ?? '',
        address_city:         profileForm.address_city ?? '',
        address_state:        profileForm.address_state ?? '',
        address_zip:          profileForm.address_zip ?? '',
        address_country:      profileForm.address_country || 'US',
        ...photoPatch,
      };
      if (bl) {
        const curHeadline = profileForm.profile_headline ?? '';
        if (String(curHeadline) !== String(bl.profile_headline))
          body.profile_headline = curHeadline;
        const curR = profileForm.service_radius_miles;
        const curRadiusStr = curR === '' || curR == null ? '' : String(curR);
        const blR = bl.service_radius_miles;
        const blRadiusStr = blR === '' || blR == null ? '' : String(blR);
        if (curRadiusStr !== blRadiusStr) {
          body.service_radius_miles =
            curR === '' || curR == null ? null : parseFloat(curR);
        }
      }
      await updateBusiness(bizId, body);
      toast.success(t('businessHub.toastProfileSaved'));
      setLogoFile(null);
      setCoverFile(null);
      await loadProfile();
    } catch (e) {
      setProfileErr(e?.response?.data?.error || t('businessHub.errorProfileSave'));
    } finally {
      setProfileSaving(false);
    }
  }, [bizId, profileForm, logoFile, coverFile, loadProfile, t]);

  // Content tab loading functions
  const loadServices = useCallback(async () => {
    if (!bizId) return;
    setServicesLoading(true);
    try { setServices(await listBusinessServices(bizId)); }
    catch { toast.error(t('businessHub.errorLoadServices')); }
    finally { setServicesLoading(false); }
  }, [bizId, t]);

  const loadGallery = useCallback(async () => {
    if (!bizId) return;
    setGalleryLoading(true);
    try { setGallery(await listBusinessGallery(bizId)); }
    catch { toast.error(t('businessHub.errorLoadGallery')); }
    finally { setGalleryLoading(false); }
  }, [bizId, t]);

  const loadPolicies = useCallback(async () => {
    if (!bizId) return;
    setPoliciesLoading(true);
    try { setPolicies(await listBusinessPolicies(bizId)); }
    catch { toast.error(t('businessHub.errorLoadPolicies')); }
    finally { setPoliciesLoading(false); }
  }, [bizId, t]);

  const loadFAQs = useCallback(async () => {
    if (!bizId) return;
    setFAQsLoading(true);
    try { setFAQs(await listBusinessFAQs(bizId)); }
    catch { toast.error(t('businessHub.errorLoadFAQs')); }
    finally { setFAQsLoading(false); }
  }, [bizId, t]);

  const loadHours = useCallback(async () => {
    if (!bizId) return;
    setHoursLoading(true);
    try { setHours(await listBusinessHours(bizId)); }
    catch { toast.error(t('businessHub.errorLoadHours')); }
    finally { setHoursLoading(false); }
  }, [bizId, t]);

  const loadSkills = useCallback(async () => {
    if (!bizId) return;
    setSkillsLoading(true);
    try { setSkills(await listBusinessSkills(bizId)); }
    catch { toast.error(t('businessHub.errorLoadSkills')); }
    finally { setSkillsLoading(false); }
  }, [bizId, t]);

  useEffect(() => {
    if (loadingBiz) return;
    if (!bizId) return;
    if (!businesses.some((b) => String(b.id) === String(bizId))) return;
    if (tab === 'profile') loadProfile();
    else if (tab === 'workflow') {
      loadOverview();
      loadServices();
      loadGallery();
      loadFAQs();
      loadHours();
      loadTeam();
    }
    else if (tab === 'services') loadServices();
    else if (tab === 'gallery') loadGallery();
    else if (tab === 'policies') loadPolicies();
    else if (tab === 'faqs') loadFAQs();
    else if (tab === 'property-ops') loadPropertyOperations();
    else if (tab === 'trades-ops') loadTradesOperations();
    else if (tab === 'beauty-ops') loadBeautyOperations();
    else if (tab === 'creative-ops') loadCreativeOperations();
    else if (tab === 'professional-ops') loadProfessionalOperations();
    else if (tab === 'continuity-ops') loadContinuityOperations();
    else if (tab === 'calendar') loadHours();
    else if (tab === 'skills') loadSkills();
    else if (tab === 'ai') { /* AI tab loads its own data */ }
    else if (tab === 'overview') loadOverview();
    else if (tab === 'invoices') loadInvoices();
    else if (tab === 'tax') loadTax();
    else if (tab === 'goals') {
      loadGoals();
      loadOverview();
    }
    else if (tab === 'maintenance') loadMaintenance();
    else if (tab === 'team') loadTeam();
  }, [loadingBiz, businesses, bizId, tab, loadProfile, loadServices, loadGallery, loadPolicies, loadFAQs, loadHours, loadSkills, loadOverview, loadInvoices, loadTax, loadGoals, loadMaintenance, loadPropertyOperations, loadTradesOperations, loadBeautyOperations, loadCreativeOperations, loadProfessionalOperations, loadContinuityOperations, loadTeam]);

  // ── switcher ──────────────────────────────────────────────────────────────
  function handleSwitchBiz(id) {
    setBizId(id);
    localStorage.setItem(LS_KEY, id);
    setAnalyticsLoading(true);
    setAnalytics(null); setAnalyticsError(false); setInvoiceData(null); setTaxData(null); setGoals([]); setMaintenanceData({ requests: [], stats: null }); setPropertyOpsData(null); setTradesOpsData(null); setBeautyOpsData(null); setCreativeOpsData(null); setProfessionalOpsData(null); setContinuityOpsData(null);
    setMembersLoading(true);
    setMembers([]);
  }

  // ── modal helpers ─────────────────────────────────────────────────────────
  function closeModal() { setModal(null); setSelected(null); setFormErr(''); }
  function fc(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  // ── add business ──────────────────────────────────────────────────────────
  async function handleAddBiz() {
    if (!form.business_name?.trim()) { setFormErr(t('businessHub.errBusinessNameRequired')); return; }
    setSaving(true);
    try {
      await createBusiness({ ...form, tax_rate: form.tax_rate ? parseFloat(form.tax_rate) : undefined });
      toast.success(t('businessHub.toastBizAdded'));
      closeModal();
      await loadBusinesses();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastBizCreateFail')); }
    finally { setSaving(false); }
  }

  // ── invoice CRUD ──────────────────────────────────────────────────────────
  async function handleSaveInvoice() {
    if (!form.client_name?.trim()) { setFormErr(t('businessHub.errClientNameRequired')); return; }
    if (!form.due_date) { setFormErr(t('businessHub.errDueDateRequired')); return; }
    const items = (form.line_items || []).filter(li => li.description?.trim());
    if (items.length === 0) { setFormErr(t('businessHub.errLineItemRequired')); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        invoice_tax_rate: form.invoice_tax_rate !== '' && form.invoice_tax_rate != null ? parseFloat(form.invoice_tax_rate) : undefined,
        line_items: items.map(li => ({
          description: li.description,
          quantity: parseFloat(li.quantity) || 1,
          unit_price: parseFloat(li.unit_price) || 0,
        })),
      };
      if (modal === 'add-inv') {
        await createInvoice(bizId, payload);
        toast.success(t('businessHub.toastInvoiceCreated'));
      } else {
        await updateInvoice(bizId, selected.id, payload);
        toast.success(t('businessHub.toastInvoiceUpdated'));
      }
      closeModal();
      await loadInvoices();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastInvoiceSaveFail')); }
    finally { setSaving(false); }
  }

  async function handleMarkInvoicePaid() {
    setSaving(true);
    try {
      await markInvoicePaid(bizId, selected.id, form.amount ? parseFloat(form.amount) : undefined);
      toast.success(t('businessHub.toastInvoicePaid'));
      closeModal();
      await loadInvoices();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastGenericFail')); }
    finally { setSaving(false); }
  }

  async function handleDeleteInvoice(inv) {
    if (!window.confirm(t('businessHub.confirmDeleteInvoice', { num: inv.invoice_number }))) return;
    try {
      await deleteInvoice(bizId, inv.id);
      toast.success(t('businessHub.toastInvoiceDeleted'));
      await loadInvoices();
    } catch { toast.error(t('businessHub.toastInvoiceDeleteFail')); }
  }

  async function handleSendInvoice(inv) {
    try {
      const result = await sendInvoice(bizId, inv.id);
      const { isInternalUser, publicToken } = result;

      if (isInternalUser) {
        toast.success(t('businessHub.toastInvoiceSentInternal'));
      } else if (publicToken) {
        const publicUrl = `${window.location.origin}/invoice/p/${publicToken}`;
        navigator.clipboard.writeText(publicUrl);
        toast.success(t('businessHub.toastInvoiceSentExternal'));
      }
      await loadInvoices();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('businessHub.toastInvoiceSendFail'));
    }
  }

  // ── tax ───────────────────────────────────────────────────────────────────
  async function handleRefreshTax() {
    try {
      await refreshTax(bizId);
      toast.success(t('businessHub.toastTaxRefreshed'));
      await loadTax();
    } catch { toast.error(t('businessHub.toastTaxRefreshFail')); }
  }

  async function handleMarkTaxPaid() {
    setSaving(true);
    try {
      await markTaxPaid(bizId, selected.id, form.amount ? parseFloat(form.amount) : undefined);
      toast.success(t('businessHub.toastTaxPaid'));
      closeModal();
      await loadTax();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastGenericFail')); }
    finally { setSaving(false); }
  }

  // ── goals ─────────────────────────────────────────────────────────────────
  async function handleSaveGoal() {
    if (!form.title?.trim()) { setFormErr(t('businessHub.errTitleRequired')); return; }
    if (!form.target_value) { setFormErr(t('businessHub.errTargetRequired')); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        target_value: parseFloat(form.target_value),
        current_value: form.current_value !== '' && form.current_value != null ? parseFloat(form.current_value) : undefined,
      };
      if (modal === 'add-goal') {
        await createGoal(bizId, payload);
        toast.success(t('businessHub.toastGoalAdded'));
      } else {
        await updateGoal(bizId, selected.id, payload);
        toast.success(t('businessHub.toastGoalUpdated'));
      }
      closeModal();
      await loadGoals();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastGoalSaveFail')); }
    finally { setSaving(false); }
  }

  async function handleDeleteGoal(g) {
    if (!window.confirm(t('businessHub.confirmDeleteGoal', { title: g.title }))) return;
    try {
      await deleteGoal(bizId, g.id);
      toast.success(t('businessHub.toastGoalDeleted'));
      await loadGoals();
    } catch { toast.error(t('businessHub.toastGoalDeleteFail')); }
  }

  // ── team ──────────────────────────────────────────────────────────────────
  async function handleInviteMember() {
    if (!form.invite_email?.trim()) { setFormErr(t('businessHub.errEmailRequired')); return; }
    if (!form.invite_role) { setFormErr(t('businessHub.errRoleRequired')); return; }
    setSaving(true);
    try {
      const result = await inviteMember(bizId, { email: form.invite_email.trim(), role: form.invite_role });
      toast.success(result.user_found ? t('businessHub.toastInviteSent') : t('businessHub.toastInviteRecorded'));
      closeModal();
      await loadTeam();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastInviteSendFail')); }
    finally { setSaving(false); }
  }

  async function handleRevokeMember(member) {
    const label = member.status === 'pending'
      ? t('businessHub.confirmCancelInvite', { email: member.invite_email })
      : t('businessHub.confirmRemoveMember', { name: member.first_name || member.invite_email });
    if (!window.confirm(label)) return;
    try {
      await revokeMember(bizId, member.id);
      toast.success(t('businessHub.toastMemberRemoved'));
      await loadTeam();
    } catch { toast.error(t('businessHub.toastMemberRemoveFail')); }
  }

  async function handleAcceptInvitation(inv) {
    try {
      await acceptInvitation(inv.id);
      toast.success(t('businessHub.toastInviteAccepted', { name: inv.business_name }));
      await loadTeam();
    } catch (e) { toast.error(e?.response?.data?.error || t('businessHub.toastInviteAcceptFail')); }
  }

  async function handleDeclineInvitation(inv) {
    try {
      await declineInvitation(inv.id);
      toast.success(t('businessHub.toastInviteDeclined'));
      await loadTeam();
    } catch { toast.error(t('businessHub.toastInviteDeclineFail')); }
  }

  // ── vortex token handlers ─────────────────────────────────────────────────
  async function handleGenerateToken() {
    if (!bizId) return;
    setGeneratingToken(true);
    try {
      await generateVortexToken(bizId, tokenForm);
      toast.success(t('businessHub.toastVortexGenerated'));
      const tokens = await listVortexTokens(bizId).catch(() => []);
      setVortexTokens(tokens);
    } catch (e) { toast.error(e?.response?.data?.error || t('businessHub.toastVortexGenerateFail')); }
    finally { setGeneratingToken(false); }
  }

  async function handleRevokeToken(tokenId) {
    if (!bizId) return;
    try {
      await revokeVortexToken(bizId, tokenId);
      toast.success(t('businessHub.toastTokenRevoked'));
      const tokens = await listVortexTokens(bizId).catch(() => []);
      setVortexTokens(tokens);
    } catch { toast.error(t('businessHub.toastTokenRevokeFail')); }
  }

  async function handleCreateAccessCode() {
    if (!bizId) return;
    setGeneratingAccessCode(true);
    try {
      const label = accessCodeForm.label.trim();
      await createAccessCode(bizId, {
        role: accessCodeForm.role,
        label: label || null,
        requires_approval: accessCodeForm.requires_approval,
      });
      toast.success(t('businessHub.toastAccessCodeCreated'));
      setAccessCodeForm(current => ({ ...current, label: '' }));
      const codes = await listAccessCodes(bizId).catch(() => []);
      setAccessCodes(codes);
    } catch (e) {
      toast.error(e?.response?.data?.error || t('businessHub.toastAccessCodeCreateFail'));
    } finally {
      setGeneratingAccessCode(false);
    }
  }

  async function handleRevokeAccessCode(codeId) {
    if (!bizId) return;
    try {
      await revokeAccessCode(bizId, codeId);
      toast.success(t('businessHub.toastAccessCodeRevoked'));
      const codes = await listAccessCodes(bizId).catch(() => []);
      setAccessCodes(codes);
    } catch {
      toast.error(t('businessHub.toastAccessCodeRevokeFail'));
    }
  }

  // ── invoice line items helpers ────────────────────────────────────────────
  function addLineItem() {
    setForm(f => ({ ...f, line_items: [...(f.line_items || []), { description: '', quantity: 1, unit_price: '' }] }));
  }
  function removeLineItem(i) {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, idx) => idx !== i) }));
  }
  function updateLineItem(i, field, value) {
    setForm(f => {
      const items = [...f.line_items];
      items[i] = { ...items[i], [field]: value };
      return { ...f, line_items: items };
    });
  }
  function calcTotals(lineItems, taxRate) {
    const subtotal = (lineItems || []).reduce((s, li) => s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0), 0);
    const taxAmt   = subtotal * ((parseFloat(taxRate) || 0) / 100);
    return { subtotal, taxAmt, total: subtotal + taxAmt };
  }

  // ── services CRUD ─────────────────────────────────────────────────────────
  async function handleSaveService() {
    if (!form.name?.trim()) { setFormErr(t('businessHub.errServiceNameRequired')); return; }
    if (!form.price && form.price !== 0) { setFormErr(t('businessHub.errPriceRequired')); return; }
    const price = Math.round(parseFloat(form.price) * 100) / 100;
    if (isNaN(price)) { setFormErr(t('businessHub.errPriceNumeric')); return; }
    if (price < 0 || price > 999999.99) { setFormErr(t('businessHub.errPriceRange')); return; }
    setSaving(true);
    try {
      const payload = { ...form, price };
      if (modal === 'add-service') {
        await createBusinessService(bizId, payload);
        toast.success(t('businessHub.toastServiceCreated'));
      } else {
        await updateBusinessService(bizId, selected.id, payload);
        toast.success(t('businessHub.toastServiceUpdated'));
      }
      closeModal();
      await loadServices();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastServiceCreateFail')); }
    finally { setSaving(false); }
  }

  async function handleDeleteService(svc) {
    if (!window.confirm(t('businessHub.confirmDeleteService', { name: svc.name }))) return;
    try {
      await deleteBusinessService(bizId, svc.id);
      toast.success(t('businessHub.toastServiceDeleted'));
      await loadServices();
    } catch { toast.error(t('businessHub.toastServiceDeleteFail')); }
  }

  // ── gallery CRUD ──────────────────────────────────────────────────────────
  async function handleSavePhoto() {
    if (!form.url?.trim()) { setFormErr(t('businessHub.errPhotoURLRequired')); return; }
    try {
      new URL(form.url);
    } catch {
      setFormErr(t('businessHub.errPhotoURLInvalid'));
      return;
    }
    setSaving(true);
    try {
      if (modal === 'add-photo') {
        await addBusinessPhoto(bizId, form);
        toast.success(t('businessHub.toastPhotoUploaded'));
      } else {
        await updateBusinessPhoto(bizId, selected.id, form);
        toast.success(t('businessHub.toastPhotoUpdated'));
      }
      closeModal();
      await loadGallery();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastPhotoCreateFail')); }
    finally { setSaving(false); }
  }

  async function handleDeletePhoto(photo) {
    if (!window.confirm(t('businessHub.confirmDeletePhoto'))) return;
    try {
      await deleteBusinessPhoto(bizId, photo.id);
      toast.success(t('businessHub.toastPhotoDeleted'));
      await loadGallery();
    } catch { toast.error(t('businessHub.toastPhotoDeleteFail')); }
  }

  // ── policies CRUD ─────────────────────────────────────────────────────────
  async function handleSavePolicy() {
    if (!form.title?.trim()) { setFormErr(t('businessHub.errPolicyTitleRequired')); return; }
    if (!form.content?.trim()) { setFormErr(t('businessHub.errPolicyContentRequired')); return; }
    setSaving(true);
    try {
      if (modal === 'add-policy') {
        await createBusinessPolicy(bizId, form);
        toast.success(t('businessHub.toastPolicyCreated'));
      } else {
        await updateBusinessPolicy(bizId, selected.id, form);
        toast.success(t('businessHub.toastPolicyUpdated'));
      }
      closeModal();
      await loadPolicies();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastPolicyCreateFail')); }
    finally { setSaving(false); }
  }

  async function handleDeletePolicy(policy) {
    if (!window.confirm(t('businessHub.confirmDeletePolicy', { title: policy.title }))) return;
    try {
      await deleteBusinessPolicy(bizId, policy.id);
      toast.success(t('businessHub.toastPolicyDeleted'));
      await loadPolicies();
    } catch { toast.error(t('businessHub.toastPolicyDeleteFail')); }
  }

  // ── faqs CRUD ─────────────────────────────────────────────────────────────
  async function handleSaveFAQ() {
    if (!form.question?.trim()) { setFormErr(t('businessHub.errQuestionRequired')); return; }
    if (!form.answer?.trim()) { setFormErr(t('businessHub.errAnswerRequired')); return; }
    setSaving(true);
    try {
      if (modal === 'add-faq') {
        await createBusinessFAQ(bizId, form);
        toast.success(t('businessHub.toastFAQCreated'));
      } else {
        await updateBusinessFAQ(bizId, selected.id, form);
        toast.success(t('businessHub.toastFAQUpdated'));
      }
      closeModal();
      await loadFAQs();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastFAQCreateFail')); }
    finally { setSaving(false); }
  }

  async function handleDeleteFAQ(faq) {
    if (!window.confirm(t('businessHub.confirmDeleteFAQ'))) return;
    try {
      await deleteBusinessFAQ(bizId, faq.id);
      toast.success(t('businessHub.toastFAQDeleted'));
      await loadFAQs();
    } catch { toast.error(t('businessHub.toastFAQDeleteFail')); }
  }

  // ── hours CRUD ────────────────────────────────────────────────────────────
  async function handleSaveHours() {
    setSaving(true);
    try {
      const hoursData = [0, 1, 2, 3, 4, 5, 6].map(dayNum => ({
        day_of_week: dayNum,
        is_closed: form[`closed_${dayNum}`],
        start_time: form[`closed_${dayNum}`] ? null : (form[`start_${dayNum}`] || null),
        end_time: form[`closed_${dayNum}`] ? null : (form[`end_${dayNum}`] || null),
      }));
      await updateBusinessHours(bizId, { hours: hoursData });
      toast.success(t('businessHub.toastHoursUpdated'));
      closeModal();
      await loadHours();
    } catch (e) { setFormErr(e?.response?.data?.error || t('businessHub.toastHoursUpdateFail')); }
    finally { setSaving(false); }
  }

  // ── current biz object + caller's role ───────────────────────────────────
  async function handleUpdateMaintenanceRequest(requestId, payload) {
    try {
      await updateMaintenanceRequest(requestId, payload);
      toast.success(t('businessHub.maintenance.toastUpdated'));
      await loadMaintenance();
    } catch (e) {
      toast.error(e?.response?.data?.error || t('businessHub.maintenance.toastUpdateFail'));
    }
  }

  async function handleConvertMaintenanceRequest(requestId) {
    try {
      const { job } = await convertMaintenanceRequestToJob(requestId);
      toast.success(t('businessHub.maintenance.toastConverted'));
      await loadMaintenance();
      if (job?.id && window.confirm(t('businessHub.maintenance.confirmOpenNewJob'))) {
        window.open(`/jobs/${job.id}`, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || t('businessHub.maintenance.toastConvertFail'));
    }
  }

  const currentBiz  = businesses.find(b => String(b.id) === String(bizId));
  const currentRole = currentBiz?._role || 'owner';
  const canEditBizProfile = currentRole === 'owner' || currentRole === 'manager';
  const canViewFinanceHub = currentRole !== 'representative';
  const financeTabIds = ['overview', 'invoices', 'tax', 'goals'];
  const contentTabIds = ['services', 'gallery', 'policies', 'faqs', 'skills', 'ai'];
  const tabAliases = {
    hours: 'calendar',
    appointments: 'calendar',
    waitlist: 'calendar',
    'booking-services': 'services',
  };
  // Maintenance is only part of the default tab set when this business has
  // selected the Property Manager template. For every other template the tab
  // would be confusing dead UI - it lives there only because of that template.
  const activeTemplate = currentBiz?.active_template || 'default';
  const isPropertyManagerTpl = activeTemplate === 'property_manager';
  const isTradesOpsTemplate = ['trades_pro', 'electrician', 'auto_mechanic'].includes(activeTemplate);
  const isBeautyOpsTemplate = ['beauty_style', 'barbershop', 'hair_stylist', 'spa_skincare'].includes(activeTemplate);
  const isCreativeOpsTemplate = ['photographer', 'creative_studio', 'graphic_design'].includes(activeTemplate);
  const isProfessionalOpsTemplate = ['accountant', 'consulting_coaching', 'legal_admin'].includes(activeTemplate);
  const isContinuityOpsTemplate = ['fitness_pro', 'wellness_therapy', 'nutrition_diet', 'mental_health', 'massage_therapist', 'care_trust', 'pet_services', 'tutoring_education', 'child_development', 'dog_walker', 'math_tutor'].includes(activeTemplate);
  // Tab order:
  //   1. Overview (KPIs / health, the place owners land first)
  //   2. Edit Profile
  //   3. Clients (managers/owners track customers per business)
  //   4. Content tabs (services, gallery, policies, faqs, hours, skills, ai)
  //   5. Calendar
  //   6. Property ops + maintenance (only for property_manager template)
  //   7. Invoices / Tax / Goals
  //   8. Team
  const candidateTabs = [
    'overview',
    'workflow',
    'profile',
    'clients',
    ...contentTabIds,
    'products',
    'messages',
    'calendar',
    ...(isPropertyManagerTpl ? ['property-ops'] : []),
    ...(isTradesOpsTemplate ? ['trades-ops'] : []),
    ...(isBeautyOpsTemplate ? ['beauty-ops'] : []),
    ...(isCreativeOpsTemplate ? ['creative-ops'] : []),
    ...(isProfessionalOpsTemplate ? ['professional-ops'] : []),
    ...(isContinuityOpsTemplate ? ['continuity-ops'] : []),
    ...(isPropertyManagerTpl ? ['maintenance'] : []),
    'invoices', 'tax', 'goals',
    'service-pricing',
    'product-pricing',
    'analytics',
    'loyalty',
    'team',
    'integrations',
    'expenses',
    'quotes',
    'recurring',
    'staff',
    'reviews-mgmt',
    'marketing',
    'packages',
    'health',
    'leads',
    'msg-templates',
  ];
  const visibleTabs = candidateTabs.filter((tb) => LAUNCH_BUSINESS_HUB_TABS.has(tb)).filter((tb) => {
    if (tb === 'workflow' && !canEditBizProfile) return false;
    if (tb === 'profile' && !canEditBizProfile) return false;
    if (tb === 'clients' && !canEditBizProfile) return false;
    if (contentTabIds.includes(tb) && !canEditBizProfile) return false;
    if (['booking-services','appointments','products','messages','service-pricing','product-pricing'].includes(tb) && !canEditBizProfile) return false;
    if (financeTabIds.includes(tb) && !canViewFinanceHub) return false;
    if (tb === 'overview' && !canViewFinanceHub) return false;
    if (tb === 'analytics' && !canEditBizProfile) return false;
    if (tb === 'loyalty' && !canEditBizProfile) return false;
    if (tb === 'integrations' && currentRole !== 'owner') return false;
    if (['property-ops','trades-ops','beauty-ops','creative-ops','professional-ops','continuity-ops','expenses','quotes','recurring','staff','reviews-mgmt','marketing','waitlist','packages','health','leads','msg-templates'].includes(tb) && !canEditBizProfile) return false;
    return true;
  });

  useEffect(() => {
    const aliasedTab = tabAliases[tab];
    if (aliasedTab && aliasedTab !== tab) {
      setTab(aliasedTab);
      return;
    }
    if (tab === 'workflow' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
      return;
    }
    if ((tab === 'profile' || contentTabIds.includes(tab)) && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (tab === 'property-ops' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (tab === 'trades-ops' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (tab === 'beauty-ops' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (tab === 'creative-ops' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (tab === 'professional-ops' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (tab === 'continuity-ops' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (tab === 'ai' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (financeTabIds.includes(tab) && !canViewFinanceHub) {
      setTab('team');
    }
  }, [bizId, canEditBizProfile, canViewFinanceHub, tab]);

  // tab label resolver
  const tabLabel = (tb) => {
    if (tb === 'workflow') return t('businessHub.tabWorkflowLabel', { defaultValue: 'Workflow System' });
    if (tb === 'profile') return t('businessHub.tabEditProfile');
    if (tb === 'services') return t('businessHub.tabServicesLabel', { defaultValue: 'Services & Booking' });
    if (tb === 'gallery') return t('businessHub.tabGalleryLabel');
    if (tb === 'policies') return t('businessHub.tabPoliciesLabel');
    if (tb === 'faqs') return t('businessHub.tabFAQsLabel');
    if (tb === 'hours') return t('businessHub.tabHoursLabel');
    if (tb === 'skills') return t('businessHub.tabSkillsLabel');
    if (tb === 'team') return t('businessHub.tabTeamLabel');
    if (tb === 'overview') return t('businessHub.tabOverviewLabel');
    if (tb === 'invoices') return t('businessHub.tabInvoicesLabel');
    if (tb === 'tax') return t('businessHub.tabTaxLabel');
    if (tb === 'goals') return t('businessHub.tabGoalsLabel');
    if (tb === 'maintenance') return t('businessHub.tabMaintenanceLabel', { defaultValue: 'Maintenance' });
    if (tb === 'property-ops') return t('businessHub.tabPropertyOpsLabel', { defaultValue: 'Property Ops' });
    if (tb === 'trades-ops') return t('businessHub.tabTradesOpsLabel', { defaultValue: 'Trades Ops' });
    if (tb === 'beauty-ops') return t('businessHub.tabBeautyOpsLabel', { defaultValue: 'Beauty Ops' });
    if (tb === 'creative-ops') return t('businessHub.tabCreativeOpsLabel', { defaultValue: 'Creative Ops' });
    if (tb === 'professional-ops') return t('businessHub.tabProfessionalOpsLabel', { defaultValue: 'Professional Ops' });
    if (tb === 'continuity-ops') return t('businessHub.tabContinuityOpsLabel', { defaultValue: 'Continuity Ops' });
    if (tb === 'calendar') return t('businessHub.tabCalendarLabel', { defaultValue: 'Schedule' });
    if (tb === 'clients') return t('businessHub.tabClientsLabel', { defaultValue: 'Clients' });
    if (tb === 'ai') return t('businessHub.tabAILabel');
    if (tb === 'messages')         return t('businessHub.tabMessagesLabel',        { defaultValue: 'Messages' });
    if (tb === 'appointments')     return t('businessHub.tabAppointmentsLabel',    { defaultValue: 'Appointments' });
    if (tb === 'booking-services') return t('businessHub.tabBookingServicesLabel', { defaultValue: 'Book Services' });
    if (tb === 'products')         return t('businessHub.tabProductsLabel',        { defaultValue: 'Products' });
    if (tb === 'service-pricing')  return t('businessHub.tabServicePricingLabel',  { defaultValue: 'Service Pricing' });
    if (tb === 'product-pricing')  return t('businessHub.tabProductPricingLabel',  { defaultValue: 'Product Pricing' });
    if (tb === 'analytics')        return t('businessHub.tabAnalyticsLabel',        { defaultValue: 'Analytics' });
    if (tb === 'loyalty')          return t('businessHub.tabLoyaltyLabel',          { defaultValue: 'Loyalty' });
    if (tb === 'integrations')     return t('businessHub.tabIntegrationsLabel',     { defaultValue: 'Integrations' });
    if (tb === 'expenses')         return t('businessHub.tabExpensesLabel', { defaultValue: 'Expenses' });
    if (tb === 'quotes')           return t('businessHub.tabQuotesLabel', { defaultValue: 'Quotes' });
    if (tb === 'recurring')        return t('businessHub.tabRecurringLabel', { defaultValue: 'Recurring' });
    if (tb === 'staff')            return t('businessHub.tabStaffLabel', { defaultValue: 'Staff' });
    if (tb === 'reviews-mgmt')     return t('businessHub.tabReviewsLabel', { defaultValue: 'Reviews' });
    if (tb === 'marketing')        return t('businessHub.tabMarketingLabel', { defaultValue: 'Marketing' });
    if (tb === 'waitlist')         return t('businessHub.tabWaitlistLabel', { defaultValue: 'Waitlist' });
    if (tb === 'packages')         return t('businessHub.tabPackagesLabel', { defaultValue: 'Packages' });
    if (tb === 'health')           return t('businessHub.tabHealthLabel', { defaultValue: 'Health' });
    if (tb === 'leads')            return t('businessHub.tabLeadsLabel', { defaultValue: 'Leads' });
    if (tb === 'msg-templates')    return t('businessHub.tabTemplatesLabel', { defaultValue: 'Templates' });
    return tb;
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageMeta title={t('businessHub.metaTitle')} description={t('businessHub.metaDesc')} />
      <div className="bh-page">

        {/* Header */}
        <div className="bh-header">
          <div>
            <h1>{t('businessHub.header')}</h1>
            <p>{t('businessHub.headerDesc')}</p>
          </div>
          <div className="bh-header-actions">
            {LAUNCH_VISIBILITY.businessHubGrowthTools && (
              <Link className="bh-btn" to="/promote">
                Growth Center
              </Link>
            )}
            <button className="bh-btn primary" onClick={() => { setForm(DEFAULT_BIZ_FORM); setFormErr(''); setModal('add-biz'); }}>
              + {t('businessHub.addBusiness')}
            </button>
          </div>
        </div>

        {/* Business switcher */}
        {loadingBiz ? (
          <p className="bh-loading">{t('businessHub.loadingBusinesses')}</p>
        ) : businesses.length === 0 ? (
          <div className="bh-empty">
            <p style={{ fontWeight: 700 }}>{t('businessHub.noBiz')}</p>
            <p>{t('businessHub.noBizDesc')}</p>
            <button className="bh-btn primary" onClick={() => { setForm(DEFAULT_BIZ_FORM); setFormErr(''); setModal('add-biz'); }}>
              {t('businessHub.addABusiness')}
            </button>
          </div>
        ) : (
          <>
            <div className="bh-switcher">
              <span className="bh-switcher-label">{t('businessHub.switcherLabel')}</span>
              <select value={bizId} onChange={e => handleSwitchBiz(e.target.value)}>
                {businesses.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.business_name}
                    {b._role !== 'owner' ? ` (${b._role === 'manager' ? t('businessHub.roleManager') : t('businessHub.roleRepresentative')})` : ''}
                  </option>
                ))}
              </select>
              {currentBiz?.is_primary && currentRole === 'owner' && <span className="bh-primary-tag">{t('businessHub.tagPrimary')}</span>}
              {currentRole !== 'owner' && (
                <span className="bh-primary-tag" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)' }}>
                  {currentRole === 'manager' ? t('businessHub.tagManager') : t('businessHub.tagRepresentative')}
                </span>
              )}
              {bizId && (
                <Link
                  to={`/business/${bizId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bh-view-profile-link"
                  title={t('businessHub.viewPublicProfile')}
                >
                  {t('businessHub.viewProfile')} ↗
                </Link>
              )}
              {bizId && canEditBizProfile && LAUNCH_VISIBILITY.businessHubSpecializedTemplates && (
                <Link
                  to={`/templates?type=business&bizId=${encodeURIComponent(bizId)}`}
                  className="bh-view-profile-link"
                  title={t('businessHub.switchTemplateTitle', { defaultValue: 'Switch this business to a different profile template' })}
                  style={{ color: '#a855f7' }}
                >
                  {t('businessHub.switchTemplate', { defaultValue: 'Switch template' })} ✨
                </Link>
              )}
            </div>

            {/* Role-aware top menu (team-role spec section 7) — sits above the
                legacy tab strip and switches the same `tab` state. */}
            {bizId ? (
              <RoleMenu
                businessId={bizId}
                activeTab={tab}
                onSelectTab={(tb) => setTab(tb)}
              />
            ) : null}

            {/* Tabs */}
            <div className="bh-tabs">
              {visibleTabs.map(tb => (
                <button key={tb} className={`bh-tab${tab === tb ? ' active' : ''}`} onClick={() => setTab(tb)}>
                  {tabLabel(tb)}
                </button>
              ))}
            </div>

            {/* ── Profile tab ──────────────────────────────────────── */}
            {tab === 'profile' && (
              profileLoading ? <p className="bh-loading">{t('businessHub.loadingProfile')}</p> :
              !profileForm && profileErr ? (
                <div className="bh-empty" style={{ marginTop: '1rem' }}>
                  <p className="bh-error" style={{ marginBottom: '1rem' }}>{profileErr}</p>
                  <button type="button" className="bh-btn primary" onClick={() => loadProfile()}>
                    {t('businessHub.tryAgain')}
                  </button>
                </div>
              ) :
              <ProfileTab
                form={profileForm}
                logoPreview={logoPreview}
                coverPreview={coverPreview}
                saving={profileSaving}
                err={profileErr}
                currentRole={currentRole}
                onChange={(patch) => setProfileForm(f => ({ ...f, ...patch }))}
                onLogoChange={(file) => {
                  setLogoFile(file);
                  setLogoPreview(file ? URL.createObjectURL(file) : null);
                }}
                onCoverChange={(file) => {
                  setCoverFile(file);
                  setCoverPreview(file ? URL.createObjectURL(file) : null);
                }}
                onSave={handleSaveProfile}
                bizId={bizId}
              />
            )}

            {/* ── Services tab ─────────────────────────────────────── */}
            {tab === 'services' && (
              servicesLoading ? <p className="bh-loading">{t('businessHub.loadingServices')}</p> :
              <div className="space-y-6">
                <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold text-white">Services & Booking</h2>
                    <p className="mt-1 text-sm leading-6 text-gray-400">
                      Manage the public services customers see and the bookable service configurations they can schedule against from one place.
                    </p>
                  </div>
                  <ServicesTab services={services} businessId={bizId}
                    onNew={() => { setForm({}); setFormErr(''); setModal('add-service'); }}
                    onEdit={svc => { setSelected(svc); setForm(svc); setFormErr(''); setModal('edit-service'); }}
                    onDelete={handleDeleteService}
                  />
                </div>
                {bizId && canEditBizProfile && (
                  <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-white">Bookable Service Setup</h3>
                      <p className="mt-1 text-sm leading-6 text-gray-400">
                        Set durations, capacity, pricing, booking notice, and service-level scheduling rules for appointments tied to this business.
                      </p>
                    </div>
                    <BusinessServicesTab businessId={bizId} />
                  </div>
                )}
              </div>
            )}

            {/* ── Gallery tab ──────────────────────────────────────── */}
            {tab === 'gallery' && (
              galleryLoading ? <p className="bh-loading">{t('businessHub.loadingGallery')}</p> :
              <GalleryTab gallery={gallery} businessId={bizId}
                onNew={() => { setForm({}); setFormErr(''); setModal('add-photo'); }}
                onEdit={photo => { setSelected(photo); setForm(photo); setFormErr(''); setModal('edit-photo'); }}
                onDelete={handleDeletePhoto}
              />
            )}

            {/* ── Policies tab ─────────────────────────────────────── */}
            {tab === 'policies' && (
              policiesLoading ? <p className="bh-loading">{t('businessHub.loadingPolicies')}</p> :
              <PoliciesTab policies={policies} businessId={bizId}
                onNew={() => { setForm({}); setFormErr(''); setModal('add-policy'); }}
                onEdit={policy => { setSelected(policy); setForm(policy); setFormErr(''); setModal('edit-policy'); }}
                onDelete={handleDeletePolicy}
              />
            )}

            {/* ── FAQs tab ─────────────────────────────────────────── */}
            {tab === 'faqs' && (
              faqsLoading ? <p className="bh-loading">{t('businessHub.loadingFAQs')}</p> :
              <FAQsTab faqs={faqs} businessId={bizId}
                onNew={() => { setForm({}); setFormErr(''); setModal('add-faq'); }}
                onEdit={faq => { setSelected(faq); setForm(faq); setFormErr(''); setModal('edit-faq'); }}
                onDelete={handleDeleteFAQ}
              />
            )}

            {/* ── Hours tab ────────────────────────────────────────── */}


            {/* ── Skills tab ───────────────────────────────────────── */}
            {tab === 'skills' && (
              skillsLoading ? <p className="bh-loading">{t('businessHub.loadingSkills')}</p> :
              <BusinessSkillsSelector
                businessId={bizId}
                onSkillsChange={(updatedSkills) => setSkills(updatedSkills)}
              />
            )}

            {tab === 'ai' && canEditBizProfile && bizId && (
              <AIKnowledgeTab profileType="business" profileId={bizId} />
            )}

            {tab === 'maintenance' && (
              maintenanceLoading ? <p className="bh-loading">Loading maintenance requests...</p> :
              <MaintenanceRequestsTab
                businessId={bizId}
                data={maintenanceData}
                currency={currency}
                onRefresh={loadMaintenance}
                onUpdate={handleUpdateMaintenanceRequest}
                onConvert={handleConvertMaintenanceRequest}
              />
            )}

            {tab === 'property-ops' && (
              propertyOpsLoading ? <p className="bh-loading">Loading property operations...</p> :
              <PropertyOperationsTab
                businessId={bizId}
                workspace={propertyOpsData}
                currency={currency}
                onRefresh={loadPropertyOperations}
                onJumpTab={(nextTab) => setTab(nextTab)}
              />
            )}

            {tab === 'trades-ops' && (
              tradesOpsLoading ? <p className="bh-loading">Loading trades operations...</p> :
              <TradesOperationsTab
                businessId={bizId}
                workspace={tradesOpsData}
                currency={currency}
                onRefresh={loadTradesOperations}
                onJumpTab={(nextTab) => setTab(nextTab)}
              />
            )}

            {tab === 'beauty-ops' && (
              beautyOpsLoading ? <p className="bh-loading">Loading beauty operations...</p> :
              <BeautyOperationsTab
                businessId={bizId}
                workspace={beautyOpsData}
                currency={currency}
                onRefresh={loadBeautyOperations}
                onJumpTab={(nextTab) => setTab(nextTab)}
              />
            )}

            {tab === 'creative-ops' && (
              creativeOpsLoading ? <p className="bh-loading">Loading creative operations...</p> :
              <CreativeOperationsTab
                businessId={bizId}
                workspace={creativeOpsData}
                currency={currency}
                onRefresh={loadCreativeOperations}
                onJumpTab={(nextTab) => setTab(nextTab)}
              />
            )}

            {tab === 'professional-ops' && (
              professionalOpsLoading ? <p className="bh-loading">Loading professional operations...</p> :
              <ProfessionalOperationsTab
                businessId={bizId}
                workspace={professionalOpsData}
                currency={currency}
                onRefresh={loadProfessionalOperations}
                onJumpTab={(nextTab) => setTab(nextTab)}
              />
            )}

            {tab === 'continuity-ops' && (
              continuityOpsLoading ? <p className="bh-loading">Loading continuity operations...</p> :
              <ContinuityOperationsTab
                businessId={bizId}
                workspace={continuityOpsData}
                currency={currency}
                onRefresh={loadContinuityOperations}
                onJumpTab={(nextTab) => setTab(nextTab)}
              />
            )}

            {tab === 'calendar' && bizId && (
              <div className="space-y-6">
                <div className="bh-calendar-wrap">
                  <div className="bh-calendar-header">
                    <h2>{currentBiz?.business_name || 'Business'} schedule</h2>
                    <p>
                      This combined schedule workspace keeps business hours, appointments,
                      calendar events, and follow-up demand in one place so the team can plan
                      work without bouncing between tabs.
                    </p>
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Business Hours</h3>
                      <p className="mt-1 text-sm leading-6 text-gray-400">
                        Set when this business is open so customers and staff see the right operating rhythm.
                      </p>
                    </div>
                  </div>
                  {hoursLoading ? <p className="bh-loading">{t('businessHub.loadingHours')}</p> : (
                    <HoursTab hours={hours} businessId={bizId}
                      onEdit={() => {
                        setFormErr('');
                        const formData = {};
                        hours.forEach(h => {
                          formData[`closed_${h.day_of_week}`] = h.is_closed;
                          formData[`start_${h.day_of_week}`] = h.start_time || '';
                          formData[`end_${h.day_of_week}`] = h.end_time || '';
                        });
                        [0, 1, 2, 3, 4, 5, 6].forEach(d => {
                          if (!formData[`closed_${d}`] && !formData[`start_${d}`]) {
                            formData[`closed_${d}`] = false;
                            formData[`start_${d}`] = '';
                            formData[`end_${d}`] = '';
                          }
                        });
                        setForm(formData);
                        setModal('edit-hours');
                      }}
                    />
                  )}
                </div>

                {canEditBizProfile && (
                  <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-white">Appointments</h3>
                      <p className="mt-1 text-sm leading-6 text-gray-400">
                        Manage the appointment calendar tied to this business, including bookable slots and customer reservations.
                      </p>
                    </div>
                    <AppointmentCalendarView businessId={bizId} />
                  </div>
                )}

                <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-white">Business Calendar</h3>
                    <p className="mt-1 text-sm leading-6 text-gray-400">
                      Track team meetings, deliveries, supplier visits, training, and other events that belong to this business.
                    </p>
                  </div>
                  <BusinessCalendarView bizId={bizId} canManage={canEditBizProfile} />
                </div>

                {canEditBizProfile && (
                  <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-white">Waitlist & Follow-ups</h3>
                      <p className="mt-1 text-sm leading-6 text-gray-400">
                        Keep demand warm by tracking people waiting for availability, reschedules, or the next open spot.
                      </p>
                    </div>
                    <WaitlistManager businessId={bizId} />
                  </div>
                )}
              </div>
            )}

            {tab === 'clients' && bizId && canEditBizProfile && (
              <BusinessClientsTab
                bizId={bizId}
                businessName={currentBiz?.business_name}
                currency={currency}
              />
            )}

            {/* ── Overview tab ────────────────────────────────────── */}
            {tab === 'overview' && (
              analyticsLoading || (bizId && !analytics && !analyticsError) ? (
                <p className="bh-loading">{t('businessHub.loadingAnalytics')}</p>
              ) : analyticsError ? (
                <p className="bh-error">{t('businessHub.errorAnalytics')}</p>
              ) : (
                <OverviewTab
                  analytics={analytics}
                  currency={currency}
                  bizId={bizId}
                  businessName={currentBiz?.business_name}
                  canManage={canEditBizProfile}
                  setTab={setTab}
                />
              )
            )}

            {tab === 'workflow' && bizId && canEditBizProfile && (
              <TemplateWorkflowSystemTab
                activeTemplate={activeTemplate}
                currentBiz={currentBiz}
                currentRole={currentRole}
                services={services}
                gallery={gallery}
                reviews={[]}
                faqs={faqs}
                hours={hours}
                members={members}
                analytics={analytics}
                onJumpTab={setTab}
              />
            )}

            {/* ── Invoices tab ─────────────────────────────────────── */}
            {tab === 'invoices' && (
              invoicesLoading ? <p className="bh-loading">{t('businessHub.loadingInvoices')}</p> :
              <InvoicesTab
                data={invoiceData}
                currency={currency}
                onNew={() => { setForm(DEFAULT_INV_FORM); setFormErr(''); setModal('add-inv'); }}
                onEdit={inv => {
                  setSelected(inv);
                  setForm({
                    client_name: inv.client_name || '',
                    client_email: inv.client_email || '',
                    client_company: inv.client_company || '',
                    due_date: inv.due_date ? inv.due_date.split('T')[0] : '',
                    invoice_tax_rate: inv.invoice_tax_rate ?? '',
                    notes: inv.notes || '',
                    status: inv.status || 'draft',
                    line_items: (inv.line_items?.length ? inv.line_items : [{ description: '', quantity: 1, unit_price: '' }]),
                  });
                  setFormErr('');
                  setModal('edit-inv');
                }}
                onSend={handleSendInvoice}
                onPay={inv => { setSelected(inv); setForm({ amount: inv.total || '' }); setFormErr(''); setModal('pay-inv'); }}
                onDelete={handleDeleteInvoice}
              />
            )}

            {/* ── Tax tab ──────────────────────────────────────────── */}
            {tab === 'tax' && (
              taxLoading ? <p className="bh-loading">{t('businessHub.loadingTax')}</p> :
              <TaxTab
                data={taxData}
                currency={currency}
                onRefresh={handleRefreshTax}
                onPay={est => { setSelected(est); setForm({ amount: est.estimated_tax || '' }); setFormErr(''); setModal('pay-tax'); }}
              />
            )}

            {/* ── Goals tab ────────────────────────────────────────── */}
            {tab === 'goals' && (
              goalsLoading ? <p className="bh-loading">{t('businessHub.loadingGoals')}</p> :
              <GoalsTab
                goals={goals}
                analytics={analytics}
                currency={currency}
                onNew={() => { setForm(DEFAULT_GOAL_FORM); setFormErr(''); setModal('add-goal'); }}
                onEdit={g => {
                  setSelected(g);
                  setForm({
                    title: g.title || '',
                    goal_type: g.goal_type || 'revenue',
                    period: g.period || 'monthly',
                    target_value: g.target_value ?? '',
                    current_value: g.current_value ?? '',
                  });
                  setFormErr('');
                  setModal('edit-goal');
                }}
                onDelete={handleDeleteGoal}
              />
            )}

            {/* ── Team tab ─────────────────────────────────────────── */}
            {tab === 'team' && (
              membersLoading ? <p className="bh-loading">{t('businessHub.loadingTeam')}</p> :
              <TeamTab
                members={members}
                invitations={invitations}
                managedBiz={managedBiz}
                vortexTokens={vortexTokens}
                tokenForm={tokenForm}
                accessCodes={accessCodes}
                accessCodeForm={accessCodeForm}
                onTokenFormChange={(patch) => setTokenForm(f => ({ ...f, ...patch }))}
                onAccessCodeFormChange={(patch) => setAccessCodeForm(f => ({ ...f, ...patch }))}
                onGenerateToken={handleGenerateToken}
                generatingToken={generatingToken}
                onCreateAccessCode={handleCreateAccessCode}
                generatingAccessCode={generatingAccessCode}
                onRevokeToken={handleRevokeToken}
                onRevokeAccessCode={handleRevokeAccessCode}
                showVortexAccess={LAUNCH_VISIBILITY.businessHubVortexAccess}
                onInvite={() => { setForm({ invite_email: '', invite_role: 'representative' }); setFormErr(''); setModal('invite-member'); }}
                onRevoke={handleRevokeMember}
                onAccept={handleAcceptInvitation}
                onDecline={handleDeclineInvitation}
              />
            )}

            {/* ── Messages tab ─────────────────────────────────────── */}
            {tab === 'messages' && bizId && canEditBizProfile && (
              <BusinessMessagingTab businessId={bizId} />
            )}

            {/* ── Products tab ─────────────────────────────────────── */}
            {tab === 'products' && bizId && canEditBizProfile && (
              <ProductManagement businessId={bizId} />
            )}

            {/* ── Service Pricing tab ──────────────────────────────── */}
            {tab === 'service-pricing' && bizId && canEditBizProfile && (
              <PricingRulesManager businessId={bizId} />
            )}

            {/* ── Product Pricing tab ──────────────────────────────── */}
            {tab === 'product-pricing' && bizId && canEditBizProfile && (
              <ProductPricingManager businessId={bizId} />
            )}

            {/* ── Analytics tab ────────────────────────────────────── */}
            {tab === 'analytics' && bizId && canEditBizProfile && (
              <BusinessAnalyticsTab businessId={bizId} />
            )}

            {/* ── Loyalty tab ──────────────────────────────────────── */}
            {tab === 'loyalty' && bizId && canEditBizProfile && (
              <CustomerLoyaltyManager businessId={bizId} />
            )}

            {/* ── Integrations tab ─────────────────────────────────── */}
            {tab === 'integrations' && bizId && currentRole === 'owner' && (
              <BusinessIntegrations businessId={bizId} />
            )}

            {/* ── Expense Tracker ──────────────────────────────────── */}
            {tab === 'expenses' && bizId && canEditBizProfile && (
              <ExpenseTracker businessId={bizId} />
            )}

            {/* ── Quote Builder ────────────────────────────────────── */}
            {tab === 'quotes' && bizId && canEditBizProfile && (
              <QuoteBuilder businessId={bizId} />
            )}

            {/* ── Recurring Billing ────────────────────────────────── */}
            {tab === 'recurring' && bizId && canEditBizProfile && (
              <RecurringBillingManager businessId={bizId} />
            )}

            {/* ── Staff Scheduler ──────────────────────────────────── */}
            {tab === 'staff' && bizId && canEditBizProfile && (
              <StaffScheduler businessId={bizId} />
            )}

            {/* ── Review Manager ───────────────────────────────────── */}
            {tab === 'reviews-mgmt' && bizId && canEditBizProfile && (
              <ReviewManager businessId={bizId} />
            )}

            {/* ── Marketing Tools ──────────────────────────────────── */}
            {tab === 'marketing' && bizId && canEditBizProfile && (
              <MarketingTools businessId={bizId} />
            )}

            {/* ── Service Packages ─────────────────────────────────── */}
            {tab === 'packages' && bizId && canEditBizProfile && (
              <ServicePackagesManager businessId={bizId} />
            )}

            {/* ── Health Alerts ────────────────────────────────────── */}
            {tab === 'health' && bizId && canEditBizProfile && (
              <HealthAlertsDashboard businessId={bizId} />
            )}

            {/* ── Lead Pipeline ────────────────────────────────────── */}
            {tab === 'leads' && bizId && canEditBizProfile && (
              <LeadPipeline businessId={bizId} />
            )}

            {/* ── Message Templates ────────────────────────────────── */}
            {tab === 'msg-templates' && bizId && canEditBizProfile && (
              <MessageTemplatesManager businessId={bizId} />
            )}
          </>
        )}

        {/* ── Modal: Add Business ───────────────────────────────────── */}
        {modal === 'add-biz' && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{t('businessHub.modalAddBiz')}</h2>
              <div className="bh-field"><label>{t('businessHub.fieldNameRequired')}</label><input name="business_name" value={form.business_name || ''} onChange={fc} placeholder={t('businessHub.placeholderBizName')} /></div>
              <div className="bh-field"><label>{t('businessHub.fieldDescription')}</label><textarea name="description" value={form.description || ''} onChange={fc} rows={2} /></div>
              <div className="bh-field-row">
                <div className="bh-field"><label>{t('businessHub.fieldPhone')}</label><input name="phone" value={form.phone || ''} onChange={fc} /></div>
                <div className="bh-field"><label>{t('businessHub.fieldWebsite')}</label><input name="website" value={form.website || ''} onChange={fc} placeholder={t('businessHub.placeholderWebsite')} /></div>
              </div>
              <div className="bh-field"><label>{t('businessHub.fieldDefaultTaxRate')}</label><input type="number" name="tax_rate" value={form.tax_rate || ''} onChange={fc} placeholder="0" min="0" max="100" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleAddBiz} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.addBusiness')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Add / Edit Invoice ─────────────────────────────── */}
        {(modal === 'add-inv' || modal === 'edit-inv') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-inv' ? t('businessHub.modalNewInvoice') : t('businessHub.modalEditInvoice')}</h2>
              <div className="bh-field-row">
                <div className="bh-field"><label>{t('businessHub.fieldClientNameRequired')}</label><input name="client_name" value={form.client_name || ''} onChange={fc} /></div>
                <div className="bh-field"><label>{t('businessHub.fieldClientEmail')}</label><input type="email" name="client_email" value={form.client_email || ''} onChange={fc} /></div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>{t('businessHub.fieldCompany')}</label><input name="client_company" value={form.client_company || ''} onChange={fc} /></div>
                <div className="bh-field"><label>{t('businessHub.fieldDueDateRequired')}</label><input type="date" name="due_date" value={form.due_date || ''} onChange={fc} /></div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>{t('businessHub.fieldTaxRate')}</label><input type="number" name="invoice_tax_rate" value={form.invoice_tax_rate ?? ''} onChange={fc} placeholder="0" min="0" max="100" step="0.01" /></div>
                <div className="bh-field">
                  <label>{t('businessHub.fieldStatus')}</label>
                  <select name="status" value={form.status || 'draft'} onChange={fc}>
                    <option value="draft">{t('businessHub.statusDraft')}</option>
                    <option value="sent">{t('businessHub.statusSent')}</option>
                    <option value="paid">{t('businessHub.statusPaid')}</option>
                    <option value="cancelled">{t('businessHub.statusCancelled')}</option>
                  </select>
                </div>
              </div>

              {/* Line items */}
              <div className="bh-field"><label>{t('businessHub.fieldLineItems')}</label></div>
              <div className="bh-line-items">
                {(form.line_items || []).map((li, i) => (
                  <div key={i} className="bh-line-item">
                    <input placeholder={t('businessHub.placeholderLineDesc')} value={li.description || ''} onChange={e => updateLineItem(i, 'description', e.target.value)} />
                    <input type="number" placeholder={t('businessHub.placeholderLineQty')} value={li.quantity || ''} onChange={e => updateLineItem(i, 'quantity', e.target.value)} min="0" step="0.01" />
                    <input type="number" placeholder={t('businessHub.placeholderLineUnit')} value={li.unit_price || ''} onChange={e => updateLineItem(i, 'unit_price', e.target.value)} min="0" step="0.01" />
                    <button className="bh-line-remove" onClick={() => removeLineItem(i)} disabled={(form.line_items || []).length <= 1}>×</button>
                  </div>
                ))}
                <button className="bh-line-add" onClick={addLineItem}>{t('businessHub.addLineItem')}</button>
              </div>

              {/* Live totals preview */}
              {(() => {
                const { subtotal, taxAmt, total } = calcTotals(form.line_items, form.invoice_tax_rate);
                return (
                  <div className="bh-totals">
                    <div>{t('businessHub.subtotal')}: {fmt$(subtotal, currency)}</div>
                    {taxAmt > 0 && <div>{t('businessHub.taxLabel')} ({form.invoice_tax_rate || 0}%): {fmt$(taxAmt, currency)}</div>}
                    <div className="grand">{t('businessHub.total')}: {fmt$(total, currency)}</div>
                  </div>
                );
              })()}

              <div className="bh-field"><label>{t('businessHub.fieldNotes')}</label><textarea name="notes" value={form.notes || ''} onChange={fc} rows={2} /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleSaveInvoice} disabled={saving}>{saving ? t('businessHub.btnSaving') : modal === 'add-inv' ? t('businessHub.btnCreateInvoice') : t('businessHub.btnSaveChanges')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Mark Invoice Paid ──────────────────────────────── */}
        {modal === 'pay-inv' && selected && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{t('businessHub.modalMarkInvoicePaid')}</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                {t('businessHub.invoiceTotalLabel', { num: selected.invoice_number, total: fmt$(selected.total, currency) })}
              </p>
              <div className="bh-field"><label>{t('businessHub.fieldAmountReceived')}</label><input type="number" name="amount" value={form.amount || ''} onChange={fc} min="0" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleMarkInvoicePaid} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.btnMarkPaid')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Add / Edit Goal ────────────────────────────────── */}
        {(modal === 'add-goal' || modal === 'edit-goal') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-goal' ? t('businessHub.modalAddGoal') : t('businessHub.modalEditGoal')}</h2>
              <div className="bh-field"><label>{t('businessHub.fieldTitleRequired')}</label><input name="title" value={form.title || ''} onChange={fc} placeholder={t('businessHub.placeholderGoalTitle')} /></div>
              <div className="bh-field-row">
                <div className="bh-field">
                  <label>{t('businessHub.fieldType')}</label>
                  <select name="goal_type" value={form.goal_type || 'revenue'} onChange={fc}>
                    <option value="revenue">{t('businessHub.goalTypeRevenue')}</option>
                    <option value="profit">{t('businessHub.goalTypeProfit')}</option>
                    <option value="jobs">{t('businessHub.goalTypeJobs')}</option>
                    <option value="clients">{t('businessHub.goalTypeClients')}</option>
                    <option value="invoiced">{t('businessHub.goalTypeInvoiced')}</option>
                  </select>
                </div>
                <div className="bh-field">
                  <label>{t('businessHub.fieldPeriod')}</label>
                  <select name="period" value={form.period || 'monthly'} onChange={fc}>
                    <option value="weekly">{t('businessHub.periodWeekly')}</option>
                    <option value="monthly">{t('businessHub.periodMonthly')}</option>
                    <option value="quarterly">{t('businessHub.periodQuarterly')}</option>
                    <option value="yearly">{t('businessHub.periodYearly')}</option>
                  </select>
                </div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>{t('businessHub.fieldTargetValueRequired')}</label><input type="number" name="target_value" value={form.target_value || ''} onChange={fc} min="0" step="0.01" /></div>
                <div className="bh-field"><label>{t('businessHub.fieldCurrentValue')}</label><input type="number" name="current_value" value={form.current_value ?? ''} onChange={fc} min="0" step="0.01" /></div>
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleSaveGoal} disabled={saving}>{saving ? t('businessHub.btnSaving') : modal === 'add-goal' ? t('businessHub.btnAddGoal') : t('businessHub.btnSaveChanges')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Mark Tax Paid ──────────────────────────────────── */}
        {modal === 'pay-tax' && selected && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{t('businessHub.modalRecordTaxPayment')}</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                {t('businessHub.taxQuarterLabel', { quarter: selected.quarter, year: selected.tax_year, amount: fmt$(selected.estimated_tax, currency) })}
              </p>
              <div className="bh-field"><label>{t('businessHub.fieldAmountPaid')}</label><input type="number" name="amount" value={form.amount || ''} onChange={fc} min="0" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleMarkTaxPaid} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.btnRecordPayment')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Invite Team Member ─────────────────────────────── */}
        {modal === 'invite-member' && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{t('businessHub.modalInviteMember')}</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                {t('businessHub.inviteMemberDesc')}
              </p>
              <div className="bh-field">
                <label>{t('businessHub.fieldEmailRequired')}</label>
                <input
                  type="email"
                  name="invite_email"
                  value={form.invite_email || ''}
                  onChange={fc}
                  placeholder={t('businessHub.placeholderInviteEmail')}
                />
              </div>
              <div className="bh-field">
                <label>{t('businessHub.fieldRoleRequired')}</label>
                <select name="invite_role" value={form.invite_role || 'representative'} onChange={fc}>
                  <option value="representative">{t('businessHub.roleRepresentativeDesc')}</option>
                  <option value="manager">{t('businessHub.roleManagerDesc')}</option>
                </select>
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleInviteMember} disabled={saving}>{saving ? t('businessHub.btnSending') : t('businessHub.btnSendInvite')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Service Modal ────────────────────────────────────────────── */}
        {(modal === 'add-service' || modal === 'edit-service') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-service' ? t('businessHub.modalAddService') : t('businessHub.modalEditService')}</h2>
              <div className="bh-field">
                <label>{t('businessHub.fieldServiceNameRequired')}</label>
                <input type="text" name="name" value={form.name || ''} onChange={fc} placeholder={t('businessHub.placeholderServiceName')} />
              </div>
              <div className="bh-field">
                <label>{t('businessHub.fieldServiceDescription')}</label>
                <textarea name="description" rows="3" value={form.description || ''} onChange={fc} placeholder={t('businessHub.placeholderServiceDesc')} />
              </div>
              <div className="bh-field" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label>{t('businessHub.fieldPriceRequired')}</label>
                  <input type="number" name="price" value={form.price || ''} onChange={fc} placeholder={t('businessHub.placeholderPrice')} step="0.01" min="0" />
                </div>
                <div>
                  <label>{t('businessHub.fieldPriceUnit')}</label>
                  <select name="price_unit" value={form.price_unit || 'flat'} onChange={fc}>
                    <option value="flat">{t('businessHub.priceUnitFlat')}</option>
                    <option value="hour">{t('businessHub.priceUnitHour')}</option>
                    <option value="starting_at">{t('businessHub.priceUnitStarting')}</option>
                    <option value="quote">{t('businessHub.priceUnitQuote')}</option>
                  </select>
                </div>
              </div>
              <div className="bh-field" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label>{t('businessHub.fieldDuration')}</label>
                  <input type="text" name="duration" value={form.duration || ''} onChange={fc} placeholder={t('businessHub.placeholderDuration')} />
                </div>
                <div>
                  <label>{t('businessHub.fieldCategory')}</label>
                  <input type="text" name="category" value={form.category || ''} onChange={fc} placeholder={t('businessHub.placeholderCategory')} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" name="popular" checked={form.popular || false} onChange={e => setForm(f => ({ ...f, popular: e.target.checked }))} />
                  {t('businessHub.fieldPopular')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" name="is_active" checked={form.is_active !== false} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  {t('businessHub.fieldActive')}
                </label>
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleSaveService} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveService')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Photo Modal ──────────────────────────────────────────────── */}
        {(modal === 'add-photo' || modal === 'edit-photo') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-photo' ? t('businessHub.modalAddPhoto') : t('businessHub.modalEditPhoto')}</h2>
              <div className="bh-field">
                <label>{t('businessHub.fieldPhotoURLRequired')}</label>
                <input type="url" name="url" value={form.url || ''} onChange={fc} placeholder={t('businessHub.placeholderPhotoURL')} />
              </div>
              <div className="bh-field">
                <label>{t('businessHub.fieldCaption')}</label>
                <input type="text" name="caption" value={form.caption || ''} onChange={fc} placeholder={t('businessHub.placeholderCaption')} />
              </div>
              <div className="bh-field">
                <label>{t('businessHub.fieldAltText')}</label>
                <input type="text" name="alt" value={form.alt || ''} onChange={fc} placeholder={t('businessHub.placeholderAltText')} />
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleSavePhoto} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.btnSavePhoto')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Policy Modal ──────────────────────────────────────────────── */}
        {(modal === 'add-policy' || modal === 'edit-policy') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-policy' ? t('businessHub.modalAddPolicy') : t('businessHub.modalEditPolicy')}</h2>
              <div className="bh-field">
                <label>{t('businessHub.fieldPolicyTitleRequired')}</label>
                <input type="text" name="title" value={form.title || ''} onChange={fc} placeholder={t('businessHub.placeholderPolicyTitle')} />
              </div>
              <div className="bh-field">
                <label>{t('businessHub.fieldPolicyContentRequired')}</label>
                <textarea name="content" rows="5" value={form.content || ''} onChange={fc} placeholder={t('businessHub.placeholderPolicyContent')} />
              </div>
              <div className="bh-field">
                <label>{t('businessHub.fieldPolicyIcon')}</label>
                <input type="text" name="icon" value={form.icon || ''} onChange={fc} placeholder={t('businessHub.placeholderPolicyIcon')} />
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleSavePolicy} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.btnSavePolicy')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── FAQ Modal ────────────────────────────────────────────────── */}
        {(modal === 'add-faq' || modal === 'edit-faq') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-faq' ? t('businessHub.modalAddFAQ') : t('businessHub.modalEditFAQ')}</h2>
              <div className="bh-field">
                <label>{t('businessHub.fieldQuestionRequired')}</label>
                <input type="text" name="question" value={form.question || ''} onChange={fc} placeholder={t('businessHub.placeholderQuestion')} />
              </div>
              <div className="bh-field">
                <label>{t('businessHub.fieldAnswerRequired')}</label>
                <textarea name="answer" rows="5" value={form.answer || ''} onChange={fc} placeholder={t('businessHub.placeholderAnswer')} />
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleSaveFAQ} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveFAQ')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Hours Modal ──────────────────────────────────────────────── */}
        {modal === 'edit-hours' && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{t('businessHub.modalEditHours')}</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)', marginBottom: '1.5rem' }}>{t('businessHub.helpHours')}</p>
              <div style={{ display: 'grid', gap: '1rem', maxHeight: '60vh', overflowY: 'auto' }}>
                {[0, 1, 2, 3, 4, 5, 6].map(dayNum => {
                  const days = [t('businessHub.daysSunday'), t('businessHub.daysMonday'), t('businessHub.daysTuesday'), t('businessHub.daysWednesday'), t('businessHub.daysThursday'), t('businessHub.daysFriday'), t('businessHub.daysSaturday')];
                  const isClosed = form[`closed_${dayNum}`];
                  return (
                    <div key={dayNum} style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={isClosed} onChange={e => setForm(f => ({ ...f, [`closed_${dayNum}`]: e.target.checked }))} />
                          <strong>{days[dayNum]}</strong>
                        </label>
                      </div>
                      {!isClosed && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <input type="time" value={form[`start_${dayNum}`] || ''} onChange={e => setForm(f => ({ ...f, [`start_${dayNum}`]: e.target.value }))} />
                          <input type="time" value={form[`end_${dayNum}`] || ''} onChange={e => setForm(f => ({ ...f, [`end_${dayNum}`]: e.target.value }))} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>{t('businessHub.btnCancel')}</button>
                <button className="bh-btn primary" onClick={handleSaveHours} disabled={saving}>{saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveHours')}</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </PageShell>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────────

const BIZ_TYPES = [
  { value: 'Handyman',       labelKey: 'bizTypeHandyman' },
  { value: 'Plumbing',       labelKey: 'bizTypePlumbing' },
  { value: 'Electrical',     labelKey: 'bizTypeElectrical' },
  { value: 'HVAC',           labelKey: 'bizTypeHVAC' },
  { value: 'Landscaping',    labelKey: 'bizTypeLandscaping' },
  { value: 'Cleaning',       labelKey: 'bizTypeCleaning' },
  { value: 'Painting',       labelKey: 'bizTypePainting' },
  { value: 'Carpentry',      labelKey: 'bizTypeCarpentry' },
  { value: 'Roofing',        labelKey: 'bizTypeRoofing' },
  { value: 'Flooring',       labelKey: 'bizTypeFlooring' },
  { value: 'Moving',         labelKey: 'bizTypeMoving' },
  { value: 'Pest Control',   labelKey: 'bizTypePestControl' },
  { value: 'Pool Service',   labelKey: 'bizTypePoolService' },
  { value: 'Auto Repair',    labelKey: 'bizTypeAutoRepair' },
  { value: 'General Labor',  labelKey: 'bizTypeGeneralLabor' },
  { value: 'Other',          labelKey: 'bizTypeOther' },
];

function ProfileTab({ form, logoPreview, coverPreview, saving, err, currentRole, onChange, onLogoChange, onCoverChange, onSave, bizId }) {
  const { t } = useTranslation();
  const [expandContact, setExpandContact] = useState(false);
  const [expandLocation, setExpandLocation] = useState(false);

  if (!form) return null;

  function pf(e) {
    const { name, value } = e.target;
    onChange({ [name]: value });
  }

  const profileChecks = [
    !!form.business_name?.trim(),
    !!form.business_type?.trim(),
    !!form.profile_headline?.trim(),
    !!form.description?.trim(),
    !!form.phone?.trim(),
    !!form.address_city?.trim(),
    !!logoPreview,
    !!coverPreview,
  ];
  const completedChecks = profileChecks.filter(Boolean).length;
  const completionPct = Math.round((completedChecks / profileChecks.length) * 100);
  const contactSummary = [
    form.phone?.trim(),
    form.website?.trim(),
  ].filter(Boolean).join(' • ') || 'Add a phone number and website so customers can trust and contact your business.';
  const locationParts = [
    form.address_city?.trim(),
    form.address_state?.trim(),
    form.address_country?.trim(),
  ].filter(Boolean);
  const locationSummary = locationParts.length
    ? locationParts.join(', ')
    : 'Set your city, region, country, and service radius so local customers can find you.';
  const serviceRadiusLabel = form.service_radius_miles
    ? `${form.service_radius_miles} mile radius`
    : 'Service radius not set yet';

  return (
    <div className="space-y-6">
      {/* ── Header with preview link ──────────────────────────────────── */}
      <div className="rounded-3xl border border-orange-500/20 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.16),transparent_34%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(15,23,42,0.96))] px-6 py-6 shadow-[0_20px_80px_rgba(0,0,0,0.24)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-300">
              {t('businessHub.profileStudioEyebrow', { defaultValue: 'Profile Studio' })}
            </span>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-white">{t('businessHub.publicProfile')}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300">
              {t('businessHub.publicProfileSubtitle')} {t('businessHub.profileStudioSupportCopy', {
                defaultValue: 'This is the storefront customers judge in a few seconds, so lead with trust, clarity, and strong visuals.',
              })}
            </p>
            {currentRole === 'manager' && (
              <p className="mt-3 text-xs text-indigo-300">
                <Trans i18nKey="businessHub.managerNote">
                  You are editing as a <strong>Manager</strong>. Changes apply to the business owner's public profile.
                </Trans>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                {t('businessHub.profileReadinessLabel', { defaultValue: 'Profile Readiness' })}
              </div>
              <div className="mt-1 text-2xl font-bold text-white">{completionPct}%</div>
            </div>
            {bizId && (
              <a
                href={`/business/${bizId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-300 transition hover:bg-orange-500/20"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                {t('businessHub.preview')} →
              </a>
            )}
          </div>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-gradient-to-r from-orange-400 via-amber-400 to-emerald-400 transition-all" style={{ width: `${completionPct}%` }} />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              {t('businessHub.brandAssetsLabel', { defaultValue: 'Brand Assets' })}
            </div>
            <div className="mt-2 text-lg font-semibold text-white">{logoPreview && coverPreview ? 'Ready to publish' : 'Needs visual polish'}</div>
            <p className="mt-1 text-sm leading-6 text-gray-400">
              {logoPreview && coverPreview
                ? 'Your logo and cover already give the public page a stronger first impression.'
                : 'Add a logo and cover photo so the public profile feels established before customers scroll.'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              {t('businessHub.trustSignalsLabel', { defaultValue: 'Trust Signals' })}
            </div>
            <div className="mt-2 text-lg font-semibold text-white">{form.phone?.trim() && form.website?.trim() ? 'Contact-ready' : 'Needs contact details'}</div>
            <p className="mt-1 text-sm leading-6 text-gray-400">{contactSummary}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              {t('businessHub.serviceReachLabel', { defaultValue: 'Service Reach' })}
            </div>
            <div className="mt-2 text-lg font-semibold text-white">{locationParts.length ? locationSummary : 'Location not fully set'}</div>
            <p className="mt-1 text-sm leading-6 text-gray-400">{serviceRadiusLabel}</p>
          </div>
        </div>
      </div>

      <div className="hidden flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">{t('businessHub.publicProfile')}</h2>
          <p className="text-xs text-gray-500 mt-1">{t('businessHub.publicProfileSubtitle')}</p>
          {currentRole === 'manager' && (
            <p className="text-xs text-indigo-400 mt-2">
              <Trans i18nKey="businessHub.managerNote">
                You are editing as a <strong>Manager</strong>. Changes apply to the business owner's public profile.
              </Trans>
            </p>
          )}
        </div>
        {bizId && (
          <a
            href={`/business/${bizId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition border border-orange-500/30 text-sm font-semibold whitespace-nowrap"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            {t('businessHub.preview')} ↗
          </a>
        )}
      </div>

      {/* ── Photos Card ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-3xl border border-gray-800 bg-gray-900/95 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
        <div className="border-b border-gray-800 bg-white/[0.02] px-6 py-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">{t('businessHub.sectionPhotos')}</h3>
              <p className="mt-1 text-sm leading-6 text-gray-400">
                {t('businessHub.photosSectionSupportCopy', {
                  defaultValue: 'Customers scan visuals before reading details. Use a clean square logo and a welcoming cover image that feels local, professional, and real.',
                })}
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-300">
              <span className={`h-2.5 w-2.5 rounded-full ${logoPreview || coverPreview ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {logoPreview || coverPreview ? 'Visuals in progress' : 'Add visuals to unlock trust'}
            </span>
          </div>
        </div>
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[0.95fr,1.05fr]">
          {/* Logo */}
          <div className="rounded-2xl border border-gray-800 bg-slate-950/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-gray-200">{t('businessHub.businessLogo')}</label>
              <span className="text-xs text-gray-500">Square works best</span>
            </div>
            <div className="mb-3 flex w-full aspect-square items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-700 bg-gray-800/70">
              {logoPreview ? (
                <img src={logoPreview} alt={t('businessHub.logoPreviewAlt')} className="w-full h-full object-cover" />
              ) : (
                <div className="flex max-w-[15rem] flex-col items-center gap-3 px-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl">◎</div>
                  <div>
                    <div className="text-sm font-medium text-gray-300">{t('businessHub.noLogo')}</div>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Use your mark, monogram, or storefront badge so customers recognize the business instantly.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={e => onLogoChange(e.target.files?.[0] || null)}
              id="bh-logo-input"
            />
            <div className="flex gap-2">
              <label htmlFor="bh-logo-input" className="flex-1 cursor-pointer rounded-xl bg-gray-800 px-3 py-2.5 text-center text-sm font-medium text-gray-200 transition hover:bg-gray-700">
                {logoPreview ? t('businessHub.changeLogo') : t('businessHub.uploadLogo')}
              </label>
              {logoPreview && (
                <button
                  type="button"
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition"
                  onClick={() => { onLogoChange(null); onChange({ logo_url: '' }); }}
                >
                  {t('businessHub.remove')}
                </button>
              )}
            </div>
          </div>

          {/* Cover photo */}
          <div className="rounded-2xl border border-gray-800 bg-slate-950/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-gray-200">{t('businessHub.coverPhoto')}</label>
              <span className="text-xs text-gray-500">Wide banner</span>
            </div>
            <div className="mb-3 flex w-full aspect-[3/1.5] items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-700 bg-gray-800/70">
              {coverPreview ? (
                <img src={coverPreview} alt={t('businessHub.coverPreviewAlt')} className="w-full h-full object-cover" />
              ) : (
                <div className="flex max-w-[18rem] flex-col items-center gap-3 px-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl">▭</div>
                  <div>
                    <div className="text-sm font-medium text-gray-300">{t('businessHub.noCoverPhoto')}</div>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Show your shop, team, equipment, or signature work so the page feels alive before a customer books.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={e => onCoverChange(e.target.files?.[0] || null)}
              id="bh-cover-input"
            />
            <div className="flex gap-2">
              <label htmlFor="bh-cover-input" className="flex-1 cursor-pointer rounded-xl bg-gray-800 px-3 py-2.5 text-center text-sm font-medium text-gray-200 transition hover:bg-gray-700">
                {coverPreview ? t('businessHub.changeCover') : t('businessHub.uploadCover')}
              </label>
              {coverPreview && (
                <button
                  type="button"
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition"
                  onClick={() => { onCoverChange(null); onChange({ cover_photo_url: '' }); }}
                >
                  {t('businessHub.remove')}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-800 px-6 py-4 text-xs text-gray-500">
          Logo: square preferred. Cover: 3:1 ratio for best results.
        </div>
      </div>

      {/* ── Business Identity Card ──────────────────────────────────── */}
      <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
        <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{t('businessHub.sectionBusinessIdentity')}</h3>
            <p className="mt-1 text-sm leading-6 text-gray-400">
              {t('businessHub.identitySectionSupportCopy', {
                defaultValue: 'Name, category, headline, and description shape the first serious impression. Keep this crisp, specific, and customer-facing.',
              })}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">What customers see first</div>
            <div className="mt-1 text-white">{form.profile_headline?.trim() || 'Add a sharp one-line promise for your business.'}</div>
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldBusinessNameRequired')}</label>
              <p className="mb-2 text-xs text-gray-500">Use the exact name you want customers to remember and share.</p>
              <input
                name="business_name"
                value={form.business_name}
                onChange={pf}
                placeholder={t('businessHub.placeholderBizName')}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldBusinessType')}</label>
                <p className="mb-2 text-xs text-gray-500">Choose the lane customers most likely search for first.</p>
                <select
                  name="business_type"
                  value={form.business_type}
                  onChange={pf}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
                >
                  <option value="">{t('businessHub.selectTypePlaceholder')}</option>
                  {BIZ_TYPES.map(bt => <option key={bt.value} value={bt.value}>{t(`businessHub.${bt.labelKey}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldTagline')}</label>
                <p className="mb-2 text-xs text-gray-500">A clear one-line promise beats a list of buzzwords.</p>
                <input
                  name="profile_headline"
                  value={form.profile_headline}
                  onChange={pf}
                  placeholder={t('businessHub.placeholderTagline')}
                  maxLength={120}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldAbout')}</label>
              <p className="mb-2 text-xs text-gray-500">Explain what you do, where you work, and why a customer should trust your business.</p>
              <textarea
                name="description"
                value={form.description}
                onChange={pf}
                rows={5}
                placeholder={t('businessHub.placeholderAbout')}
                className="w-full resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-slate-950/35 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              {t('businessHub.quickChecklistLabel', { defaultValue: 'Quick Checklist' })}
            </div>
            <ul className="mt-3 space-y-3 text-sm text-gray-300">
              {[
                { done: !!form.business_name?.trim(), label: 'Business name is set' },
                { done: !!form.business_type?.trim(), label: 'Business type is selected' },
                { done: !!form.profile_headline?.trim(), label: 'Headline is ready' },
                { done: !!form.description?.trim(), label: 'About section has content' },
              ].map((item) => (
                <li key={item.label} className="flex items-start gap-3">
                  <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${item.done ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/8 text-gray-500'}`}>
                    {item.done ? '✓' : '•'}
                  </span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Contact Info (Collapsible) ──────────────────────────────── */}
      <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
        <button
          type="button"
          onClick={() => setExpandContact(!expandContact)}
          aria-expanded={expandContact}
          className="flex w-full items-center justify-between gap-4 text-left transition hover:opacity-90"
        >
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-white">{t('businessHub.sectionContact')}</h3>
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${form.phone?.trim() || form.website?.trim() ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-400">{contactSummary}</p>
          </div>
          <svg
            className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform ${expandContact ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>

        {expandContact && (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldPhone')}</label>
              <input
                name="phone"
                value={form.phone}
                onChange={pf}
                placeholder={t('businessHub.placeholderPhone')}
                type="tel"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldWebsite')}</label>
              <input
                name="website"
                value={form.website}
                onChange={pf}
                placeholder={t('businessHub.placeholderWebsiteFull')}
                type="url"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Location & Service Area (Collapsible) ──────────────────────── */}
      <div className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
        <button
          type="button"
          onClick={() => setExpandLocation(!expandLocation)}
          aria-expanded={expandLocation}
          className="flex w-full items-center justify-between gap-4 text-left transition hover:opacity-90"
        >
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-white">{t('businessHub.sectionLocation')}</h3>
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${form.address_city?.trim() ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              {locationSummary}. {serviceRadiusLabel}.
            </p>
          </div>
          <svg
            className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform ${expandLocation ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>

        {expandLocation && (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldStreetAddress')}</label>
              <input
                name="address_street"
                value={form.address_street}
                onChange={pf}
                placeholder={t('businessHub.placeholderStreet')}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">{t('businessHub.streetHint')}</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldCountry') || 'Country'}</label>
              <CountrySelect
                value={form.address_country || 'US'}
                onChange={(code) => {
                  // Switching country invalidates the current state if it
                  // came from a fixed-list country; clear it for safety.
                  onChange({ address_country: code, address_state: '' });
                }}
                includeBlank={false}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldCity')}</label>
                <input
                  name="address_city"
                  value={form.address_city}
                  onChange={pf}
                  placeholder={t('businessHub.placeholderCity')}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldState')}</label>
                <RegionInput
                  country={form.address_country || 'US'}
                  name="address_state"
                  value={form.address_state}
                  onChange={(v) => onChange({ address_state: v })}
                  placeholder={t('businessHub.selectStatePlaceholder')}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldZip')}</label>
                <PostalCodeInput
                  country={form.address_country || 'US'}
                  name="address_zip"
                  value={form.address_zip}
                  onChange={(v) => onChange({ address_zip: v })}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="sm:w-1/3">
              <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('businessHub.fieldServiceRadius')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="service_radius_miles"
                  value={form.service_radius_miles}
                  onChange={pf}
                  placeholder={t('businessHub.placeholderRadius')}
                  min="1"
                  max="200"
                  className="flex-1 rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition focus:border-orange-500 focus:outline-none"
                />
                <span className="text-gray-500 text-sm">mi</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Error & Actions ──────────────────────────────────────────────── */}
      <div className="sticky bottom-4 z-10 rounded-3xl border border-orange-500/20 bg-[linear-gradient(180deg,rgba(17,24,39,0.96),rgba(15,23,42,0.98))] px-5 py-4 shadow-[0_20px_80px_rgba(0,0,0,0.3)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">
              {completionPct >= 100 ? 'Profile looks publish-ready.' : `Profile is ${completionPct}% complete.`}
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              {completionPct >= 100
                ? 'Give the preview one final review, then keep services, gallery, and hours aligned with the public promise above.'
                : 'Finish the missing basics before publishing so customers see a confident, complete storefront.'}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-w-[220px] items-center justify-center rounded-2xl bg-gradient-to-r from-orange-400 to-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:from-orange-300 hover:to-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveProfile')}
          </button>
        </div>
        {err && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        <p className="mt-4 text-xs text-gray-500">{t('businessHub.profileFooterNote')}</p>
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ analytics, currency, bizId, businessName, canManage, setTab }) {
  const { t, i18n } = useTranslation();
  const a = analytics;
  const monthly = a?.monthly || [];
  const profitCls = value => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return undefined;
    return parsed >= 0 ? 'positive' : 'negative';
  };
  const allVals = monthly.flatMap(m => [
    parseFloat(m.revenue) || 0,
    parseFloat(m.expenses) || 0,
    parseFloat(m.profit)   || 0,
  ]);
  const maxVal = Math.max(...allVals.map(v => Math.abs(v)), 1);

  // ── Calendar summary (today / this week / next 24h) ─────────────────────────
  const [calSummary, setCalSummary] = useState(null);
  useEffect(() => {
    let mounted = true;
    if (!bizId) return undefined;
    getBusinessCalendarSummary(bizId)
      .then((s) => { if (mounted) setCalSummary(s || {}); })
      .catch(() => { if (mounted) setCalSummary({}); });
    return () => { mounted = false; };
  }, [bizId]);

  // ── Cash-flow runway: avg net burn from negative-profit months ─────────────
  const runway = (() => {
    if (!monthly.length) return null;
    const recent = monthly.slice(-6);
    const profits = recent.map((m) => parseFloat(m.profit) || 0);
    const avgProfit = profits.reduce((acc, v) => acc + v, 0) / profits.length;
    const totalRevenue = recent.reduce((acc, m) => acc + (parseFloat(m.revenue) || 0), 0);
    const totalExpenses = recent.reduce((acc, m) => acc + (parseFloat(m.expenses) || 0), 0);
    const burn = Math.max(0, totalExpenses - totalRevenue) / recent.length;
    const cashOnHand = parseFloat(a?.cash_on_hand) || null;
    const months = burn > 0 && cashOnHand ? Math.floor(cashOnHand / burn) : null;
    return { avgProfit, burn, months, healthy: avgProfit >= 0 };
  })();

  // ── Outstanding revenue ratio (overdue/sent) ───────────────────────────────
  const outstandingPct = (() => {
    const sent = parseFloat(a?.invoices?.outstanding_total) || 0;
    const overdue = parseFloat(a?.invoices?.overdue_total) || 0;
    if (sent <= 0) return 0;
    return Math.min(100, Math.round((overdue / sent) * 100));
  })();

  const goTo = (id) => () => setTab && setTab(id);
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const nextLabel = calSummary?.next_event_at
    ? new Date(calSummary.next_event_at).toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <>
      {/* ── Today snapshot ─────────────────────────────────────────────────── */}
      <div className="bh-today-strip" role="region" aria-label={t('businessHub.overview.todayRegion')}>
        <div className="bh-today-head">
          <div>
            <span className="bh-today-kicker">
              {t('businessHub.overview.todayAtBusiness', {
                business: businessName || t('businessHub.overview.yourBusiness'),
              })}
            </span>
            <h2>{new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          </div>
          {nextLabel && (
            <div className="bh-today-next">
              <span>{t('businessHub.overview.nextUp')}</span>
              <strong>{nextLabel}</strong>
            </div>
          )}
        </div>
        <div className="bh-today-cards">
          <button type="button" className="bh-today-card" onClick={goTo('calendar')}>
            <span className="bh-today-card-num">{calSummary?.today_count ?? '-'}</span>
            <span className="bh-today-card-label">{t('businessHub.overview.onCalendarToday')}</span>
          </button>
          <button type="button" className="bh-today-card" onClick={goTo('calendar')}>
            <span className="bh-today-card-num">{calSummary?.this_week_count ?? '-'}</span>
            <span className="bh-today-card-label">{t('businessHub.overview.eventsThisWeek')}</span>
          </button>
          <button type="button" className="bh-today-card" onClick={goTo('invoices')}>
            <span className="bh-today-card-num">{a?.invoices?.overdue_count ?? 0}</span>
            <span className="bh-today-card-label">{t('businessHub.overview.overdueInvoices')}</span>
          </button>
          <button type="button" className="bh-today-card" onClick={goTo('invoices')}>
            <span className="bh-today-card-num">{fmt$(a?.invoices?.outstanding_total, currency)}</span>
            <span className="bh-today-card-label">{t('businessHub.overview.awaitingPayment')}</span>
          </button>
        </div>
      </div>

      {/* ── Quick actions ribbon ──────────────────────────────────────────── */}
      <div className="bh-quick-actions" role="region" aria-label={t('businessHub.overview.quickActionsRegion')}>
        {canManage && (
          <button type="button" className="bh-quick-btn" onClick={goTo('calendar')}>
            <span className="bh-quick-emoji" aria-hidden="true">📅</span>
            <strong>{t('businessHub.overview.quickActions.addEvent.title')}</strong>
            <span>{t('businessHub.overview.quickActions.addEvent.description')}</span>
          </button>
        )}
        <button type="button" className="bh-quick-btn" onClick={goTo('invoices')}>
          <span className="bh-quick-emoji" aria-hidden="true">🧾</span>
          <strong>{t('businessHub.overview.quickActions.sendInvoice.title')}</strong>
          <span>{t('businessHub.overview.quickActions.sendInvoice.description')}</span>
        </button>
        {LAUNCH_VISIBILITY.businessHubFinancialPlanning && (
          <button type="button" className="bh-quick-btn" onClick={goTo('goals')}>
            <span className="bh-quick-emoji" aria-hidden="true">🎯</span>
            <strong>{t('businessHub.overview.quickActions.setGoal.title')}</strong>
            <span>{t('businessHub.overview.quickActions.setGoal.description')}</span>
          </button>
        )}
        <button type="button" className="bh-quick-btn" onClick={goTo('team')}>
          <span className="bh-quick-emoji" aria-hidden="true">👥</span>
          <strong>{t('businessHub.overview.quickActions.inviteTeammate.title')}</strong>
          <span>{t('businessHub.overview.quickActions.inviteTeammate.description')}</span>
        </button>
        {LAUNCH_VISIBILITY.businessHubAdvancedOps && (
          <button type="button" className="bh-quick-btn" onClick={goTo('maintenance')}>
            <span className="bh-quick-emoji" aria-hidden="true">🛠</span>
            <strong>{t('businessHub.overview.quickActions.openMaintenance.title')}</strong>
            <span>{t('businessHub.overview.quickActions.openMaintenance.description')}</span>
          </button>
        )}
      </div>

      {/* ── Financial health: runway + outstanding mix ───────────────────── */}
      <div className="bh-health-grid">
        <div className="bh-health-card">
          <div className="bh-health-head">
            <span className="bh-health-kicker">{t('businessHub.overview.cashFlowSignal')}</span>
            <h3>{runway?.healthy ? t('businessHub.overview.healthyAverage') : t('businessHub.overview.tighteningWatch')}</h3>
          </div>
          <div className="bh-health-body">
            <p className="bh-health-stat">
              <strong>{fmt$(runway?.avgProfit ?? 0, currency)}</strong>
              <span>{t('businessHub.overview.avgMonthlyProfit')}</span>
            </p>
            {runway?.burn > 0 ? (
              <p className="bh-health-stat warn">
                <strong>{fmt$(runway.burn, currency)}</strong>
                <span>{t('businessHub.overview.avgMonthlyBurn')}</span>
              </p>
            ) : (
              <p className="bh-health-stat ok">
                <strong>{t('businessHub.overview.profitable')}</strong>
                <span>{t('businessHub.overview.revenueCoveringExpenses')}</span>
              </p>
            )}
            {runway?.months != null && (
              <p className="bh-health-stat">
                <strong>{t('businessHub.overview.runwayMonthsValue', { count: runway.months })}</strong>
                <span>{t('businessHub.overview.estimatedRunway')}</span>
              </p>
            )}
          </div>
        </div>

        <div className="bh-health-card">
          <div className="bh-health-head">
            <span className="bh-health-kicker">{t('businessHub.overview.receivablesMix')}</span>
            <h3>{t('businessHub.overview.outstandingVsOverdue')}</h3>
          </div>
          <div className="bh-health-body">
            <div className="bh-receivables-bar" aria-hidden="true">
              <div className="bh-receivables-overdue" style={{ width: `${outstandingPct}%` }} />
            </div>
            <p className="bh-health-stat">
              <strong>{fmt$(a?.invoices?.outstanding_total, currency)}</strong>
              <span>{t('businessHub.overview.totalAwaitingPayment')}</span>
            </p>
            <p className="bh-health-stat warn">
              <strong>{fmt$(a?.invoices?.overdue_total, currency)}</strong>
              <span>{t('businessHub.overview.outstandingOverdueRatio', { percent: outstandingPct })}</span>
            </p>
            <button type="button" className="bh-link-btn" onClick={goTo('invoices')}>
              {t('businessHub.overview.reviewInvoices')} →
            </button>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="bh-kpi-grid">
        <KPI label={t('businessHub.kpiMtdRevenue')}    value={fmt$(a?.mtd?.revenue, currency)}    cls="positive" />
        <KPI label={t('businessHub.kpiMtdProfit')}     value={fmt$(a?.mtd?.profit, currency)}     cls={profitCls(a?.mtd?.profit)} />
        <KPI label={t('businessHub.kpiLastMonthRevenue')} value={fmt$(a?.last_month?.revenue, currency)} />
        <KPI label={t('businessHub.kpiYtdRevenue')}    value={fmt$(a?.ytd?.revenue, currency)}    cls="positive" />
        <KPI label={t('businessHub.kpiYtdProfit')}     value={fmt$(a?.ytd?.profit, currency)}     cls={profitCls(a?.ytd?.profit)} />
        <KPI label={t('businessHub.kpiOutstanding')}    value={fmt$(a?.invoices?.outstanding_total, currency)} cls="warn"
          sub={t('businessHub.kpiInvoicesSent', { count: a?.invoices?.sent || 0 })} />
        <KPI label={t('businessHub.kpiOverdue')}        value={fmt$(a?.invoices?.overdue_total, currency)}     cls="negative"
          sub={t('businessHub.kpiInvoicesCount', { count: a?.invoices?.overdue_count || 0 })} />
        <KPI label={t('businessHub.kpiJobs6m')}      value={a?.jobs?.completed_6m ?? '-'} />
        <KPI label={t('businessHub.kpiAvgJobValue')}  value={fmt$(a?.jobs?.avg_value, currency)} />
      </div>

      {/* 6-month P&L bar chart */}
      {monthly.length > 0 && (
        <div className="bh-card">
          <div className="bh-card-header">
            <div><h2>{t('businessHub.chartTitle')}</h2></div>
          </div>
          <div className="bh-chart">
            {monthly.map((m, i) => {
              const rev = parseFloat(m.revenue)  || 0;
              const exp = parseFloat(m.expenses) || 0;
              const pro = parseFloat(m.profit)   || 0;
              const pct = v => `${Math.max(2, Math.round((Math.abs(v) / maxVal) * 180))}px`;
              return (
                <div key={i} className="bh-chart-bar-group">
                  <div className="bh-chart-bars">
                    <div className="bh-chart-bar revenue" style={{ height: pct(rev) }} title={t('businessHub.tooltipRevenue', { amount: fmt$(rev, currency) })} />
                    <div className="bh-chart-bar expense" style={{ height: pct(exp) }} title={t('businessHub.tooltipExpenses', { amount: fmt$(exp, currency) })} />
                    <div className="bh-chart-bar profit"  style={{ height: pct(pro) }} title={t('businessHub.tooltipProfit', { amount: fmt$(pro, currency) })} />
                  </div>
                  <span className="bh-chart-month">{fmtMonth(m.month)}</span>
                </div>
              );
            })}
          </div>
          <div className="bh-chart-legend">
            {[
              ['revenue', '#4ade80', t('businessHub.chartRevenue')],
              ['expense', '#f87171', t('businessHub.chartExpenses')],
              ['profit',  '#60a5fa', t('businessHub.chartProfit')],
            ].map(([, color, label]) => (
              <span key={label} className="bh-chart-legend-item">
                <span className="bh-chart-legend-dot" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function KPI({ label, value, cls, sub }) {
  return (
    <div className="bh-kpi">
      <div className="bh-kpi-label">{label}</div>
      <div className={`bh-kpi-value${cls ? ' ' + cls : ''}`}>{value}</div>
      {sub && <div className="bh-kpi-sub">{sub}</div>}
    </div>
  );
}

// ── Invoices tab ──────────────────────────────────────────────────────────────
function InvoicesTab({ data, onNew, onEdit, onPay, onDelete, onSend, currency }) {
  const { t } = useTranslation();
  const invoices = data?.invoices || [];
  const summary  = data?.summary  || {};

  const statusLabel = (status) => {
    const map = {
      draft: t('businessHub.invoiceStatusDraft'),
      sent: t('businessHub.invoiceStatusSent'),
      paid: t('businessHub.invoiceStatusPaid'),
      overdue: t('businessHub.invoiceStatusOverdue'),
      cancelled: t('businessHub.statusCancelled'),
    };
    return map[status] || status;
  };

  return (
    <>
      {/* Summary counts */}
      <div className="bh-kpi-grid" style={{ marginBottom: '1rem' }}>
        <KPI label={t('businessHub.invoiceStatusDraft')}       value={summary.draft       || 0} />
        <KPI label={t('businessHub.invoiceStatusSent')}        value={summary.sent        || 0} />
        <KPI label={t('businessHub.invoiceStatusPaid')}        value={summary.paid        || 0} cls="positive" />
        <KPI label={t('businessHub.invoiceStatusOverdue')}     value={summary.overdue     || 0} cls="negative" />
        <KPI label={t('businessHub.invoiceStatusOutstanding')} value={fmt$(summary.outstanding_total, currency)} cls="warn" />
      </div>

      <div className="bh-card">
        <div className="bh-card-header">
          <div><h2>{t('businessHub.invoicesSection')}</h2></div>
          <button className="bh-btn primary sm" onClick={onNew}>{t('businessHub.btnNewInvoice')}</button>
        </div>

        {invoices.length === 0 ? (
          <div className="bh-empty"><p>{t('businessHub.noInvoicesYet')}</p><button className="bh-btn primary" onClick={onNew}>{t('businessHub.btnCreateInvoiceShort')}</button></div>
        ) : (
          <div className="bh-table-wrap">
            <table className="bh-table">
              <thead>
                <tr>
                  <th>{t('businessHub.colNumber')}</th><th>{t('businessHub.colClient')}</th><th>{t('businessHub.colStatus')}</th><th>{t('businessHub.colDue')}</th>
                  <th className="num">{t('businessHub.colTotal')}</th><th className="num">{t('businessHub.colPaid')}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{inv.invoice_number}</td>
                    <td>
                      <div>{inv.client_name}</div>
                      {inv.client_company && <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{inv.client_company}</div>}
                    </td>
                    <td><span className={`bh-status ${inv.status}`}>{statusLabel(inv.status)}</span></td>
                    <td style={{ whiteSpace: 'nowrap', color: inv.status === 'overdue' ? '#f87171' : undefined }}>{fmtDate(inv.due_date)}</td>
                    <td className="num">{fmt$(inv.total, currency)}</td>
                    <td className="num">{fmt$(inv.amount_paid, currency)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {inv.status === 'draft' && (
                        <button className="bh-btn sm" style={{ marginRight: '0.3rem' }} onClick={() => onSend(inv)}>{t('businessHub.btnSendInvoice')}</button>
                      )}
                      {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                        <button className="bh-btn sm" style={{ marginRight: '0.3rem' }} onClick={() => onPay(inv)}>{t('businessHub.btnMarkPaid')}</button>
                      )}
                      <button className="bh-btn sm" style={{ marginRight: '0.3rem' }} onClick={() => onEdit(inv)}>{t('businessHub.btnEdit')}</button>
                      <button className="bh-btn sm danger" onClick={() => onDelete(inv)}>{t('businessHub.btnDelete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Tax tab ───────────────────────────────────────────────────────────────────
function TaxTab({ data, onRefresh, onPay, currency }) {
  const { t } = useTranslation();
  const estimates = data?.estimates || [];

  const taxStatusLabel = (status) => {
    const map = {
      paid: t('businessHub.statusPaid'),
      overdue: t('businessHub.statusOverdue'),
      draft: t('businessHub.statusDraft'),
      sent: t('businessHub.statusSent'),
    };
    return map[status] || status;
  };

  return (
    <div className="bh-card">
      <div className="bh-card-header">
        <div>
          <h2>{t('businessHub.taxSection')}</h2>
          <p>{t('businessHub.taxSectionDesc')}</p>
        </div>
        <button className="bh-btn sm" onClick={onRefresh}>{t('businessHub.btnRefreshEstimates')}</button>
      </div>

      {estimates.length === 0 ? (
        <div className="bh-empty"><p>{t('businessHub.noTaxEstimates')}</p></div>
      ) : (
        <div className="bh-table-wrap">
          <table className="bh-table">
            <thead>
              <tr>
                <th>{t('businessHub.colQuarter')}</th><th>{t('businessHub.colDue')}</th><th>{t('businessHub.colStatus')}</th>
                <th className="num">{t('businessHub.colEstNetIncome')}</th><th className="num">{t('businessHub.colEstTax')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {estimates.map(est => (
                <tr key={est.id}>
                  <td>{t('businessHub.quarterLabel', { q: est.quarter, year: est.tax_year })}</td>
                  <td style={{ whiteSpace: 'nowrap', color: est.status === 'overdue' ? '#f87171' : undefined }}>{fmtDate(est.due_date)}</td>
                  <td><span className={`bh-status ${est.status}`}>{taxStatusLabel(est.status)}</span></td>
                  <td className="num">{fmt$(est.estimated_net_income, currency)}</td>
                  <td className="num">{fmt$(est.estimated_tax, currency)}</td>
                  <td>
                    {est.status !== 'paid' && (
                      <button className="bh-btn sm" onClick={() => onPay(est)}>{t('businessHub.btnMarkPaid')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Goals tab ─────────────────────────────────────────────────────────────────
function GoalsTab({ goals, analytics, onNew, onEdit, onDelete, currency }) {
  const { t } = useTranslation();

  const goalTypeLabel = (gt) => {
    const map = {
      revenue: t('businessHub.goalTypeRevenue'),
      profit: t('businessHub.goalTypeProfit'),
      jobs: t('businessHub.goalTypeJobs'),
      clients: t('businessHub.goalTypeClients'),
      invoiced: t('businessHub.goalTypeInvoiced'),
    };
    return map[gt] || gt;
  };
  const periodLabel = (p) => {
    const map = {
      weekly: t('businessHub.periodWeekly'),
      monthly: t('businessHub.periodMonthly'),
      quarterly: t('businessHub.periodQuarterly'),
      yearly: t('businessHub.periodYearly'),
    };
    return map[p] || p;
  };

  return (
    <div className="bh-card">
      <div className="bh-card-header">
        <div><h2>{t('businessHub.goalsSection')}</h2></div>
        <button className="bh-btn primary sm" onClick={onNew}>{t('businessHub.btnAddGoalShort')}</button>
      </div>

      {goals.length === 0 ? (
        <div className="bh-empty"><p>{t('businessHub.noGoalsYet')}</p><button className="bh-btn primary" onClick={onNew}>{t('businessHub.btnAddAGoal')}</button></div>
      ) : (
        <div className="bh-goal-list">
          {goals.map(g => {
            let current = parseFloat(g.current_value) || 0;
            if (g.goal_type === 'revenue' && analytics?.mtd?.revenue)   current = Math.max(current, parseFloat(analytics.mtd.revenue)  || 0);
            if (g.goal_type === 'profit'  && analytics?.mtd?.profit)    current = Math.max(current, parseFloat(analytics.mtd.profit)   || 0);
            const target = parseFloat(g.target_value) || 1;
            const pct    = Math.min(100, Math.round((current / target) * 100));
            const done   = pct >= 100;
            return (
              <div key={g.id} className="bh-goal">
                <div className="bh-goal-row">
                  <div>
                    <div className="bh-goal-title">{g.title}</div>
                    <div className="bh-goal-meta">{goalTypeLabel(g.goal_type)} · {periodLabel(g.period)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button className="bh-btn sm" onClick={() => onEdit(g)}>{t('businessHub.btnEdit')}</button>
                    <button className="bh-btn sm danger" onClick={() => onDelete(g)}>{t('businessHub.btnDelete')}</button>
                  </div>
                </div>
                <div className="bh-goal-progress-track">
                  <div className={`bh-goal-progress-fill${done ? ' done' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="bh-goal-stats">
                  <span>{t('businessHub.goalPercentComplete', { pct })}</span>
                  <span>{fmt$(current, currency)} / <strong>{fmt$(target, currency)}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Team tab ──────────────────────────────────────────────────────────────────
function MaintenanceRequestsTab({ businessId, data, currency, onRefresh, onUpdate, onConvert }) {
  const requests = data?.requests || [];
  const stats = data?.stats || {};
  const [drafts, setDrafts] = useState({});

  function getDraft(request) {
    return drafts[request.id] || {
      status: request.status,
      workflow_stage: request.workflow_stage || 'intake',
      scheduled_start_at: request.scheduled_start_at ? String(request.scheduled_start_at).slice(0, 16) : '',
      assigned_helper_id: request.assigned_helper_id || '',
      tenant_visible_notes: request.tenant_visible_notes || '',
      actual_cost: request.actual_cost || '',
      vendor_name: request.vendor_name || '',
      billable_party: request.billable_party || 'owner',
      resolution_summary: request.resolution_summary || '',
    };
  }

  function patchDraft(id, patch) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));
  }

  return (
    <div>
      <div className="bh-kpi-grid">
        <KPI label="Open requests" value={stats.open_count || 0} cls="warn" sub="Reported, scheduled, assigned, or in progress" />
        <KPI label="Completed" value={stats.completed_count || 0} cls="positive" sub="Closed maintenance records" />
        <KPI label="Follow-ups due" value={stats.follow_up_count || 0} cls="warn" sub="Requests in follow-up stage" />
        <KPI label="SLA at risk" value={stats.overdue_sla_count || 0} cls="danger" sub="Requests past response target" />
        <KPI label="Tracked cost" value={fmt$(stats.actual_cost_total || 0, currency)} sub="Actual repair costs logged" />
      </div>

      <div className="bh-card">
        <div className="bh-card-header">
          <div>
            <h2>Property Maintenance Requests</h2>
            <p>Tenant issues from the public profile land here before they become scheduled work, assigned helper jobs, invoices, or year-end records.</p>
          </div>
          <div className="bh-header-actions">
            <Link className="bh-btn" to={`/business/${businessId}/maintenance-request`} target="_blank" rel="noopener noreferrer">
              Open tenant form
            </Link>
            <button className="bh-btn" onClick={onRefresh}>Refresh</button>
          </div>
        </div>

        {requests.length === 0 ? (
          <div className="bh-empty">
            <p style={{ fontWeight: 700 }}>No maintenance requests yet.</p>
            <p>When tenants report issues from the property profile, you can accept, schedule, assign, convert to a job, and track repair cost here.</p>
          </div>
        ) : (
          <div className="bh-maint-list">
            {requests.map((request) => {
              const draft = getDraft(request);
              return (
                <article className="bh-maint-card" key={request.id}>
                  <div className="bh-maint-main">
                    <div>
                      <span className={`bh-status-badge bh-status-${request.status}`}>{request.status.replaceAll('_', ' ')}</span>
                      <h3>{request.title}</h3>
                      <p>{request.description}</p>
                    </div>
                    <div className="bh-maint-meta">
                      <span>{request.issue_category}</span>
                      <span>{request.urgency}</span>
                      <span>{fmtDate(request.created_at)}</span>
                      {request.unit_label && <span>Unit {request.unit_label}</span>}
                      {request.job_id && <Link to={`/jobs/${request.job_id}`}>Job created</Link>}
                    </div>
                  </div>

                  {(request.photo_urls || []).length > 0 && (
                    <div className="bh-maint-photos">
                      {request.photo_urls.slice(0, 5).map((url) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="bh-maint-details">
                    {request.property_label && <p><strong>Property:</strong> {request.property_label}</p>}
                    {request.preferred_times && <p><strong>Preferred times:</strong> {request.preferred_times}</p>}
                    {request.access_notes && <p><strong>Access:</strong> {request.access_notes}</p>}
                    {request.template_intake?.location_area && <p><strong>Area:</strong> {request.template_intake.location_area}</p>}
                    {request.template_intake?.asset_label && <p><strong>Asset:</strong> {request.template_intake.asset_label}</p>}
                    {request.template_intake?.entry_preference && <p><strong>Entry preference:</strong> {request.template_intake.entry_preference}</p>}
                    {request.permission_to_enter && <p><strong>Permission:</strong> Tenant granted permission to enter with scheduling.</p>}
                  </div>

                  <div className="bh-maint-controls">
                    <label>
                      Workflow stage
                      <select value={draft.workflow_stage} onChange={(e) => patchDraft(request.id, { workflow_stage: e.target.value })}>
                        {['intake', 'triage', 'dispatch', 'scheduled', 'repair', 'follow_up', 'closed'].map((stage) => (
                          <option key={stage} value={stage}>{stage.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Status
                      <select value={draft.status} onChange={(e) => patchDraft(request.id, { status: e.target.value })}>
                        {['reported', 'accepted', 'scheduled', 'assigned', 'in_progress', 'completed', 'rejected', 'cancelled'].map((status) => (
                          <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Schedule
                      <input type="datetime-local" value={draft.scheduled_start_at || ''} onChange={(e) => patchDraft(request.id, { scheduled_start_at: e.target.value })} />
                    </label>
                    <label>
                      Helper ID
                      <input value={draft.assigned_helper_id || ''} onChange={(e) => patchDraft(request.id, { assigned_helper_id: e.target.value })} placeholder="Optional OxSteed helper ID" />
                    </label>
                    <label>
                      Vendor / handyman
                      <input value={draft.vendor_name || ''} onChange={(e) => patchDraft(request.id, { vendor_name: e.target.value })} placeholder="Optional" />
                    </label>
                    <label>
                      Actual cost
                      <input type="number" min="0" step="0.01" value={draft.actual_cost || ''} onChange={(e) => patchDraft(request.id, { actual_cost: e.target.value })} placeholder="0.00" />
                    </label>
                    <label>
                      Bill to
                      <select value={draft.billable_party || 'owner'} onChange={(e) => patchDraft(request.id, { billable_party: e.target.value })}>
                        {['owner', 'tenant', 'hoa', 'internal'].map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="wide">
                      Tenant-visible update
                      <textarea value={draft.tenant_visible_notes || ''} onChange={(e) => patchDraft(request.id, { tenant_visible_notes: e.target.value })} rows={2} placeholder="Example: We can send someone Friday morning." />
                    </label>
                    <label className="wide">
                      Resolution summary
                      <textarea value={draft.resolution_summary || ''} onChange={(e) => patchDraft(request.id, { resolution_summary: e.target.value })} rows={2} placeholder="What was fixed, what still needs approval, or what should be billed." />
                    </label>
                  </div>

                  <div className="bh-maint-actions">
                    <button className="bh-btn primary" onClick={() => onUpdate(request.id, draft)}>Save update</button>
                    <button className="bh-btn" onClick={() => onConvert(request.id)} disabled={!!request.job_id}>
                      {request.job_id ? 'Already converted' : 'Convert to job'}
                    </button>
                    <Link className="bh-btn" to="/helpers">Find helper</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamTab({
  members, invitations, managedBiz,
  vortexTokens, tokenForm, accessCodes, accessCodeForm,
  onTokenFormChange, onAccessCodeFormChange,
  onGenerateToken, generatingToken, onCreateAccessCode, generatingAccessCode,
  onRevokeToken, onRevokeAccessCode,
  showVortexAccess = false,
  onInvite, onRevoke, onAccept, onDecline,
}) {
  const { t } = useTranslation();
  const roleLabel = (role) => {
    if (role === 'manager') return t('businessHub.roleManager');
    if (role === 'representative') return t('businessHub.roleRepresentative');
    if (role === 'employee') return t('businessHub.roleEmployee');
    if (role === 'support_agent') return t('businessHub.roleSupportAgent');
    return role;
  };

  const [copiedTokenId, setCopiedTokenId] = useState(null);
  const [copiedAccessCodeId, setCopiedAccessCodeId] = useState(null);

  function copyToken(token, tokenId, kind = 'legacy') {
    navigator.clipboard.writeText(token).then(() => {
      if (kind === 'access') {
        setCopiedAccessCodeId(tokenId);
        setTimeout(() => setCopiedAccessCodeId(prev => prev === tokenId ? null : prev), 1500);
        return;
      }
      setCopiedTokenId(tokenId);
      setTimeout(() => setCopiedTokenId(prev => prev === tokenId ? null : prev), 1500);
    });
  }

  const STATUS_COLOR = { active: '#4ade80', used: '#94a3b8', expired: '#f97316', revoked: '#ef4444' };

  const vortexStatusLabel = (status) => {
    const map = {
      active: t('businessHub.vortexStatusActive'),
      used: t('businessHub.vortexStatusUsed'),
      expired: t('businessHub.vortexStatusExpired'),
      revoked: t('businessHub.vortexStatusRevoked'),
    };
    return map[status] || (status ? status.charAt(0).toUpperCase() + status.slice(1) : '');
  };

  return (
    <div className="bh-team">

      {/* ── Pending invitations received by the logged-in user ─────────── */}
      {invitations.length > 0 && (
        <div className="bh-team-section">
          <h3 className="bh-team-heading">{t('businessHub.pendingInvitations')}</h3>
          <div className="bh-team-invites">
            {invitations.map(inv => (
              <div key={inv.id} className="bh-team-invite-card">
                <div className="bh-team-invite-info">
                  <span className="bh-team-invite-biz">{inv.business_name}</span>
                  <span className="bh-team-invite-from">
                    {t('businessHub.inviteFromLabel', { first: inv.owner_first_name, last: inv.owner_last_name, role: roleLabel(inv.role) })}
                  </span>
                </div>
                <div className="bh-team-invite-actions">
                  <button className="bh-btn primary" onClick={() => onAccept(inv)}>{t('businessHub.btnAccept')}</button>
                  <button className="bh-btn" onClick={() => onDecline(inv)}>{t('businessHub.btnDecline')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Businesses I manage as a representative / manager ──────────── */}
      {managedBiz.length > 0 && (
        <div className="bh-team-section">
          <h3 className="bh-team-heading">{t('businessHub.businessesIManage')}</h3>
          <div className="bh-team-managed">
            {managedBiz.map(b => (
              <div key={b.id} className="bh-team-managed-card">
                {b.logo_url
                  ? <img src={b.logo_url} alt="" className="bh-team-avatar" />
                  : <div className="bh-team-avatar bh-team-avatar-init">{b.business_name[0]}</div>
                }
                <div>
                  <p className="bh-team-managed-name">{b.business_name}</p>
                  <p className="bh-team-managed-role">{t('businessHub.managedRoleLabel', { role: roleLabel(b.role), first: b.owner_first_name, last: b.owner_last_name })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showVortexAccess && (
        <>
          {/* ── New Vortex access codes for restaurant apps ─────────────────── */}
          <div className="bh-team-section bh-vortex-method bh-vortex-method-new">
        <div className="bh-vortex-method-title-row">
          <div>
            <p className="bh-vortex-method-eyebrow">{t('businessHub.vortexNewMethodLabel')}</p>
            <h3 className="bh-team-heading">{t('businessHub.accessCodeSection')}</h3>
          </div>
          <span className="bh-vortex-method-pill">{t('businessHub.vortexRecommended')}</span>
        </div>
        <p className="bh-team-vortex-desc">
          {t('businessHub.accessCodeDesc')}
        </p>
        <div className="bh-team-vortex-gen">
          <select
            className="bh-select"
            value={accessCodeForm.role}
            onChange={e => onAccessCodeFormChange({ role: e.target.value })}
          >
            <option value="employee">{t('businessHub.roleEmployee')}</option>
            <option value="manager">{t('businessHub.roleManager')}</option>
            <option value="representative">{t('businessHub.roleRepresentative')}</option>
            <option value="support_agent">{t('businessHub.roleSupportAgent')}</option>
          </select>
          <input
            className="bh-input bh-vortex-label-input"
            type="text"
            value={accessCodeForm.label}
            placeholder={t('businessHub.accessCodeLabelPlaceholder')}
            onChange={e => onAccessCodeFormChange({ label: e.target.value })}
          />
          <label className="bh-vortex-approval-toggle">
            <input
              type="checkbox"
              checked={accessCodeForm.requires_approval}
              onChange={e => onAccessCodeFormChange({ requires_approval: e.target.checked })}
            />
            <span>{t('businessHub.accessCodeRequireApproval')}</span>
          </label>
          <button className="bh-btn primary" onClick={onCreateAccessCode} disabled={generatingAccessCode}>
            {generatingAccessCode ? t('businessHub.btnCreatingAccessCode') : t('businessHub.btnCreateAccessCode')}
          </button>
        </div>

        {accessCodes.length > 0 && (
          <div className="bh-vortex-tokens">
            {accessCodes.map(code => (
              <div key={code.id} className={`bh-vortex-token-row ${code.is_active ? 'bh-vortex-active' : 'bh-vortex-revoked'}`}>
                <div className="bh-vortex-token-info">
                  <code className="bh-vortex-code bh-vortex-code-strong">{code.code}</code>
                  <span className={`bh-role-badge bh-role-${code.role}`}>{roleLabel(code.role)}</span>
                  {code.label && <span className="bh-vortex-used-by">{code.label}</span>}
                  <span className="bh-vortex-status" style={{ color: code.is_active ? '#4ade80' : '#ef4444' }}>
                    {code.is_active ? t('businessHub.vortexStatusActive') : t('businessHub.vortexStatusRevoked')}
                  </span>
                  <span className="bh-vortex-expires">
                    {t('businessHub.accessCodeUses', { count: code.uses ?? 0 })}
                  </span>
                  {code.requires_approval && (
                    <span className="bh-vortex-approval-badge">{t('businessHub.accessCodeApprovalRequired')}</span>
                  )}
                </div>
                <div className="bh-vortex-token-actions">
                  {code.is_active && (
                    <>
                      <button
                        className="bh-btn"
                        onClick={() => copyToken(code.code, code.id, 'access')}
                        style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                      >
                        {copiedAccessCodeId === code.id ? t('businessHub.btnCopied') : t('businessHub.btnCopy')}
                      </button>
                      <button className="bh-btn bh-btn-danger-sm" onClick={() => onRevokeAccessCode(code.id)}>{t('businessHub.btnRevoke')}</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
          </div>

          {/* ── Legacy Vortex token generator ───────────────────────────────── */}
          <div className="bh-team-section">
        <p className="bh-vortex-method-eyebrow">{t('businessHub.vortexLegacyMethodLabel')}</p>
        <h3 className="bh-team-heading">{t('businessHub.vortexSection')}</h3>
        <p className="bh-team-vortex-desc">
          {t('businessHub.vortexDesc')}
        </p>
        <div className="bh-team-vortex-gen">
          <select
            className="bh-select"
            value={tokenForm.role}
            onChange={e => onTokenFormChange({ role: e.target.value })}
          >
            <option value="representative">{t('businessHub.vortexRoleRepresentative')}</option>
            <option value="manager">{t('businessHub.vortexRoleManager')}</option>
          </select>
          <select
            className="bh-select"
            value={tokenForm.expires_in}
            onChange={e => onTokenFormChange({ expires_in: e.target.value })}
          >
            <option value="24h">{t('businessHub.vortexExpires24h')}</option>
            <option value="7d">{t('businessHub.vortexExpires7d')}</option>
            <option value="30d">{t('businessHub.vortexExpires30d')}</option>
            <option value="60d">{t('businessHub.vortexExpires60d')}</option>
          </select>
          <button className="bh-btn primary" onClick={onGenerateToken} disabled={generatingToken}>
            {generatingToken ? t('businessHub.btnGenerating') : t('businessHub.btnGenerateToken')}
          </button>
        </div>

        {vortexTokens.length > 0 && (
          <div className="bh-vortex-tokens">
            {vortexTokens.map(tk => {
              const tokenStr = tk.token ?? null;
              const tokenHidden = tk.status === 'active' && tokenStr === null;
              const tokenPrefix = tokenStr ? tokenStr.slice(0, 16) : null;
              const rowKey = tk.id;

              return (
                <div key={rowKey} className={`bh-vortex-token-row bh-vortex-${tk.status}`}>
                  <div className="bh-vortex-token-info">
                    {tokenHidden ? (
                      <code className="bh-vortex-code bh-vortex-code--hidden" title={t('businessHub.tokenHiddenTitle')}>
                        ••••••••••••••••
                      </code>
                    ) : (
                      <code className="bh-vortex-code">{tokenPrefix}…</code>
                    )}
                    <span className="bh-role-badge bh-role-representative" style={{ marginLeft: '0.5rem' }}>{roleLabel(tk.role)}</span>
                    <span className="bh-vortex-status" style={{ color: STATUS_COLOR[tk.status] || 'inherit' }}>
                      {vortexStatusLabel(tk.status)}
                    </span>
                    {tk.status === 'used' && tk.used_by_first && (
                      <span className="bh-vortex-used-by">{t('businessHub.vortexUsedBy', { first: tk.used_by_first, last: tk.used_by_last })}</span>
                    )}
                    {tk.status === 'active' && (
                      <span className="bh-vortex-expires">{t('businessHub.vortexExpiresOn', { date: formatDate(tk.expires_at, { month: 'short', day: 'numeric', year: undefined }) })}</span>
                    )}
                    {tk.created_by_first && (
                      <span className="bh-vortex-creator" style={{ fontSize: '0.75rem', color: 'var(--muted-text)', marginLeft: '0.4rem' }}>
                        {t('businessHub.vortexCreatedBy', { first: tk.created_by_first, last: tk.created_by_last })}
                      </span>
                    )}
                  </div>
                  <div className="bh-vortex-token-actions">
                    {tk.status === 'active' && !tokenHidden && (
                      <>
                        <button
                          className="bh-btn"
                          onClick={() => copyToken(tokenStr, tk.id)}
                          style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                        >
                          {copiedTokenId === tk.id ? t('businessHub.btnCopied') : t('businessHub.btnCopy')}
                        </button>
                        <button className="bh-btn bh-btn-danger-sm" onClick={() => onRevokeToken(tk.id)}>{t('businessHub.btnRevoke')}</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
          </div>
        </>
      )}

      {/* ── Members of the currently selected business ─────────────────── */}
      <div className="bh-team-section">
        <div className="bh-team-heading-row">
          <h3 className="bh-team-heading">{t('businessHub.teamMembersSection')}</h3>
          <button className="bh-btn primary" onClick={onInvite}>{t('businessHub.btnInvite')}</button>
        </div>

        {members.length === 0 ? (
          <div className="bh-empty" style={{ padding: '2rem 0' }}>
            <p>{t('businessHub.noTeamYet')}</p>
          </div>
        ) : (
          <table className="bh-team-table">
            <thead>
              <tr>
                <th>{t('businessHub.colNameEmail')}</th>
                <th>{t('businessHub.colRole')}</th>
                <th>{t('businessHub.colStatus')}</th>
                <th>{t('businessHub.colSince')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id}>
                  <td>
                    <div className="bh-team-member-name">
                      {m.first_name ? `${m.first_name} ${m.last_name}` : '-'}
                    </div>
                    <div className="bh-team-member-email">{m.member_email || m.invite_email}</div>
                  </td>
                  <td><span className={`bh-role-badge bh-role-${m.role}`}>{roleLabel(m.role)}</span></td>
                  <td>
                    <span className={`bh-status-badge bh-status-${m.status}`}>
                      {m.status === 'pending' ? t('businessHub.statusInviteSent') : t('businessHub.statusActive')}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--muted-text)' }}>
                    {formatDate(m.accepted_at || m.invited_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td>
                    <button className="bh-btn bh-btn-danger-sm" onClick={() => onRevoke(m)}>
                      {m.status === 'pending' ? t('businessHub.btnCancelInvite') : t('businessHub.btnRemoveMember')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Content Tab Components (Services, Gallery, Policies, FAQs, Hours) ────────

function ServicesTab({ services, businessId, onNew, onEdit, onDelete }) {
  const { t } = useTranslation();

  if (!services || services.length === 0) {
    return (
      <div className="bh-empty" style={{ padding: '2rem 0' }}>
        <p>{t('businessHub.noServicesYet')}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>
          {t('businessHub.addServicesToYourBusiness')}
        </p>
        <button className="bh-btn primary" style={{ marginTop: '1rem' }} onClick={onNew}>{t('businessHub.addService')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {services.map(svc => (
        <div key={svc.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1">
              <h4 className="font-semibold text-white">{svc.name}</h4>
              {svc.description && <p className="text-sm text-gray-400 mt-1">{svc.description}</p>}
              <p className="text-sm text-orange-400 mt-2">${svc.price || 0}{svc.price_unit === 'hour' ? '/hr' : ''}</p>
              {!svc.is_active && <span style={{ fontSize: '0.75rem', color: '#f87171', marginLeft: '0.5rem' }}>(Inactive)</span>}
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded transition" onClick={() => onEdit(svc)}>{t('businessHub.btnEdit')}</button>
              <button className="px-3 py-1 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition" onClick={() => onDelete(svc)}>{t('businessHub.btnDelete')}</button>
            </div>
          </div>
        </div>
      ))}
      <button className="w-full py-2 px-4 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 rounded-lg transition border border-orange-600/30" onClick={onNew}>
        {t('businessHub.addService')}
      </button>
    </div>
  );
}

function GalleryTab({ gallery, businessId, onNew, onEdit, onDelete }) {
  const { t } = useTranslation();

  if (!gallery || gallery.length === 0) {
    return (
      <div className="bh-empty" style={{ padding: '2rem 0' }}>
        <p>{t('businessHub.noGalleryYet')}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>
          {t('businessHub.uploadPhotosToShowcase')}
        </p>
        <button className="bh-btn primary" style={{ marginTop: '1rem' }} onClick={onNew}>{t('businessHub.uploadPhotos')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {gallery.map(photo => (
          <div key={photo.id} className="relative bg-gray-900 rounded-lg overflow-hidden border border-gray-800 group">
            <img src={photo.url} alt={photo.alt || photo.caption || t('businessHub.galleryPhoto')} className="w-full h-48 object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
              <button className="px-3 py-1 text-sm bg-orange-600 hover:bg-orange-700 rounded text-white" onClick={() => onEdit(photo)}>{t('businessHub.btnEdit')}</button>
              <button className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded text-white" onClick={() => onDelete(photo)}>{t('businessHub.btnDelete')}</button>
            </div>
          </div>
        ))}
      </div>
      <button className="w-full py-2 px-4 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 rounded-lg transition border border-orange-600/30" onClick={onNew}>
        {t('businessHub.uploadPhotos')}
      </button>
    </div>
  );
}

function PoliciesTab({ policies, businessId, onNew, onEdit, onDelete }) {
  const { t } = useTranslation();

  if (!policies || policies.length === 0) {
    return (
      <div className="bh-empty" style={{ padding: '2rem 0' }}>
        <p>{t('businessHub.noPoliciesYet')}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>
          {t('businessHub.addPoliciesForClients')}
        </p>
        <button className="bh-btn primary" style={{ marginTop: '1rem' }} onClick={onNew}>{t('businessHub.addPolicy')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {policies.map(policy => (
        <div key={policy.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1">
              <h4 className="font-semibold text-white">{policy.title}</h4>
              <p className="text-sm text-gray-400 mt-2" style={{ whiteSpace: 'pre-wrap' }}>{policy.content}</p>
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded transition" onClick={() => onEdit(policy)}>{t('businessHub.btnEdit')}</button>
              <button className="px-3 py-1 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition" onClick={() => onDelete(policy)}>{t('businessHub.btnDelete')}</button>
            </div>
          </div>
        </div>
      ))}
      <button className="w-full py-2 px-4 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 rounded-lg transition border border-orange-600/30" onClick={onNew}>
        {t('businessHub.addPolicy')}
      </button>
    </div>
  );
}

function FAQsTab({ faqs, businessId, onNew, onEdit, onDelete }) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState(null);

  if (!faqs || faqs.length === 0) {
    return (
      <div className="bh-empty" style={{ padding: '2rem 0' }}>
        <p>{t('businessHub.noFAQsYet')}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>
          {t('businessHub.addFAQsForClients')}
        </p>
        <button className="bh-btn primary" style={{ marginTop: '1rem' }} onClick={onNew}>{t('businessHub.addFAQ')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {faqs.map(faq => (
        <div key={faq.id} className="bg-gray-900 border border-gray-800 rounded-lg">
          <button
            onClick={() => setExpandedId(expandedId === faq.id ? null : faq.id)}
            className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-800/50 transition"
          >
            <h4 className="font-semibold text-white text-left">{faq.question}</h4>
            <span className="text-gray-400">{expandedId === faq.id ? '−' : '+'}</span>
          </button>
          {expandedId === faq.id && (
            <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/50">
              <p className="text-gray-300 text-sm" style={{ whiteSpace: 'pre-wrap' }}>{faq.answer}</p>
              <div className="flex gap-2 mt-3">
                <button className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded transition" onClick={() => onEdit(faq)}>{t('businessHub.btnEdit')}</button>
                <button className="px-3 py-1 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition" onClick={() => onDelete(faq)}>{t('businessHub.btnDelete')}</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button className="w-full py-2 px-4 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 rounded-lg transition border border-orange-600/30" onClick={onNew}>
        {t('businessHub.addFAQ')}
      </button>
    </div>
  );
}

function HoursTab({ hours, businessId, onEdit }) {
  const { t } = useTranslation();
  const days = [t('businessHub.daysSunday'), t('businessHub.daysMonday'), t('businessHub.daysTuesday'), t('businessHub.daysWednesday'), t('businessHub.daysThursday'), t('businessHub.daysFriday'), t('businessHub.daysSaturday')];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-semibold text-white">{t('businessHub.businessHours')}</h3>
        <button className="bh-btn sm" onClick={onEdit}>{t('businessHub.btnEdit')}</button>
      </div>
      <div className="space-y-4">
        {[0, 1, 2, 3, 4, 5, 6].map(dayNum => {
          const dayHours = hours?.find(h => h.day_of_week === dayNum);
          return (
            <div key={dayNum} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
              <span className="font-medium text-gray-300 min-w-[100px]">{days[dayNum]}</span>
              {dayHours?.is_closed ? (
                <span className="text-gray-500 italic">{t('businessHub.closed')}</span>
              ) : (
                <span className="text-gray-300">
                  {dayHours?.start_time || '-'} – {dayHours?.end_time || '-'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
