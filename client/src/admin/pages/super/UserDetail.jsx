import { useEffect, useState, useCallback } from 'react';
import { useTranslation }  from 'react-i18next';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Shield, Ban, CheckCircle, ExternalLink, AlertCircle,
  ChevronLeft, MessageSquare, X, Loader2, Trash2, FileCheck,
  AlertTriangle, KeyRound, LogIn, Clock, StickyNote, Activity,
  ClipboardList, Phone, MapPin, Calendar, Wifi, Lock,
  RotateCcw, Edit3, Save, Plus, ChevronDown, ChevronUp, Eye,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAuth } from '../../../hooks/useAuth';

// ─── helpers ────────────────────────────────────────────────────────────────

function humanize(str) {
  if (!str) return '—';
  return String(str).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusPill({ value }) {
  const colorMap = {
    active: 'bg-green-900 text-green-400', suspended: 'bg-yellow-900 text-yellow-300',
    restricted: 'bg-orange-900 text-orange-300', banned: 'bg-red-900 text-red-400',
    passed: 'bg-green-900 text-green-400', failed: 'bg-red-900 text-red-400',
    not_submitted: 'bg-gray-700 text-gray-400', pending: 'bg-blue-900 text-blue-400',
    verified: 'bg-blue-900 text-blue-300', none: 'bg-gray-700 text-gray-500',
    open: 'bg-blue-900 text-blue-300', in_progress: 'bg-orange-900 text-orange-300',
    resolved: 'bg-green-900 text-green-400', closed: 'bg-gray-700 text-gray-500',
    high: 'bg-red-900 text-red-400', medium: 'bg-yellow-900 text-yellow-300',
    low: 'bg-gray-700 text-gray-400', critical: 'bg-red-950 text-red-300',
  };
  const color = colorMap[String(value || '').toLowerCase()] || 'bg-gray-700 text-gray-400';
  return <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${color}`}>{humanize(value)}</span>;
}

const SOURCE_META = {
  admin_action:  { label: 'Admin Edit',    color: 'text-orange-400' },
  audit_log:     { label: 'Admin Action',  color: 'text-indigo-400' },
  login:         { label: 'Login',         color: 'text-green-400'  },
  impersonation: { label: 'Impersonation', color: 'text-yellow-400' },
};

// ─── main component ──────────────────────────────────────────────────────────

export default function UserDetail() {
  const { t }        = useTranslation();
  const { userId }   = useParams();
  const navigate     = useNavigate();
  const { user: me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const isAdmin = me?.role === 'admin' || me?.role === 'super_admin';

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null);

  const [nameForm,     setNameForm]     = useState({ first_name: '', last_name: '' });
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [nameSaving,   setNameSaving]   = useState(false);

  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [profileForm,     setProfileForm]     = useState({ email: '', phone: '', bio: '', city: '', state: '', country: '' });
  const [profileSaving,   setProfileSaving]   = useState(false);

  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgText,      setMsgText]      = useState('');
  const [msgSending,   setMsgSending]   = useState(false);

  const [diditSaving, setDiditSaving] = useState(false);

  const [credentialModal,  setCredentialModal]  = useState(null);
  const [credentialReason, setCredentialReason] = useState('');
  const [credentialNotes,  setCredentialNotes]  = useState('');
  const [credentialSaving, setCredentialSaving] = useState(false);

  const [showPwReset, setShowPwReset] = useState(false);
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [pwSaving,    setPwSaving]    = useState(false);

  const [impersonating, setImpersonating] = useState(false);

  const [statusModal,  setStatusModal]  = useState(null);
  const [statusReason, setStatusReason] = useState('');
  const [suspendDays,  setSuspendDays]  = useState(7);
  const [statusSaving, setStatusSaving] = useState(false);

  const [notes,       setNotes]       = useState([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [showNotes,   setShowNotes]   = useState(false);
  const [newNote,     setNewNote]     = useState('');
  const [noteSaving,  setNoteSaving]  = useState(false);
  const [editNote,    setEditNote]    = useState(null);

  const [activity,       setActivity]       = useState([]);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [showActivity,   setShowActivity]   = useState(false);
  const [activityTotal,  setActivityTotal]  = useState(0);

  const [tickets,       setTickets]       = useState([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [showTickets,   setShowTickets]   = useState(false);

  // ── data fetching ─────────────────────────────────────────────────────────

  const fetchUser = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: res } = await adminApi.get(`/admin/users/${userId}`);
      setData(res ?? null);
      const u = res?.user || {};
      setNameForm({ first_name: u.first_name ?? '', last_name: u.last_name ?? '' });
      setProfileForm({ email: u.email ?? '', phone: u.phone ?? '', bio: u.bio ?? '', city: u.city ?? '', state: u.state ?? '', country: u.country ?? 'US' });
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load user.');
    } finally { setLoading(false); }
  }, [userId]);

  const loadNotes = useCallback(async () => {
    if (notesLoaded) return;
    try {
      const { data: res } = await adminApi.get(`/admin/users/${userId}/notes`);
      setNotes(res.notes || []); setNotesLoaded(true);
    } catch (_) {}
  }, [userId, notesLoaded]);

  const loadActivity = useCallback(async () => {
    if (activityLoaded) return;
    try {
      const { data: res } = await adminApi.get(`/admin/users/${userId}/activity?limit=100`);
      setActivity(res.events || []); setActivityTotal(res.total || 0); setActivityLoaded(true);
    } catch (_) {}
  }, [userId, activityLoaded]);

  const loadTickets = useCallback(async () => {
    if (ticketsLoaded) return;
    try {
      const { data: res } = await adminApi.get(`/admin/users/${userId}/support-tickets`);
      setTickets(res.tickets || []); setTicketsLoaded(true);
    } catch (_) {}
  }, [userId, ticketsLoaded]);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  // ── helpers ───────────────────────────────────────────────────────────────

  const flash = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage(null), 5000); };

  const doAction = async (endpoint, payload = {}, label = '') => {
    if (!window.confirm(`Confirm: ${label}?`)) return;
    setWorking(true); setMessage(null);
    try {
      const { data: res } = await adminApi.post(`/admin/users/${userId}/${endpoint}`, payload);
      flash('success', res.message); fetchUser();
    } catch (err) { flash('error', err.response?.data?.error || 'Action failed.'); }
    finally { setWorking(false); }
  };

  // ── impersonation ─────────────────────────────────────────────────────────

  const startImpersonation = async () => {
    if (!window.confirm(
      `Login as ${data?.user?.first_name} ${data?.user?.last_name}?\n\nAll actions during this session will be logged in the audit trail. A new tab will open with an orange impersonation banner.`
    )) return;
    setImpersonating(true);
    try {
      const { data: res } = await adminApi.post(`/admin/users/${userId}/impersonate`);
      const url = `${window.location.origin}/impersonate?token=${encodeURIComponent(res.impersonationToken)}`;
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to create impersonation session.');
    } finally { setImpersonating(false); }
  };

  // ── name save ─────────────────────────────────────────────────────────────

  const saveName = async (e) => {
    e.preventDefault(); setNameSaving(true); setMessage(null);
    try {
      const { data: res } = await adminApi.put(`/admin/users/${userId}/name`, nameForm);
      flash('success', res.message); setShowNameEdit(false); fetchUser();
    } catch (err) { flash('error', err.response?.data?.error || 'Name update failed.'); }
    finally { setNameSaving(false); }
  };

  // ── profile save ──────────────────────────────────────────────────────────

  const saveProfile = async (e) => {
    e.preventDefault(); setProfileSaving(true); setMessage(null);
    try {
      const { data: res } = await adminApi.put(`/admin/users/${userId}/profile`, profileForm);
      flash('success', res.message || 'Profile updated.'); setShowProfileEdit(false); fetchUser();
    } catch (err) { flash('error', err.response?.data?.error || 'Profile update failed.'); }
    finally { setProfileSaving(false); }
  };

  // ── role ──────────────────────────────────────────────────────────────────

  const changeRole = async (role) => {
    if (!window.confirm(`Change role to ${role}?`)) return;
    setWorking(true);
    try {
      const { data: res } = await adminApi.put(`/admin/users/${userId}/role`, { role });
      flash('success', res.message); fetchUser();
    } catch (err) { flash('error', err.response?.data?.error || 'Role change failed.'); }
    finally { setWorking(false); }
  };

  // ── granular status ───────────────────────────────────────────────────────

  const submitStatusAction = async (e) => {
    e.preventDefault();
    if (!statusReason.trim() && statusModal?.action !== 'reactivate') return;
    setStatusSaving(true);
    try {
      const payload = { reason: statusReason.trim() };
      if (statusModal?.action === 'suspend') payload.days = parseInt(suspendDays, 10) || 0;
      const { data: res } = await adminApi.post(`/admin/users/${userId}/${statusModal.action}`, payload);
      flash('success', res.message);
      setStatusModal(null); setStatusReason(''); setSuspendDays(7); fetchUser();
    } catch (err) { flash('error', err.response?.data?.error || 'Action failed.'); }
    finally { setStatusSaving(false); }
  };

  // ── notes ─────────────────────────────────────────────────────────────────

  const addNote = async (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    setNoteSaving(true);
    try {
      const { data: res } = await adminApi.post(`/admin/users/${userId}/notes`, { note_text: newNote.trim() });
      setNotes(prev => [{ ...res.note, author_name: `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim(), author_email: me?.email, author_role: me?.role }, ...prev]);
      setNewNote('');
    } catch (err) { flash('error', err.response?.data?.error || 'Failed to add note.'); }
    finally { setNoteSaving(false); }
  };

  const saveEditNote = async (e) => {
    e.preventDefault();
    if (!editNote?.text?.trim()) return;
    try {
      await adminApi.put(`/admin/users/${userId}/notes/${editNote.id}`, { note_text: editNote.text });
      setNotes(prev => prev.map(n => n.id === editNote.id ? { ...n, note_text: editNote.text } : n));
      setEditNote(null);
    } catch (err) { flash('error', err.response?.data?.error || 'Failed to update note.'); }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await adminApi.delete(`/admin/users/${userId}/notes/${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) { flash('error', err.response?.data?.error || 'Failed to delete note.'); }
  };

  // ── didit ─────────────────────────────────────────────────────────────────

  const setDiditEnforcement = async (required) => {
    if (!window.confirm(t(required ? 'admin.diditRequireConfirm' : 'admin.diditRelaxConfirm'))) return;
    setDiditSaving(true);
    try {
      await adminApi.put(`/admin/users/${userId}/didit-enforcement`, { required });
      flash('success', t('admin.diditEnforcementUpdated')); fetchUser();
    } catch (err) { flash('error', err.response?.data?.error || t('admin.diditEnforcementFailed')); }
    finally { setDiditSaving(false); }
  };

  // ── credential removal ────────────────────────────────────────────────────

  const removeCredential = async (e) => {
    e.preventDefault();
    if (!credentialModal?.type || !credentialReason.trim()) { flash('error', 'Reason is required.'); return; }
    setCredentialSaving(true);
    try {
      const { data: res } = await adminApi.post(`/helpers/${userId}/remove-credential`, {
        credential_type: credentialModal.type, removal_reason: credentialReason, notes: credentialNotes.trim() || undefined,
      });
      flash('success', res.message || `${credentialModal.type} removed successfully`);
      setCredentialModal(null); setCredentialReason(''); setCredentialNotes(''); fetchUser();
    } catch (err) { flash('error', err.response?.data?.error || 'Failed to remove credential.'); }
    finally { setCredentialSaving(false); }
  };

  // ── password reset ────────────────────────────────────────────────────────

  const submitSuperAdminPassword = async (e) => {
    e.preventDefault();
    if (newPw.length < 8)    { flash('error', t('admin.setPasswordTooShort')); return; }
    if (newPw !== confirmPw) { flash('error', t('admin.setPasswordMismatch'));  return; }
    if (!window.confirm(t('admin.setPasswordPrompt'))) return;
    setPwSaving(true);
    try {
      const { data: res } = await adminApi.post(`/admin/users/${userId}/password`, { password: newPw });
      flash('success', res.message || t('admin.setPasswordSuccess'));
      setShowPwReset(false); setNewPw(''); setConfirmPw('');
    } catch (err) { flash('error', err.response?.data?.error || t('admin.setPasswordFailed')); }
    finally { setPwSaving(false); }
  };

  // ── delete ────────────────────────────────────────────────────────────────

  const deleteUserAccount = async () => {
    if (!window.confirm(t('admin.deleteUserConfirm'))) return;
    const typed = window.prompt(t('admin.deleteUserTypeEmail'), '');
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== (data?.user?.email ?? '').toLowerCase()) { flash('error', t('admin.deleteUserEmailMismatch')); return; }
    const reason = window.prompt(t('admin.deleteUserReasonPrompt'), '') ?? '';
    setWorking(true);
    try {
      const { data: res } = await adminApi.delete(`/admin/users/${userId}`, { data: { reason: reason.trim() || undefined } });
      flash('success', res.message); navigate('/admin/users');
    } catch (err) { flash('error', err.response?.data?.error || t('admin.deleteUserFailed')); }
    finally { setWorking(false); }
  };

  // ── render guards ─────────────────────────────────────────────────────────

  if (loading) return <div className="p-8 text-center text-gray-500">Loading user…</div>;

  if (error) return (
    <div className="p-6 sm:p-8">
      <div className="flex items-start gap-3 bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 max-w-lg">
        <AlertCircle size={18} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm">Failed to load user</p>
          <p className="text-xs mt-1 text-red-400">{error}</p>
          <button onClick={fetchUser} className="mt-3 text-xs underline hover:no-underline">Try again</button>
        </div>
      </div>
    </div>
  );

  if (!data) return null;

  const { user, recentJobs = [], recentPayouts = [], billing = [] } = data;

  const accountStatus = !user.is_active
    ? (user.is_suspended ? 'suspended' : 'banned')
    : user.is_restricted ? 'restricted' : 'active';

  const profileFields = ['first_name', 'last_name', 'email', 'phone', 'bio', 'city'];
  const profilePct    = Math.round((profileFields.filter(f => !!user[f]).length / profileFields.length) * 100);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-8 max-w-5xl">

      <Link to="/admin/users" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition mb-4">
        <ChevronLeft size={14} />Back to Users
      </Link>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
        <div className="flex items-start gap-3 sm:gap-4">
          <img src={user.avatar_url || '/default-avatar.png'} alt="" className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border border-gray-700 shrink-0" />
          <div className="min-w-0">

            {/* Name + inline edit */}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white">{user.first_name} {user.last_name}</h1>
              {isAdmin && (
                <button onClick={() => { setShowNameEdit(v => !v); setNameForm({ first_name: user.first_name || '', last_name: user.last_name || '' }); }} className="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">Edit name</button>
              )}
            </div>
            {showNameEdit && (
              <form onSubmit={saveName} className="mt-2 flex flex-wrap items-center gap-2">
                <input value={nameForm.first_name} onChange={e => setNameForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" required className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm w-28 focus:outline-none focus:border-orange-500" />
                <input value={nameForm.last_name}  onChange={e => setNameForm(f => ({ ...f, last_name: e.target.value }))}  placeholder="Last name"  required className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm w-28 focus:outline-none focus:border-orange-500" />
                <button type="submit" disabled={nameSaving} className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded font-semibold transition disabled:opacity-50">{nameSaving ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => setShowNameEdit(false)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition">Cancel</button>
              </form>
            )}

            <p className="text-gray-400 text-sm mt-0.5 truncate">{user.email}</p>

            {/* Metadata row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
              {user.phone && <span className="flex items-center gap-1"><Phone size={11} />{user.phone}</span>}
              {(user.city || user.state) && <span className="flex items-center gap-1"><MapPin size={11} />{[user.city, user.state, user.country].filter(Boolean).join(', ')}</span>}
              <span className="flex items-center gap-1"><Calendar size={11} />Joined {formatDateShort(user.created_at)}</span>
              {user.last_login_at && (
                <span className="flex items-center gap-1">
                  <Wifi size={11} />Last login {formatDate(user.last_login_at)}
                  {user.last_login_ip && <span className="text-gray-600 ml-1">· {String(user.last_login_ip)}</span>}
                </span>
              )}
              <span className={`flex items-center gap-1 ${profilePct < 60 ? 'text-yellow-600' : ''}`}>
                <Eye size={11} />{profilePct}% profile complete
              </span>
            </div>

            {/* Status pills */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded-full capitalize">{user.role}</span>
              {user.plan_slug && <span className="px-2 py-0.5 bg-orange-900 text-orange-300 text-xs rounded-full capitalize">{user.plan_slug}</span>}
              <StatusPill value={accountStatus} />
              {user.id_verified             && <span className="px-2 py-0.5 bg-blue-900 text-blue-300 text-xs rounded-full">✓ ID Verified</span>}
              {user.background_check_status === 'passed' && <span className="px-2 py-0.5 bg-green-900 text-green-400 text-xs rounded-full">✓ Background Check</span>}
              <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded-full">{t('admin.diditStatus', { status: humanize(user.didit_status || 'pending') })}</span>
              {user.didit_enforcement_required && <span className="px-2 py-0.5 bg-amber-900 text-amber-200 text-xs rounded-full">{t('admin.diditEnforcementOn')}</span>}
              {user.is_restricted && <span className="px-2 py-0.5 bg-orange-900 text-orange-300 text-xs rounded-full">⚠ Restricted</span>}
              {(user.warning_count > 0) && <span className="px-2 py-0.5 bg-yellow-900 text-yellow-300 text-xs rounded-full">{user.warning_count} warning{user.warning_count > 1 ? 's' : ''}</span>}
            </div>

            {/* Suspension / restriction details */}
            {user.is_suspended && (
              <p className="text-xs text-yellow-400 mt-1">
                Suspended until: {user.suspended_until ? formatDate(user.suspended_until) : 'indefinite'}
                {user.suspension_reason && ` · ${user.suspension_reason}`}
              </p>
            )}
            {user.is_restricted && user.restriction_reason && (
              <p className="text-xs text-orange-400 mt-1">Restriction: {user.restriction_reason}</p>
            )}

            {/* Didit enforcement toggles */}
            {isAdmin && !['admin', 'super_admin'].includes(user.role) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={diditSaving || user.didit_enforcement_required} onClick={() => setDiditEnforcement(true)} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-900/80 text-amber-100 hover:bg-amber-800 border border-amber-700 disabled:opacity-40 disabled:cursor-not-allowed">{t('admin.diditEnforcementOn')}</button>
                <button type="button" disabled={diditSaving || !user.didit_enforcement_required} onClick={() => setDiditEnforcement(false)} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed">{t('admin.diditEnforcementOff')}</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Action buttons ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 sm:shrink-0">

          {/* P0: Login as User */}
          {isSuper && !['admin', 'super_admin'].includes(user.role) && (
            <button onClick={startImpersonation} disabled={impersonating || working}
              className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 shadow-md"
              title="Open a new tab logged in as this user (audited)">
              {impersonating ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}Login as User
            </button>
          )}

          {/* Message */}
          <button onClick={() => setShowMsgModal(true)} disabled={['admin', 'super_admin'].includes(user.role)}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-900 text-indigo-300 hover:bg-indigo-800 rounded-lg text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed">
            <MessageSquare size={13} />Message
          </button>

          {/* Super-admin actions */}
          {isSuper && (
            <>
              {/* Granular status */}
              {accountStatus === 'active' ? (
                <>
                  <button onClick={() => { setStatusModal({ action: 'suspend' }); setStatusReason(''); setSuspendDays(7); }} disabled={working}
                    className="flex items-center gap-1.5 px-3 py-2 bg-yellow-900 text-yellow-200 hover:bg-yellow-800 rounded-lg text-xs font-semibold transition disabled:opacity-50">
                    <Clock size={13} />Suspend
                  </button>
                  <button onClick={() => { setStatusModal({ action: 'restrict' }); setStatusReason(''); }} disabled={working}
                    className="flex items-center gap-1.5 px-3 py-2 bg-orange-900 text-orange-200 hover:bg-orange-800 rounded-lg text-xs font-semibold transition disabled:opacity-50">
                    <Lock size={13} />Restrict
                  </button>
                </>
              ) : (
                <button onClick={() => { setStatusModal({ action: 'reactivate' }); setStatusReason(''); }} disabled={working}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-900 text-green-300 hover:bg-green-800 rounded-lg text-xs font-semibold transition disabled:opacity-50">
                  <RotateCcw size={13} />Reactivate
                </button>
              )}
              <button onClick={() => { setStatusModal({ action: 'warn' }); setStatusReason(''); }} disabled={working}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-900 text-amber-200 hover:bg-amber-800 rounded-lg text-xs font-semibold transition disabled:opacity-50">
                <AlertTriangle size={13} />Warn
              </button>
              {/* Legacy hard ban */}
              <button onClick={() => doAction('ban', { reason: window.prompt(t('admin.optionalReason')) || '' }, user.is_active ? 'Ban this user' : 'Unban this user')} disabled={working}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition disabled:opacity-50 ${user.is_active ? 'bg-red-900 text-red-300 hover:bg-red-800' : 'bg-green-900 text-green-300 hover:bg-green-800'}`}>
                {user.is_active ? <Ban size={13} /> : <CheckCircle size={13} />}{user.is_active ? 'Ban' : 'Unban'}
              </button>

              <button onClick={() => doAction('verify', { field: 'is_identity_verified' }, t('admin.verifyIdConfirm'))} disabled={working || (user.didit_status === 'verified' && user.id_verified)}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-900 text-blue-300 hover:bg-blue-800 rounded-lg text-xs font-semibold transition disabled:opacity-40">
                <Shield size={13} />{t('admin.verifyIdButton')}
              </button>
              <button onClick={() => doAction('verify', { field: 'is_background_checked' }, t('admin.verifyBgConfirm'))} disabled={working || (user.background_check_passed && user.background_check_status === 'passed')}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-900 text-emerald-200 hover:bg-emerald-800 rounded-lg text-xs font-semibold transition disabled:opacity-40">
                <CheckCircle size={13} />{t('admin.verifyBgButton')}
              </button>

              <select onChange={e => e.target.value && changeRole(e.target.value)} defaultValue="" disabled={working}
                className="px-3 py-2 bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded-lg focus:outline-none focus:border-orange-500">
                <option value="">Change Role</option>
                {['customer','helper','helper_pro','broker','admin'].map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
              </select>

              {!['admin', 'super_admin'].includes(user.role) && me?.id !== user.id && (
                <button type="button" onClick={deleteUserAccount} disabled={working}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-950 text-red-200 hover:bg-red-900 border border-red-800 rounded-lg text-xs font-semibold transition disabled:opacity-50">
                  <Trash2 size={13} />{t('admin.deleteUserButton')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Flash message */}
      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm mb-6 ${message.type === 'success' ? 'bg-green-900 border border-green-700 text-green-300' : 'bg-red-900 border border-red-700 text-red-300'}`}>
          {message.text}
        </div>
      )}

      {/* ── PASSWORD RESET ─────────────────────────────────────────────────── */}
      {isSuper && (
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5 mb-6">
          <h3 className="font-semibold text-white mb-2 flex items-center gap-2"><KeyRound size={18} />{t('admin.setPasswordSectionTitle')}</h3>
          <p className="text-sm text-gray-400 mb-4">{t('admin.setPasswordSectionHint')}</p>
          {!showPwReset ? (
            <button type="button" onClick={() => { setShowPwReset(true); setNewPw(''); setConfirmPw(''); setMessage(null); }}
              className="px-4 py-2 bg-amber-900/80 text-amber-100 hover:bg-amber-800 rounded-lg text-sm font-semibold border border-amber-700 transition">
              {t('admin.setPasswordOpen')}
            </button>
          ) : (
            <form onSubmit={submitSuperAdminPassword} className="space-y-3 max-w-md">
              <input type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder={t('admin.setPasswordNew')} required minLength={8} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500" />
              <input type="password" autoComplete="new-password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder={t('admin.setPasswordRepeat')} required minLength={8} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500" />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pwSaving} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">{pwSaving ? t('admin.setPasswordSaving') : t('admin.setPasswordSubmit')}</button>
                <button type="button" onClick={() => { setShowPwReset(false); setNewPw(''); setConfirmPw(''); }} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition">{t('admin.setPasswordCancel')}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── EXTENDED PROFILE EDIT ──────────────────────────────────────────── */}
      {isSuper && (
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5 mb-6">
          <button onClick={() => setShowProfileEdit(v => !v)} className="w-full flex items-center justify-between text-left">
            <h3 className="font-semibold text-white flex items-center gap-2"><Edit3 size={18} />Edit Profile on Behalf of User</h3>
            {showProfileEdit ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>
          {showProfileEdit && (
            <form onSubmit={saveProfile} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { field: 'email', label: 'Email', type: 'email' },
                { field: 'phone', label: 'Phone', type: 'tel'   },
                { field: 'city',  label: 'City',  type: 'text'  },
                { field: 'state', label: 'State', type: 'text'  },
                { field: 'country', label: 'Country', type: 'text' },
              ].map(({ field, label, type }) => (
                <div key={field}>
                  <label className="block text-xs text-gray-400 mb-1">{label}</label>
                  <input type={type} value={profileForm[field]} onChange={e => setProfileForm(f => ({ ...f, [field]: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500" />
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Bio</label>
                <textarea rows={3} value={profileForm.bio} onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500 resize-none" />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button type="submit" disabled={profileSaving} className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                  {profileSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save Profile
                </button>
                <button type="button" onClick={() => setShowProfileEdit(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── STATS GRID ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {[
          { label: 'Rating',         value: user.average_rating ? `${parseFloat(user.average_rating).toFixed(1)} ★` : 'N/A' },
          { label: 'Jobs Completed', value: user.completed_jobs ?? 0 },
          { label: 'Total Earnings', value: user.earnings_total ? `$${parseFloat(user.earnings_total).toFixed(2)}` : '—' },
          { label: 'BG Check',       value: humanize(user.background_check_status || 'not_submitted') },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-800 border border-gray-700 rounded-xl p-3 sm:p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
            <p className="text-lg sm:text-xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* ── CREDENTIALS ────────────────────────────────────────────────────── */}
      {user.role && ['helper', 'helper_pro', 'broker'].includes(user.role) && (
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5 mb-6 sm:mb-8">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2"><FileCheck size={18} />Self-Reported Credentials</h3>
          <div className="space-y-3">
            {[
              { type: 'license',   label: 'Professional License', claimed: user.is_licensed, cls: 'text-sky-400'   },
              { type: 'insurance', label: 'Insurance',            claimed: user.is_insured,  cls: 'text-amber-400' },
            ].map(({ type, label, claimed, cls }) => (
              <div key={type} className="flex items-center justify-between p-3 bg-gray-700/30 rounded-lg border border-gray-700">
                <div className="flex items-center gap-3">
                  <FileCheck size={16} className={claimed ? cls : 'text-gray-500'} />
                  <div>
                    <p className="text-sm text-white font-medium">{label}</p>
                    <p className={`text-xs ${claimed ? cls : 'text-gray-500'}`}>{claimed ? 'Claimed' : 'Not claimed'}</p>
                  </div>
                </div>
                {claimed && isSuper && (
                  <button onClick={() => setCredentialModal({ type })} disabled={credentialSaving}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-900 text-red-300 hover:bg-red-800 transition disabled:opacity-50 flex items-center gap-1.5">
                    <Trash2 size={13} />Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SUPPORT TICKETS ────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5 mb-6">
          <button onClick={() => { setShowTickets(v => !v); if (!ticketsLoaded) loadTickets(); }}
            className="w-full flex items-center justify-between text-left">
            <h3 className="font-semibold text-white flex items-center gap-2"><ClipboardList size={18} />Support Tickets</h3>
            {showTickets ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>
          {showTickets && (
            <div className="mt-4">
              {!ticketsLoaded ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-2"><Loader2 size={14} className="animate-spin" />Loading…</div>
              ) : tickets.length === 0 ? (
                <p className="text-gray-500 text-sm py-2">No support tickets found.</p>
              ) : (
                <div className="space-y-2">
                  {tickets.map(ticket => (
                    <div key={ticket.id} className="flex items-center justify-between gap-3 p-3 bg-gray-700/30 rounded-lg border border-gray-700">
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate font-medium">{ticket.title || `Ticket #${ticket.ticket_number}`}</p>
                        <p className="text-xs text-gray-500">{formatDateShort(ticket.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusPill value={ticket.status} />
                        <StatusPill value={ticket.priority} />
                        <Link to={`/admin/support/tickets/${ticket.id}`} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition">
                          <ExternalLink size={12} />View
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ADMIN NOTES ────────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5 mb-6">
          <button onClick={() => { setShowNotes(v => !v); if (!notesLoaded) loadNotes(); }}
            className="w-full flex items-center justify-between text-left">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <StickyNote size={18} />Admin Notes
              <span className="text-xs text-gray-500 font-normal">(never shown to user)</span>
            </h3>
            {showNotes ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>
          {showNotes && (
            <div className="mt-4 space-y-4">
              <form onSubmit={addNote} className="flex flex-col gap-2">
                <textarea rows={2} value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add an internal note about this user…" maxLength={4000}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500 resize-none" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">{newNote.length}/4000</span>
                  <button type="submit" disabled={noteSaving || !newNote.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-40">
                    {noteSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Add Note
                  </button>
                </div>
              </form>
              {!notesLoaded ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 size={14} className="animate-spin" />Loading…</div>
              ) : notes.length === 0 ? (
                <p className="text-gray-500 text-sm">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {notes.map(note => (
                    <div key={note.id} className="p-3 bg-gray-700/40 rounded-lg border border-gray-700">
                      {editNote?.id === note.id ? (
                        <form onSubmit={saveEditNote} className="flex flex-col gap-2">
                          <textarea rows={3} value={editNote.text} onChange={e => setEditNote(n => ({ ...n, text: e.target.value }))} maxLength={4000}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500 resize-none" />
                          <div className="flex gap-2">
                            <button type="submit" className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded-lg font-semibold transition">Save</button>
                            <button type="button" onClick={() => setEditNote(null)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition">Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <p className="text-sm text-gray-200 whitespace-pre-wrap mb-2">{note.note_text}</p>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-gray-500">{note.author_name || note.author_email} · {formatDate(note.created_at)}{note.updated_at !== note.created_at ? ' (edited)' : ''}</p>
                            <div className="flex gap-1.5">
                              {(isSuper || note.author_email === me?.email) && (
                                <>
                                  <button onClick={() => setEditNote({ id: note.id, text: note.note_text })} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-0.5 bg-gray-700 rounded transition">Edit</button>
                                  <button onClick={() => deleteNote(note.id)} className="text-xs text-red-500 hover:text-red-400 px-2 py-0.5 bg-gray-700 rounded transition">Delete</button>
                                </>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVITY LOG ───────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5 mb-6">
          <button onClick={() => { setShowActivity(v => !v); if (!activityLoaded) loadActivity(); }}
            className="w-full flex items-center justify-between text-left">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Activity size={18} />Activity Log
              {activityTotal > 0 && <span className="text-xs text-gray-500">({activityTotal} events)</span>}
            </h3>
            {showActivity ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>
          {showActivity && (
            <div className="mt-4">
              {!activityLoaded ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-2"><Loader2 size={14} className="animate-spin" />Loading…</div>
              ) : activity.length === 0 ? (
                <p className="text-gray-500 text-sm py-2">No activity recorded yet.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {activity.map((evt, i) => {
                    const meta = SOURCE_META[evt.source] || { label: evt.source, color: 'text-gray-400' };
                    return (
                      <div key={evt.id || i} className="flex items-start gap-3 p-3 bg-gray-700/30 rounded-lg border border-gray-700/50">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-0.5">
                            <span className={`text-xs font-semibold uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
                            <span className="text-xs text-gray-300 font-medium">{humanize(evt.event_type)}</span>
                            {evt.field_name && <span className="text-xs text-gray-500">field: <code className="text-gray-400">{evt.field_name}</code></span>}
                          </div>
                          {(evt.old_value || evt.new_value) && (
                            <p className="text-xs text-gray-500 mb-0.5">
                              {evt.old_value && <span>From: <em className="text-gray-400">{evt.old_value}</em> </span>}
                              {evt.new_value && <span>→ <em className="text-gray-300">{evt.new_value}</em></span>}
                            </p>
                          )}
                          {evt.notes && <p className="text-xs text-gray-500 italic">{evt.notes}</p>}
                          <div className="flex flex-wrap items-center gap-x-3 mt-1 text-xs text-gray-600">
                            {evt.actor_name && <span>{evt.actor_name} ({evt.actor_role})</span>}
                            {evt.ip_address && <span>IP: {evt.ip_address}</span>}
                            <span>{formatDate(evt.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TWO-COLUMN ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
          <h3 className="font-semibold text-white mb-4">Recent Jobs</h3>
          {recentJobs.length === 0 ? <p className="text-gray-500 text-sm text-center py-4">No jobs yet.</p> : (
            <div className="space-y-3">
              {recentJobs.map(job => (
                <div key={job.id} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{job.title}</p>
                    <p className="text-xs text-gray-500">{formatDateShort(job.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.final_price && <span className="text-xs text-gray-400">${parseFloat(job.final_price).toFixed(2)}</span>}
                    <StatusPill value={job.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
          <h3 className="font-semibold text-white mb-4">Billing History</h3>
          {billing.length === 0 ? <p className="text-gray-500 text-sm text-center py-4">No billing history.</p> : (
            <div className="space-y-3">
              {billing.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white capitalize">{humanize((item.event_type || '').replace('invoice.', ''))}</p>
                    <p className="text-xs text-gray-500">{item.period_start ? new Date(item.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-white">${((item.amount_cents || 0) / 100).toFixed(2)}</span>
                    <StatusPill value={item.status} />
                    {item.invoice_url && <a href={item.invoice_url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 transition"><ExternalLink size={12} /></a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {recentPayouts.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
            <h3 className="font-semibold text-white mb-4">Recent Payouts</h3>
            <div className="space-y-3">
              {recentPayouts.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{p.job_title}</p>
                    <p className="text-xs text-gray-500">{p.completed_at ? formatDateShort(p.completed_at) : 'Pending'}</p>
                  </div>
                  <span className="text-sm font-bold text-green-400 shrink-0">+${(p.net_to_helper_cents / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isSuper && (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
            <h3 className="font-semibold text-white mb-4">Stripe Account</h3>
            <div className="space-y-3 text-sm">
              {[
                { label: 'Account ID',      value: user.stripe_account_id || '—' },
                { label: 'Onboarding',      value: user.onboarding_complete ? '✓ Complete' : '✗ Incomplete' },
                { label: 'Charges Enabled', value: user.charges_enabled ? '✓ Yes' : '✗ No' },
                { label: 'Payouts Enabled', value: user.payouts_enabled  ? '✓ Yes' : '✗ No' },
                { label: 'Subscription ID', value: user.stripe_subscription_id || '—' },
                { label: 'Sub Status',      value: humanize(user.sub_status || user.subscription_status || 'none') },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between border-b border-gray-700/50 pb-2 last:border-0 last:pb-0">
                  <span className="text-gray-400 shrink-0">{label}</span>
                  <span className="text-white font-mono text-xs truncate max-w-[9rem] sm:max-w-40 text-right ml-2">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* Message */}
      {showMsgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white flex items-center gap-2 text-sm"><MessageSquare size={15} className="text-indigo-400" />Message {user.first_name}</h2>
              <button onClick={() => { setShowMsgModal(false); setMsgText(''); }} className="text-gray-500 hover:text-white transition p-1"><X size={15} /></button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault(); if (!msgText.trim()) return;
              setMsgSending(true);
              try {
                await adminApi.post(`/admin/super/users/${user.id}/message`, { content: msgText.trim() });
                flash('success', `Message sent to ${user.first_name}.`);
                setShowMsgModal(false); setMsgText('');
              } catch (err) { flash('error', err.response?.data?.error || 'Failed to send message.'); }
              finally { setMsgSending(false); }
            }} className="p-5">
              <p className="text-xs text-gray-400 mb-3">Appears in {user.first_name}'s inbox as a system message and is logged in the audit trail.</p>
              <textarea autoFocus required rows={5} maxLength={4000} value={msgText} onChange={e => setMsgText(e.target.value)} placeholder={`Write a message to ${user.first_name}…`}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none" />
              <div className="flex items-center justify-between mt-1 mb-4"><span className="text-xs text-gray-600">{msgText.length}/4000</span></div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setShowMsgModal(false); setMsgText(''); }} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition">Cancel</button>
                <button type="submit" disabled={msgSending || !msgText.trim()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-40">
                  {msgSending ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}Send
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credential removal */}
      {credentialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="text-red-400 shrink-0" size={20} />
              <h2 className="text-white font-semibold text-lg">Remove {credentialModal.type === 'license' ? 'Professional License' : 'Insurance'}</h2>
            </div>
            <form onSubmit={removeCredential}>
              <label className="block text-sm text-gray-400 mb-2">Reason <span className="text-red-400">*</span></label>
              <select value={credentialReason} onChange={e => setCredentialReason(e.target.value)} required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 mb-4 text-sm focus:border-orange-500 focus:outline-none">
                <option value="">Select a reason…</option>
                <option value="unverified">Unverified / No documentation</option>
                <option value="expired">License/Insurance expired</option>
                <option value="false_claim">False or fraudulent claim</option>
                <option value="user_report">Helper self-reported issue</option>
                <option value="other">Other (see notes below)</option>
              </select>
              <label className="block text-sm text-gray-400 mb-2">Notes <span className="text-gray-600">(optional)</span></label>
              <textarea value={credentialNotes} onChange={e => setCredentialNotes(e.target.value)} rows={2} maxLength={255}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:border-orange-500 focus:outline-none resize-none" />
              <p className="text-xs text-gray-600 mb-4">{credentialNotes.length}/255</p>
              <div className="flex gap-3">
                <button type="submit" disabled={credentialSaving || !credentialReason} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition">{credentialSaving ? 'Removing…' : 'Remove Credential'}</button>
                <button type="button" onClick={() => { setCredentialModal(null); setCredentialReason(''); setCredentialNotes(''); }} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium transition">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Status action (Suspend / Restrict / Warn / Reactivate) */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              {{ suspend: <Clock className="text-yellow-400" size={22} />, restrict: <Lock className="text-orange-400" size={22} />, warn: <AlertTriangle className="text-amber-400" size={22} />, reactivate: <RotateCcw className="text-green-400" size={22} /> }[statusModal.action]}
              <h2 className="text-white font-semibold text-lg capitalize">{statusModal.action} Account</h2>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              {{ suspend: 'User will be logged out and cannot log in until the suspension lifts.', restrict: 'User can log in but cannot post jobs or submit bids.', warn: 'An official warning will be sent to the user\'s inbox.', reactivate: 'Lifts any suspension, restriction, and ban.' }[statusModal.action]}
            </p>
            <form onSubmit={submitStatusAction}>
              {statusModal.action === 'suspend' && (
                <div className="mb-3">
                  <label className="block text-sm text-gray-400 mb-1">Duration</label>
                  <select value={suspendDays} onChange={e => setSuspendDays(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                    {[1,3,7,14,30].map(d => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
                    <option value={0}>Indefinite</option>
                  </select>
                </div>
              )}
              <label className="block text-sm text-gray-400 mb-2">{statusModal.action === 'reactivate' ? 'Notes (optional)' : <>Reason <span className="text-red-400">*</span></>}</label>
              <textarea value={statusReason} onChange={e => setStatusReason(e.target.value)} rows={3} maxLength={500}
                required={statusModal.action !== 'reactivate'}
                placeholder={`${statusModal.action === 'reactivate' ? 'Reason for reactivation…' : `Reason for ${statusModal.action}…`}`}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:border-orange-500 focus:outline-none resize-none" />
              <p className="text-xs text-gray-600 mb-4">{statusReason.length}/500</p>
              <div className="flex gap-3">
                <button type="submit" disabled={statusSaving || (statusModal.action !== 'reactivate' && !statusReason.trim())}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50 text-white ${{ suspend: 'bg-yellow-700 hover:bg-yellow-600', restrict: 'bg-orange-700 hover:bg-orange-600', warn: 'bg-amber-700 hover:bg-amber-600', reactivate: 'bg-green-700 hover:bg-green-600' }[statusModal.action]}`}>
                  {statusSaving ? 'Processing…' : `Confirm ${humanize(statusModal.action)}`}
                </button>
                <button type="button" onClick={() => { setStatusModal(null); setStatusReason(''); }} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium transition">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
