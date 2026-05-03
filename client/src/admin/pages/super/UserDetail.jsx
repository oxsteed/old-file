import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation }  from 'react-i18next';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Shield, Ban, CheckCircle, ExternalLink, AlertCircle,
  ChevronLeft, MessageSquare, X, Loader2, Trash2, FileCheck,
  AlertTriangle, KeyRound, LogIn, Clock, StickyNote, Activity,
  ClipboardList, Phone, MapPin, Calendar, Wifi, Lock,
  RotateCcw, Edit3, Save, Plus, ChevronDown, ChevronUp, Eye,
  Pencil, ChevronRight, MoreVertical,
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

// Standardized status badge — consistent padding, radius, font, color system
function StatusBadge({ value, label }) {
  const display = label || humanize(value);
  const key = String(value || '').toLowerCase();
  const colorMap = {
    active:       'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
    suspended:    'bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30',
    restricted:   'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
    banned:       'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
    passed:       'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
    failed:       'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
    not_submitted:'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/30',
    pending:      'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30',
    verified:     'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
    skipped:      'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/30',
    none:         'bg-gray-500/15 text-gray-500 ring-1 ring-gray-500/20',
    open:         'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
    in_progress:  'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
    resolved:     'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
    closed:       'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/30',
    high:         'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
    medium:       'bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30',
    low:          'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/30',
    critical:     'bg-red-600/20 text-red-300 ring-1 ring-red-600/40',
  };
  const color = colorMap[key] || 'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/30';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {display}
    </span>
  );
}

// Legacy alias kept for internal use
function StatusPill({ value }) { return <StatusBadge value={value} />; }

const SOURCE_META = {
  admin_action:  { label: 'Admin Edit',    color: 'text-orange-400' },
  audit_log:     { label: 'Admin Action',  color: 'text-indigo-400' },
  login:         { label: 'Login',         color: 'text-emerald-400' },
  impersonation: { label: 'Impersonation', color: 'text-yellow-400' },
};

// Role color ring for avatar
function roleRingColor(role) {
  if (!role) return 'ring-gray-600';
  if (role === 'helper' || role === 'helper_pro' || role === 'broker') return 'ring-orange-500';
  if (role === 'customer') return 'ring-blue-500';
  if (role === 'admin' || role === 'super_admin') return 'ring-purple-500';
  return 'ring-gray-600';
}

