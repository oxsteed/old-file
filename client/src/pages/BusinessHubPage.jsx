import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { acceptInvitation, declineInvitation } from '../api/businesses';
import {
  useBusinesses,
  useBusinessAnalytics,
  useBusinessInvoices,
  useBusinessTax,
  useBusinessGoals,
  useBusinessTeam,
  useBusinessProfileEditor,
  useCreateBusiness,
  useUpdateBusiness,
  useUploadBusinessPhotos,
  useCreateInvoice,
  useUpdateInvoice,
  useMarkInvoicePaid,
  useDeleteInvoice,
  useRefreshTax,
  useMarkTaxPaid,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useInviteMember,
  useRevokeMember,
  useGenerateVortexToken,
  useRevokeVortexToken,
} from '../hooks/useBusinessHub';
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

  // ── UI State (Modal/Form/Selection) – useState FIRST ───────────────────────
  const [bizId, setBizId]               = useState(() => localStorage.getItem(LS_KEY) || '');
  const [tab, setTab]                   = useState('overview');
  const [modal, setModal]               = useState(null);
  const [selected, setSelected]         = useState(null);
  const [form, setForm]                 = useState({});
  const [formErr, setFormErr]           = useState('');
  const [tokenForm, setTokenForm]       = useState({ role: 'representative', expires_in: '7d' });

  // ── Profile Tab UI State ──────────────────────────────────────────────────
  const [logoPreview, setLogoPreview]   = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);
  const [logoFile, setLogoFile]         = useState(null);
  const [coverFile, setCoverFile]       = useState(null);
  const [profileForm, setProfileForm]   = useState(null);
  const profileFieldsBaselineRef        = useRef(null);

  // ── React Query Hooks (NOW state is defined) ──────────────────────────────
  const businessesQuery = useBusinesses();
  const analyticsQuery = useBusinessAnalytics(bizId);
  const invoicesQuery = useBusinessInvoices(bizId);
  const taxQuery = useBusinessTax(bizId);
  const goalsQuery = useBusinessGoals(bizId);
  const teamQuery = useBusinessTeam(bizId);
  const profileQuery = useBusinessProfileEditor(bizId);

  // ── React Query Mutations ────────────────────────────────────────────────────
  const createBizMutation = useCreateBusiness();
  const updateBizMutation = useUpdateBusiness(bizId);
  const uploadPhotosMutation = useUploadBusinessPhotos(bizId);
  const createInvoiceMutation = useCreateInvoice(bizId);
  const updateInvoiceMutation = useUpdateInvoice(bizId, selected?.id);
  const markInvoicePaidMutation = useMarkInvoicePaid(bizId, selected?.id);
  const deleteInvoiceMutation = useDeleteInvoice(bizId, selected?.id);
  const refreshTaxMutation = useRefreshTax(bizId);
  const markTaxPaidMutation = useMarkTaxPaid(bizId);
  const createGoalMutation = useCreateGoal(bizId);
  const updateGoalMutation = useUpdateGoal(bizId, selected?.id);
  const deleteGoalMutation = useDeleteGoal(bizId, selected?.id);
  const inviteMemberMutation = useInviteMember(bizId);
  const revokeMemberMutation = useRevokeMember(bizId, selected?.id);
  const generateTokenMutation = useGenerateVortexToken(bizId);
  const revokeTokenMutation = useRevokeVortexToken(bizId, selected?.id);

  // ── Initialize bizId from merged businesses on first load ──────────────────
  useEffect(() => {
    if (businessesQuery.isSuccess && businessesQuery.data?.mergedBusinesses?.length > 0 && !bizId) {
      const saved = localStorage.getItem(LS_KEY);
      const merged = businessesQuery.data.mergedBusinesses;
      const valid = saved && merged.find(b => String(b.id) === String(saved));
      const chosen = valid ? saved : String(merged[0].id);
      setBizId(chosen);
      localStorage.setItem(LS_KEY, chosen);
    }
  }, [businessesQuery.data?.mergedBusinesses, bizId]);

  // ── Load profile form when profileQuery data arrives ──────────────────────
  useEffect(() => {
    if (profileQuery.isSuccess && profileQuery.data) {
      const biz = profileQuery.data.business;
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
    }
  }, [profileQuery.data, profileQuery.isSuccess]);

  // ── Show error toasts for failed mutations ────────────────────────────────
  useEffect(() => {
    if (analyticsQuery.error) toast.error(t('businessHub.errorAnalytics'));
  }, [analyticsQuery.error, t]);
  useEffect(() => {
    if (invoicesQuery.error) toast.error(t('businessHub.toastLoadInvoicesFail'));
  }, [invoicesQuery.error, t]);
  useEffect(() => {
    if (taxQuery.error) toast.error(t('businessHub.toastLoadTaxFail'));
  }, [taxQuery.error, t]);
  useEffect(() => {
    if (goalsQuery.error) toast.error(t('businessHub.toastLoadGoalsFail'));
  }, [goalsQuery.error, t]);
  useEffect(() => {
    if (teamQuery.error) toast.error(t('businessHub.toastLoadTeamFail'));
  }, [teamQuery.error, t]);
  useEffect(() => {
    if (profileQuery.error) setFormErr(t('businessHub.errorProfileLoad'));
  }, [profileQuery.error, t]);

  // ── Show success/error toasts for mutations ───────────────────────────────
  useEffect(() => {
    if (createBizMutation.isSuccess) {
      toast.success(t('businessHub.toastBizAdded'));
      closeModal();
      createBizMutation.reset();
    }
  }, [createBizMutation.isSuccess, t]);

  useEffect(() => {
    if (updateBizMutation.isSuccess) {
      toast.success(t('businessHub.toastProfileSaved'));
      setLogoFile(null);
      setCoverFile(null);
      updateBizMutation.reset();
    }
  }, [updateBizMutation.isSuccess, t]);

  useEffect(() => {
    if (uploadPhotosMutation.isSuccess) {
      toast.success(t('businessHub.toastPhotosUploaded'));
      uploadPhotosMutation.reset();
    }
  }, [uploadPhotosMutation.isSuccess, t]);

  useEffect(() => {
    if (createInvoiceMutation.isSuccess) {
      toast.success(t('businessHub.toastInvoiceCreated'));
      closeModal();
      createInvoiceMutation.reset();
    }
  }, [createInvoiceMutation.isSuccess, t]);

  useEffect(() => {
    if (updateInvoiceMutation.isSuccess) {
      toast.success(t('businessHub.toastInvoiceUpdated'));
      closeModal();
      updateInvoiceMutation.reset();
    }
  }, [updateInvoiceMutation.isSuccess, t]);

  useEffect(() => {
    if (markInvoicePaidMutation.isSuccess) {
      toast.success(t('businessHub.toastInvoicePaid'));
      closeModal();
      markInvoicePaidMutation.reset();
    }
  }, [markInvoicePaidMutation.isSuccess, t]);

  useEffect(() => {
    if (deleteInvoiceMutation.isSuccess) {
      toast.success(t('businessHub.toastInvoiceDeleted'));
      deleteInvoiceMutation.reset();
    }
  }, [deleteInvoiceMutation.isSuccess, t]);

  useEffect(() => {
    if (refreshTaxMutation.isSuccess) {
      toast.success(t('businessHub.toastTaxRefreshed'));
      refreshTaxMutation.reset();
    }
  }, [refreshTaxMutation.isSuccess, t]);

  useEffect(() => {
    if (markTaxPaidMutation.isSuccess) {
      toast.success(t('businessHub.toastTaxPaid'));
      closeModal();
      markTaxPaidMutation.reset();
    }
  }, [markTaxPaidMutation.isSuccess, t]);

  useEffect(() => {
    if (createGoalMutation.isSuccess) {
      toast.success(t('businessHub.toastGoalAdded'));
      closeModal();
      createGoalMutation.reset();
    }
  }, [createGoalMutation.isSuccess, t]);

  useEffect(() => {
    if (updateGoalMutation.isSuccess) {
      toast.success(t('businessHub.toastGoalUpdated'));
      closeModal();
      updateGoalMutation.reset();
    }
  }, [updateGoalMutation.isSuccess, t]);

  useEffect(() => {
    if (deleteGoalMutation.isSuccess) {
      toast.success(t('businessHub.toastGoalDeleted'));
      deleteGoalMutation.reset();
    }
  }, [deleteGoalMutation.isSuccess, t]);

  useEffect(() => {
    if (inviteMemberMutation.isSuccess) {
      toast.success(inviteMemberMutation.data?.user_found ? t('businessHub.toastInviteSent') : t('businessHub.toastInviteRecorded'));
      closeModal();
      inviteMemberMutation.reset();
    }
  }, [inviteMemberMutation.isSuccess, inviteMemberMutation.data, t]);

  useEffect(() => {
    if (revokeMemberMutation.isSuccess) {
      toast.success(t('businessHub.toastMemberRemoved'));
      revokeMemberMutation.reset();
    }
  }, [revokeMemberMutation.isSuccess, t]);

  useEffect(() => {
    if (generateTokenMutation.isSuccess) {
      toast.success(t('businessHub.toastVortexGenerated'));
      setTokenForm({ role: 'representative', expires_in: '7d' });
      generateTokenMutation.reset();
    }
  }, [generateTokenMutation.isSuccess, t]);

  useEffect(() => {
    if (revokeTokenMutation.isSuccess) {
      toast.success(t('businessHub.toastTokenRevoked'));
      revokeTokenMutation.reset();
    }
  }, [revokeTokenMutation.isSuccess, t]);

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function closeModal() { setModal(null); setSelected(null); setFormErr(''); }
  function fc(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }
  function handleSwitchBiz(id) {
    setBizId(id);
    localStorage.setItem(LS_KEY, id);
  }

  // ── Handlers using React Query mutations ──────────────────────────────────
  function handleAddBiz() {
    if (!form.business_name?.trim()) { setFormErr(t('businessHub.errBusinessNameRequired')); return; }
    createBizMutation.mutate(
      { ...form, tax_rate: form.tax_rate ? parseFloat(form.tax_rate) : undefined },
      { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastBizCreateFail')) }
    );
  }

  function handleSaveInvoice() {
    if (!form.client_name?.trim()) { setFormErr(t('businessHub.errClientNameRequired')); return; }
    if (!form.due_date) { setFormErr(t('businessHub.errDueDateRequired')); return; }
    const items = (form.line_items || []).filter(li => li.description?.trim());
    if (items.length === 0) { setFormErr(t('businessHub.errLineItemRequired')); return; }
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
      createInvoiceMutation.mutate(payload, { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastInvoiceSaveFail')) });
    } else {
      updateInvoiceMutation.mutate(payload, { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastInvoiceSaveFail')) });
    }
  }

  function handleMarkInvoicePaid() {
    markInvoicePaidMutation.mutate(
      form.amount ? parseFloat(form.amount) : undefined,
      { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastGenericFail')) }
    );
  }

  function handleDeleteInvoice(inv) {
    if (!window.confirm(t('businessHub.confirmDeleteInvoice', { num: inv.invoice_number }))) return;
    deleteInvoiceMutation.mutate(null, { onError: () => toast.error(t('businessHub.toastInvoiceDeleteFail')) });
  }

  function handleRefreshTax() {
    refreshTaxMutation.mutate(null, { onError: () => toast.error(t('businessHub.toastTaxRefreshFail')) });
  }

  function handleMarkTaxPaid() {
    markTaxPaidMutation.mutate(
      form.amount ? parseFloat(form.amount) : undefined,
      { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastGenericFail')) }
    );
  }

  function handleSaveGoal() {
    if (!form.title?.trim()) { setFormErr(t('businessHub.errTitleRequired')); return; }
    if (!form.target_value) { setFormErr(t('businessHub.errTargetRequired')); return; }
    const payload = {
      ...form,
      target_value: parseFloat(form.target_value),
      current_value: form.current_value !== '' && form.current_value != null ? parseFloat(form.current_value) : undefined,
    };
    if (modal === 'add-goal') {
      createGoalMutation.mutate(payload, { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastGoalSaveFail')) });
    } else {
      updateGoalMutation.mutate(payload, { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastGoalSaveFail')) });
    }
  }

  function handleDeleteGoal(g) {
    if (!window.confirm(t('businessHub.confirmDeleteGoal', { title: g.title }))) return;
    deleteGoalMutation.mutate(null, { onError: () => toast.error(t('businessHub.toastGoalDeleteFail')) });
  }

  function handleSaveProfile() {
    if (!profileForm) return;
    setFormErr('');
    (async () => {
      try {
        if (logoFile || coverFile) {
          await uploadPhotosMutation.mutateAsync({ logo: logoFile, cover: coverFile });
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
            body.service_radius_miles = curR === '' || curR == null ? null : parseFloat(curR);
          }
        }
        updateBizMutation.mutate(body, { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.errorProfileSave')) });
      } catch (e) {
        setFormErr(e?.response?.data?.error || t('businessHub.errorProfileSave'));
      }
    })();
  }

  function handleInviteMember() {
    if (!form.invite_email?.trim()) { setFormErr(t('businessHub.errEmailRequired')); return; }
    if (!form.invite_role) { setFormErr(t('businessHub.errRoleRequired')); return; }
    inviteMemberMutation.mutate(
      { email: form.invite_email.trim(), role: form.invite_role },
      { onError: (e) => setFormErr(e?.response?.data?.error || t('businessHub.toastInviteSendFail')) }
    );
  }

  function handleRevokeMember(member) {
    const label = member.status === 'pending'
      ? t('businessHub.confirmCancelInvite', { email: member.invite_email })
      : t('businessHub.confirmRemoveMember', { name: member.first_name || member.invite_email });
    if (!window.confirm(label)) return;
    revokeMemberMutation.mutate(null, { onError: () => toast.error(t('businessHub.toastMemberRemoveFail')) });
  }

  async function handleAcceptInvitation(inv) {
    try {
      await acceptInvitation(inv.id);
      toast.success(t('businessHub.toastInviteAccepted', { name: inv.business_name }));
      teamQuery.refetch();
    } catch (e) { toast.error(e?.response?.data?.error || t('businessHub.toastInviteAcceptFail')); }
  }

  async function handleDeclineInvitation(inv) {
    try {
      await declineInvitation(inv.id);
      toast.success(t('businessHub.toastInviteDeclined'));
      teamQuery.refetch();
    } catch { toast.error(t('businessHub.toastInviteDeclineFail')); }
  }

  function handleGenerateToken() {
    if (!bizId) return;
    generateTokenMutation.mutate(tokenForm, { onError: (e) => toast.error(e?.response?.data?.error || t('businessHub.toastVortexGenerateFail')) });
  }

  function handleRevokeToken(tokenId) {
    if (!bizId) return;
    revokeTokenMutation.mutate(null, { onError: () => toast.error(t('businessHub.toastTokenRevokeFail')) });
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
  const currentBiz  = businessesQuery.data?.mergedBusinesses?.find(b => String(b.id) === String(bizId));
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
        {businessesQuery.isLoading ? (
          <p className="bh-loading">{t('businessHub.loadingBusinesses')}</p>
        ) : (businessesQuery.data?.mergedBusinesses?.length ?? 0) === 0 ? (
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
                {(businessesQuery.data?.mergedBusinesses || []).map(b => (
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
              profileQuery.isLoading ? <p className="bh-loading">{t('businessHub.loadingProfile')}</p> :
              !profileForm && formErr ? (
                <div className="bh-empty" style={{ marginTop: '1rem' }}>
                  <p className="bh-error" style={{ marginBottom: '1rem' }}>{formErr}</p>
                  <button type="button" className="bh-btn primary" onClick={() => profileQuery.refetch()}>
                    {t('businessHub.tryAgain')}
                  </button>
                </div>
              ) :
              <ProfileTab
                form={profileForm}
                logoPreview={logoPreview}
                coverPreview={coverPreview}
                saving={updateBizMutation.isPending || uploadPhotosMutation.isPending}
                err={formErr}
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
              analyticsQuery.isLoading ? <p className="bh-loading">{t('businessHub.loadingAnalytics')}</p> :
              analyticsQuery.error ? <p className="bh-error">{t('businessHub.errorAnalytics')}</p> :
              <OverviewTab analytics={analyticsQuery.data} />
            )}

            {/* ── Invoices tab ─────────────────────────────────────── */}
            {tab === 'invoices' && (
              invoicesQuery.isLoading ? <p className="bh-loading">{t('businessHub.loadingInvoices')}</p> :
              <InvoicesTab
                data={invoicesQuery.data}
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
                onPay={inv => { setSelected(inv); setForm({ amount: inv.total || '' }); setFormErr(''); setModal('pay-inv'); }}
                onDelete={handleDeleteInvoice}
              />
            )}

            {/* ── Tax tab ──────────────────────────────────────────── */}
            {tab === 'tax' && (
              taxQuery.isLoading ? <p className="bh-loading">{t('businessHub.loadingTax')}</p> :
              <TaxTab
                data={taxQuery.data}
                onRefresh={handleRefreshTax}
                onPay={est => { setSelected(est); setForm({ amount: est.estimated_tax || '' }); setFormErr(''); setModal('pay-tax'); }}
              />
            )}

            {/* ── Goals tab ────────────────────────────────────────── */}
            {tab === 'goals' && (
              goalsQuery.isLoading ? <p className="bh-loading">{t('businessHub.loadingGoals')}</p> :
              <GoalsTab
                goals={goalsQuery.data}
                analytics={analyticsQuery.data}
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
              teamQuery.isLoading ? <p className="bh-loading">{t('businessHub.loadingTeam')}</p> :
              <TeamTab
                members={teamQuery.data?.members || []}
                invitations={teamQuery.data?.invitations || []}
                managedBiz={teamQuery.data?.managedBiz || []}
                vortexTokens={teamQuery.data?.vortexTokens || []}
                tokenForm={tokenForm}
                onTokenFormChange={(patch) => setTokenForm(f => ({ ...f, ...patch }))}
                onGenerateToken={handleGenerateToken}
                generatingToken={generateTokenMutation.isPending}
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
                <button className="bh-btn primary" onClick={handleAddBiz} disabled={createBizMutation.isPending}>{createBizMutation.isPending ? t('businessHub.btnSaving') : t('businessHub.addBusiness')}</button>
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
                <button className="bh-btn primary" onClick={handleSaveInvoice} disabled={createInvoiceMutation.isPending || updateInvoiceMutation.isPending}>{(createInvoiceMutation.isPending || updateInvoiceMutation.isPending) ? t('businessHub.btnSaving') : modal === 'add-inv' ? t('businessHub.btnCreateInvoice') : t('businessHub.btnSaveChanges')}</button>
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
                <button className="bh-btn primary" onClick={handleMarkInvoicePaid} disabled={markInvoicePaidMutation.isPending}>{markInvoicePaidMutation.isPending ? t('businessHub.btnSaving') : t('businessHub.btnMarkPaid')}</button>
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
                <button className="bh-btn primary" onClick={handleSaveGoal} disabled={createGoalMutation.isPending || updateGoalMutation.isPending}>{(createGoalMutation.isPending || updateGoalMutation.isPending) ? t('businessHub.btnSaving') : modal === 'add-goal' ? t('businessHub.btnAddGoal') : t('businessHub.btnSaveChanges')}</button>
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
                <button className="bh-btn primary" onClick={handleMarkTaxPaid} disabled={markTaxPaidMutation.isPending}>{markTaxPaidMutation.isPending ? t('businessHub.btnSaving') : t('businessHub.btnRecordPayment')}</button>
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
                <button className="bh-btn primary" onClick={handleInviteMember} disabled={inviteMemberMutation.isPending}>{inviteMemberMutation.isPending ? t('businessHub.btnSending') : t('businessHub.btnSendInvite')}</button>
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
  if (!form) return null;

  function pf(e) {
    const { name, value } = e.target;
    onChange({ [name]: value });
  }

  return (
    <div className="bh-profile-tab">
      <div className="bh-profile-header">
        <div>
          <h2 className="bh-profile-title">{t('businessHub.publicProfile')}</h2>
          <p className="bh-profile-subtitle">
            {t('businessHub.publicProfileSubtitle')}
          </p>
          {currentRole === 'manager' && (
            <p className="bh-profile-note" style={{ marginTop: '0.4rem', color: '#818cf8', fontSize: '0.82rem' }}>
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
            className="bh-btn sm"
          >
            {t('businessHub.preview')} ↗
          </a>
        )}
      </div>

      {/* ── Photos ──────────────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionPhotos')}</h3>
        <div className="bh-photo-row">

          {/* Logo */}
          <div className="bh-photo-field">
            <label className="bh-photo-label">{t('businessHub.businessLogo')}</label>
            <div className="bh-photo-preview bh-photo-preview--logo">
              {logoPreview
                ? <img src={logoPreview} alt={t('businessHub.logoPreviewAlt')} className="bh-photo-img" />
                : <span className="bh-photo-placeholder">{t('businessHub.noLogo')}</span>}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="bh-photo-input"
              onChange={e => onLogoChange(e.target.files?.[0] || null)}
              id="bh-logo-input"
            />
            <label htmlFor="bh-logo-input" className="bh-btn sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
              {logoPreview ? t('businessHub.changeLogo') : t('businessHub.uploadLogo')}
            </label>
            {logoPreview && (
              <button
                className="bh-btn sm danger"
                onClick={() => { onLogoChange(null); onChange({ logo_url: '' }); }}
                style={{ marginLeft: '0.5rem' }}
              >
                {t('businessHub.remove')}
              </button>
            )}
          </div>

          {/* Cover photo */}
          <div className="bh-photo-field">
            <label className="bh-photo-label">{t('businessHub.coverPhoto')}</label>
            <div className="bh-photo-preview bh-photo-preview--cover">
              {coverPreview
                ? <img src={coverPreview} alt={t('businessHub.coverPreviewAlt')} className="bh-photo-img" />
                : <span className="bh-photo-placeholder">{t('businessHub.noCoverPhoto')}</span>}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="bh-photo-input"
              onChange={e => onCoverChange(e.target.files?.[0] || null)}
              id="bh-cover-input"
            />
            <label htmlFor="bh-cover-input" className="bh-btn sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
              {coverPreview ? t('businessHub.changeCover') : t('businessHub.uploadCover')}
            </label>
            {coverPreview && (
              <button
                className="bh-btn sm danger"
                onClick={() => { onCoverChange(null); onChange({ cover_photo_url: '' }); }}
                style={{ marginLeft: '0.5rem' }}
              >
                {t('businessHub.remove')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Business identity ────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionBusinessIdentity')}</h3>
        <div className="bh-field-row">
          <div className="bh-field">
            <label>{t('businessHub.fieldBusinessNameRequired')}</label>
            <input name="business_name" value={form.business_name} onChange={pf} placeholder={t('businessHub.placeholderBizName')} />
          </div>
          <div className="bh-field">
            <label>{t('businessHub.fieldBusinessType')}</label>
            <select name="business_type" value={form.business_type} onChange={pf}>
              <option value="">{t('businessHub.selectTypePlaceholder')}</option>
              {BIZ_TYPES.map(bt => <option key={bt.value} value={bt.value}>{t(`businessHub.${bt.labelKey}`)}</option>)}
            </select>
          </div>
        </div>
        <div className="bh-field">
          <label>{t('businessHub.fieldTagline')}</label>
          <input
            name="profile_headline"
            value={form.profile_headline}
            onChange={pf}
            placeholder={t('businessHub.placeholderTagline')}
            maxLength={120}
          />
          <span className="bh-field-hint">{t('businessHub.taglineHint')}</span>
        </div>
        <div className="bh-field">
          <label>{t('businessHub.fieldAbout')}</label>
          <textarea
            name="description"
            value={form.description}
            onChange={pf}
            rows={4}
            placeholder={t('businessHub.placeholderAbout')}
          />
        </div>
      </section>

      {/* ── Contact info ────────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionContact')}</h3>
        <div className="bh-field-row">
          <div className="bh-field">
            <label>{t('businessHub.fieldPhone')}</label>
            <input name="phone" value={form.phone} onChange={pf} placeholder={t('businessHub.placeholderPhone')} type="tel" />
          </div>
          <div className="bh-field">
            <label>{t('businessHub.fieldWebsite')}</label>
            <input name="website" value={form.website} onChange={pf} placeholder={t('businessHub.placeholderWebsiteFull')} type="url" />
          </div>
        </div>
      </section>

      {/* ── Location & service area ──────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionServiceArea')}</h3>
        <div className="bh-field">
          <label>{t('businessHub.fieldAddress')}</label>
          <input name="address_street" value={form.address_street} onChange={pf} placeholder={t('businessHub.placeholderStreet')} />
        </div>
        <div className="bh-field-row">
          <div className="bh-field">
            <input name="address_city" value={form.address_city} onChange={pf} placeholder={t('businessHub.placeholderCity')} />
          </div>
          <div className="bh-field">
            <select name="address_state" value={form.address_state} onChange={pf}>
              <option value="">{t('businessHub.selectState')}</option>
              {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="bh-field">
            <input name="address_zip" value={form.address_zip} onChange={pf} placeholder={t('businessHub.placeholderZip')} />
          </div>
        </div>
        <div className="bh-field">
          <label>{t('businessHub.fieldServiceRadius')}</label>
          <input type="number" name="service_radius_miles" value={form.service_radius_miles} onChange={pf} placeholder="10" min="0" max="100" />
          <span className="bh-field-hint">{t('businessHub.serviceRadiusHint')}</span>
        </div>
      </section>

      {err && <div className="bh-error" style={{ marginTop: '1rem' }}>{err}</div>}
      <div className="bh-profile-actions">
        <button className="bh-btn primary" onClick={onSave} disabled={saving}>
          {saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveProfile')}
        </button>
      </div>
    </div>
  );
}

// ── Tab Components (Placeholder - these exist in the original file) ───────────

function OverviewTab({ analytics }) {
  const { t } = useTranslation();
  if (!analytics) return null;
  return (
    <div className="bh-overview-tab">
      <p>{t('businessHub.overviewPlaceholder')}</p>
      <pre>{JSON.stringify(analytics, null, 2)}</pre>
    </div>
  );
}

function InvoicesTab({ data, onNew, onEdit, onPay, onDelete }) {
  const { t } = useTranslation();
  if (!data) return null;
  return (
    <div className="bh-invoices-tab">
      <button className="bh-btn primary" onClick={onNew}>{t('businessHub.btnNewInvoice')}</button>
      <p>{t('businessHub.invoicesPlaceholder')}</p>
    </div>
  );
}

function TaxTab({ data, onRefresh, onPay }) {
  const { t } = useTranslation();
  if (!data) return null;
  return (
    <div className="bh-tax-tab">
      <button className="bh-btn primary" onClick={onRefresh}>{t('businessHub.btnRefreshTax')}</button>
      <p>{t('businessHub.taxPlaceholder')}</p>
    </div>
  );
}

function GoalsTab({ goals, analytics, onNew, onEdit, onDelete }) {
  const { t } = useTranslation();
  return (
    <div className="bh-goals-tab">
      <button className="bh-btn primary" onClick={onNew}>{t('businessHub.btnAddGoal')}</button>
      <p>{t('businessHub.goalsPlaceholder')}</p>
    </div>
  );
}

function TeamTab({ members, invitations, managedBiz, vortexTokens, tokenForm, onTokenFormChange, onGenerateToken, generatingToken, onRevokeToken, onInvite, onRevoke, onAccept, onDecline }) {
  const { t } = useTranslation();
  return (
    <div className="bh-team-tab">
      <button className="bh-btn primary" onClick={onInvite}>{t('businessHub.btnInviteMember')}</button>
      <p>{t('businessHub.teamPlaceholder')}</p>
    </div>
  );
}
