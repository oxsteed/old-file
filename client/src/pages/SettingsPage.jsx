import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import TrialBanner from '../components/TrialBanner';
import PageMeta from '../components/PageMeta';
import useSubscription from '../hooks/useSubscription';
import NotificationPreferences from '../components/NotificationPreferences';
import ReferralPanel from '../components/ReferralPanel';
import '../styles/SettingsPage.css';

const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];

// ── SVG icons ────────────────────────────────────────────────────────────────
const IconUser = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);
const IconShield = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l8 3v6c0 5-3.5 9.3-8 11C7.5 20.3 4 16 4 11V5l8-3z"/>
  </svg>
);
const IconCard = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
  </svg>
);
const IconBuilding = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
    <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
  </svg>
);
const IconBell = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
);
const IconGift = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5" rx="1"/>
    <path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
  </svg>
);
const IconDatabase = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
);
const IconRefresh = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
  </svg>
);
const IconTrash = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
);

// ── Tab definitions (moved inside component for i18n) ─────────────────────────

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, logout, switchRole } = useAuth();
  const navigate = useNavigate();

  const TABS = useMemo(() => [
    { key: 'profile',       label: t('settings.tabs.profile'),       icon: <IconUser /> },
    { key: 'security',      label: t('settings.tabs.security'),      icon: <IconShield /> },
    { key: 'subscription',  label: t('settings.tabs.subscription'),  icon: <IconCard /> },
    { key: 'businesses',    label: t('settings.tabs.businesses'),    icon: <IconBuilding /> },
    { key: 'notifications', label: t('settings.tabs.notifications'), icon: <IconBell /> },
    { key: 'referral',      label: t('settings.tabs.referral'),      icon: <IconGift /> },
    { key: 'privacy',       label: t('settings.tabs.privacy'),       icon: <IconDatabase /> },
    { key: 'account',       label: t('settings.tabs.accountType'),   icon: <IconRefresh /> },
    { key: 'danger',        label: t('settings.tabs.dangerZone'),    icon: <IconTrash />, danger: true },
  ], [t]);

  const [activeTab, setActiveTab] = useState('profile');
  const [switchingRole, setSwitchingRole] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const isHelper = HELPER_ROLES.includes(user?.role);
  const targetRole = isHelper ? 'customer' : 'helper';

  const handleSwitchRole = async () => {
    setSwitchingRole(true);
    try {
      await switchRole(targetRole);
      setShowSwitchConfirm(false);
      toast.success(
        targetRole === 'helper'
          ? t('settings.switch.successHelper')
          : t('settings.switch.successCustomer'),
      );
      navigate(targetRole === 'helper' ? '/dashboard' : '/dashboard', { replace: true });
      window.location.reload();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('settings.roleSwitchFailed'));
    }
    setSwitchingRole(false);
  };

  const [profile, setProfile] = useState({ first_name: '', last_name: '', phone: '', bio: '', zipcode: '' });
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const { subscription, plans, loading: subLoading, openPortal, cancelSubscription, createCheckout } = useSubscription();

  const [businesses, setBusinesses] = useState([]);
  const [bizLoading, setBizLoading] = useState(true);
  const [showAddBiz, setShowAddBiz] = useState(false);
  const [editingBiz, setEditingBiz] = useState(null);
  const [bizForm, setBizForm] = useState({
    business_name: '', business_type: 'llc', ein: '',
    address_street: '', address_city: '', address_state: '', address_zip: '',
  });
  const [bizSaving, setBizSaving] = useState(false);

  useEffect(() => {
    api.get('/auth/me')
      .then(r => {
        const u = r.data?.user || r.data || {};
        setProfile({
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          phone: u.phone || '',
          bio: u.bio || '',
          zipcode: u.zip_code || u.zipcode || '',
          display_name_preference: u.display_name_preference || 'first_name',
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get('/businesses')
      .then(r => { setBusinesses(r.data?.businesses || []); setBizLoading(false); })
      .catch(() => setBizLoading(false));
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { first_name, last_name, bio, ...updatableFields } = profile;
      await api.put('/auth/profile', updatableFields);
      toast.success(t('settings.profileUpdated'));
    } catch (err) { toast.error(err.response?.data?.error || t('settings.profileFailed')); }
    setSaving(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (passwords.newPass !== passwords.confirm) return toast.error(t('settings.passwordNoMatch'));
    if (passwords.newPass.length < 8) return toast.error(t('settings.passwordTooShort'));
    try {
      await api.put('/auth/change-password', { currentPassword: passwords.current, newPassword: passwords.newPass });
      toast.success(t('settings.passwordChanged'));
      setPasswords({ current: '', newPass: '', confirm: '' });
    } catch (err) { toast.error(err.response?.data?.error || t('settings.passwordChangeFailed')); }
  };

  const deleteAccount = async () => {
    try {
      await api.delete('/privacy/delete-account');
      toast.success(t('settings.accountDeleted'));
      logout();
      navigate('/');
    } catch (err) { toast.error(t('settings.accountDeleteFailed')); }
  };

  const resetBizForm = () => {
    setBizForm({ business_name: '', business_type: 'llc', ein: '', address_street: '', address_city: '', address_state: '', address_zip: '' });
    setEditingBiz(null);
    setShowAddBiz(false);
  };

  const openAddBiz = () => { resetBizForm(); setShowAddBiz(true); };

  const openEditBiz = (biz) => {
    setBizForm({
      business_name: biz.business_name || '',
      business_type: biz.business_type || 'llc',
      ein: '',
      address_street: biz.address_street || '',
      address_city: biz.address_city || '',
      address_state: biz.address_state || '',
      address_zip: biz.address_zip || '',
    });
    setEditingBiz(biz);
    setShowAddBiz(true);
  };

  const saveBusiness = async (e) => {
    e.preventDefault();
    if (!bizForm.business_name.trim()) return toast.error(t('settings.businessNameRequired'));
    setBizSaving(true);
    try {
      if (editingBiz) {
        const { data } = await api.put(`/businesses/${editingBiz.id}`, bizForm);
        setBusinesses(prev => prev.map(b => b.id === editingBiz.id ? data.business : b));
        toast.success(t('settings.businessUpdated'));
      } else {
        const { data } = await api.post('/businesses', bizForm);
        setBusinesses(prev => [...prev, data.business]);
        toast.success(t('settings.businessAdded'));
      }
      resetBizForm();
    } catch (err) { toast.error(err.response?.data?.error || t('settings.businessSaveFailed')); }
    setBizSaving(false);
  };

  const deleteBusiness = async (id) => {
    if (!confirm('Remove this business?')) return;
    try {
      await api.delete(`/businesses/${id}`);
      setBusinesses(prev => prev.filter(b => b.id !== id));
      toast.success(t('settings.businessRemoved'));
    } catch (err) { toast.error(t('settings.businessRemoveFailed')); }
  };

  const setPrimaryBiz = async (id) => {
    try {
      await api.put(`/businesses/${id}/primary`);
      setBusinesses(prev => prev.map(b => ({ ...b, is_primary: b.id === id })));
      toast.success(t('settings.primaryBusinessUpdated'));
    } catch (err) { toast.error(t('settings.primaryBusinessFailed')); }
  };

  const BIZ_TYPES = [
    { value: 'sole_prop', label: 'Sole Proprietorship' },
    { value: 'llc', label: 'LLC' },
    { value: 'corp', label: 'Corporation' },
    { value: 'partnership', label: 'Partnership' },
  ];

  if (loading) {
    return (
      <div className="sp-spinner-wrap">
        <div className="sp-spinner" />
      </div>
    );
  }

  // ── Tab panels ──────────────────────────────────────────────────────────────

  const tabProfile = (
    <form onSubmit={saveProfile}>
      <div className="sp-card">
        <h2 className="sp-card-title">{t('settings.profile.title')}</h2>
        <p className="sp-card-subtitle">{t('settings.profile.subtitle')}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="sp-label">{t('settings.profile.firstName')}</label>
            <input className="sp-input" value={profile.first_name || ''} readOnly disabled />
          </div>
          <div>
            <label className="sp-label">{t('settings.profile.lastName')}</label>
            <input className="sp-input" value={profile.last_name || ''} readOnly disabled />
          </div>
        </div>

        <div className="sp-info-banner mb-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>
            {t('settings.profile.verificationNotice')}{' '}
            <a href="mailto:support@oxsteed.com" className="underline opacity-80 hover:opacity-100">support@oxsteed.com</a>
            {' '}or use the{' '}
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('oxsteed:open-support'))} className="underline opacity-80 hover:opacity-100">{t('settings.profile.supportChat')}</button>.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="sp-label">{t('settings.profile.phone')}</label>
            <input className="sp-input" value={profile.phone || ''} onChange={e => setProfile({ ...profile, phone: e.target.value })} />
          </div>
          <div>
            <label className="sp-label">{t('settings.profile.zipCode')}</label>
            <input className="sp-input" value={profile.zipcode || ''} onChange={e => setProfile({ ...profile, zipcode: e.target.value })} />
          </div>
        </div>

        <div className="mb-4">
          <label className="sp-label">{t('settings.profile.bio')}</label>
          <textarea className="sp-textarea" value={profile.bio || ''} onChange={e => setProfile({ ...profile, bio: e.target.value })} />
        </div>

        <div className="mb-5">
          <label className="sp-label">{t('settings.profile.displayName')}</label>
          <p className="text-xs mb-2" style={{ color: 'var(--muted-text,#94a3b8)' }}>{t('settings.profile.displayNameSub')}</p>
          <div className="sp-name-options">
            {[
              { value: 'first_name',    label: t('settings.profile.names.firstName'),    example: user?.first_name || 'Alex' },
              { value: 'full_name',     label: t('settings.profile.names.fullName'),     example: `${user?.first_name || 'Alex'} ${user?.last_name || 'Smith'}` },
              { value: 'business_name', label: t('settings.profile.names.businessName'), example: 'My Services LLC' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setProfile(p => ({ ...p, display_name_preference: opt.value }))}
                className={`sp-name-opt ${profile.display_name_preference === opt.value ? 'selected' : ''}`}
              >
                <span className="sp-name-opt-label">{opt.label}</span>
                <span className="sp-name-opt-example">{opt.example}</span>
              </button>
            ))}
          </div>
          {profile.display_name_preference === 'business_name' && (
            <p className="text-xs mt-2" style={{ color: '#fb923c' }}>{t('settings.profile.businessWarning')}</p>
          )}
        </div>

        <button type="submit" disabled={saving} className="sp-btn sp-btn-primary">
          {saving ? t('settings.profile.saving') : t('settings.profile.saveChanges')}
        </button>
      </div>
    </form>
  );

  const tabSecurity = (
    <>
      <form onSubmit={changePassword}>
        <div className="sp-card">
          <h2 className="sp-card-title">{t('settings.security.changePassword')}</h2>
          <p className="sp-card-subtitle">{t('settings.security.passwordDesc')}</p>
          <div className="space-y-3 mb-5">
            <div>
              <label className="sp-label">{t('settings.security.currentPassword')}</label>
              <input type="password" className="sp-input" placeholder="••••••••" value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} />
            </div>
            <div>
              <label className="sp-label">{t('settings.security.newPassword')}</label>
              <input type="password" className="sp-input" placeholder="••••••••" value={passwords.newPass} onChange={e => setPasswords({ ...passwords, newPass: e.target.value })} />
            </div>
            <div>
              <label className="sp-label">{t('settings.security.confirmPassword')}</label>
              <input type="password" className="sp-input" placeholder="••••••••" value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} />
            </div>
          </div>
          <button type="submit" className="sp-btn sp-btn-primary">{t('settings.security.updatePassword')}</button>
        </div>
      </form>

      <div className="sp-card">
        <h2 className="sp-card-title">{t('settings.security.twoFactor')}</h2>
        <p className="sp-card-subtitle">{t('settings.security.twoFactorDesc')}</p>
        <Link to="/settings/2fa" className="sp-btn sp-btn-ghost">{t('settings.security.manage2fa')}</Link>
      </div>
    </>
  );

  const tabSubscription = (
    <div className="sp-card">
      <h2 className="sp-card-title">{t('settings.subscription.title')}</h2>
      <p className="sp-card-subtitle">{t('settings.subscription.subtitle')}</p>
      {subLoading ? (
        <p className="text-sm" style={{ color: 'var(--muted-text,#94a3b8)' }}>{t('settings.subscription.loading')}</p>
      ) : subscription ? (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="sp-badge sp-badge-green">
              {subscription.status === 'active' ? t('settings.subscription.active') : subscription.status}
            </span>
            <span className="text-sm" style={{ color: 'var(--muted-text,#94a3b8)' }}>{subscription.plan_name || 'Pro Plan'}</span>
          </div>
          {subscription.current_period_end && (
            <p className="text-sm mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
              {t('settings.subscription.nextBilling', { date: new Date(subscription.current_period_end).toLocaleDateString() })}
            </p>
          )}
          {subscription.cancel_at_period_end && (
            <p className="text-sm mb-3" style={{ color: '#fbbf24' }}>
              {t('settings.subscription.cancelNotice')}
            </p>
          )}
          <div className="flex gap-3 flex-wrap">
            <button onClick={openPortal} className="sp-btn sp-btn-primary">{t('settings.subscription.manageBilling')}</button>
            {!subscription.cancel_at_period_end && (
              <button
                onClick={() => { if (confirm(t('settings.subscription.cancelConfirm'))) cancelSubscription(); }}
                className="sp-btn sp-btn-danger"
              >
                {t('settings.subscription.cancelPlan')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm mb-4" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            {t('settings.subscription.freePlanNotice')}
          </p>
          <div className="flex gap-3 flex-wrap">
            {plans.filter(p => p.slug !== 'free').map(plan => (
              <button key={plan.id} onClick={() => createCheckout(plan.slug)} className="sp-btn sp-btn-primary">
                {t('settings.subscription.upgradeTo', { name: plan.name })} — ${(plan.price / 100).toFixed(2)}/{plan.slug?.includes('yearly') ? t('settings.subscription.year') : t('settings.subscription.mo')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const tabBusinesses = (
    <div className="sp-card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="sp-card-title">{t('settings.businesses.title')}</h2>
        <button onClick={openAddBiz} className="sp-btn sp-btn-primary" style={{ padding: '0.4rem 0.9rem', fontSize: '0.8125rem' }}>{t('settings.businesses.add')}</button>
      </div>
      <p className="sp-card-subtitle">{t('settings.businesses.subtitle')}</p>

      {bizLoading ? (
        <p className="text-sm" style={{ color: 'var(--muted-text,#94a3b8)' }}>{t('settings.businesses.loading')}</p>
      ) : businesses.length === 0 ? (
        <div className="sp-empty">
          <p>{t('settings.businesses.empty')}</p>
          <p>{t('settings.businesses.emptyDesc')}</p>
        </div>
      ) : (
        <div>
          {businesses.map(biz => (
            <div key={biz.id} className="sp-biz-item">
              <div className="flex items-center gap-3 min-w-0">
                <div className="sp-biz-icon">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate" style={{ color: 'var(--app-text,#f1f5f9)' }}>{biz.business_name}</span>
                    {biz.is_primary && <span className="sp-badge sp-badge-orange">{t('settings.businesses.primary')}</span>}
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                    {BIZ_TYPES.find(t => t.value === biz.business_type)?.label || biz.business_type || 'Business'}
                    {biz.address_city && ` · ${biz.address_city}, ${biz.address_state}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-3">
                {!biz.is_primary && (
                  <button onClick={() => setPrimaryBiz(biz.id)} title={t('settings.businesses.setPrimary')} className="sp-btn sp-btn-ghost" style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}>★</button>
                )}
                <button onClick={() => openEditBiz(biz)} className="sp-btn sp-btn-ghost" style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}>{t('common.edit')}</button>
                <button onClick={() => deleteBusiness(biz.id)} className="sp-btn sp-btn-danger" style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddBiz && (
        <form onSubmit={saveBusiness} className="sp-biz-form-panel">
          <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--app-text,#f1f5f9)' }}>
            {editingBiz ? t('settings.businesses.edit') : t('settings.businesses.addHeader')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="sp-label">{t('settings.businesses.form.name')}</label>
              <input className="sp-input" value={bizForm.business_name} onChange={e => setBizForm({ ...bizForm, business_name: e.target.value })} placeholder="Mika's Plumbing LLC" required />
            </div>
            <div>
              <label className="sp-label">{t('settings.businesses.form.type')}</label>
              <select className="sp-select" value={bizForm.business_type} onChange={e => setBizForm({ ...bizForm, business_type: e.target.value })}>
                {BIZ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="sp-label">{t('settings.businesses.form.ein')} <span style={{ opacity: 0.5 }}>({t('common.optional')})</span></label>
              <input className="sp-input" value={bizForm.ein} onChange={e => setBizForm({ ...bizForm, ein: e.target.value })} placeholder="XX-XXXXXXX" />
            </div>
          </div>
          <div className="mb-4">
            <label className="sp-label">{t('settings.businesses.form.address')}</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="sp-input" placeholder={t('settings.businesses.form.street')} value={bizForm.address_street} onChange={e => setBizForm({ ...bizForm, address_street: e.target.value })} />
              <input className="sp-input" placeholder={t('settings.businesses.form.city')} value={bizForm.address_city} onChange={e => setBizForm({ ...bizForm, address_city: e.target.value })} />
              <input className="sp-input" placeholder={t('settings.businesses.form.state')} value={bizForm.address_state} onChange={e => setBizForm({ ...bizForm, address_state: e.target.value })} />
              <input className="sp-input" placeholder={t('settings.businesses.form.zip')} value={bizForm.address_zip} onChange={e => setBizForm({ ...bizForm, address_zip: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={bizSaving} className="sp-btn sp-btn-primary">
              {bizSaving ? t('common.saving') : editingBiz ? t('settings.businesses.update') : t('settings.businesses.add')}
            </button>
            <button type="button" onClick={resetBizForm} className="sp-btn sp-btn-ghost">{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </div>
  );

  // NotificationPreferences renders its own card wrapper with heading — render directly
  const tabNotifications = <NotificationPreferences />;

  const tabReferral = (
    <div className="sp-card">
      <h2 className="sp-card-title">{t('settings.referral.title')}</h2>
      <p className="sp-card-subtitle">{t('settings.referral.subtitle')}</p>
      <ReferralPanel />
    </div>
  );

  const tabPrivacy = (
    <div className="sp-card">
      <h2 className="sp-card-title">{t('settings.privacy.title')}</h2>
      <p className="sp-card-subtitle">{t('settings.privacy.subtitle')}</p>
      <button
        className="sp-btn sp-btn-ghost"
        onClick={() => {
          api.get('/privacy/export')
            .then(r => {
              const blob = new Blob([JSON.stringify(r.data, null, 2)]);
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'my-data.json';
              a.click();
              toast.success(t('settings.privacy.exportSuccess'));
            })
            .catch(() => toast.error(t('settings.privacy.exportFailed')));
        }}
      >
        {t('settings.privacy.exportBtn')}
      </button>
    </div>
  );

  const tabAccount = (
    <div className="sp-card">
      <h2 className="sp-card-title">{t('settings.account.title')}</h2>
      <p className="sp-card-subtitle">
        {isHelper
          ? t('settings.account.helperDesc')
          : t('settings.account.customerDesc')}
      </p>
      <div className="flex items-center gap-3 mb-5">
        <span className={`sp-role-badge ${isHelper ? 'sp-role-helper' : 'sp-role-customer'}`}>
          {isHelper ? t('common.helper') : t('common.customer')}
        </span>
        <span className="text-sm" style={{ color: 'var(--muted-text,#94a3b8)' }}>{t('settings.account.currentRole')}</span>
      </div>

      {!showSwitchConfirm ? (
        <button
          onClick={() => setShowSwitchConfirm(true)}
          className={`sp-btn ${isHelper ? 'sp-btn-ghost' : 'sp-btn-primary'}`}
        >
          {isHelper ? t('settings.account.switchToCustomer') : t('settings.account.switchToHelper')}
        </button>
      ) : (
        <div className="sp-confirm-box">
          {isHelper ? (
            <>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--app-text,#f1f5f9)' }}>{t('settings.account.confirmSwitchCustomer')}</p>
              <p className="text-sm mb-4" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.account.switchCustomerNotice')}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--app-text,#f1f5f9)' }}>{t('settings.account.confirmSwitchHelper')}</p>
              <p className="text-sm mb-4" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.account.switchHelperNotice')}
              </p>
            </>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleSwitchRole}
              disabled={switchingRole}
              className={`sp-btn ${isHelper ? 'sp-btn-ghost' : 'sp-btn-primary'} disabled:opacity-50`}
            >
              {switchingRole ? t('common.switching') : t('settings.account.yesSwitch')}
            </button>
            <button onClick={() => setShowSwitchConfirm(false)} className="sp-btn sp-btn-ghost">{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );

  const tabDanger = (
    <div className="sp-card sp-danger-card">
      <h2 className="sp-card-title" style={{ color: '#f87171' }}>{t('settings.danger.title')}</h2>
      <p className="sp-card-subtitle">{t('settings.danger.subtitle')}</p>

      {!showDelete ? (
        <button onClick={() => setShowDelete(true)} className="sp-btn sp-btn-danger">{t('settings.danger.deleteAccount')}</button>
      ) : (
        <div className="sp-confirm-box">
          <p className="text-sm font-semibold mb-1" style={{ color: '#f87171' }}>{t('settings.danger.confirmTitle')}</p>
          <p className="text-sm mb-4" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            {t('settings.danger.confirmDesc')}
          </p>
          <div className="flex gap-3">
            <button onClick={deleteAccount} className="sp-btn sp-btn-danger">{t('settings.danger.yesDelete')}</button>
            <button onClick={() => setShowDelete(false)} className="sp-btn sp-btn-ghost">{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );

  const PANEL_MAP = {
    profile:       tabProfile,
    security:      tabSecurity,
    subscription:  tabSubscription,
    businesses:    tabBusinesses,
    notifications: tabNotifications,
    referral:      tabReferral,
    privacy:       tabPrivacy,
    account:       tabAccount,
    danger:        tabDanger,
  };

  return (
    <div className="min-h-screen sp-bg">
      <PageMeta title={t('settings.title')} description={t('settings.metaDesc')} noIndex={true} />
      <Navbar />
      <div className="sp-shell">
        <div className="sp-header">
          <h1 className="sp-title">{t('settings.title')}</h1>
          <div className="mt-3">
            <TrialBanner />
          </div>
        </div>

        <div className="sp-layout">
          {/* Sidebar */}
          <nav className="sp-sidebar" aria-label="Settings navigation">
            {TABS.map((tab, i) => {
              const isDividerBefore = tab.key === 'danger';
              return (
                <div key={tab.key}>
                  {isDividerBefore && <div className="sp-tab-divider" />}
                  <button
                    className={`sp-tab ${activeTab === tab.key ? 'active' : ''} ${tab.danger ? 'danger' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                    aria-current={activeTab === tab.key ? 'page' : undefined}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Content */}
          <main className="sp-content">
            {PANEL_MAP[activeTab]}
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
