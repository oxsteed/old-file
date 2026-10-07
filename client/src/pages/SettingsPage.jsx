import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { uploadAppAsset } from '../api/uploads';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import TrialBanner from '../components/TrialBanner';
import PageMeta from '../components/PageMeta';
import useSubscription from '../hooks/useSubscription';
import NotificationPreferences from '../components/NotificationPreferences';
import ReferralPanel from '../components/ReferralPanel';
import PaymentMethodSettings from '../components/PaymentMethodSettings';
import CountrySelect from '../components/CountrySelect';
import RegionInput from '../components/RegionInput';
import PostalCodeInput from '../components/PostalCodeInput';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { isValidPostal } from '../lib/countries';
import { MODE_CATALOG, routeForMode } from '../utils/modeRouter';
import {
  LAUNCH_SELF_SELECTABLE_MODES,
  LAUNCH_SETTINGS_TABS,
  LAUNCH_VISIBILITY,
} from '../utils/launchScope';
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
const IconBox = () => (
  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

// ── Tab definitions (moved inside component for i18n) ─────────────────────────

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, logout, switchRole, refreshUser, setUser } = useAuth();
  const navigate = useNavigate();

  const TABS = useMemo(() => [
    { key: 'profile',       label: t('settings.tabProfile'),       icon: <IconUser /> },
    { key: 'security',      label: t('settings.tabSecurity'),      icon: <IconShield /> },
    { key: 'subscription',  label: t('settings.tabSubscription'),  icon: <IconCard /> },
    { key: 'toolRentals',   label: t('settings.tabToolRentals'),   icon: <IconBox /> },
    { key: 'businesses',    label: t('settings.tabBusinesses'),    icon: <IconBuilding /> },
    { key: 'notifications', label: t('settings.tabNotifications'), icon: <IconBell /> },
    { key: 'referral',      label: t('settings.tabReferral'),      icon: <IconGift /> },
    { key: 'privacy',       label: t('settings.tabPrivacy'),       icon: <IconDatabase /> },
    { key: 'account',       label: t('settings.tabAccount'),       icon: <IconRefresh /> },
    { key: 'danger',        label: t('settings.tabDanger'),        icon: <IconTrash />, danger: true },
  ].filter((tab) => LAUNCH_SETTINGS_TABS.has(tab.key)), [t]);

  const [activeTab, setActiveTab] = useState('profile');
  const [switchingMode, setSwitchingMode] = useState(null); // mode being switched into, or null
  const [grantedModes, setGrantedModes] = useState([]); // [{ mode, business_name, role }]
  const isHelper = HELPER_ROLES.includes(user?.role);
  const currentMode = user?.default_mode || (isHelper ? 'helper' : 'customer');

  const handleSwitchMode = async (targetMode) => {
    if (!targetMode || targetMode === currentMode) return;
    setSwitchingMode(targetMode);
    try {
      await switchRole(targetMode);
      toast.success(t('settings.account.switchSuccess', {
        mode: t(MODE_CATALOG[targetMode]?.labelKey || `modes.${targetMode}.label`, { defaultValue: targetMode }),
        defaultValue: 'Account type switched.',
      }));
      // Hard reload so every part of the app (nav, sidebars, role gates) re-reads from the fresh user state.
      navigate(routeForMode(targetMode), { replace: true });
      window.location.reload();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || t('settings.roleSwitchFailed'));
      setSwitchingMode(null);
    }
  };

  // Discover any "granted" modes the user holds (business_manager / employee
  // / representative / support_agent). We display these as read-only entries
  // — they're switched into via the Mode Switcher, not via Settings.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.get('/me/businesses')
      .then(res => {
        if (cancelled) return;
        const items = Array.isArray(res?.data?.items) ? res.data.items : [];
        const grants = [];
        for (const m of items.filter(x => x.status === 'active' && !x.is_owner)) {
          const map = {
            manager: 'business_manager',
            representative: 'business_representative',
            employee: 'business_employee',
            support_agent: 'business_support_agent',
          };
          const mode = map[m.role];
          if (mode) grants.push({ mode, business_name: m.business_name, role: m.role });
        }
        setGrantedModes(grants);
      })
      .catch(() => { /* endpoint optional; fail silent */ });
    return () => { cancelled = true; };
  }, [user]);

  const [profile, setProfile] = useState({ first_name: '', last_name: '', phone: '', bio: '', zipcode: '', profile_photo_url: '', address_line1: '', address_line2: '', city: '', state: '', country: 'US' });
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [namePrefTouched, setNamePrefTouched] = useState(false);
  const [postalTouched, setPostalTouched] = useState(false);
  const fileInputRef = useRef(null);
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [allowGuestContact, setAllowGuestContact] = useState(true);
  const [allowBooking, setAllowBooking] = useState(true);
  const [allowScheduling, setAllowScheduling] = useState(true);
  const [allowLiveChat, setAllowLiveChat] = useState(true);
  const [privacySaving, setPrivacySaving] = useState(null);
  const [exportVerification, setExportVerification] = useState({
    step: 'idle',
    password: '',
    code: '',
    challengeToken: '',
    emailHint: '',
    submitting: false,
  });

  const { subscription, loading: subLoading } = useSubscription();

  const [businesses, setBusinesses] = useState([]);
  const [bizLoading, setBizLoading] = useState(true);
  const [showAddBiz, setShowAddBiz] = useState(false);
  const [editingBiz, setEditingBiz] = useState(null);
  const [bizForm, setBizForm] = useState({
    business_name: '', business_type: 'llc', ein: '',
    address_street: '', address_city: '', address_state: '', address_zip: '',
    address_country: 'US',
  });
  const [bizSaving, setBizSaving] = useState(false);

  useEffect(() => {
    api.get('/auth/me')
      .then(r => {
        const u = r.data?.user || r.data || {};
        const initialProfile = {
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          phone: u.phone || '',
          bio: u.bio || '',
          zipcode: u.zip_code || u.zipcode || '',
          display_name_preference: u.display_name_preference || 'first_name',
          profile_photo_url: u.profile_photo_url || '',
          address_line1: u.address_line1 || '',
          address_line2: u.address_line2 || '',
          city: u.city || '',
          state: u.state || '',
          country: u.country || 'US',
        };
        setProfile(initialProfile);
        setProfileSnapshot(initialProfile);
        if (typeof u.allow_guest_contact === 'boolean') {
          setAllowGuestContact(u.allow_guest_contact);
        } else {
          setAllowGuestContact(true);
        }
        if (typeof u.allow_booking === 'boolean') {
          setAllowBooking(u.allow_booking);
        } else {
          setAllowBooking(true);
        }
        if (typeof u.allow_scheduling === 'boolean') {
          setAllowScheduling(u.allow_scheduling);
        } else {
          setAllowScheduling(true);
        }
        if (typeof u.allow_live_chat === 'boolean') {
          setAllowLiveChat(u.allow_live_chat);
        } else {
          setAllowLiveChat(true);
        }
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
    if (postalInvalid) {
      // The inline error under the field is already visible (or appears now);
      // no toast needed.
      setPostalTouched(true);
      return;
    }
    setSaving(true);
    try {
      const { first_name, last_name, ...updatableFields } = profile;
      const { data } = await api.put('/auth/profile', updatableFields);
      // H8d: the refresh token now travels via httpOnly cookie — only the
      // short-lived access token is kept in localStorage.
      if (data?.accessToken && data?.refreshToken) {
        localStorage.setItem('accessToken', data.accessToken);
      }
      if (data?.user) setUser(data.user);
      setProfileSnapshot({ ...profile });
      toast.success(t('settings.profileUpdated'));
    } catch (err) { toast.error(err.response?.data?.error || t('settings.profileFailed')); }
    setSaving(false);
  };

  const handlePhotoSelect = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      toast.error(t('settings.profile.photoTypeError', 'Please choose an image file.'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('settings.profile.photoSizeError', 'Image must be smaller than 5 MB.'));
      return;
    }
    setUploadingPhoto(true);
    try {
      const data = await uploadAppAsset(file, 'profile-photo');
      const url = data && data.url;
      if (!url) throw new Error('missing url');
      setProfile(p => ({ ...p, profile_photo_url: url }));
      toast.success(t('settings.profile.photoUploaded', 'Photo uploaded. Save your changes to keep it.'));
    } catch (err) {
      toast.error(t('settings.profile.photoUploadFailed', 'Photo upload failed. Please try again.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = () => setProfile(p => ({ ...p, profile_photo_url: '' }));

  const DIRTY_KEYS = ['phone', 'bio', 'zipcode', 'display_name_preference', 'profile_photo_url', 'address_line1', 'address_line2', 'city', 'state', 'country'];
  const isProfileDirty = !!profileSnapshot && DIRTY_KEYS.some(k => (profile[k] || '') !== (profileSnapshot[k] || ''));

  // Inline postal-code validation (shown under the field on blur, not as a
  // save-time toast). Empty is allowed; a non-empty value must match the
  // selected country's format.
  const postalInvalid = (() => {
    const zipTrimmed = (profile.zipcode || '').trim();
    return zipTrimmed !== '' && !isValidPostal(profile.country || 'US', zipTrimmed);
  })();

  const avatarInitials = useMemo(() => {
    const initials = `${profile.first_name?.[0] || ''}${profile.last_name?.[0] || ''}`.toUpperCase();
    return initials || '?';
  }, [profile.first_name, profile.last_name]);

  const previewBusinessName = businesses.find(b => b.business_name)?.business_name;
  const previewDisplayName = profile.display_name_preference === 'full_name'
    ? (`${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.first_name || 'Alex')
    : profile.display_name_preference === 'business_name'
      ? (previewBusinessName || t('settings.profile.previewBusinessFallback', 'Your Business'))
      : (profile.first_name || 'Alex');

  const completenessItems = [
    { key: 'photo', done: !!profile.profile_photo_url, label: t('settings.profile.completePhoto', 'Add a profile photo') },
    { key: 'bio', done: (profile.bio || '').trim().length >= 20, label: t('settings.profile.completeBio', 'Write a bio (20+ characters)') },
    { key: 'phone', done: !!(profile.phone || '').trim(), label: t('settings.profile.completePhone', 'Add your phone number') },
    { key: 'address', done: !!((profile.address_line1 || '').trim() && (profile.city || '').trim() && (profile.country || '').trim()), label: t('settings.profile.completeAddress', 'Add your address') },
    { key: 'name', done: namePrefTouched || (!!profileSnapshot && profileSnapshot.display_name_preference !== 'first_name'), label: t('settings.profile.completeName', 'Choose how your name appears') },
  ];
  const completenessPct = Math.round((completenessItems.filter(i => i.done).length / completenessItems.length) * 100);

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

  const savePrivacySetting = async (setting, value) => {
    setPrivacySaving(setting);
    try {
      const body = { [setting]: value };
      await api.patch('/settings/privacy', body);

      // Update the appropriate state
      if (setting === 'allow_guest_contact') setAllowGuestContact(value);
      if (setting === 'allow_booking') setAllowBooking(value);
      if (setting === 'allow_scheduling') setAllowScheduling(value);
      if (setting === 'allow_live_chat') setAllowLiveChat(value);

      try {
        await refreshUser();
      } catch {
        /* non-blocking */
      }
      toast.success(t('settings.privacy.updated'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('settings.privacy.updateFailed'));
    }
    setPrivacySaving(null);
  };

  const resetExportVerification = () => {
    setExportVerification({
      step: 'idle',
      password: '',
      code: '',
      challengeToken: '',
      emailHint: '',
      submitting: false,
    });
  };

  const exportErrorMessage = async (err) => {
    let payload = err?.response?.data;
    if (payload instanceof Blob) {
      try { payload = JSON.parse(await payload.text()); } catch { payload = null; }
    }
    const message = payload?.error || t('settings.privacy.exportFailed');
    return payload?.requestId ? `${message} (${payload.requestId})` : message;
  };

  const requestExportCode = async (event) => {
    event.preventDefault();
    if (!exportVerification.password) {
      toast.error(t('settings.privacy.passwordRequired', { defaultValue: 'Enter your current password.' }));
      return;
    }
    setExportVerification((current) => ({ ...current, submitting: true }));
    try {
      const { data } = await api.post('/privacy/export/verification/request', {
        password: exportVerification.password,
      });
      setExportVerification((current) => ({
        ...current,
        step: 'code',
        password: '',
        challengeToken: data.challengeToken,
        emailHint: data.emailHint || 'your email address',
        submitting: false,
      }));
      toast.success(t('settings.privacy.codeSent', { defaultValue: 'A verification code was sent to your email.' }));
    } catch (err) {
      setExportVerification((current) => ({ ...current, submitting: false }));
      toast.error(await exportErrorMessage(err));
    }
  };

  const verifyAndDownloadExport = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(exportVerification.code.trim())) {
      toast.error(t('settings.privacy.codeRequired', { defaultValue: 'Enter the six-digit code from your email.' }));
      return;
    }
    setExportVerification((current) => ({ ...current, submitting: true }));
    try {
      const { data } = await api.post('/privacy/export/verification/verify', {
        challengeToken: exportVerification.challengeToken,
        code: exportVerification.code.trim(),
      });
      const response = await api.get('/privacy/export', {
        responseType: 'blob',
        headers: { 'X-Export-Verification-Token': data.exportToken },
      });
      const contentDisposition = response.headers?.['content-disposition'] || '';
      const filename = contentDisposition.match(/filename="([^"]+)"/i)?.[1] || 'oxsteed-data-export.zip';
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      resetExportVerification();
      toast.success(t('settings.privacy.exportSuccess'));
    } catch (err) {
      setExportVerification((current) => ({ ...current, submitting: false }));
      toast.error(await exportErrorMessage(err));
    }
  };

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteActiveJobs, setDeleteActiveJobs] = useState([]);
  const [deletePending, setDeletePending] = useState(false);

  const deleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE MY ACCOUNT') {
      setDeleteError('Please type "DELETE MY ACCOUNT" exactly to confirm.');
      return;
    }
    setDeleteError('');
    setDeleteActiveJobs([]);
    setDeletePending(true);
    try {
      await api.delete('/privacy/delete-account', {
        data: { confirmation: 'DELETE MY ACCOUNT' },
      });
      toast.success(t('settings.accountDeleted'));
      logout();
      navigate('/');
    } catch (err) {
      const serverErr = err.response?.data;
      if (serverErr?.activeJobs) {
        setDeleteActiveJobs(serverErr.activeJobs);
        setDeleteError(serverErr.error || t('settings.accountDeleteFailed'));
      } else {
        setDeleteError(serverErr?.error || t('settings.accountDeleteFailed'));
      }
    }
    setDeletePending(false);
  };

  const resetBizForm = () => {
    setBizForm({ business_name: '', business_type: 'llc', ein: '', address_street: '', address_city: '', address_state: '', address_zip: '', address_country: 'US' });
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
      address_country: biz.address_country || 'US',
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
    if (!confirm(t('settings.removeBusinessConfirm'))) return;
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
    <div className="sp-profile-grid">
      <form onSubmit={saveProfile}>
        <div className="sp-card">
          <h2 className="sp-card-title">{t('settings.profile.title')}</h2>
          <p className="sp-card-subtitle">{t('settings.profile.subtitle')}</p>

          <div className="sp-photo-row">
            <div className="sp-avatar" aria-hidden="true">
              {profile.profile_photo_url ? (
                <img src={profile.profile_photo_url} alt={t('settings.profile.photoAlt', 'Profile photo')} />
              ) : (
                <span>{avatarInitials}</span>
              )}
            </div>
            <div className="sp-photo-meta">
              <div className="sp-photo-title">{t('settings.profile.photoTitle', 'Profile photo')}</div>
              <div className="sp-photo-actions">
                <button
                  type="button"
                  className="sp-btn sp-btn-ghost"
                  style={{ padding: '0.35rem 0.8rem', fontSize: '0.8125rem' }}
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto
                    ? t('settings.profile.photoUploading', 'Uploading...')
                    : profile.profile_photo_url
                      ? t('settings.profile.changePhoto', 'Change photo')
                      : t('settings.profile.uploadPhoto', 'Upload photo')}
                </button>
                {profile.profile_photo_url && (
                  <button
                    type="button"
                    className="sp-btn sp-btn-ghost"
                    style={{ padding: '0.35rem 0.8rem', fontSize: '0.8125rem' }}
                    onClick={removePhoto}
                    disabled={uploadingPhoto}
                  >
                    {t('settings.profile.removePhoto', 'Remove')}
                  </button>
                )}
              </div>
              <p className="sp-photo-hint">{t('settings.profile.photoHint', 'JPG or PNG, up to 5 MB. Shown to customers on your profile.')}</p>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoSelect} />
            </div>
          </div>

          <div className="sp-completeness">
            <div className="sp-completeness-head">
              <span>{t('settings.profile.completenessTitle', 'Profile completeness')}</span>
              <span>{completenessPct}%</span>
            </div>
            <div className="sp-progress" role="progressbar" aria-valuenow={completenessPct} aria-valuemin="0" aria-valuemax="100">
              <div className="sp-progress-fill" style={{ width: `${completenessPct}%` }} />
            </div>
            <ul className="sp-checklist">
              {completenessItems.map(item => (
                <li key={item.key} className={item.done ? 'done' : ''}>
                  <span className="sp-check" aria-hidden="true">{item.done ? '✓' : '○'}</span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

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
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
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
          </div>

          <div className="mb-4">
            <label className="sp-label">{t('settings.profile.addressTitle', 'Address')}</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <div className="md:col-span-2">
                <input
                  className="sp-input"
                  value={profile.address_line1 || ''}
                  onChange={e => setProfile({ ...profile, address_line1: e.target.value })}
                  placeholder={t('settings.profile.addressLine1', 'Street address')}
                  autoComplete="street-address"
                  maxLength={255}
                />
              </div>
              <div className="md:col-span-2">
                <input
                  className="sp-input"
                  value={profile.address_line2 || ''}
                  onChange={e => setProfile({ ...profile, address_line2: e.target.value })}
                  placeholder={t('settings.profile.addressLine2', 'Apt, suite, unit (optional)')}
                  autoComplete="address-line2"
                  maxLength={255}
                />
              </div>
              <div>
                <input
                  className="sp-input"
                  value={profile.city || ''}
                  onChange={e => setProfile({ ...profile, city: e.target.value })}
                  placeholder={t('settings.profile.city', 'City')}
                  autoComplete="address-level2"
                  maxLength={100}
                />
              </div>
              <div>
                <RegionInput
                  className="sp-input"
                  country={profile.country || 'US'}
                  value={profile.state || ''}
                  onChange={(v) => setProfile({ ...profile, state: v })}
                  placeholder={t('settings.profile.stateProvince', 'State / Province')}
                />
              </div>
              <div>
                <CountrySelect
                  className="sp-input"
                  value={profile.country || 'US'}
                  onChange={(code) => { setProfile({ ...profile, country: code, state: '' }); setPostalTouched(false); }}
                  includeBlank={false}
                  placeholder={t('settings.profile.country', 'Country')}
                />
              </div>
              <div>
                <PostalCodeInput
                  className="sp-input"
                  country={profile.country || 'US'}
                  value={profile.zipcode || ''}
                  onChange={(v) => setProfile({ ...profile, zipcode: v })}
                  onBlur={() => setPostalTouched(true)}
                />
                {postalTouched && postalInvalid && (
                  <p role="alert" className="sp-field-error">
                    {t('settings.profile.postalCodeInvalid', 'Enter a valid postal code for the selected country.')}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="sp-label">{t('settings.profile.bio')}</label>
            <textarea className="sp-textarea" maxLength={500} value={profile.bio || ''} onChange={e => setProfile({ ...profile, bio: e.target.value })} />
            <div className="sp-bio-meta"><span>{(profile.bio || '').length}/500</span></div>
            <ul className="sp-tips">
              <li>{t('settings.profile.bioTip1', 'Mention your experience and the services you do best.')}</li>
              <li>{t('settings.profile.bioTip2', 'A friendly, specific bio gets more bookings than a generic one.')}</li>
            </ul>
          </div>

          <div className="mb-5">
            <label className="sp-label">{t('settings.profile.displayName')}</label>
            <p className="text-xs mb-2" style={{ color: 'var(--muted-text,#94a3b8)' }}>{t('settings.profile.displayNameSub')}</p>
            <div className="sp-name-options">
              {[
                { value: 'first_name', label: t('settings.profile.names.firstName'), example: user?.first_name || 'Alex' },
                { value: 'full_name', label: t('settings.profile.names.fullName'), example: `${user?.first_name || 'Alex'} ${user?.last_name || 'Smith'}` },
                { value: 'business_name', label: t('settings.profile.names.businessName'), example: 'My Services LLC' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setNamePrefTouched(true); setProfile(p => ({ ...p, display_name_preference: opt.value })); }}
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

          <div className="sp-save-row">
            <button type="submit" disabled={saving || !isProfileDirty} className="sp-btn sp-btn-primary">
              {saving ? t('settings.profile.saving') : t('settings.profile.saveChanges')}
            </button>
            {isProfileDirty && !saving && (
              <span className="sp-dirty-hint">{t('settings.profile.unsavedChanges', 'Unsaved changes')}</span>
            )}
          </div>
        </div>
      </form>

      <aside className="sp-card" aria-label={t('settings.profile.previewTitle', 'How others see you')}>
        <h2 className="sp-card-title">{t('settings.profile.previewTitle', 'How others see you')}</h2>
        <p className="sp-card-subtitle">{t('settings.profile.previewSubtitle', 'This is what customers see. It updates as you type.')}</p>
        <div className="sp-preview">
          <div className="sp-avatar sp-avatar-lg" aria-hidden="true">
            {profile.profile_photo_url ? (
              <img src={profile.profile_photo_url} alt="" />
            ) : (
              <span>{avatarInitials}</span>
            )}
          </div>
          <div className="sp-preview-name">{previewDisplayName}</div>
          <div className="sp-preview-loc">
            {(profile.city || '').trim() && (profile.state || '').trim()
              ? t('settings.profile.previewLocationFull', 'Serving {{city}}, {{state}}', { city: (profile.city || '').trim(), state: (profile.state || '').trim() })
              : profile.zipcode
                ? t('settings.profile.previewLocation', 'Serving {{zip}}', { zip: profile.zipcode })
                : t('settings.profile.previewNoLocation', 'Location not set')}
          </div>
          <p className="sp-preview-bio">
            {(profile.bio || '').trim() || t('settings.profile.previewNoBio', 'No bio yet.')}
          </p>
        </div>
      </aside>
    </div>
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

      <div className="sp-card">
        <h2 className="sp-card-title">{t('settings.security.passkeys')}</h2>
        <p className="sp-card-subtitle">{t('settings.security.passkeysDesc')}</p>
        <Link to="/settings/passkeys" className="sp-btn sp-btn-ghost">{t('settings.security.managePasskeys')}</Link>
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
            <span className="text-sm" style={{ color: 'var(--muted-text,#94a3b8)' }}>{subscription.plan_name || t('settings.subscription.proPlan')}</span>
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
          <div className="sp-empty mt-3">
            <p>Billing and plan changes are not launched in-app yet.</p>
            <p>Use support or the activity/history surfaces if you need assistance with account access.</p>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm mb-4" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            {t('settings.subscription.freePlanNotice')}
          </p>
          <div className="sp-empty">
            <p>Plan upgrades are handled outside the launch flow for now.</p>
            <p>Restaurant credit and direct payment are the launch payment paths.</p>
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
              <CountrySelect
                className="sp-input"
                value={bizForm.address_country || 'US'}
                onChange={(code) => setBizForm({ ...bizForm, address_country: code, address_state: '' })}
                includeBlank={false}
              />
              <AddressAutocomplete
                value={bizForm.address_street}
                onChange={(value) => setBizForm((current) => ({ ...current, address_street: value }))}
                onSelect={(place) => setBizForm((current) => ({
                  ...current,
                  address_street: place.addressLine1 || place.display,
                  address_city: place.city || current.address_city,
                  address_state: place.state || current.address_state,
                  address_zip: place.zip || current.address_zip,
                  address_country: place.country || current.address_country,
                }))}
                inputClassName="sp-input"
                placeholder={t('settings.businesses.form.street')}
                autoComplete="street-address"
                ariaLabel={t('settings.businesses.form.street')}
              />
              <input className="sp-input" placeholder={t('settings.businesses.form.city')} value={bizForm.address_city} onChange={e => setBizForm({ ...bizForm, address_city: e.target.value })} />
              <RegionInput
                className="sp-input"
                country={bizForm.address_country || 'US'}
                value={bizForm.address_state}
                onChange={(v) => setBizForm({ ...bizForm, address_state: v })}
                placeholder={t('settings.businesses.form.state')}
              />
              <PostalCodeInput
                className="sp-input"
                country={bizForm.address_country || 'US'}
                value={bizForm.address_zip}
                onChange={(v) => setBizForm({ ...bizForm, address_zip: v })}
              />
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

  const tabToolRentals = (
    <div className="sp-card">
      <PaymentMethodSettings />
    </div>
  );

  // NotificationPreferences renders its own card wrapper with heading - render directly
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
      {isHelper && (
        <div className="mb-6 pb-6 border-b border-[var(--border-color,#334155)]">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--app-text,#f1f5f9)' }}>
            {t('settings.privacy.communicationControls')}
          </h3>
          <div className="space-y-4">
            {/* Guest Contact */}
            <div>
              <p className="text-xs font-medium mb-2 uppercase tracking-widest" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.guestContactTitle')}
              </p>
              <p className="text-sm mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.guestContactDesc')}
              </p>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-600"
                  checked={allowGuestContact}
                  disabled={privacySaving === 'allow_guest_contact'}
                  onChange={(e) => savePrivacySetting('allow_guest_contact', e.target.checked)}
                />
                <span className="text-sm" style={{ color: 'var(--app-text,#f1f5f9)' }}>
                  {t('settings.privacy.guestContactLabel')}
                </span>
              </label>
            </div>

            {/* Live Chat */}
            <div>
              <p className="text-xs font-medium mb-2 uppercase tracking-widest" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.liveChatTitle')}
              </p>
              <p className="text-sm mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.liveChatDesc')}
              </p>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-600"
                  checked={allowLiveChat}
                  disabled={privacySaving === 'allow_live_chat'}
                  onChange={(e) => savePrivacySetting('allow_live_chat', e.target.checked)}
                />
                <span className="text-sm" style={{ color: 'var(--app-text,#f1f5f9)' }}>
                  {t('settings.privacy.liveChatLabel')}
                </span>
              </label>
            </div>
          </div>
        </div>
      )}
      {isHelper && (
        <div className="mb-6 pb-6 border-b border-[var(--border-color,#334155)]">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--app-text,#f1f5f9)' }}>
            {t('settings.privacy.jobControls')}
          </h3>
          <div className="space-y-4">
            {/* Booking */}
            <div>
              <p className="text-xs font-medium mb-2 uppercase tracking-widest" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.bookingTitle')}
              </p>
              <p className="text-sm mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.bookingDesc')}
              </p>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-600"
                  checked={allowBooking}
                  disabled={privacySaving === 'allow_booking'}
                  onChange={(e) => savePrivacySetting('allow_booking', e.target.checked)}
                />
                <span className="text-sm" style={{ color: 'var(--app-text,#f1f5f9)' }}>
                  {t('settings.privacy.bookingLabel')}
                </span>
              </label>
            </div>

            {/* Scheduling */}
            <div>
              <p className="text-xs font-medium mb-2 uppercase tracking-widest" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.schedulingTitle')}
              </p>
              <p className="text-sm mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                {t('settings.privacy.schedulingDesc')}
              </p>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-600"
                  checked={allowScheduling}
                  disabled={privacySaving === 'allow_scheduling'}
                  onChange={(e) => savePrivacySetting('allow_scheduling', e.target.checked)}
                />
                <span className="text-sm" style={{ color: 'var(--app-text,#f1f5f9)' }}>
                  {t('settings.privacy.schedulingLabel')}
                </span>
              </label>
            </div>
          </div>
        </div>
      )}
      {exportVerification.step === 'idle' && (
        <button
          className="sp-btn sp-btn-ghost"
          type="button"
          onClick={() => setExportVerification((current) => ({ ...current, step: 'password' }))}
        >
          {t('settings.privacy.exportBtn')}
        </button>
      )}
      {exportVerification.step === 'password' && (
        <form className="mt-4 p-4 rounded-lg border border-[var(--border-color,#334155)]" onSubmit={requestExportCode}>
          <p className="text-sm font-semibold" style={{ color: 'var(--app-text,#f1f5f9)' }}>
            {t('settings.privacy.verifyTitle', { defaultValue: 'Verify before exporting' })}
          </p>
          <p className="text-sm mt-1 mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            {t('settings.privacy.verifyPasswordDesc', { defaultValue: 'Enter your current password. We will then email you a one-time code.' })}
          </p>
          <input
            className="sp-input w-full mb-3"
            type="password"
            autoComplete="current-password"
            value={exportVerification.password}
            onChange={(event) => setExportVerification((current) => ({ ...current, password: event.target.value }))}
            placeholder={t('settings.privacy.currentPassword', { defaultValue: 'Current password' })}
            disabled={exportVerification.submitting}
          />
          <div className="flex gap-2">
            <button className="sp-btn sp-btn-primary" type="submit" disabled={exportVerification.submitting}>
              {t('settings.privacy.sendCode', { defaultValue: 'Send email code' })}
            </button>
            <button className="sp-btn sp-btn-ghost" type="button" onClick={resetExportVerification} disabled={exportVerification.submitting}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </form>
      )}
      {exportVerification.step === 'code' && (
        <form className="mt-4 p-4 rounded-lg border border-[var(--border-color,#334155)]" onSubmit={verifyAndDownloadExport}>
          <p className="text-sm font-semibold" style={{ color: 'var(--app-text,#f1f5f9)' }}>
            {t('settings.privacy.enterCodeTitle', { defaultValue: 'Enter your email code' })}
          </p>
          <p className="text-sm mt-1 mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            {t('settings.privacy.enterCodeDesc', { defaultValue: 'We sent a six-digit code to {{email}}. It expires in 15 minutes.', email: exportVerification.emailHint })}
          </p>
          <input
            className="sp-input w-full mb-3"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={exportVerification.code}
            onChange={(event) => setExportVerification((current) => ({ ...current, code: event.target.value.replace(/\D/g, '') }))}
            placeholder="123456"
            disabled={exportVerification.submitting}
          />
          <div className="flex gap-2">
            <button className="sp-btn sp-btn-primary" type="submit" disabled={exportVerification.submitting}>
              {exportVerification.submitting ? t('settings.privacy.exporting', { defaultValue: 'Verifying...' }) : t('settings.privacy.verifyAndExport', { defaultValue: 'Verify and export' })}
            </button>
            <button className="sp-btn sp-btn-ghost" type="button" onClick={resetExportVerification} disabled={exportVerification.submitting}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </form>
      )}
    </div>
  );

  const tabAccount = (
    <div className="sp-card">
      <h2 className="sp-card-title">{t('settings.account.title')}</h2>
      <p className="sp-card-subtitle">
        {t('settings.account.unifiedDesc', { defaultValue: 'Your account type drives the dashboard, the navbar, and which features are visible. Switch any time, the change is instant and your data is preserved.' })}
      </p>

      <ul className="flex flex-col gap-2 mb-2">
        {LAUNCH_SELF_SELECTABLE_MODES.map((m) => {
          const meta = MODE_CATALOG[m] || {};
          const isCurrent = m === currentMode;
          const isSwitching = switchingMode === m;
          return (
            <li
              key={m}
              className="flex items-start gap-3 p-3 rounded-lg border"
              style={{
                borderColor: isCurrent ? 'rgba(249,115,22,0.4)' : 'var(--color-border, #1f2937)',
                background: isCurrent ? 'rgba(249,115,22,0.08)' : 'transparent',
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--app-text,#f1f5f9)' }}>
                    {t(meta.labelKey || `modes.${m}.label`, { defaultValue: m })}
                  </span>
                  {isCurrent && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                      style={{ background: '#F97316', color: '#fff' }}
                    >
                      {t('settings.account.currentRole', { defaultValue: 'Current' })}
                    </span>
                  )}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                  {t(meta.hintKey || `modes.${m}.hint`, { defaultValue: '' })}
                </div>
              </div>
              {!isCurrent && (
                <button
                  type="button"
                  onClick={() => handleSwitchMode(m)}
                  disabled={!!switchingMode}
                  className="sp-btn sp-btn-ghost text-xs whitespace-nowrap disabled:opacity-50"
                  style={{ padding: '0.4rem 0.75rem' }}
                >
                  {isSwitching ? t('common.switching', { defaultValue: 'Switching...' }) : t('settings.account.switchTo', { defaultValue: 'Switch' })}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {grantedModes.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            {t('settings.account.grantedTitle', { defaultValue: 'Workspaces you belong to' })}
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            {t('settings.account.grantedHint', { defaultValue: 'You\'ve been granted these roles by other workspace owners. Enter them from the Mode Switcher in the navbar.' })}
          </p>
          <ul className="flex flex-col gap-2">
            {grantedModes.map((g, i) => {
              const meta = MODE_CATALOG[g.mode] || {};
              return (
                <li
                  key={`${g.mode}-${i}`}
                  className="flex items-start gap-3 p-3 rounded-lg border"
                  style={{ borderColor: 'var(--color-border, #1f2937)', background: 'transparent' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: 'var(--app-text,#f1f5f9)' }}>
                      {t(meta.labelKey || `modes.${g.mode}.label`, { defaultValue: g.mode })}
                      <span className="ml-2 text-xs font-normal" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                        · {g.business_name}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted-text,#94a3b8)' }}>
                      {t(meta.hintKey || `modes.${g.mode}.hint`, { defaultValue: '' })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  const tabDanger = (
    <div className="sp-card sp-danger-card">
      <h2 className="sp-card-title" style={{ color: '#f87171' }}>{t('settings.danger.title')}</h2>
      <p className="sp-card-subtitle">{t('settings.danger.subtitle')}</p>

      {!showDelete ? (
        <button onClick={() => { setShowDelete(true); setDeleteConfirmText(''); setDeleteError(''); setDeleteActiveJobs([]); }} className="sp-btn sp-btn-danger">
          {t('settings.danger.deleteAccount')}
        </button>
      ) : (
        <div className="sp-confirm-box">
          <p className="text-sm font-semibold mb-1" style={{ color: '#f87171' }}>{t('settings.danger.confirmTitle')}</p>

          {/* What deletion means */}
          <div className="text-sm mb-4 space-y-2" style={{ color: 'var(--muted-text,#94a3b8)' }}>
            <p>{t('settings.danger.confirmDesc')}</p>
            <div className="rounded-lg border p-3 text-xs space-y-1.5" style={{ borderColor: 'rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.04)' }}>
              <p style={{ color: '#fca5a5', fontWeight: 600 }}>What happens when you delete your account:</p>
              <p>• Your profile, photo, and personal information are immediately anonymized</p>
              <p>• You are logged out and cannot log back in</p>
              <p>• Your review history, dispute records, and financial/payment records are <strong style={{ color: '#fca5a5' }}>retained</strong> as required by law</p>
              <p>• Pending earnings must be collected before deletion</p>
              <p>• Active jobs must be completed or cancelled first</p>
              <p style={{ color: '#fb923c' }}>⚠ Banned accounts cannot be self-deleted. Contact support to appeal a ban.</p>
            </div>
          </div>

          {/* Active jobs error */}
          {deleteActiveJobs.length > 0 && (
            <div className="rounded-lg border p-3 text-xs mb-3 space-y-1" style={{ borderColor: 'rgba(251,146,60,0.3)', background: 'rgba(251,146,60,0.06)', color: '#fdba74' }}>
              <p className="font-semibold">You have {deleteActiveJobs.length} active job{deleteActiveJobs.length !== 1 ? 's' : ''} that must be resolved first:</p>
              {deleteActiveJobs.map(j => (
                <p key={j.id}>• {j.title}: <span style={{ opacity: 0.75 }}>{j.status}</span></p>
              ))}
            </div>
          )}

          {/* Generic error */}
          {deleteError && !deleteActiveJobs.length && (
            <p className="text-sm mb-3" style={{ color: '#f87171' }}>{deleteError}</p>
          )}

          {/* Confirmation input */}
          <div className="mb-4">
            <label className="sp-label" style={{ color: '#f87171' }}>
              Type <strong>DELETE MY ACCOUNT</strong> to confirm
            </label>
            <input
              className="sp-input"
              value={deleteConfirmText}
              onChange={e => { setDeleteConfirmText(e.target.value); setDeleteError(''); }}
              placeholder="DELETE MY ACCOUNT"
              autoComplete="off"
              style={{ borderColor: deleteError ? '#f87171' : undefined }}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={deleteAccount}
              disabled={deletePending || deleteConfirmText !== 'DELETE MY ACCOUNT'}
              className="sp-btn sp-btn-danger"
              style={{ opacity: deleteConfirmText !== 'DELETE MY ACCOUNT' ? 0.5 : 1 }}
            >
              {deletePending ? 'Deleting…' : t('settings.danger.yesDelete')}
            </button>
            <button
              onClick={() => { setShowDelete(false); setDeleteConfirmText(''); setDeleteError(''); setDeleteActiveJobs([]); }}
              className="sp-btn sp-btn-ghost"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const PANEL_MAP = {
    profile:       tabProfile,
    security:      tabSecurity,
    subscription:  tabSubscription,
    toolRentals:   tabToolRentals,
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
          {LAUNCH_VISIBILITY.subscriptions && (
            <div className="mt-3">
              <TrialBanner />
            </div>
          )}
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
            {/* Helper-only: payment & cancellation policies */}
            {isHelper && (
              <>
                <div className="sp-tab-divider" />
                <Link
                  to="/settings/payment-policies"
                  className="sp-tab"
                >
                  <svg className="sp-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M7 15h2m4 0h2"/>
                  </svg>
                  <span>{t('settings.tabPaymentPolicies', { defaultValue: 'Payment Policies' })}</span>
                </Link>
              </>
            )}
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
