import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import {
  listBusinesses, createBusiness, updateBusiness, uploadBusinessPhotos,
  getAnalytics,
  listInvoices, createInvoice, updateInvoice, markInvoicePaid, deleteInvoice,
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

  // guard
  if (!user || !HELPER_ROLES.includes(user.role)) {
    return (
      <PageShell>
        <PageMeta title="Business Hub — OxSteed" description="Manage your service business finances, invoices, and goals." />
        <div className="bh-page">
          <div className="bh-empty" style={{ marginTop: '3rem' }}>
            <p style={{ fontWeight: 700 }}>Helpers only</p>
            <p>The Business Hub is available to Helper, Helper Pro, and Broker accounts.</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return <BusinessHubInner />;
}

function BusinessHubInner() {
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

  // ── load businesses (owned + managed) ───────────────────────────────────
  const loadBusinesses = useCallback(async () => {
    setLoadingBiz(true);
    try {
      const [owned, managed] = await Promise.all([
        listBusinesses(),
        listManagedBusinesses().catch(() => []),
      ]);
      // Tag each entry so the UI knows the caller's relationship to it.
      const ownedTagged   = owned.map(b   => ({ ...b, _role: 'owner'    }));
      const managedTagged = managed.map(b => ({ ...b, _role: b.role })); // 'manager' | 'representative'
      // Deduplicate: if the user somehow owns AND is a member, prefer 'owner'.
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
    } catch { toast.error('Failed to load businesses'); }
    finally { setLoadingBiz(false); }
  }, []);

  useEffect(() => { loadBusinesses(); }, [loadBusinesses]);

  // ── load tab data when bizId or tab changes ──────────────────────────────
  const loadOverview = useCallback(async () => {
    if (!bizId) return;
    setAnalyticsLoading(true);
    try { setAnalytics(await getAnalytics(bizId)); }
    catch { toast.error('Failed to load analytics'); }
    finally { setAnalyticsLoading(false); }
  }, [bizId]);

  const loadInvoices = useCallback(async () => {
    if (!bizId) return;
    setInvoicesLoading(true);
    try { setInvoiceData(await listInvoices(bizId)); }
    catch { toast.error('Failed to load invoices'); }
    finally { setInvoicesLoading(false); }
  }, [bizId]);

  const loadTax = useCallback(async () => {
    if (!bizId) return;
    setTaxLoading(true);
    try { setTaxData(await getTax(bizId)); }
    catch { toast.error('Failed to load tax estimates'); }
    finally { setTaxLoading(false); }
  }, [bizId]);

  const loadGoals = useCallback(async () => {
    if (!bizId) return;
    setGoalsLoading(true);
    try { setGoals(await listGoals(bizId)); }
    catch { toast.error('Failed to load goals'); }
    finally { setGoalsLoading(false); }
  }, [bizId]);

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
    } catch { toast.error('Failed to load team'); }
    finally { setMembersLoading(false); }
  }, [bizId]);

  const loadProfile = useCallback(async () => {
    if (!bizId) return;
    setProfileLoading(true);
    setProfileErr('');
    try {
      const data = await getBusinessProfileForEditor(bizId);
      const biz = data.business;
      setProfileForm({
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
      });
      setLogoPreview(biz.logo_url || null);
      setCoverPreview(biz.cover_photo_url || null);
      setLogoFile(null);
      setCoverFile(null);
    } catch { setProfileErr('Failed to load business profile.'); }
    finally { setProfileLoading(false); }
  }, [bizId]);

  const handleSaveProfile = useCallback(async () => {
    if (!profileForm) return;
    setProfileSaving(true);
    setProfileErr('');
    try {
      // 1. Upload photos first if files were selected
      if (logoFile || coverFile) {
        await uploadBusinessPhotos(bizId, logoFile || null, coverFile || null);
      }
      // 2. Save text fields (logo_url / cover_photo_url included if typed manually)
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
      await updateBusiness(bizId, {
        business_name:        profileForm.business_name       || undefined,
        business_type:        profileForm.business_type       || undefined,
        // Send '' / null explicitly so JSON includes the key; omitted keys become NULL
        // server-side and COALESCE(NULL, col) would preserve the previous value.
        profile_headline:     profileForm.profile_headline ?? '',
        description:          profileForm.description ?? '',
        phone:                profileForm.phone ?? '',
        website:              profileForm.website ?? '',
        address_street:       profileForm.address_street ?? '',
        address_city:         profileForm.address_city ?? '',
        address_state:        profileForm.address_state ?? '',
        address_zip:          profileForm.address_zip ?? '',
        service_radius_miles:
          profileForm.service_radius_miles === '' || profileForm.service_radius_miles == null
            ? null
            : parseFloat(profileForm.service_radius_miles),
        ...photoPatch,
      });
      toast.success('Profile saved');
      // Reload so form reflects persisted values
      setLogoFile(null);
      setCoverFile(null);
      await loadProfile();
    } catch (e) {
      setProfileErr(e?.response?.data?.error || 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  }, [bizId, profileForm, logoFile, coverFile, loadProfile]);

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
    if (!form.business_name?.trim()) { setFormErr('Business name is required.'); return; }
    setSaving(true);
    try {
      await createBusiness({ ...form, tax_rate: form.tax_rate ? parseFloat(form.tax_rate) : undefined });
      toast.success('Business added');
      closeModal();
      await loadBusinesses();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed to create business'); }
    finally { setSaving(false); }
  }

  // ── invoice CRUD ──────────────────────────────────────────────────────────
  async function handleSaveInvoice() {
    if (!form.client_name?.trim()) { setFormErr('Client name is required.'); return; }
    if (!form.due_date) { setFormErr('Due date is required.'); return; }
    const items = (form.line_items || []).filter(li => li.description?.trim());
    if (items.length === 0) { setFormErr('At least one line item is required.'); return; }
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
        toast.success('Invoice created');
      } else {
        await updateInvoice(bizId, selected.id, payload);
        toast.success('Invoice updated');
      }
      closeModal();
      await loadInvoices();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed to save invoice'); }
    finally { setSaving(false); }
  }

  async function handleMarkInvoicePaid() {
    setSaving(true);
    try {
      await markInvoicePaid(bizId, selected.id, form.amount ? parseFloat(form.amount) : undefined);
      toast.success('Invoice marked paid');
      closeModal();
      await loadInvoices();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  }

  async function handleDeleteInvoice(inv) {
    if (!window.confirm(`Delete invoice ${inv.invoice_number}?`)) return;
    try {
      await deleteInvoice(bizId, inv.id);
      toast.success('Invoice deleted');
      await loadInvoices();
    } catch { toast.error('Failed to delete invoice'); }
  }

  // ── tax ───────────────────────────────────────────────────────────────────
  async function handleRefreshTax() {
    try {
      await refreshTax(bizId);
      toast.success('Tax estimates refreshed');
      await loadTax();
    } catch { toast.error('Failed to refresh tax estimates'); }
  }

  async function handleMarkTaxPaid() {
    setSaving(true);
    try {
      await markTaxPaid(bizId, selected.id, form.amount ? parseFloat(form.amount) : undefined);
      toast.success('Tax payment recorded');
      closeModal();
      await loadTax();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  }

  // ── goals ─────────────────────────────────────────────────────────────────
  async function handleSaveGoal() {
    if (!form.title?.trim()) { setFormErr('Title is required.'); return; }
    if (!form.target_value) { setFormErr('Target value is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        target_value: parseFloat(form.target_value),
        current_value: form.current_value !== '' && form.current_value != null ? parseFloat(form.current_value) : undefined,
      };
      if (modal === 'add-goal') {
        await createGoal(bizId, payload);
        toast.success('Goal added');
      } else {
        await updateGoal(bizId, selected.id, payload);
        toast.success('Goal updated');
      }
      closeModal();
      await loadGoals();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed to save goal'); }
    finally { setSaving(false); }
  }

  async function handleDeleteGoal(g) {
    if (!window.confirm(`Delete goal "${g.title}"?`)) return;
    try {
      await deleteGoal(bizId, g.id);
      toast.success('Goal deleted');
      await loadGoals();
    } catch { toast.error('Failed to delete goal'); }
  }

  // ── team ──────────────────────────────────────────────────────────────────
  async function handleInviteMember() {
    if (!form.invite_email?.trim()) { setFormErr('Email is required.'); return; }
    if (!form.invite_role) { setFormErr('Role is required.'); return; }
    setSaving(true);
    try {
      const result = await inviteMember(bizId, { email: form.invite_email.trim(), role: form.invite_role });
      toast.success(result.user_found ? 'Invitation sent' : `Invite recorded — they'll see it when they sign up`);
      closeModal();
      await loadTeam();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed to send invite'); }
    finally { setSaving(false); }
  }

  async function handleRevokeMember(member) {
    const label = member.status === 'pending' ? `Cancel invite to ${member.invite_email}?` : `Remove ${member.first_name || member.invite_email} from this business?`;
    if (!window.confirm(label)) return;
    try {
      await revokeMember(bizId, member.id);
      toast.success('Member removed');
      await loadTeam();
    } catch { toast.error('Failed to remove member'); }
  }

  async function handleAcceptInvitation(inv) {
    try {
      await acceptInvitation(inv.id);
      toast.success(`Joined "${inv.business_name}"`);
      await loadTeam();
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to accept'); }
  }

  async function handleDeclineInvitation(inv) {
    try {
      await declineInvitation(inv.id);
      toast.success('Invitation declined');
      await loadTeam();
    } catch { toast.error('Failed to decline'); }
  }

  // ── vortex token handlers ─────────────────────────────────────────────────
  async function handleGenerateToken() {
    if (!bizId) return;
    setGeneratingToken(true);
    try {
      await generateVortexToken(bizId, tokenForm);
      toast.success('Vortex token generated');
      const tokens = await listVortexTokens(bizId).catch(() => []);
      setVortexTokens(tokens);
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to generate token'); }
    finally { setGeneratingToken(false); }
  }

  async function handleRevokeToken(tokenId) {
    if (!bizId) return;
    try {
      await revokeVortexToken(bizId, tokenId);
      toast.success('Token revoked');
      const tokens = await listVortexTokens(bizId).catch(() => []);
      setVortexTokens(tokens);
    } catch { toast.error('Failed to revoke token'); }
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
  const currentRole = currentBiz?._role || 'owner'; // 'owner' | 'manager' | 'representative'
  const canEditBizProfile = currentRole === 'owner' || currentRole === 'manager';

  // If the user switches to a business where they can't edit profile, fall back to overview
  useEffect(() => {
    if (tab === 'profile' && !canEditBizProfile) {
      setTab('overview');
    }
  }, [bizId, canEditBizProfile, tab]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageMeta title="Business Hub — OxSteed" description="Manage your service business finances, invoices, and goals." />
      <div className="bh-page">

        {/* Header */}
        <div className="bh-header">
          <div>
            <h1>Business Hub</h1>
            <p>Manage invoices, track taxes, and monitor your business goals.</p>
          </div>
          <div className="bh-header-actions">
            <button className="bh-btn primary" onClick={() => { setForm(DEFAULT_BIZ_FORM); setFormErr(''); setModal('add-biz'); }}>
              + Add Business
            </button>
          </div>
        </div>

        {/* Business switcher */}
        {loadingBiz ? (
          <p className="bh-loading">Loading businesses…</p>
        ) : businesses.length === 0 ? (
          <div className="bh-empty">
            <p style={{ fontWeight: 700 }}>No businesses yet</p>
            <p>Add your first business to start tracking invoices, taxes, and goals.</p>
            <button className="bh-btn primary" onClick={() => { setForm(DEFAULT_BIZ_FORM); setFormErr(''); setModal('add-biz'); }}>
              Add a Business
            </button>
          </div>
        ) : (
          <>
            <div className="bh-switcher">
              <span className="bh-switcher-label">Business</span>
              <select value={bizId} onChange={e => handleSwitchBiz(e.target.value)}>
                {businesses.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.business_name}
                    {b._role !== 'owner' ? ` (${b._role})` : ''}
                  </option>
                ))}
              </select>
              {currentBiz?.is_primary && currentRole === 'owner' && <span className="bh-primary-tag">Primary</span>}
              {currentRole !== 'owner' && (
                <span className="bh-primary-tag" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)' }}>
                  {currentRole === 'manager' ? 'Manager' : 'Representative'}
                </span>
              )}
              {bizId && (
                <Link
                  to={`/business/${bizId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bh-view-profile-link"
                  title="View public profile"
                >
                  View Profile ↗
                </Link>
              )}
            </div>

            {/* Tabs */}
            <div className="bh-tabs">
              {['profile', 'overview', 'invoices', 'tax', 'goals', 'team']
                .filter(t => t !== 'profile' || canEditBizProfile)
                .map(t => (
                  <button key={t} className={`bh-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                    {t === 'profile' ? 'Edit Profile' : t === 'team' ? 'Team' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
            </div>

            {/* ── Profile tab ──────────────────────────────────────── */}
            {tab === 'profile' && (
              profileLoading ? <p className="bh-loading">Loading profile…</p> :
              !profileForm && profileErr ? (
                <div className="bh-empty" style={{ marginTop: '1rem' }}>
                  <p className="bh-error" style={{ marginBottom: '1rem' }}>{profileErr}</p>
                  <button type="button" className="bh-btn primary" onClick={() => loadProfile()}>
                    Try again
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
              analyticsLoading ? <p className="bh-loading">Loading analytics…</p> :
              !analytics ? <p className="bh-error">Could not load analytics.</p> :
              <OverviewTab analytics={analytics} />
            )}

            {/* ── Invoices tab ─────────────────────────────────────── */}
            {tab === 'invoices' && (
              invoicesLoading ? <p className="bh-loading">Loading invoices…</p> :
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
                onPay={inv => { setSelected(inv); setForm({ amount: inv.total || '' }); setFormErr(''); setModal('pay-inv'); }}
                onDelete={handleDeleteInvoice}
              />
            )}

            {/* ── Tax tab ──────────────────────────────────────────── */}
            {tab === 'tax' && (
              taxLoading ? <p className="bh-loading">Loading tax estimates…</p> :
              <TaxTab
                data={taxData}
                onRefresh={handleRefreshTax}
                onPay={est => { setSelected(est); setForm({ amount: est.estimated_tax || '' }); setFormErr(''); setModal('pay-tax'); }}
              />
            )}

            {/* ── Goals tab ────────────────────────────────────────── */}
            {tab === 'goals' && (
              goalsLoading ? <p className="bh-loading">Loading goals…</p> :
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
              membersLoading ? <p className="bh-loading">Loading team…</p> :
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
              <h2>Add Business</h2>
              <div className="bh-field"><label>Name *</label><input name="business_name" value={form.business_name || ''} onChange={fc} placeholder="My Service Co." /></div>
              <div className="bh-field"><label>Description</label><textarea name="description" value={form.description || ''} onChange={fc} rows={2} /></div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Phone</label><input name="phone" value={form.phone || ''} onChange={fc} /></div>
                <div className="bh-field"><label>Website</label><input name="website" value={form.website || ''} onChange={fc} placeholder="https://" /></div>
              </div>
              <div className="bh-field"><label>Default Tax Rate (%)</label><input type="number" name="tax_rate" value={form.tax_rate || ''} onChange={fc} placeholder="0" min="0" max="100" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleAddBiz} disabled={saving}>{saving ? 'Saving…' : 'Add Business'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Add / Edit Invoice ─────────────────────────────── */}
        {(modal === 'add-inv' || modal === 'edit-inv') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-inv' ? 'New Invoice' : 'Edit Invoice'}</h2>
              <div className="bh-field-row">
                <div className="bh-field"><label>Client Name *</label><input name="client_name" value={form.client_name || ''} onChange={fc} /></div>
                <div className="bh-field"><label>Client Email</label><input type="email" name="client_email" value={form.client_email || ''} onChange={fc} /></div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Company</label><input name="client_company" value={form.client_company || ''} onChange={fc} /></div>
                <div className="bh-field"><label>Due Date *</label><input type="date" name="due_date" value={form.due_date || ''} onChange={fc} /></div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Tax Rate (%)</label><input type="number" name="invoice_tax_rate" value={form.invoice_tax_rate ?? ''} onChange={fc} placeholder="0" min="0" max="100" step="0.01" /></div>
                <div className="bh-field">
                  <label>Status</label>
                  <select name="status" value={form.status || 'draft'} onChange={fc}>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="paid">Paid</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Line items */}
              <div className="bh-field"><label>Line Items</label></div>
              <div className="bh-line-items">
                {(form.line_items || []).map((li, i) => (
                  <div key={i} className="bh-line-item">
                    <input placeholder="Description" value={li.description || ''} onChange={e => updateLineItem(i, 'description', e.target.value)} />
                    <input type="number" placeholder="Qty" value={li.quantity || ''} onChange={e => updateLineItem(i, 'quantity', e.target.value)} min="0" step="0.01" />
                    <input type="number" placeholder="Unit $" value={li.unit_price || ''} onChange={e => updateLineItem(i, 'unit_price', e.target.value)} min="0" step="0.01" />
                    <button className="bh-line-remove" onClick={() => removeLineItem(i)} disabled={(form.line_items || []).length <= 1}>×</button>
                  </div>
                ))}
                <button className="bh-line-add" onClick={addLineItem}>+ Add line item</button>
              </div>

              {/* Live totals preview */}
              {(() => {
                const { subtotal, taxAmt, total } = calcTotals(form.line_items, form.invoice_tax_rate);
                return (
                  <div className="bh-totals">
                    <div>Subtotal: {fmt$(subtotal)}</div>
                    {taxAmt > 0 && <div>Tax ({form.invoice_tax_rate || 0}%): {fmt$(taxAmt)}</div>}
                    <div className="grand">Total: {fmt$(total)}</div>
                  </div>
                );
              })()}

              <div className="bh-field"><label>Notes</label><textarea name="notes" value={form.notes || ''} onChange={fc} rows={2} /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleSaveInvoice} disabled={saving}>{saving ? 'Saving…' : modal === 'add-inv' ? 'Create Invoice' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Mark Invoice Paid ──────────────────────────────── */}
        {modal === 'pay-inv' && selected && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>Mark Invoice Paid</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                Invoice {selected.invoice_number} · Total {fmt$(selected.total)}
              </p>
              <div className="bh-field"><label>Amount Received ($)</label><input type="number" name="amount" value={form.amount || ''} onChange={fc} min="0" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleMarkInvoicePaid} disabled={saving}>{saving ? 'Saving…' : 'Mark Paid'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Add / Edit Goal ────────────────────────────────── */}
        {(modal === 'add-goal' || modal === 'edit-goal') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-goal' ? 'Add Goal' : 'Edit Goal'}</h2>
              <div className="bh-field"><label>Title *</label><input name="title" value={form.title || ''} onChange={fc} placeholder="e.g. Monthly Revenue Target" /></div>
              <div className="bh-field-row">
                <div className="bh-field">
                  <label>Type</label>
                  <select name="goal_type" value={form.goal_type || 'revenue'} onChange={fc}>
                    <option value="revenue">Revenue</option>
                    <option value="profit">Profit</option>
                    <option value="jobs">Jobs Completed</option>
                    <option value="clients">Clients</option>
                    <option value="invoiced">Invoiced</option>
                  </select>
                </div>
                <div className="bh-field">
                  <label>Period</label>
                  <select name="period" value={form.period || 'monthly'} onChange={fc}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Target Value *</label><input type="number" name="target_value" value={form.target_value || ''} onChange={fc} min="0" step="0.01" /></div>
                <div className="bh-field"><label>Current Value</label><input type="number" name="current_value" value={form.current_value ?? ''} onChange={fc} min="0" step="0.01" /></div>
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleSaveGoal} disabled={saving}>{saving ? 'Saving…' : modal === 'add-goal' ? 'Add Goal' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Mark Tax Paid ──────────────────────────────────── */}
        {modal === 'pay-tax' && selected && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>Record Tax Payment</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                Q{selected.quarter} {selected.year} · Estimated {fmt$(selected.estimated_tax)}
              </p>
              <div className="bh-field"><label>Amount Paid ($)</label><input type="number" name="amount" value={form.amount || ''} onChange={fc} min="0" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleMarkTaxPaid} disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Invite Team Member ─────────────────────────────── */}
        {modal === 'invite-member' && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>Invite Team Member</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                Invite someone to represent or manage this business. They'll get a notification to accept.
              </p>
              <div className="bh-field">
                <label>Email *</label>
                <input
                  type="email"
                  name="invite_email"
                  value={form.invite_email || ''}
                  onChange={fc}
                  placeholder="teammate@example.com"
                />
              </div>
              <div className="bh-field">
                <label>Role *</label>
                <select name="invite_role" value={form.invite_role || 'representative'} onChange={fc}>
                  <option value="representative">Representative — handles customer chat &amp; job acceptance</option>
                  <option value="manager">Manager — full access to invoices, tax &amp; analytics</option>
                </select>
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleInviteMember} disabled={saving}>{saving ? 'Sending…' : 'Send Invite'}</button>
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
  'Handyman', 'Plumbing', 'Electrical', 'HVAC', 'Landscaping', 'Cleaning',
  'Painting', 'Carpentry', 'Roofing', 'Flooring', 'Moving', 'Pest Control',
  'Pool Service', 'Auto Repair', 'General Labor', 'Other',
];

function ProfileTab({ form, logoPreview, coverPreview, saving, err, currentRole, onChange, onLogoChange, onCoverChange, onSave, bizId }) {
  if (!form) return null;

  function pf(e) {
    const { name, value } = e.target;
    onChange({ [name]: value });
  }

  return (
    <div className="bh-profile-tab">
      <div className="bh-profile-header">
        <div>
          <h2 className="bh-profile-title">Public Profile</h2>
          <p className="bh-profile-subtitle">
            This information appears on your business's public page visible to customers.
          </p>
          {currentRole === 'manager' && (
            <p className="bh-profile-note" style={{ marginTop: '0.4rem', color: '#818cf8', fontSize: '0.82rem' }}>
              You are editing as a <strong>Manager</strong>. Changes apply to the business owner's public profile.
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
            Preview ↗
          </a>
        )}
      </div>

      {/* ── Photos ──────────────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">Photos</h3>
        <div className="bh-photo-row">

          {/* Logo */}
          <div className="bh-photo-field">
            <label className="bh-photo-label">Business Logo</label>
            <div className="bh-photo-preview bh-photo-preview--logo">
              {logoPreview
                ? <img src={logoPreview} alt="Logo preview" className="bh-photo-img" />
                : <span className="bh-photo-placeholder">No logo</span>}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="bh-photo-input"
              onChange={e => onLogoChange(e.target.files?.[0] || null)}
              id="bh-logo-input"
            />
            <label htmlFor="bh-logo-input" className="bh-btn sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
              {logoPreview ? 'Change Logo' : 'Upload Logo'}
            </label>
            {logoPreview && (
              <button
                className="bh-btn sm danger"
                onClick={() => { onLogoChange(null); onChange({ logo_url: '' }); }}
                style={{ marginLeft: '0.5rem' }}
              >
                Remove
              </button>
            )}
          </div>

          {/* Cover photo */}
          <div className="bh-photo-field">
            <label className="bh-photo-label">Cover Photo</label>
            <div className="bh-photo-preview bh-photo-preview--cover">
              {coverPreview
                ? <img src={coverPreview} alt="Cover preview" className="bh-photo-img" />
                : <span className="bh-photo-placeholder">No cover photo</span>}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="bh-photo-input"
              onChange={e => onCoverChange(e.target.files?.[0] || null)}
              id="bh-cover-input"
            />
            <label htmlFor="bh-cover-input" className="bh-btn sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
              {coverPreview ? 'Change Cover' : 'Upload Cover'}
            </label>
            {coverPreview && (
              <button
                className="bh-btn sm danger"
                onClick={() => { onCoverChange(null); onChange({ cover_photo_url: '' }); }}
                style={{ marginLeft: '0.5rem' }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Business identity ────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">Business Identity</h3>
        <div className="bh-field-row">
          <div className="bh-field">
            <label>Business Name *</label>
            <input name="business_name" value={form.business_name} onChange={pf} placeholder="My Service Co." />
          </div>
          <div className="bh-field">
            <label>Business Type</label>
            <select name="business_type" value={form.business_type} onChange={pf}>
              <option value="">— Select a type —</option>
              {BIZ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="bh-field">
          <label>Tagline / Headline</label>
          <input
            name="profile_headline"
            value={form.profile_headline}
            onChange={pf}
            placeholder="e.g. Reliable plumbing &amp; HVAC service since 2010"
            maxLength={120}
          />
          <span className="bh-field-hint">Shown below your business name. Max 120 chars.</span>
        </div>
        <div className="bh-field">
          <label>About / Description</label>
          <textarea
            name="description"
            value={form.description}
            onChange={pf}
            rows={4}
            placeholder="Tell customers about your business, specialties, and what makes you stand out…"
          />
        </div>
      </section>

      {/* ── Contact info ────────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">Contact Info</h3>
        <div className="bh-field-row">
          <div className="bh-field">
            <label>Phone</label>
            <input name="phone" value={form.phone} onChange={pf} placeholder="(555) 000-0000" type="tel" />
          </div>
          <div className="bh-field">
            <label>Website</label>
            <input name="website" value={form.website} onChange={pf} placeholder="https://yoursite.com" type="url" />
          </div>
        </div>
      </section>

      {/* ── Location & service area ──────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">Location &amp; Service Area</h3>
        <div className="bh-field">
          <label>Street Address</label>
          <input name="address_street" value={form.address_street} onChange={pf} placeholder="123 Main St (optional — not shown publicly)" />
          <span className="bh-field-hint">Street address is not displayed publicly.</span>
        </div>
        <div className="bh-field-row">
          <div className="bh-field">
            <label>City</label>
            <input name="address_city" value={form.address_city} onChange={pf} placeholder="Austin" />
          </div>
          <div className="bh-field">
            <label>State</label>
            <select name="address_state" value={form.address_state} onChange={pf}>
              <option value="">— Select —</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="bh-field" style={{ maxWidth: '120px' }}>
            <label>ZIP</label>
            <input name="address_zip" value={form.address_zip} onChange={pf} placeholder="78701" maxLength={10} />
          </div>
        </div>
        <div className="bh-field" style={{ maxWidth: '200px' }}>
          <label>Service Radius (miles)</label>
          <input
            type="number"
            name="service_radius_miles"
            value={form.service_radius_miles}
            onChange={pf}
            placeholder="25"
            min="1"
            max="200"
          />
        </div>
      </section>

      {err && <p className="bh-profile-err">{err}</p>}

      <div className="bh-profile-actions">
        <button className="bh-btn primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Profile'}
        </button>
        <p className="bh-profile-note">
          Services, gallery, availability, and policies are managed from your{' '}
          <a href="/dashboard" className="bh-profile-link">helper profile settings</a>.
        </p>
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ analytics }) {
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
        <KPI label="MTD Revenue"    value={fmt$(a?.mtd?.revenue)}    cls="positive" />
        <KPI label="MTD Profit"     value={fmt$(a?.mtd?.profit)}     cls={profitCls(a?.mtd?.profit)} />
        <KPI label="Last Mo Revenue" value={fmt$(a?.last_month?.revenue)} />
        <KPI label="YTD Revenue"    value={fmt$(a?.ytd?.revenue)}    cls="positive" />
        <KPI label="YTD Profit"     value={fmt$(a?.ytd?.profit)}     cls={profitCls(a?.ytd?.profit)} />
        <KPI label="Outstanding"    value={fmt$(a?.invoices?.outstanding_total)} cls="warn"
          sub={`${a?.invoices?.sent || 0} sent`} />
        <KPI label="Overdue"        value={fmt$(a?.invoices?.overdue_total)}     cls="negative"
          sub={`${a?.invoices?.overdue_count || 0} invoices`} />
        <KPI label="Jobs (6m)"      value={a?.jobs?.completed_6m ?? '—'} />
        <KPI label="Avg Job Value"  value={fmt$(a?.jobs?.avg_value)} />
      </div>

      {/* 6-month P&L bar chart */}
      {monthly.length > 0 && (
        <div className="bh-card">
          <div className="bh-card-header">
            <div><h2>6-Month P&amp;L</h2></div>
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
                    <div className="bh-chart-bar revenue" style={{ height: pct(rev) }} title={`Revenue: ${fmt$(rev)}`} />
                    <div className="bh-chart-bar expense" style={{ height: pct(exp) }} title={`Expenses: ${fmt$(exp)}`} />
                    <div className="bh-chart-bar profit"  style={{ height: pct(pro) }} title={`Profit: ${fmt$(pro)}`} />
                  </div>
                  <span className="bh-chart-month">{fmtMonth(m.month)}</span>
                </div>
              );
            })}
          </div>
          <div className="bh-chart-legend">
            {[['revenue', '#4ade80', 'Revenue'], ['expense', '#f87171', 'Expenses'], ['profit', '#60a5fa', 'Profit']].map(([, color, label]) => (
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
function InvoicesTab({ data, onNew, onEdit, onPay, onDelete }) {
  const invoices = data?.invoices || [];
  const summary  = data?.summary  || {};

  return (
    <>
      {/* Summary counts */}
      <div className="bh-kpi-grid" style={{ marginBottom: '1rem' }}>
        <KPI label="Draft"       value={summary.draft       || 0} />
        <KPI label="Sent"        value={summary.sent        || 0} />
        <KPI label="Paid"        value={summary.paid        || 0} cls="positive" />
        <KPI label="Overdue"     value={summary.overdue     || 0} cls="negative" />
        <KPI label="Outstanding" value={fmt$(summary.outstanding_total)} cls="warn" />
      </div>

      <div className="bh-card">
        <div className="bh-card-header">
          <div><h2>Invoices</h2></div>
          <button className="bh-btn primary sm" onClick={onNew}>+ New Invoice</button>
        </div>

        {invoices.length === 0 ? (
          <div className="bh-empty"><p>No invoices yet.</p><button className="bh-btn primary" onClick={onNew}>Create Invoice</button></div>
        ) : (
          <div className="bh-table-wrap">
            <table className="bh-table">
              <thead>
                <tr>
                  <th>#</th><th>Client</th><th>Status</th><th>Due</th>
                  <th className="num">Total</th><th className="num">Paid</th><th></th>
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
                    <td><span className={`bh-status ${inv.status}`}>{inv.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap', color: inv.status === 'overdue' ? '#f87171' : undefined }}>{fmtDate(inv.due_date)}</td>
                    <td className="num">{fmt$(inv.total)}</td>
                    <td className="num">{fmt$(inv.amount_paid)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                        <button className="bh-btn sm" style={{ marginRight: '0.3rem' }} onClick={() => onPay(inv)}>Mark Paid</button>
                      )}
                      <button className="bh-btn sm" style={{ marginRight: '0.3rem' }} onClick={() => onEdit(inv)}>Edit</button>
                      <button className="bh-btn sm danger" onClick={() => onDelete(inv)}>Delete</button>
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
  const estimates = data?.estimates || [];
  return (
    <div className="bh-card">
      <div className="bh-card-header">
        <div>
          <h2>Quarterly Tax Estimates</h2>
          <p>Based on OxSteed earnings + paid invoices − expenses.</p>
        </div>
        <button className="bh-btn sm" onClick={onRefresh}>Refresh Estimates</button>
      </div>

      {estimates.length === 0 ? (
        <div className="bh-empty"><p>No tax estimates yet. Click "Refresh Estimates" to calculate.</p></div>
      ) : (
        <div className="bh-table-wrap">
          <table className="bh-table">
            <thead>
              <tr>
                <th>Quarter</th><th>Due</th><th>Status</th>
                <th className="num">Est. Net Income</th><th className="num">Est. Tax</th><th></th>
              </tr>
            </thead>
            <tbody>
              {estimates.map(est => (
                <tr key={est.id}>
                  <td>Q{est.quarter} {est.year}</td>
                  <td style={{ whiteSpace: 'nowrap', color: est.status === 'overdue' ? '#f87171' : undefined }}>{fmtDate(est.due_date)}</td>
                  <td><span className={`bh-status ${est.status}`}>{est.status}</span></td>
                  <td className="num">{fmt$(est.estimated_net_income)}</td>
                  <td className="num">{fmt$(est.estimated_tax)}</td>
                  <td>
                    {est.status !== 'paid' && (
                      <button className="bh-btn sm" onClick={() => onPay(est)}>Mark Paid</button>
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
  return (
    <div className="bh-card">
      <div className="bh-card-header">
        <div><h2>Goals</h2></div>
        <button className="bh-btn primary sm" onClick={onNew}>+ Add Goal</button>
      </div>

      {goals.length === 0 ? (
        <div className="bh-empty"><p>No goals yet.</p><button className="bh-btn primary" onClick={onNew}>Add a Goal</button></div>
      ) : (
        <div className="bh-goal-list">
          {goals.map(g => {
            // optionally pull current value from analytics for revenue/profit types
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
                    <div className="bh-goal-meta">{g.goal_type} · {g.period}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button className="bh-btn sm" onClick={() => onEdit(g)}>Edit</button>
                    <button className="bh-btn sm danger" onClick={() => onDelete(g)}>Delete</button>
                  </div>
                </div>
                <div className="bh-goal-progress-track">
                  <div className={`bh-goal-progress-fill${done ? ' done' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="bh-goal-stats">
                  <span><strong>{pct}%</strong> complete</span>
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
  const ROLE_LABEL = { manager: 'Manager', representative: 'Representative' };

  const [copiedTokenId, setCopiedTokenId] = useState(null);

  function copyToken(token, tokenId) {
    navigator.clipboard.writeText(token).then(() => {
      setCopiedTokenId(tokenId);
      setTimeout(() => setCopiedTokenId(prev => prev === tokenId ? null : prev), 1500);
    });
  }

  const STATUS_COLOR = { active: '#4ade80', used: '#94a3b8', expired: '#f97316', revoked: '#ef4444' };

  return (
    <div className="bh-team">

      {/* ── Pending invitations received by the logged-in user ─────────── */}
      {invitations.length > 0 && (
        <div className="bh-team-section">
          <h3 className="bh-team-heading">Pending Invitations</h3>
          <div className="bh-team-invites">
            {invitations.map(inv => (
              <div key={inv.id} className="bh-team-invite-card">
                <div className="bh-team-invite-info">
                  <span className="bh-team-invite-biz">{inv.business_name}</span>
                  <span className="bh-team-invite-from">
                    from {inv.owner_first_name} {inv.owner_last_name} · {ROLE_LABEL[inv.role] || inv.role}
                  </span>
                </div>
                <div className="bh-team-invite-actions">
                  <button className="bh-btn primary" onClick={() => onAccept(inv)}>Accept</button>
                  <button className="bh-btn" onClick={() => onDecline(inv)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Businesses I manage as a representative / manager ──────────── */}
      {managedBiz.length > 0 && (
        <div className="bh-team-section">
          <h3 className="bh-team-heading">Businesses I Manage</h3>
          <div className="bh-team-managed">
            {managedBiz.map(b => (
              <div key={b.id} className="bh-team-managed-card">
                {b.logo_url
                  ? <img src={b.logo_url} alt="" className="bh-team-avatar" />
                  : <div className="bh-team-avatar bh-team-avatar-init">{b.business_name[0]}</div>
                }
                <div>
                  <p className="bh-team-managed-name">{b.business_name}</p>
                  <p className="bh-team-managed-role">{ROLE_LABEL[b.role] || b.role} · owner: {b.owner_first_name} {b.owner_last_name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Vortex token generator ────────────────────────────────────────── */}
      <div className="bh-team-section">
        <h3 className="bh-team-heading">Vortex — Self-Onboarding Tokens</h3>
        <p className="bh-team-vortex-desc">
          Generate a 64-character single-use token. Share it with a representative out-of-band — they click
          "Vortex" in the footer after signing up, enter the token, and are instantly linked to this business.
        </p>
        <div className="bh-team-vortex-gen">
          <select
            className="bh-select"
            value={tokenForm.role}
            onChange={e => onTokenFormChange({ role: e.target.value })}
          >
            <option value="representative">Representative</option>
            <option value="manager">Manager</option>
          </select>
          <select
            className="bh-select"
            value={tokenForm.expires_in}
            onChange={e => onTokenFormChange({ expires_in: e.target.value })}
          >
            <option value="24h">Expires in 24 hours</option>
            <option value="7d">Expires in 7 days</option>
            <option value="30d">Expires in 30 days</option>
            <option value="60d">Expires in 60 days</option>
          </select>
          <button className="bh-btn primary" onClick={onGenerateToken} disabled={generatingToken}>
            {generatingToken ? 'Generating…' : '+ Generate Token'}
          </button>
        </div>

        {vortexTokens.length > 0 && (
          <div className="bh-vortex-tokens">
            {vortexTokens.map(t => {
              // t.token is NULL for active tokens the requesting manager did not create.
              // Guard every access to prevent TypeError crashes.
              const tokenStr = t.token ?? null;
              const tokenHidden = t.status === 'active' && tokenStr === null;
              const tokenPrefix = tokenStr ? tokenStr.slice(0, 16) : null;
              const rowKey = t.id;

              return (
                <div key={rowKey} className={`bh-vortex-token-row bh-vortex-${t.status}`}>
                  <div className="bh-vortex-token-info">
                    {tokenHidden ? (
                      <code className="bh-vortex-code bh-vortex-code--hidden" title="Created by another manager">
                        ••••••••••••••••
                      </code>
                    ) : (
                      <code className="bh-vortex-code">{tokenPrefix}…</code>
                    )}
                    <span className="bh-role-badge bh-role-representative" style={{ marginLeft: '0.5rem' }}>{ROLE_LABEL[t.role] || t.role}</span>
                    <span className="bh-vortex-status" style={{ color: STATUS_COLOR[t.status] || 'inherit' }}>
                      {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                    </span>
                    {t.status === 'used' && t.used_by_first && (
                      <span className="bh-vortex-used-by">Used by {t.used_by_first} {t.used_by_last}</span>
                    )}
                    {t.status === 'active' && (
                      <span className="bh-vortex-expires">Expires {new Date(t.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    )}
                    {t.created_by_first && (
                      <span className="bh-vortex-creator" style={{ fontSize: '0.75rem', color: 'var(--muted-text)', marginLeft: '0.4rem' }}>
                        by {t.created_by_first} {t.created_by_last}
                      </span>
                    )}
                  </div>
                  <div className="bh-vortex-token-actions">
                    {t.status === 'active' && !tokenHidden && (
                      <>
                        <button
                          className="bh-btn"
                          onClick={() => copyToken(tokenStr, t.id)}
                          style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                        >
                          {copiedTokenId === t.id ? 'Copied!' : 'Copy'}
                        </button>
                        <button className="bh-btn bh-btn-danger-sm" onClick={() => onRevokeToken(t.id)}>Revoke</button>
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
          <h3 className="bh-team-heading">Team Members</h3>
          <button className="bh-btn primary" onClick={onInvite}>+ Invite</button>
        </div>

        {members.length === 0 ? (
          <div className="bh-empty" style={{ padding: '2rem 0' }}>
            <p>No team members yet. Invite a representative or manager to help run this business.</p>
          </div>
        ) : (
          <table className="bh-team-table">
            <thead>
              <tr>
                <th>Name / Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Since</th>
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
                  <td><span className={`bh-role-badge bh-role-${m.role}`}>{ROLE_LABEL[m.role] || m.role}</span></td>
                  <td>
                    <span className={`bh-status-badge bh-status-${m.status}`}>
                      {m.status === 'pending' ? 'Invite sent' : 'Active'}
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
                      {m.status === 'pending' ? 'Cancel' : 'Remove'}
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