// Compact section card with consistent header style
function SectionCard({ icon: Icon, title, subtitle, children, collapsible = false, defaultOpen = false, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`bg-[#111318] border border-gray-800 rounded-2xl overflow-hidden ${className}`}>
      {collapsible ? (
        <button
          onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-3">
            {Icon && <Icon size={16} className="text-gray-400 shrink-0" />}
            <div>
              <span className="text-sm font-semibold text-white">{title}</span>
              {subtitle && <span className="text-xs text-gray-500 ml-2">{subtitle}</span>}
            </div>
          </div>
          <ChevronDown size={15} className={`text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            {Icon && <Icon size={16} className="text-gray-400 shrink-0" />}
            <div>
              <span className="text-sm font-semibold text-white">{title}</span>
              {subtitle && <span className="text-xs text-gray-500 ml-2">{subtitle}</span>}
            </div>
          </div>
        </div>
      )}
      {(!collapsible || open) && (
        <div className="px-5 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

// Actions dropdown component
function ActionsDropdown({ children, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 border border-gray-600"
      >
        <MoreVertical size={13} />Actions
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#1a1d24] border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownItem({ icon: Icon, label, onClick, danger = false, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed
        ${danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-gray-300 hover:bg-white/5'
        }`}
    >
      {Icon && <Icon size={13} className="shrink-0" />}
      {label}
    </button>
  );
}

function DropdownDivider() {
  return <div className="my-1 border-t border-gray-700/60" />;
}

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

  // flash() accepts either a plain string or { title, detail, items[] }
  const flash = (type, content) => {
    const msg = typeof content === 'string' ? { title: content } : content;
    setMessage({ type, ...msg });
    setTimeout(() => setMessage(null), 8000);
  };

  // Extract a rich error object from an Axios error response
  const parseApiError = (err, fallback = 'Action failed.') => {
    const data = err?.response?.data;
    if (!data) return { title: err?.message || fallback };
    const title = data.error || fallback;
    const detail = data.detail || null;
    const items = data.activeJobs?.map(j => `${j.title} (${j.status})`)
      || data.fields
      || null;
    return { title, detail, items };
  };

  const doAction = async (endpoint, payload = {}, label = '') => {
    if (!window.confirm(`Confirm: ${label}?`)) return;
    setWorking(true); setMessage(null);
    try {
      const { data: res } = await adminApi.post(`/admin/users/${userId}/${endpoint}`, payload);
      flash('success', res.message); fetchUser();
    } catch (err) { flash('error', parseApiError(err, `${label || 'Action'} failed.`)); }
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
      flash('error', parseApiError(err, 'Failed to create impersonation session.'));
    } finally { setImpersonating(false); }
  };

  // ── name save ─────────────────────────────────────────────────────────────

  const saveName = async (e) => {
    e.preventDefault(); setNameSaving(true); setMessage(null);
    try {
      const { data: res } = await adminApi.put(`/admin/users/${userId}/name`, nameForm);
      flash('success', res.message); setShowNameEdit(false); fetchUser();
    } catch (err) { flash('error', parseApiError(err, 'Name update failed.')); }
    finally { setNameSaving(false); }
  };

  // ── profile save ──────────────────────────────────────────────────────────

  const saveProfile = async (e) => {
    e.preventDefault(); setProfileSaving(true); setMessage(null);
    try {
      const { data: res } = await adminApi.put(`/admin/users/${userId}/profile`, profileForm);
      flash('success', res.message || 'Profile updated.'); setShowProfileEdit(false); fetchUser();
    } catch (err) { flash('error', parseApiError(err, 'Profile update failed.')); }
    finally { setProfileSaving(false); }
  };

  // ── role ──────────────────────────────────────────────────────────────────

  const changeRole = async (role) => {
    if (!window.confirm(`Change role to ${role}?`)) return;
    setWorking(true);
    try {
      const { data: res } = await adminApi.put(`/admin/users/${userId}/role`, { role });
      flash('success', res.message); fetchUser();
    } catch (err) { flash('error', parseApiError(err, 'Role change failed.')); }
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
    } catch (err) { flash('error', parseApiError(err, `${statusModal?.action || 'Action'} failed.`)); }
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
    } catch (err) { flash('error', parseApiError(err, 'Failed to add note.')); }
    finally { setNoteSaving(false); }
  };

  const saveEditNote = async (e) => {
    e.preventDefault();
    if (!editNote?.text?.trim()) return;
    try {
      await adminApi.put(`/admin/users/${userId}/notes/${editNote.id}`, { note_text: editNote.text });
      setNotes(prev => prev.map(n => n.id === editNote.id ? { ...n, note_text: editNote.text } : n));
      setEditNote(null);
    } catch (err) { flash('error', parseApiError(err, 'Failed to update note.')); }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await adminApi.delete(`/admin/users/${userId}/notes/${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) { flash('error', parseApiError(err, 'Failed to delete note.')); }
  };

  // ── didit ─────────────────────────────────────────────────────────────────

  const setDiditEnforcement = async (required) => {
    if (!window.confirm(t(required ? 'admin.diditRequireConfirm' : 'admin.diditRelaxConfirm'))) return;
    setDiditSaving(true);
    try {
      await adminApi.put(`/admin/users/${userId}/didit-enforcement`, { required });
      flash('success', t('admin.diditEnforcementUpdated')); fetchUser();
    } catch (err) { flash('error', parseApiError(err, t('admin.diditEnforcementFailed'))); }
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
    } catch (err) { flash('error', parseApiError(err, 'Failed to remove credential.')); }
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

  // ── delete (now soft-delete with 30-day window) ───────────────────────────

  const deleteUserAccount = async () => {
    const user = data?.user;
    if (!user) return;
    // Step 1: confirm intent
    if (!window.confirm(
      `Schedule deletion for ${user.email}?\n\nThe account will be locked immediately. Data will be permanently removed after 30 days. You can restore the account within that window.`
    )) return;
    // Step 2: type the email to confirm identity
    const typed = window.prompt('Type the user\'s email address to confirm:', '');
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== (user.email ?? '').toLowerCase()) {
      flash('error', 'Email address did not match. Deletion cancelled.');
      return;
    }
    // Step 3: reason
    const reason = window.prompt('Reason for deletion (required):', '') ?? '';
    if (!reason.trim()) { flash('error', 'A reason is required.'); return; }

    setWorking(true);
    try {
      const { data: res } = await adminApi.delete(`/admin/users/${userId}`, {
        data: { reason: reason.trim() },
      });
      flash('success', res.message);
      fetchUser();
    } catch (err) {
      const serverErr = err.response?.data;
      if (serverErr?.canForce && serverErr?.activeJobs) {
        // Active jobs — ask admin to force-override
        const jobList = serverErr.activeJobs.map(j => `• ${j.title} (${j.status})`).join('\n');
        const forceIt = window.confirm(
          `This user has ${serverErr.activeJobs.length} active job(s):\n${jobList}\n\nForce deletion anyway? Their counterparties will lose access to these job records.`
        );
        if (forceIt) {
          try {
            const { data: res2 } = await adminApi.delete(`/admin/users/${userId}`, {
              data: { reason: reason.trim(), force: true },
            });
            flash('success', res2.message);
            fetchUser();
          } catch (e2) {
            flash('error', parseApiError(e2, 'Forced deletion failed.'));
          }
        }
      } else if (serverErr?.canForce && serverErr?.pendingPaymentCount) {
        // Pending payments — same force pattern
        const forceIt = window.confirm(
          `This user has ${serverErr.pendingPaymentCount} pending payment(s).\n\nForce deletion anyway? Pending funds may become unrecoverable.`
        );
        if (forceIt) {
          try {
            const { data: res2 } = await adminApi.delete(`/admin/users/${userId}`, {
              data: { reason: reason.trim(), force: true },
            });
            flash('success', res2.message);
            fetchUser();
          } catch (e2) {
            flash('error', parseApiError(e2, 'Forced deletion failed.'));
          }
        }
      } else {
        flash('error', parseApiError(err, 'Failed to schedule deletion.'));
      }
    }
    setWorking(false);
  };

  const restoreUserAccount = async () => {
    const user = data?.user;
    if (!user) return;
    const reason = window.prompt(`Reason for restoring ${user.email}:`, '') ?? '';
    if (!reason.trim()) { flash('error', { title: 'A reason is required to restore an account.' }); return; }
    setWorking(true);
    try {
      const { data: res } = await adminApi.post(`/admin/users/${userId}/restore`, { reason: reason.trim() });
      flash('success', res.message);
      fetchUser();
    } catch (err) {
      flash('error', parseApiError(err, 'Failed to restore account.'));
    }
    finally { setWorking(false); }
  };

  // ── render guards ─────────────────────────────────────────────────────────

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-48">
      <Loader2 size={20} className="animate-spin text-gray-500" />
    </div>
  );

  if (error) return (
    <div className="p-6 sm:p-8">
      <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 max-w-lg">
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

  const ringColor = roleRingColor(user.role);

  // Human-readable didit status label
  const diditStatusLabel = (() => {
    const s = (user.didit_status || 'pending').toLowerCase();
    const map = { verified: 'Verified', pending: 'Pending', skipped: 'Skipped', failed: 'Failed', none: 'Not Started' };
    return map[s] || humanize(s);
  })();

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-6" style={{ background: 'transparent' }}>

      {/* Back link */}
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition">
        <ChevronLeft size={14} />Back to Users
      </Link>

      {/* ── PROFILE HEADER CARD ─────────────────────────────────────────── */}
      <div className="bg-[#111318] border border-gray-800 rounded-2xl p-5 sm:p-6">

        {/* Top row: avatar + info + actions */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">

          {/* Circular avatar with role-color ring */}
          <div className="shrink-0">
            <img
              src={user.avatar_url || '/default-avatar.png'}
              alt=""
              className={`w-20 h-20 rounded-full object-cover ring-2 ${ringColor} ring-offset-2 ring-offset-[#111318]`}
            />
          </div>

          {/* Name + metadata */}
          <div className="flex-1 min-w-0">

            {/* Name row with pencil-icon inline edit */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
                {user.first_name} {user.last_name}
              </h1>
              {isAdmin && !showNameEdit && (
                <button
                  onClick={() => { setShowNameEdit(true); setNameForm({ first_name: user.first_name || '', last_name: user.last_name || '' }); }}
                  className="p-1 rounded text-gray-600 hover:text-gray-400 transition"
                  title="Edit name"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>

            {/* Inline name edit form */}
            {showNameEdit && (
              <form onSubmit={saveName} className="flex flex-wrap items-center gap-2 mb-3">
                <input
                  value={nameForm.first_name}
                  onChange={e => setNameForm(f => ({ ...f, first_name: e.target.value }))}
                  placeholder="First name"
                  required
                  className="px-2.5 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm w-32 focus:outline-none focus:border-orange-500"
                />
                <input
                  value={nameForm.last_name}
                  onChange={e => setNameForm(f => ({ ...f, last_name: e.target.value }))}
                  placeholder="Last name"
                  required
                  className="px-2.5 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm w-32 focus:outline-none focus:border-orange-500"
                />
                <button type="submit" disabled={nameSaving} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded-lg font-semibold transition disabled:opacity-50">
                  {nameSaving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowNameEdit(false)} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition">
                  Cancel
                </button>
              </form>
            )}

            <p className="text-gray-400 text-sm">{user.email}</p>

            {/* Contact + metadata row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-gray-500">
              {user.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone size={12} className="text-gray-600" />{user.phone}
                </span>
              )}
              {(user.city || user.state) && (
                <span className="flex items-center gap-1.5">
                  <MapPin size={12} className="text-gray-600" />{[user.city, user.state, user.country].filter(Boolean).join(', ')}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Calendar size={12} className="text-gray-600" />Joined {formatDateShort(user.created_at)}
              </span>
              {user.last_login_at && (
                <span className="flex items-center gap-1.5">
                  <Wifi size={12} className="text-gray-600" />Last login {formatDate(user.last_login_at)}
                  {user.last_login_ip && <span className="text-gray-600">· {String(user.last_login_ip)}</span>}
                </span>
              )}
            </div>

            {/* Profile completion progress bar */}
            <div className="mt-4 max-w-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-500 flex items-center gap-1"><Eye size={11} />Profile completion</span>
                <span className={`text-xs font-semibold ${profilePct < 60 ? 'text-yellow-400' : 'text-emerald-400'}`}>{profilePct}%</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${profilePct < 60 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  style={{ width: `${profilePct}%` }}
                />
              </div>
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <StatusBadge value={user.role} label={humanize(user.role)} />
              {user.plan_slug && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30 capitalize">
                  {user.plan_slug}
                </span>
              )}
              <StatusBadge value={accountStatus} />
              {user.id_verified && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30">
                  <CheckCircle size={10} />ID Verified
                </span>
              )}
              {user.background_check_status === 'passed' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                  <CheckCircle size={10} />Background Check
                </span>
              )}
              <StatusBadge
                value={user.didit_status || 'pending'}
                label={`ID Verification: ${diditStatusLabel}`}
              />
              {user.didit_enforcement_required && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
                  {t('admin.diditEnforcementOn')}
                </span>
              )}
              {user.is_restricted && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30">
                  <AlertTriangle size={10} />Restricted
                </span>
              )}
              {(user.warning_count > 0) && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30">
                  {user.warning_count} warning{user.warning_count > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Suspension / restriction notices */}
            {user.is_suspended && (
              <p className="text-xs text-yellow-400 mt-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 inline-block">
                Suspended until: {user.suspended_until ? formatDate(user.suspended_until) : 'indefinite'}
                {user.suspension_reason && ` - ${user.suspension_reason}`}
              </p>
            )}
            {user.is_restricted && user.restriction_reason && (
              <p className="text-xs text-orange-400 mt-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2 inline-block">
                Restriction: {user.restriction_reason}
              </p>
            )}
          </div>

          {/* ── Action buttons: primary + secondary + dropdown ─────────── */}
          <div className="flex flex-wrap sm:flex-nowrap items-start gap-2 sm:shrink-0">

            {/* Primary: Login as User */}
            {isSuper && !['admin', 'super_admin'].includes(user.role) && (
              <button
                onClick={startImpersonation}
                disabled={impersonating || working}
                className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 shadow-md shadow-orange-900/30"
                title="Open a new tab logged in as this user (audited)"
              >
                {impersonating ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                Login as User
              </button>
            )}

            {/* Secondary: Message */}
            <button
              onClick={() => setShowMsgModal(true)}
              disabled={['admin', 'super_admin'].includes(user.role)}
              className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-gray-600 text-gray-300 hover:border-gray-400 hover:text-white rounded-lg text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MessageSquare size={13} />Message
            </button>

            {/* Actions dropdown: destructive + admin actions */}
            {isSuper && (
              <ActionsDropdown disabled={working}>
                {/* Status actions */}
                {accountStatus === 'active' ? (
                  <>
                    <DropdownItem
                      icon={Clock}
                      label="Suspend"
                      onClick={() => { setStatusModal({ action: 'suspend' }); setStatusReason(''); setSuspendDays(7); }}
                    />
                    <DropdownItem
                      icon={Lock}
                      label="Restrict"
                      onClick={() => { setStatusModal({ action: 'restrict' }); setStatusReason(''); }}
                    />
                  </>
                ) : (
                  <DropdownItem
                    icon={RotateCcw}
                    label="Reactivate"
                    onClick={() => { setStatusModal({ action: 'reactivate' }); setStatusReason(''); }}
                  />
                )}
                <DropdownItem
                  icon={AlertTriangle}
                  label="Warn"
                  onClick={() => { setStatusModal({ action: 'warn' }); setStatusReason(''); }}
                />

                <DropdownDivider />

                {/* Verification */}
                <DropdownItem
                  icon={Shield}
                  label={t('admin.verifyIdButton')}
                  onClick={() => doAction('verify', { field: 'is_identity_verified' }, t('admin.verifyIdConfirm'))}
                  disabled={user.didit_status === 'verified' && user.id_verified}
                />
                <DropdownItem
                  icon={CheckCircle}
                  label={t('admin.verifyBgButton')}
                  onClick={() => doAction('verify', { field: 'is_background_checked' }, t('admin.verifyBgConfirm'))}
                  disabled={user.background_check_passed && user.background_check_status === 'passed'}
                />

                <DropdownDivider />

                {/* Ban / Unban */}
                <DropdownItem
                  icon={user.is_active ? Ban : CheckCircle}
                  label={user.is_active ? 'Ban User' : 'Unban User'}
                  onClick={() => doAction('ban', { reason: window.prompt(t('admin.optionalReason')) || '' }, user.is_active ? 'Ban this user' : 'Unban this user')}
                  danger={user.is_active}
                />

                {/* Delete / Restore — show restore for any admin-scheduled pending row (not self); type may be NULL on legacy DBs */}
                {!['admin', 'super_admin'].includes(user.role) && me?.id !== user.id && (
                  user.deletion_scheduled_at && user.deletion_type !== 'self'
                    ? (
                      <DropdownItem
                        icon={RotateCcw}
                        label="Restore Account"
                        onClick={restoreUserAccount}
                      />
                    ) : !user.deletion_scheduled_at && (
                      <DropdownItem
                        icon={Trash2}
                        label="Schedule Deletion (30-day window)"
                        onClick={deleteUserAccount}
                        danger
                      />
                    )
                )}
              </ActionsDropdown>
            )}

            {/* Role selector */}
            {isSuper && (
              <select
                onChange={e => e.target.value && changeRole(e.target.value)}
                defaultValue=""
                disabled={working}
                className="px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg focus:outline-none focus:border-orange-500"
              >
                <option value="">Change Role</option>
                {['customer', 'helper', 'helper_pro', 'broker', 'admin'].map(r => (
                  <option key={r} value={r} className="capitalize">{r}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Deletion status banner */}
        {user.deletion_scheduled_at && (
          <div className="mt-5 pt-5 border-t border-gray-800">
            {(() => {
              const scheduledFor = new Date(user.deletion_scheduled_at);
              const now = new Date();
              const daysLeft = Math.max(0, Math.ceil((scheduledFor - now) / (1000 * 60 * 60 * 24)));
              const expired = now >= scheduledFor;
              return (
                <div className={`rounded-xl border p-4 flex flex-wrap items-start gap-4 ${
                  expired
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-orange-500/10 border-orange-500/30'
                }`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className={`w-4 h-4 shrink-0 ${expired ? 'text-red-400' : 'text-orange-400'}`} />
                      <span className={`text-sm font-semibold ${expired ? 'text-red-300' : 'text-orange-300'}`}>
                        {expired ? 'Permanent deletion overdue' : `Scheduled for permanent deletion — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 ml-6">
                      {expired
                        ? `This account was scheduled for permanent deletion on ${formatDate(user.deletion_scheduled_at)}. The cleanup job has not yet run.`
                        : `Account locked on ${formatDate(user.deleted_at)}. All data permanently removed on ${formatDate(user.deletion_scheduled_at)}.`
                      }
                    </p>
                    {user.deletion_reason && (
                      <p className="text-xs text-gray-500 mt-1 ml-6">Reason: {user.deletion_reason}</p>
                    )}
                    {user.deletion_type && (
                      <p className="text-xs text-gray-500 mt-0.5 ml-6">
                        Deletion type: <span className="capitalize">{user.deletion_type}</span>
                        {user.was_banned_at_deletion && ' · User was banned at time of deletion'}
                      </p>
                    )}
                  </div>
                  {isSuper && !expired && user.deletion_type === 'admin' && (
                    <button
                      onClick={restoreUserAccount}
                      disabled={working}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore Account
                    </button>
                  )}
                  {user.deletion_type === 'self' && (
                    <span className="shrink-0 text-xs text-gray-500 italic">
                      Self-deleted — not restorable
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ID Verification enforcement — status + toggle (not two competing buttons) */}
        {isAdmin && !['admin', 'super_admin'].includes(user.role) && (
          <div className="mt-5 pt-5 border-t border-gray-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">ID Verification Enforcement</span>
              <StatusBadge
                value={user.didit_enforcement_required ? 'active' : 'none'}
                label={user.didit_enforcement_required ? 'Required' : 'Optional'}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={diditSaving || user.didit_enforcement_required}
                onClick={() => setDiditEnforcement(true)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Make Required
              </button>
              <button
                type="button"
                disabled={diditSaving || !user.didit_enforcement_required}
                onClick={() => setDiditEnforcement(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-700/50 text-gray-400 hover:bg-gray-700 border border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Make Optional
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Flash message */}
      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/10 border border-red-500/30 text-red-300'
        }`}>
          <p className="font-semibold">{message.title || message.text}</p>
          {message.detail && (
            <p className="mt-1 opacity-80 text-xs">{message.detail}</p>
          )}
          {message.items?.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs opacity-80">
              {message.items.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── STATS GRID ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Rating',         value: user.average_rating ? `${parseFloat(user.average_rating).toFixed(1)} ★` : null, badge: null },
          { label: 'Jobs Completed', value: user.completed_jobs ?? 0, badge: null },
          { label: 'Total Earnings', value: user.earnings_total ? `$${parseFloat(user.earnings_total).toFixed(2)}` : null, badge: null },
          { label: 'Background Check', value: null, badge: user.background_check_status || 'not_submitted' },
        ].map(({ label, value, badge }) => (
          <div key={label} className="bg-[#111318] border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</p>
            {badge ? (
              <StatusBadge value={badge} />
            ) : (
              <p className={`font-bold text-white ${value === null || value === '—' ? 'text-sm text-gray-500' : 'text-xl sm:text-2xl'}`}>
                {value ?? '—'}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── PASSWORD RESET — compact row, not full card ─────────────────── */}
      {isSuper && (
        <div className="bg-[#111318] border border-gray-800 rounded-2xl">
          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <KeyRound size={15} className="text-gray-400" />
              <span className="text-sm font-semibold text-white">{t('admin.setPasswordSectionTitle')}</span>
              <span className="text-xs text-gray-500 hidden sm:inline">{t('admin.setPasswordSectionHint')}</span>
            </div>
            {!showPwReset && (
              <button
                type="button"
                onClick={() => { setShowPwReset(true); setNewPw(''); setConfirmPw(''); setMessage(null); }}
                className="px-3 py-1.5 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg text-xs font-semibold transition"
              >
                {t('admin.setPasswordOpen')}
              </button>
            )}
          </div>
          {showPwReset && (
            <div className="px-5 pb-5 border-t border-gray-800 pt-4">
              <form onSubmit={submitSuperAdminPassword} className="space-y-3 max-w-md">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder={t('admin.setPasswordNew')}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder={t('admin.setPasswordRepeat')}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={pwSaving}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
                  >
                    {pwSaving ? t('admin.setPasswordSaving') : t('admin.setPasswordSubmit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowPwReset(false); setNewPw(''); setConfirmPw(''); }}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition"
                  >
                    {t('admin.setPasswordCancel')}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ── CREDENTIALS ────────────────────────────────────────────────────── */}
      {user.role && ['helper', 'helper_pro', 'broker'].includes(user.role) && (
        <SectionCard icon={FileCheck} title="Self-Reported Credentials">
          <div className="space-y-3">
            {[
              { type: 'license',   label: 'Professional License', claimed: user.is_licensed, cls: 'text-sky-400'   },
              { type: 'insurance', label: 'Insurance',            claimed: user.is_insured,  cls: 'text-amber-400' },
            ].map(({ type, label, claimed, cls }) => (
              <div key={type} className="flex items-center justify-between p-3 bg-gray-700/20 rounded-xl border border-gray-700/60">
                <div className="flex items-center gap-3">
                  <FileCheck size={15} className={claimed ? cls : 'text-gray-600'} />
                  <div>
                    <p className="text-sm text-white font-medium">{label}</p>
                    <p className={`text-xs mt-0.5 ${claimed ? cls : 'text-gray-500'}`}>{claimed ? 'Claimed' : 'Not claimed'}</p>
                  </div>
                </div>
                {claimed && isSuper && (
                  <button
                    onClick={() => setCredentialModal({ type })}
                    disabled={credentialSaving}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Trash2 size={12} />Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── EDIT PROFILE ON BEHALF OF USER ─────────────────────────────── */}
      {isSuper && (
        <SectionCard icon={Edit3} title="Edit Profile on Behalf of User" collapsible defaultOpen={false}>
          <form onSubmit={saveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { field: 'email',   label: 'Email',   type: 'email' },
              { field: 'phone',   label: 'Phone',   type: 'tel'   },
              { field: 'city',    label: 'City',    type: 'text'  },
              { field: 'state',   label: 'State',   type: 'text'  },
              { field: 'country', label: 'Country', type: 'text'  },
            ].map(({ field, label, type }) => (
              <div key={field}>
                <label className="block text-xs text-gray-400 mb-1">{label}</label>
                <input
                  type={type}
                  value={profileForm[field]}
                  onChange={e => setProfileForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Bio</label>
              <textarea
                rows={3}
                value={profileForm.bio}
                onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500 resize-none"
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="submit"
                disabled={profileSaving}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
              >
                {profileSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save Profile
              </button>
              <button
                type="button"
                onClick={() => setShowProfileEdit(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </SectionCard>
      )}

      {/* ── SUPPORT TICKETS ─────────────────────────────────────────────── */}
      {isAdmin && (
        <SectionCard
          icon={ClipboardList}
          title="Support Tickets"
          collapsible
          defaultOpen={false}
        >
          {/* Load on open */}
          {(() => {
            if (!ticketsLoaded && !showTickets) {
              return (
                <button
                  onClick={() => { setShowTickets(true); loadTickets(); }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                >
                  Load tickets
                </button>
              );
            }
            if (!ticketsLoaded) {
              return <div className="flex items-center gap-2 text-gray-500 text-sm py-2"><Loader2 size={14} className="animate-spin" />Loading…</div>;
            }
            if (tickets.length === 0) {
              return <p className="text-gray-500 text-sm py-2">No support tickets found.</p>;
            }
            return (
              <div className="space-y-2">
                {tickets.map(ticket => (
                  <div key={ticket.id} className="flex items-center justify-between gap-3 p-3 bg-gray-700/20 rounded-xl border border-gray-700/60">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate font-medium">{ticket.title || `Ticket #${ticket.ticket_number}`}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{formatDateShort(ticket.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge value={ticket.status} />
                      <StatusBadge value={ticket.priority} />
                      <Link to={`/admin/support/tickets/${ticket.id}`} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition">
                        <ExternalLink size={12} />View
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>
      )}

      {/* ── ADMIN NOTES ─────────────────────────────────────────────────── */}
      {isAdmin && (
        <SectionCard icon={StickyNote} title="Admin Notes" subtitle="(never shown to user)" collapsible defaultOpen={false}>
          <div className="space-y-4">
            <form onSubmit={addNote} className="flex flex-col gap-2">
              <textarea
                rows={2}
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Add an internal note about this user…"
                maxLength={4000}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">{newNote.length}/4000</span>
                <button
                  type="submit"
                  disabled={noteSaving || !newNote.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-40"
                >
                  {noteSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Add Note
                </button>
              </div>
            </form>
            {!notesLoaded ? (
              <button onClick={loadNotes} className="text-xs text-indigo-400 hover:text-indigo-300 transition">Load notes</button>
            ) : notes.length === 0 ? (
              <p className="text-gray-500 text-sm">No notes yet.</p>
            ) : (
              <div className="space-y-3">
                {notes.map(note => (
                  <div key={note.id} className="p-3 bg-gray-700/20 rounded-xl border border-gray-700/60">
                    {editNote?.id === note.id ? (
                      <form onSubmit={saveEditNote} className="flex flex-col gap-2">
                        <textarea
                          rows={3}
                          value={editNote.text}
                          onChange={e => setEditNote(n => ({ ...n, text: e.target.value }))}
                          maxLength={4000}
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500 resize-none"
                        />
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
                                <button onClick={() => setEditNote({ id: note.id, text: note.note_text })} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-0.5 bg-gray-700/60 rounded transition">Edit</button>
                                <button onClick={() => deleteNote(note.id)} className="text-xs text-red-500 hover:text-red-400 px-2 py-0.5 bg-gray-700/60 rounded transition">Delete</button>
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
        </SectionCard>
      )}

      {/* ── ACTIVITY LOG ─────────────────────────────────────────────────── */}
      {isAdmin && (
        <SectionCard
          icon={Activity}
          title="Activity Log"
          subtitle={activityTotal > 0 ? `(${activityTotal} events)` : ''}
          collapsible
          defaultOpen={false}
        >
          {!activityLoaded ? (
            <button
              onClick={() => { setShowActivity(true); loadActivity(); }}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition"
            >
              Load activity
            </button>
          ) : activity.length === 0 ? (
            <p className="text-gray-500 text-sm py-2">No activity recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {activity.map((evt, i) => {
                const meta = SOURCE_META[evt.source] || { label: evt.source, color: 'text-gray-400' };
                return (
                  <div key={evt.id || i} className="flex items-start gap-3 p-3 bg-gray-700/20 rounded-xl border border-gray-700/50">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <span className={`text-xs font-semibold uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
                        <span className="text-xs text-gray-300 font-medium">{humanize(evt.event_type)}</span>
                        {evt.field_name && <span className="text-xs text-gray-500">field: <code className="text-gray-400">{evt.field_name}</code></span>}
                      </div>
                      {(evt.old_value || evt.new_value) && (
                        <p className="text-xs text-gray-500 mb-0.5">
                          {evt.old_value && <span>From: <em className="text-gray-400">{evt.old_value}</em> </span>}
                          {evt.new_value && <span>to <em className="text-gray-300">{evt.new_value}</em></span>}
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
        </SectionCard>
      )}

      {/* ── TWO-COLUMN ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        <SectionCard title="Recent Jobs">
          {recentJobs.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No jobs yet.</p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map(job => (
                <div key={job.id} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{job.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDateShort(job.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.final_price && <span className="text-xs text-gray-400">${parseFloat(job.final_price).toFixed(2)}</span>}
                    <StatusBadge value={job.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Billing History">
          {billing.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No billing history.</p>
          ) : (
            <div className="space-y-3">
              {billing.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white capitalize">{humanize((item.event_type || '').replace('invoice.', ''))}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.period_start ? new Date(item.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-white">${((item.amount_cents || 0) / 100).toFixed(2)}</span>
                    <StatusBadge value={item.status} />
                    {item.invoice_url && (
                      <a href={item.invoice_url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 transition">
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {recentPayouts.length > 0 && (
          <SectionCard title="Recent Payouts">
            <div className="space-y-3">
              {recentPayouts.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{p.job_title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{p.completed_at ? formatDateShort(p.completed_at) : 'Pending'}</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-400 shrink-0">+${(p.net_to_helper_cents / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {isSuper && (
          <SectionCard title="Stripe Account">
            <div className="space-y-3 text-sm">
              {[
                { label: 'Account ID',      value: user.stripe_account_id || '—' },
                { label: 'Onboarding',      value: user.onboarding_complete ? '✓ Complete' : '✗ Incomplete' },
                { label: 'Charges Enabled', value: user.charges_enabled ? '✓ Yes' : '✗ No' },
                { label: 'Payouts Enabled', value: user.payouts_enabled  ? '✓ Yes' : '✗ No' },
                { label: 'Subscription ID', value: user.stripe_subscription_id || '—' },
                { label: 'Sub Status',      value: humanize(user.sub_status || user.subscription_status || 'none') },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between border-b border-gray-700/40 pb-2.5 last:border-0 last:pb-0">
                  <span className="text-gray-400 shrink-0">{label}</span>
                  <span className="text-white font-mono text-xs truncate max-w-[9rem] sm:max-w-40 text-right ml-2">{value}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* Message modal */}
      {showMsgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#1a1d24] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white flex items-center gap-2 text-sm"><MessageSquare size={15} className="text-indigo-400" />Message {user.first_name}</h2>
              <button onClick={() => { setShowMsgModal(false); setMsgText(''); }} className="text-gray-500 hover:text-white transition p-1 rounded"><X size={15} /></button>
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
              <textarea
                autoFocus required rows={5} maxLength={4000} value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={`Write a message to ${user.first_name}…`}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
              <div className="flex items-center justify-between mt-1 mb-4">
                <span className="text-xs text-gray-600">{msgText.length}/4000</span>
              </div>
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

      {/* Credential removal modal */}
      {credentialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1a1d24] border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="text-red-400 shrink-0" size={20} />
              <h2 className="text-white font-semibold text-base">Remove {credentialModal.type === 'license' ? 'Professional License' : 'Insurance'}</h2>
            </div>
            <form onSubmit={removeCredential}>
              <label className="block text-sm text-gray-400 mb-2">Reason <span className="text-red-400">*</span></label>
              <select value={credentialReason} onChange={e => setCredentialReason(e.target.value)} required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 mb-4 text-sm focus:border-orange-500 focus:outline-none">
                <option value="">Select a reason…</option>
                <option value="unverified">Unverified / No documentation</option>
                <option value="expired">License / Insurance expired</option>
                <option value="false_claim">False or fraudulent claim</option>
                <option value="user_report">Helper self-reported issue</option>
                <option value="other">Other (see notes below)</option>
              </select>
              <label className="block text-sm text-gray-400 mb-2">Notes <span className="text-gray-600">(optional)</span></label>
              <textarea value={credentialNotes} onChange={e => setCredentialNotes(e.target.value)} rows={2} maxLength={255}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:border-orange-500 focus:outline-none resize-none" />
              <p className="text-xs text-gray-600 mb-4">{credentialNotes.length}/255</p>
              <div className="flex gap-3">
                <button type="submit" disabled={credentialSaving || !credentialReason}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold transition">
                  {credentialSaving ? 'Removing…' : 'Remove Credential'}
                </button>
                <button type="button" onClick={() => { setCredentialModal(null); setCredentialReason(''); setCredentialNotes(''); }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Status action modal (Suspend / Restrict / Warn / Reactivate) */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1a1d24] border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              {{ suspend: <Clock className="text-yellow-400" size={20} />, restrict: <Lock className="text-orange-400" size={20} />, warn: <AlertTriangle className="text-amber-400" size={20} />, reactivate: <RotateCcw className="text-emerald-400" size={20} /> }[statusModal.action]}
              <h2 className="text-white font-semibold text-base capitalize">{statusModal.action} Account</h2>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              {{ suspend: 'User will be logged out and cannot log in until the suspension lifts.', restrict: 'User can log in but cannot post jobs or submit bids.', warn: "An official warning will be sent to the user's inbox.", reactivate: 'Lifts any suspension, restriction, and ban.' }[statusModal.action]}
            </p>
            <form onSubmit={submitStatusAction}>
              {statusModal.action === 'suspend' && (
                <div className="mb-3">
                  <label className="block text-sm text-gray-400 mb-1">Duration</label>
                  <select value={suspendDays} onChange={e => setSuspendDays(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                    {[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
                    <option value={0}>Indefinite</option>
                  </select>
                </div>
              )}
              <label className="block text-sm text-gray-400 mb-2">
                {statusModal.action === 'reactivate' ? 'Notes (optional)' : <>Reason <span className="text-red-400">*</span></>}
              </label>
              <textarea
                value={statusReason}
                onChange={e => setStatusReason(e.target.value)}
                rows={3}
                maxLength={500}
                required={statusModal.action !== 'reactivate'}
                placeholder={statusModal.action === 'reactivate' ? 'Reason for reactivation…' : `Reason for ${statusModal.action}…`}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:border-orange-500 focus:outline-none resize-none"
              />
              <p className="text-xs text-gray-600 mb-4">{statusReason.length}/500</p>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={statusSaving || (statusModal.action !== 'reactivate' && !statusReason.trim())}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50 text-white ${{ suspend: 'bg-yellow-700 hover:bg-yellow-600', restrict: 'bg-orange-700 hover:bg-orange-600', warn: 'bg-amber-700 hover:bg-amber-600', reactivate: 'bg-emerald-700 hover:bg-emerald-600' }[statusModal.action]}`}
                >
                  {statusSaving ? 'Processing…' : `Confirm ${humanize(statusModal.action)}`}
                </button>
                <button type="button" onClick={() => { setStatusModal(null); setStatusReason(''); }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
