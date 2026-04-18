import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
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
} from '../api/businesses';
import '../styles/BusinessHubPage.css';

const LS_KEY = 'oxs:bh:lastBusinessId';
const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];

// ── formatters ────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (!n && n !== 0) return '—';
  return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '—';
  const dateOnly = String(d).split('T')[0];
  return new Date(dateOnly + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtMonth(m) {
  // m = "2025-03"
  if (!m) return '';
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1).toLocaleString('en-US', { month: 'short' });
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
  const [businesses, setBusinesses]   = useState([]);
  const [bizId, setBizId]             = useState(() => localStorage.getItem(LS_KEY) || '');
  const [tab, setTab]                 = useState('overview');
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
  const [invoiceData, setInvoiceData] = useState(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [taxData, setTaxData]       = useState(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const [goals, setGoals]           = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(false);

  // team tab
  const [members, setMembers]             = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitations, setInvitations]     = useState([]);
  const [managedBiz, setManagedBiz]       = useState([]);

  // vortex tokens
  const [vortexTokens, setVortexTokens]   = useState([]);
  const [tokenForm, setTokenForm]         = useState({ role: 'representative', expires_in: '7d' });
  const [generatingToken, setGeneratingToken] = useState(false);

  // profile tab
  const [profileForm, setProfileForm] = useState(null);   // null = not loaded
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving]   = useState(false);
  const [profileErr, setProfileErr]         = useState('');
  const [logoPreview, setLogoPreview]     = useState(null);
  const [coverPreview, setCoverPreview]   = useState(null);
  const [logoFile, setLogoFile]           = useState(null);
  const [coverFile, setCoverFile]         = useState(null);
  // Snapshot of helper-linked fields from last loadProfile — omit from PUT when unchanged
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
      if (merged.length > 0) {
        const saved = localStorage.getItem(LS_KEY);
        const valid = saved && merged.find(b => String(b.id) === String(saved));
        const chosen = valid ? saved : String(merged[0].id);
        setBizId(chosen);
        localStorage.setItem(LS_KEY, chosen);
      }
    } catch { toast.error(t('businessHub.toastLoadBizFail')); }
    finally { setLoadingBiz(false); }
  }, [t]);

  useEffect(() => { loadBusinesses(); }, [loadBusinesses]);

  // ── load tab data when bizId or tab changes ──────────────────────────────
  const loadOverview = useCallback(async () => {
    if (!bizId) return;
    setAnalyticsLoading(true);
    try { setAnalytics(await getAnalytics(bizId)); }
    catch { toast.error(t('businessHub.errorAnalytics')); }
    finally { setAnalyticsLoading(false); }
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

  const loadTeam = useCallback(async () => {
    if (!bizId) return;
    setMembersLoading(true);
    try {
      const [m, inv, managed, tokens] = await Promise.all([
        listMembers(bizId),
        listMyInvitations(),
        listManagedBusinesses(),
        listVortexTokens(bizId).catch(() => []),
      ]);
      setMembers(m);
      setInvitations(inv);
      setManagedBiz(managed);
      setVortexTokens(tokens);
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

  useEffect(() => {
    if (!bizId) return;
    if (tab === 'overview') loadOverview();
    else if (tab === 'invoices') loadInvoices();
    else if (tab === 'tax') loadTax();
    else if (tab === 'goals') {
      loadGoals();
      loadOverview();
    }
    else if (tab === 'team') loadTeam();
    else if (tab === 'profile') loadProfile();
  }, [bizId, tab, loadOverview, loadInvoices, loadTax, loadGoals, loadTeam, loadProfile]);

  // ── switcher ──────────────────────────────────────────────────────────────
  function handleSwitchBiz(id) {
    setBizId(id);
    localStorage.setItem(LS_KEY, id);
    setAnalyticsLoading(true);
    setAnalytics(null); setInvoiceData(null); setTaxData(null); setGoals([]);
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

  // ── current biz object + caller's role ───────────────────────────────────
  const currentBiz  = businesses.find(b => String(b.id) === String(bizId));
  const currentRole = currentBiz?._role || 'owner';
  const canEditBizProfile = currentRole === 'owner' || currentRole === 'manager';
  const canViewFinanceHub = currentRole !== 'representative';
  const financeTabIds = ['overview', 'invoices', 'tax', 'goals'];
  const visibleTabs = ['profile', ...financeTabIds, 'team'].filter((tb) => {
    if (tb === 'profile' && !canEditBizProfile) return false;
    if (financeTabIds.includes(tb) && !canViewFinanceHub) return false;
    return true;
  });

  useEffect(() => {
    if (tab === 'profile' && !canEditBizProfile) {
      setTab(canViewFinanceHub ? 'overview' : 'team');
    }
    if (financeTabIds.includes(tab) && !canViewFinanceHub) {
      setTab('team');
    }
  }, [bizId, canEditBizProfile, canViewFinanceHub, tab]);

  // tab label resolver
  const tabLabel = (tb) => {
    if (tb === 'profile') return t('businessHub.tabEditProfile');
    if (tb === 'team') return t('businessHub.tabTeamLabel');
    if (tb === 'overview') return t('businessHub.tabOverviewLabel');
    if (tb === 'invoices') return t('businessHub.tabInvoicesLabel');
    if (tb === 'tax') return t('businessHub.tabTaxLabel');
    if (tb === 'goals') return t('businessHub.tabGoalsLabel');
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
            </div>

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

            {/* ── Overview tab ────────────────────────────────────── */}
            {tab === 'overview' && (
              analyticsLoading ? <p className="bh-loading">{t('businessHub.loadingAnalytics')}</p> :
              !analytics ? <p className="bh-error">{t('businessHub.errorAnalytics')}</p> :
              <OverviewTab analytics={analytics} />
            )}

            {/* ── Invoices tab ─────────────────────────────────────── */}
            {tab === 'invoices' && (
              invoicesLoading ? <p className="bh-loading">{t('businessHub.loadingInvoices')}</p> :
              <InvoicesTab
                data={invoiceData}
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
                onTokenFormChange={(patch) => setTokenForm(f => ({ ...f, ...patch }))}
                onGenerateToken={handleGenerateToken}
                generatingToken={generatingToken}
                onRevokeToken={handleRevokeToken}
                onInvite={() => { setForm({ invite_email: '', invite_role: 'representative' }); setFormErr(''); setModal('invite-member'); }}
                onRevoke={handleRevokeMember}
                onAccept={handleAcceptInvitation}
                onDecline={handleDeclineInvitation}
              />
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
                    <div>{t('businessHub.subtotal')}: {fmt$(subtotal)}</div>
                    {taxAmt > 0 && <div>{t('businessHub.taxLabel')} ({form.invoice_tax_rate || 0}%): {fmt$(taxAmt)}</div>}
                    <div className="grand">{t('businessHub.total')}: {fmt$(total)}</div>
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
                {t('businessHub.invoiceTotalLabel', { num: selected.invoice_number, total: fmt$(selected.total) })}
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
                {t('businessHub.taxQuarterLabel', { quarter: selected.quarter, year: selected.tax_year, amount: fmt$(selected.estimated_tax) })}
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

      </div>
    </PageShell>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────────
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

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

  return (
    <div className="space-y-6">
      {/* ── Header with preview link ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
        <h3 className="text-base font-semibold text-white mb-4">{t('businessHub.sectionPhotos')}</h3>
        <div className="grid sm:grid-cols-2 gap-6">
          {/* Logo */}
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-2">{t('businessHub.businessLogo')}</label>
            <div className="w-full aspect-square bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-center overflow-hidden mb-3">
              {logoPreview ? (
                <img src={logoPreview} alt={t('businessHub.logoPreviewAlt')} className="w-full h-full object-cover" />
              ) : (
                <span className="text-gray-500 text-sm">{t('businessHub.noLogo')}</span>
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
              <label htmlFor="bh-logo-input" className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition cursor-pointer text-center">
                {logoPreview ? t('businessHub.changeLogo') : t('businessHub.uploadLogo')}
              </label>
              {logoPreview && (
                <button
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition"
                  onClick={() => { onLogoChange(null); onChange({ logo_url: '' }); }}
                >
                  {t('businessHub.remove')}
                </button>
              )}
            </div>
          </div>

          {/* Cover photo */}
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-2">{t('businessHub.coverPhoto')}</label>
            <div className="w-full aspect-video bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-center overflow-hidden mb-3">
              {coverPreview ? (
                <img src={coverPreview} alt={t('businessHub.coverPreviewAlt')} className="w-full h-full object-cover" />
              ) : (
                <span className="text-gray-500 text-sm">{t('businessHub.noCoverPhoto')}</span>
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
              <label htmlFor="bh-cover-input" className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition cursor-pointer text-center">
                {coverPreview ? t('businessHub.changeCover') : t('businessHub.uploadCover')}
              </label>
              {coverPreview && (
                <button
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition"
                  onClick={() => { onCoverChange(null); onChange({ cover_photo_url: '' }); }}
                >
                  {t('businessHub.remove')}
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-4">💡 Logo: square preferred. Cover: 3:1 ratio for best results.</p>
      </div>

      {/* ── Business Identity Card ──────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
        <h3 className="text-base font-semibold text-white mb-4">{t('businessHub.sectionBusinessIdentity')}</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldBusinessNameRequired')}</label>
            <input
              name="business_name"
              value={form.business_name}
              onChange={pf}
              placeholder={t('businessHub.placeholderBizName')}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldBusinessType')}</label>
              <select
                name="business_type"
                value={form.business_type}
                onChange={pf}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
              >
                <option value="">{t('businessHub.selectTypePlaceholder')}</option>
                {BIZ_TYPES.map(bt => <option key={bt.value} value={bt.value}>{t(`businessHub.${bt.labelKey}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldTagline')}</label>
              <input
                name="profile_headline"
                value={form.profile_headline}
                onChange={pf}
                placeholder={t('businessHub.placeholderTagline')}
                maxLength={120}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldAbout')}</label>
            <textarea
              name="description"
              value={form.description}
              onChange={pf}
              rows={4}
              placeholder={t('businessHub.placeholderAbout')}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition resize-none"
            />
          </div>
        </div>
      </div>

      {/* ── Contact Info (Collapsible) ──────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
        <button
          onClick={() => setExpandContact(!expandContact)}
          aria-expanded={expandContact}
          className="w-full flex items-center justify-between mb-4 hover:opacity-80 transition"
        >
          <h3 className="text-base font-semibold text-white">{t('businessHub.sectionContact')}</h3>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${expandContact ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>

        {expandContact && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldPhone')}</label>
              <input
                name="phone"
                value={form.phone}
                onChange={pf}
                placeholder={t('businessHub.placeholderPhone')}
                type="tel"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldWebsite')}</label>
              <input
                name="website"
                value={form.website}
                onChange={pf}
                placeholder={t('businessHub.placeholderWebsiteFull')}
                type="url"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Location & Service Area (Collapsible) ──────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
        <button
          onClick={() => setExpandLocation(!expandLocation)}
          aria-expanded={expandLocation}
          className="w-full flex items-center justify-between mb-4 hover:opacity-80 transition"
        >
          <h3 className="text-base font-semibold text-white">{t('businessHub.sectionLocation')}</h3>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${expandLocation ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>

        {expandLocation && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldStreetAddress')}</label>
              <input
                name="address_street"
                value={form.address_street}
                onChange={pf}
                placeholder={t('businessHub.placeholderStreet')}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
              />
              <p className="text-xs text-gray-500 mt-1">{t('businessHub.streetHint')}</p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldCity')}</label>
                <input
                  name="address_city"
                  value={form.address_city}
                  onChange={pf}
                  placeholder={t('businessHub.placeholderCity')}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldState')}</label>
                <select
                  name="address_state"
                  value={form.address_state}
                  onChange={pf}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
                >
                  <option value="">{t('businessHub.selectStatePlaceholder')}</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldZip')}</label>
                <input
                  name="address_zip"
                  value={form.address_zip}
                  onChange={pf}
                  placeholder={t('businessHub.placeholderZip')}
                  maxLength={10}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div className="sm:w-1/3">
              <label className="text-sm font-medium text-gray-300 block mb-1.5">{t('businessHub.fieldServiceRadius')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="service_radius_miles"
                  value={form.service_radius_miles}
                  onChange={pf}
                  placeholder={t('businessHub.placeholderRadius')}
                  min="1"
                  max="200"
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none transition"
                />
                <span className="text-gray-500 text-sm">mi</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Error & Actions ──────────────────────────────────────────────── */}
      {err && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</p>}

      <button
        className="w-full py-2.5 px-4 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveProfile')}
      </button>

      <p className="text-xs text-gray-500">
        <Trans i18nKey="businessHub.profileFooterNote">
          Services, gallery, availability, and policies are managed from your <a href="/dashboard" className="text-orange-400 hover:text-orange-300">helper profile settings</a>.
        </Trans>
      </p>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ analytics }) {
  const { t } = useTranslation();
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

  return (
    <>
      {/* KPI grid */}
      <div className="bh-kpi-grid">
        <KPI label={t('businessHub.kpiMtdRevenue')}    value={fmt$(a?.mtd?.revenue)}    cls="positive" />
        <KPI label={t('businessHub.kpiMtdProfit')}     value={fmt$(a?.mtd?.profit)}     cls={profitCls(a?.mtd?.profit)} />
        <KPI label={t('businessHub.kpiLastMonthRevenue')} value={fmt$(a?.last_month?.revenue)} />
        <KPI label={t('businessHub.kpiYtdRevenue')}    value={fmt$(a?.ytd?.revenue)}    cls="positive" />
        <KPI label={t('businessHub.kpiYtdProfit')}     value={fmt$(a?.ytd?.profit)}     cls={profitCls(a?.ytd?.profit)} />
        <KPI label={t('businessHub.kpiOutstanding')}    value={fmt$(a?.invoices?.outstanding_total)} cls="warn"
          sub={t('businessHub.kpiInvoicesSent', { count: a?.invoices?.sent || 0 })} />
        <KPI label={t('businessHub.kpiOverdue')}        value={fmt$(a?.invoices?.overdue_total)}     cls="negative"
          sub={t('businessHub.kpiInvoicesCount', { count: a?.invoices?.overdue_count || 0 })} />
        <KPI label={t('businessHub.kpiJobs6m')}      value={a?.jobs?.completed_6m ?? '—'} />
        <KPI label={t('businessHub.kpiAvgJobValue')}  value={fmt$(a?.jobs?.avg_value)} />
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
                    <div className="bh-chart-bar revenue" style={{ height: pct(rev) }} title={t('businessHub.tooltipRevenue', { amount: fmt$(rev) })} />
                    <div className="bh-chart-bar expense" style={{ height: pct(exp) }} title={t('businessHub.tooltipExpenses', { amount: fmt$(exp) })} />
                    <div className="bh-chart-bar profit"  style={{ height: pct(pro) }} title={t('businessHub.tooltipProfit', { amount: fmt$(pro) })} />
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
function InvoicesTab({ data, onNew, onEdit, onPay, onDelete, onSend }) {
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
        <KPI label={t('businessHub.invoiceStatusOutstanding')} value={fmt$(summary.outstanding_total)} cls="warn" />
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
                    <td className="num">{fmt$(inv.total)}</td>
                    <td className="num">{fmt$(inv.amount_paid)}</td>
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
function TaxTab({ data, onRefresh, onPay }) {
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
                  <td className="num">{fmt$(est.estimated_net_income)}</td>
                  <td className="num">{fmt$(est.estimated_tax)}</td>
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
function GoalsTab({ goals, analytics, onNew, onEdit, onDelete }) {
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
                  <span>{fmt$(current)} / <strong>{fmt$(target)}</strong></span>
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
function TeamTab({
  members, invitations, managedBiz,
  vortexTokens, tokenForm, onTokenFormChange, onGenerateToken, generatingToken, onRevokeToken,
  onInvite, onRevoke, onAccept, onDecline,
}) {
  const { t } = useTranslation();
  const roleLabel = (role) => {
    if (role === 'manager') return t('businessHub.roleManager');
    if (role === 'representative') return t('businessHub.roleRepresentative');
    return role;
  };

  const [copiedTokenId, setCopiedTokenId] = useState(null);

  function copyToken(token, tokenId) {
    navigator.clipboard.writeText(token).then(() => {
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

      {/* ── Vortex token generator ────────────────────────────────────────── */}
      <div className="bh-team-section">
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
                      <span className="bh-vortex-expires">{t('businessHub.vortexExpiresOn', { date: new Date(tk.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })}</span>
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
                      {m.first_name ? `${m.first_name} ${m.last_name}` : '—'}
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
                    {m.accepted_at
                      ? new Date(m.accepted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : new Date(m.invited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    }
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
