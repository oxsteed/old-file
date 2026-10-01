import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bell, Building2, CalendarClock, CheckCircle2, CheckSquare, ChevronLeft, ChevronRight, Download, Eye, EyeOff, History, MonitorPlay, RefreshCw, Save, Search, ShieldCheck, Store, Trash2, Undo2, User, X } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import { useAuth } from '../../hooks/useAuth';
import ConfirmDialog from '../lib/ConfirmDialog';

// Super-admin: public profile visibility control for helpers, businesses, and
// restaurants. Hiding here sets a sticky admin override (is_hidden_by_admin)
// that the public profile endpoints honor even if the owner re-lists their
// own profile. Use it for incomplete profiles or non-compliance.
//
// Extended controls (workstream C):
//  - Profile preview (public canonical page in an iframe) before acting.
//  - Active-work warnings before hiding, with acknowledgement or a
//    second-admin approval request.
//  - Scheduled hide/restore with IANA time zones (server-side worker).
//  - Second-admin approval workflow for high-risk single/bulk changes.
//  - Bulk changes through POST /bulk with dry-run preview and a single
//    idempotency key per bulk operation.
//  - Undo of the most recent visibility change.
//  - Saved filter views (localStorage) and server-side "export all".
//  - Owner notification delivery status in the history panel.

const TYPE_META = {
  helper: { Icon: User },
  business: { Icon: Building2 },
  restaurant: { Icon: Store },
};

const REASONS = ['incomplete_profile', 'non_compliance', 'admin_decision', 'other'];

const SAVED_VIEWS_KEY = 'pv-saved-views';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Sao_Paulo',
  'America/Port-au-Prince', 'Atlantic/Azores', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Athens', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

function loadSavedViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Convert a "YYYY-MM-DDTHH:mm" wall time in an IANA zone to an ISO instant.
// Refines twice so DST transitions land on the correct offset.
function wallTimeToIso(wall, timeZone) {
  const zoneOffsetMinutes = (date) => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = {};
    for (const part of dtf.formatToParts(date)) parts[part.type] = part.value;
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    return (asUTC - date.getTime()) / 60000;
  };
  let guess = new Date(`${wall}:00Z`).getTime();
  for (let i = 0; i < 2; i += 1) guess -= zoneOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess).toISOString();
}

// Accessible modal shell: Escape closes, focus moves in on open and is
// restored on close. Parent supplies role/aria via labelledBy.
function Modal({ labelledBy, title, onClose, wide, children }) {
  const ref = useRef(null);
  const previouslyFocused = useRef(null);
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    const timer = window.setTimeout(() => {
      const firstFocusable = ref.current?.querySelector(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (firstFocusable || ref.current)?.focus();
    }, 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused.current?.focus) previouslyFocused.current.focus();
    };
  }, [onClose]);
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: '1rem' }}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%', maxWidth: wide ? '64rem' : '32rem', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: '12px', padding: '1.5rem', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <h2 id={labelledBy} style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text)' }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0.25rem' }}>
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ProfileVisibilityPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const copy = useCallback((key, options) => t(`adminProfileVisibility.${key}`, options), [t]);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ page: 1, limit: 25, total: 0, hasMore: false });
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const searchRequest = useRef(0);

  // Single hide/restore flow
  const [hideTarget, setHideTarget] = useState(null); // profile row being hidden
  const [hideReason, setHideReason] = useState('incomplete_profile');
  const [hideNote, setHideNote] = useState('');
  const [hideWork, setHideWork] = useState(null); // active-work result for hideTarget
  const [hideWorkLoading, setHideWorkLoading] = useState(false);
  const [hideAck, setHideAck] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [approvalNotice, setApprovalNotice] = useState(null); // pending-approval state

  // Preview
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // History + notifications + undo
  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [undoTarget, setUndoTarget] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState(null);

  // Scheduling
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [scheduleWhen, setScheduleWhen] = useState('');
  const [scheduleTz, setScheduleTz] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [scheduleAction, setScheduleAction] = useState('hide');
  const [scheduleReason, setScheduleReason] = useState('admin_decision');
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduleFormError, setScheduleFormError] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [scheduledActions, setScheduledActions] = useState([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);

  // Approvals
  const [showApprovals, setShowApprovals] = useState(false);
  const [approvals, setApprovals] = useState([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState({});
  const [reviewingId, setReviewingId] = useState(null);

  // Bulk
  const [dryRun, setDryRun] = useState(false);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkPendingApproval, setBulkPendingApproval] = useState(null);

  // Saved views + export
  const [savedViews, setSavedViews] = useState(loadSavedViews);
  const [viewName, setViewName] = useState('');
  const [exportingAll, setExportingAll] = useState(false);

  const search = useCallback(async (nextQuery, nextType, nextVisibility, nextPage = 1) => {
    const q = nextQuery.trim();
    const requestId = ++searchRequest.current;
    if (q.length === 1) {
      setResults([]);
      setSearched(false);
      setError('');
      setPageInfo({ page: 1, limit: 25, total: 0, hasMore: false });
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/admin/profile-visibility/search', {
        params: { q, type: nextType, visibility: nextVisibility, page: nextPage, limit: 25 },
      });
      if (requestId !== searchRequest.current) return;
      setResults(data.results || []);
      setPageInfo({
        page: data.page || nextPage,
        limit: data.limit || 25,
        total: data.total || 0,
        hasMore: !!data.hasMore,
      });
      setSearched(true);
      setSelected([]);
    } catch (err) {
      if (requestId !== searchRequest.current) return;
      logger.error('profile visibility search failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      if (requestId === searchRequest.current) setLoading(false);
    }
  }, [copy]);

  // Keep the explicit Search button for keyboard and assistive-technology
  // users, but also refresh after typing pauses so the list feels immediate.
  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) searchRequest.current += 1;
    if (trimmedQuery.length === 1) {
      // Invalidate an in-flight request so it cannot repopulate results after
      // the administrator clears or shortens the query.
      searchRequest.current += 1;
      setResults([]);
      setSearched(false);
      setError('');
      setLoading(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      search(trimmedQuery, typeFilter, visibilityFilter, page);
    }, trimmedQuery.length === 0 ? 0 : 350);

    return () => window.clearTimeout(timer);
  }, [query, typeFilter, visibilityFilter, page, search]);

  const refresh = () => search(query, typeFilter, visibilityFilter, page);
  const keyFor = (profile) => `${profile.profile_type}:${profile.profile_id}`;

  const reasonLabel = (reason) =>
    copy(`reason${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`, { defaultValue: reason });
  const typeLabel = (type) =>
    copy(`type${type.charAt(0).toUpperCase()}${type.slice(1)}`, { defaultValue: type });

  // ─── Preview ────────────────────────────────────────────────────────────
  const openPreview = useCallback(async (profile) => {
    setPreviewTarget(profile);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const { data } = await api.get(`/admin/profile-visibility/${profile.profile_type}/${profile.profile_id}/preview`);
      setPreviewData(data || {});
    } catch (err) {
      logger.error('profile visibility preview failed', { message: err.message });
      setPreviewData({ unavailable: true });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // ─── Single hide / restore ──────────────────────────────────────────────
  const markVisibilityApplied = useCallback((profile, isVisible, reason) => {
    setResults((prev) =>
      prev.map((r) =>
        r.profile_type === profile.profile_type && String(r.profile_id) === String(profile.profile_id)
          ? {
              ...r,
              is_hidden_by_admin: !isVisible,
              hidden_reason: isVisible ? null : reason,
              is_visible: isVisible && r.owner_visible,
            }
          : r
      )
    );
  }, []);

  const handleApprovalRequired = useCallback((data) => {
    // The server refused the direct change and asked for a second admin.
    setApprovalNotice({
      approvalId: data?.approval_id || data?.approvalId || null,
      hint: data?.hint || data?.error || null,
    });
  }, []);

  const applyVisibility = useCallback(async (profile, isVisible, reason, note) => {
    setSaving(true);
    setError('');
    try {
      await api.put('/admin/profile-visibility', {
        profile_type: profile.profile_type,
        profile_id: profile.profile_id,
        is_visible: isVisible,
        reason: isVisible ? undefined : reason,
        note: isVisible || !note?.trim() ? undefined : note.trim(),
      });
      markVisibilityApplied(profile, isVisible, reason);
      setHideTarget(null);
      setHideNote('');
      setHideWork(null);
      setHideAck(false);
      setRestoreTarget(null);
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data || {};
      if (status === 409 && (data.approval_required || data.approvalRequired)) {
        handleApprovalRequired(data);
      } else {
        logger.error('profile visibility update failed', { message: err.message });
        setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
      }
    } finally {
      setSaving(false);
    }
  }, [copy, handleApprovalRequired, markVisibilityApplied]);

  // Step 1 of hiding: check active work before confirming.
  const beginHideConfirm = useCallback(async (profile) => {
    const forKey = keyFor(profile);
    setHideWork(null);
    setHideAck(false);
    setApprovalNotice(null);
    setHideWorkLoading(true);
    try {
      const { data } = await api.get(`/admin/profile-visibility/${profile.profile_type}/${profile.profile_id}/active-work`);
      const work = data || { has_active_work: false };
      // Tag the result to its row so a slow response for a previously
      // opened form cannot surface under a different profile.
      setHideWork({ ...work, forKey });
      if (!work.has_active_work) {
        // No active work: hide immediately.
        await applyVisibility(profile, false, hideReason, hideNote);
      }
    } catch (err) {
      logger.error('active work check failed', { message: err.message });
      // Fail closed: keep the inline form open so the admin can still decide.
      setHideWork({ has_active_work: false, checkFailed: true, forKey });
    } finally {
      setHideWorkLoading(false);
    }
  }, [applyVisibility, hideNote, hideReason]);

  const hideAnyway = useCallback(async () => {
    if (!hideTarget || !hideAck) return;
    await applyVisibility(hideTarget, false, hideReason, hideNote);
  }, [applyVisibility, hideAck, hideNote, hideReason, hideTarget]);

  // Step 2 alternative: route the hide through a second-admin approval.
  const requestHideApproval = useCallback(async () => {
    if (!hideTarget) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/admin/profile-visibility/approvals/request', {
        action_type: 'single',
        payload: {
          profile_type: hideTarget.profile_type,
          profile_id: hideTarget.profile_id,
          is_visible: false,
          reason: hideReason,
          note: hideNote.trim() || undefined,
        },
        idempotency_key: crypto.randomUUID(),
      });
      setApprovalNotice({ approvalId: data?.approval?.id || null, requested: true });
      setHideTarget(null);
      setHideWork(null);
      setHideAck(false);
      setHideNote('');
      await loadApprovals();
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data || {};
      if (status === 409 && (data.approval_required || data.approvalRequired)) {
        handleApprovalRequired(data);
      } else {
        logger.error('hide approval request failed', { message: err.message });
        setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
      }
    } finally {
      setSaving(false);
    }
  }, [copy, handleApprovalRequired, hideNote, hideReason, hideTarget]);

  // ─── Schedule ───────────────────────────────────────────────────────────
  const openSchedule = useCallback((profile) => {
    setScheduleTarget(profile);
    setScheduleWhen('');
    setScheduleAction(profile.is_hidden_by_admin ? 'restore' : 'hide');
    setScheduleReason('admin_decision');
    setScheduleNote('');
    setScheduleFormError('');
  }, []);

  const submitSchedule = useCallback(async () => {
    if (!scheduleTarget || !scheduleWhen) {
      setScheduleFormError(copy('scheduleError', { defaultValue: 'Pick a date and time in the future.' }));
      return;
    }
    let iso;
    try {
      iso = wallTimeToIso(scheduleWhen, scheduleTz);
    } catch {
      setScheduleFormError(copy('scheduleError', { defaultValue: 'Pick a date and time in the future.' }));
      return;
    }
    if (Number.isNaN(Date.parse(iso)) || Date.parse(iso) <= Date.now()) {
      setScheduleFormError(copy('scheduleError', { defaultValue: 'Pick a date and time in the future.' }));
      return;
    }
    setScheduleSaving(true);
    setScheduleFormError('');
    try {
      await api.post('/admin/profile-visibility/schedule', {
        profile_type: scheduleTarget.profile_type,
        profile_id: scheduleTarget.profile_id,
        is_visible: scheduleAction === 'restore',
        scheduled_for: iso,
        timezone: scheduleTz,
        idempotency_key: crypto.randomUUID(),
        reason: scheduleAction === 'hide' ? scheduleReason : undefined,
        note: scheduleNote.trim() || undefined,
      });
      setScheduleTarget(null);
      setScheduleNote('');
      await loadScheduled();
    } catch (err) {
      logger.error('schedule visibility change failed', { message: err.message });
      setScheduleFormError(err?.response?.data?.error || copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setScheduleSaving(false);
    }
  }, [copy, scheduleAction, scheduleNote, scheduleReason, scheduleTarget, scheduleTz, scheduleWhen]);

  const loadScheduled = useCallback(async () => {
    setScheduledLoading(true);
    try {
      const { data } = await api.get('/admin/profile-visibility/scheduled');
      setScheduledActions(data.actions || data.scheduled_actions || []);
    } catch (err) {
      logger.error('scheduled actions load failed', { message: err.message });
    } finally {
      setScheduledLoading(false);
    }
  }, []);

  const cancelScheduled = useCallback(async (action) => {
    const id = action.id;
    if (!id) return;
    if (!window.confirm(copy('cancelScheduledConfirm', { defaultValue: 'Cancel this scheduled action?' }))) return;
    try {
      await api.delete(`/admin/profile-visibility/scheduled/${id}`);
      setScheduledActions((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      logger.error('cancel scheduled action failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    }
  }, [copy]);

  useEffect(() => {
    if (showScheduled) loadScheduled();
  }, [showScheduled, loadScheduled]);

  // ─── Approvals ──────────────────────────────────────────────────────────
  const loadApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const { data } = await api.get('/admin/profile-visibility/approvals', { params: { status: 'pending' } });
      setApprovals(data.approvals || []);
    } catch (err) {
      logger.error('approvals load failed', { message: err.message });
    } finally {
      setApprovalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showApprovals) loadApprovals();
  }, [showApprovals, loadApprovals]);

  const reviewApproval = useCallback(async (approval, decision) => {
    const id = approval.id;
    if (!id) return;
    setReviewingId(id);
    try {
      await api.post(`/admin/profile-visibility/approvals/${id}/review`, {
        decision,
        note: reviewNotes[id]?.trim() || undefined,
      });
      setApprovals((prev) => prev.filter((item) => item.id !== id));
      setReviewNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      logger.error('approval review failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setReviewingId(null);
    }
  }, [copy, reviewNotes]);

  const approvalRequesterId = (approval) => approval.requested_by ?? approval.requestedById ?? approval.requester_id ?? null;
  const approvalRequesterName = (approval) => approval.requested_by_name ?? approval.requestedByName ?? approval.requester_name ?? null;

  const summarizeApproval = useCallback((approval) => {
    const payload = approval.payload || {};
    const items = Array.isArray(payload.items) ? payload.items : null;
    const actionWord = (isVisible) => copy(isVisible ? 'approvalActionRestore' : 'approvalActionHide', { defaultValue: isVisible ? 'Restore profile' : 'Hide profile' });
    if (approval.action_type === 'bulk' && items) {
      return `${copy('bulkItem', { defaultValue: 'Profile' })}s: ${items.length}`;
    }
    if (approval.action_type === 'scheduled') {
      const when = payload.scheduled_for ? new Date(payload.scheduled_for).toLocaleString() : '';
      return copy('scheduledSummary', {
        action: actionWord(payload.is_visible ?? payload.isVisible),
        when,
        defaultValue: `${actionWord(payload.is_visible ?? payload.isVisible)} on ${when}`,
      });
    }
    const profileType = payload.profile_type ?? payload.profileType ?? '';
    const profileId = payload.profile_id ?? payload.profileId ?? '';
    return `${profileType} ${profileId} → ${actionWord(payload.is_visible ?? payload.isVisible)}`;
  }, [copy]);

  // ─── Bulk ───────────────────────────────────────────────────────────────
  const toggleSelected = (profile) => {
    const key = keyFor(profile);
    setSelected((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  };
  const toggleAll = () => {
    const keys = results.map(keyFor);
    setSelected((prev) => prev.length === keys.length ? [] : keys);
  };

  const bulkItemsFor = useCallback((targets, isVisible) => targets.map((profile) => ({
    profile_type: profile.profile_type,
    profile_id: profile.profile_id,
    is_visible: isVisible,
    reason: isVisible ? undefined : 'admin_decision',
  })), []);

  const bulkApply = useCallback(async (isVisible) => {
    if (!selected.length) return;
    const targets = results.filter((profile) => selected.includes(keyFor(profile)));
    const items = bulkItemsFor(targets, isVisible);
    const idempotencyKey = crypto.randomUUID();
    setError('');
    setBulkResults(null);
    setBulkPendingApproval(null);

    if (dryRun) {
      // Dry run: preview the resulting action per item, enriched with
      // active-work counts fetched per profile.
      setSaving(true);
      try {
        const { data } = await api.post('/admin/profile-visibility/bulk', {
          items,
          idempotency_key: idempotencyKey,
          dry_run: true,
        });
        const enriched = await Promise.all((data.results || []).map(async (result) => {
          try {
            const { data: work } = await api.get(
              `/admin/profile-visibility/${result.profile_type}/${result.profile_id}/active-work`,
            );
            return { ...result, work };
          } catch {
            return { ...result, work: null };
          }
        }));
        setBulkPreview({ isVisible, targets, items, idempotencyKey, results: enriched, approvalRequired: data.approval_required });
      } catch (err) {
        logger.error('bulk dry run failed', { message: err.message });
        setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!window.confirm(copy(isVisible ? 'bulkRestoreConfirm' : 'bulkHideConfirm', { count: targets.length, defaultValue: `Apply this action to ${targets.length} profiles?` }))) return;
    setSaving(true);
    try {
      const { data } = await api.post('/admin/profile-visibility/bulk', { items, idempotency_key: idempotencyKey });
      if (data.approval_required) {
        setBulkPendingApproval(data.approval_id || null);
      } else {
        setBulkResults(data);
        await refresh();
      }
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data || {};
      if (status === 409 && (data.approval_required || data.approvalRequired)) {
        setBulkPendingApproval(data.approval_id || data.approvalId || null);
      } else {
        logger.error('bulk profile visibility update failed', { message: err.message });
        setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
      }
    } finally {
      setSaving(false);
    }
  }, [bulkItemsFor, copy, dryRun, refresh, results, selected]);

  // Confirm the dry-run preview: same idempotency key, dry_run off.
  const confirmBulkPreview = useCallback(async () => {
    if (!bulkPreview) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/admin/profile-visibility/bulk', {
        items: bulkPreview.items,
        idempotency_key: bulkPreview.idempotencyKey,
        dry_run: false,
      });
      setBulkPreview(null);
      if (data.approval_required) {
        setBulkPendingApproval(data.approval_id || null);
      } else {
        setBulkResults(data);
        await refresh();
      }
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data || {};
      if (status === 409 && (data.approval_required || data.approvalRequired)) {
        setBulkPreview(null);
        setBulkPendingApproval(data.approval_id || data.approvalId || null);
      } else {
        logger.error('bulk profile visibility apply failed', { message: err.message });
        setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
      }
    } finally {
      setSaving(false);
    }
  }, [bulkPreview, copy, refresh]);

  // ─── History + notifications + undo ─────────────────────────────────────
  const loadHistory = async (profile) => {
    setHistoryTarget(profile);
    setHistoryRows([]);
    setHistoryLoading(true);
    setUndoMessage(null);
    setNotifications([]);
    try {
      const { data } = await api.get(`/admin/profile-visibility/${profile.profile_type}/${profile.profile_id}/history`);
      setHistoryRows(data.history || []);
    } catch (err) {
      logger.error('profile visibility history failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setHistoryLoading(false);
    }
    setNotificationsLoading(true);
    try {
      const { data } = await api.get(`/admin/profile-visibility/${profile.profile_type}/${profile.profile_id}/notifications`);
      setNotifications(data.notifications || []);
    } catch (err) {
      logger.error('profile visibility notifications failed', { message: err.message });
    } finally {
      setNotificationsLoading(false);
    }
  };

  const undoLastChange = useCallback(async () => {
    if (!historyTarget) return;
    setUndoing(true);
    setUndoMessage(null);
    try {
      const { data } = await api.post(
        `/admin/profile-visibility/${historyTarget.profile_type}/${historyTarget.profile_id}/undo`,
      );
      setUndoMessage({ kind: 'success', restoredTo: data?.restored_to });
      setUndoTarget(null);
      await loadHistory(historyTarget);
      await refresh();
    } catch (err) {
      if (err?.response?.status === 409) {
        setUndoTarget(null);
        setUndoMessage({ kind: 'conflict' });
      } else {
        logger.error('undo visibility change failed', { message: err.message });
        setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
      }
    } finally {
      setUndoing(false);
    }
  }, [copy, historyTarget, refresh]);

  // ─── Saved views ────────────────────────────────────────────────────────
  const persistViews = (views) => {
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    } catch {
      // Storage full or unavailable: keep the in-memory list only.
    }
    setSavedViews(views);
  };
  const saveCurrentView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [...savedViews.filter((view) => view.name !== name), { name, query, type: typeFilter, visibility: visibilityFilter }];
    persistViews(next);
    setViewName('');
  };
  const applySavedView = (view) => {
    const nextQuery = view.query || '';
    const nextType = view.type || 'all';
    const nextVisibility = view.visibility || 'all';
    setQuery(nextQuery);
    setTypeFilter(nextType);
    setVisibilityFilter(nextVisibility);
    setPage(1);
    search(nextQuery, nextType, nextVisibility, 1);
  };
  const deleteSavedView = (name) => {
    persistViews(savedViews.filter((view) => view.name !== name));
  };

  // ─── Export ─────────────────────────────────────────────────────────────
  const exportResults = () => {
    const header = ['Type', 'Name', 'Detail', 'Visibility', 'Owner status'];
    const rows = results.map((r) => [
      r.profile_type,
      r.display_name,
      r.detail || '',
      r.is_hidden_by_admin ? 'hidden' : r.is_visible ? 'visible' : 'unlisted',
      r.is_active ? 'active' : 'inactive',
    ]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'oxsteed-profile-visibility.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportAll = async () => {
    setExportingAll(true);
    setError('');
    try {
      const { data } = await api.get('/admin/profile-visibility/export', {
        params: {
          q: query.trim() || undefined,
          type: typeFilter,
          visibility: visibilityFilter,
        },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'oxsteed-profile-visibility-all.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('export all failed', { message: err.message });
      setError(copy('exportFailed', { defaultValue: 'Export failed. Please try again.' }));
    } finally {
      setExportingAll(false);
    }
  };

  const card = { background: 'var(--color-surface)', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.08)' };
  const input = { padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.875rem' };
  const label = { display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--color-text-muted)' };
  const btn = { padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' };
  const btnPrimary = { ...btn, background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' };
  const btnDanger = { ...btn, background: '#dc2626', borderColor: '#dc2626', color: '#fff' };

  const badge = (bg, fg) => ({
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    padding: '0.2rem 0.6rem', borderRadius: '999px',
    fontSize: '0.75rem', fontWeight: 600, background: bg, color: fg,
  });

  const visibilityBadge = (r) => {
    if (r.is_hidden_by_admin) {
      return (
        <span style={badge('#fef2f2', '#b91c1c')}>
          <EyeOff size={13} aria-hidden />
          {copy('statusHidden', { defaultValue: 'Hidden by admin' })}
          {r.hidden_reason && ` - ${reasonLabel(r.hidden_reason)}`}
        </span>
      );
    }
    if (r.is_visible) {
      return (
        <span style={badge('#f0fdf4', '#15803d')}>
          <Eye size={13} aria-hidden />
          {copy('statusVisible', { defaultValue: 'Visible publicly' })}
        </span>
      );
    }
    return (
      <span style={badge('#fffbeb', '#b45309')}>
        <EyeOff size={13} aria-hidden />
        {copy('statusUnlisted', { defaultValue: 'Not listed by owner' })}
      </span>
    );
  };

  const activeWorkCounts = (work) => {
    if (!work) return null;
    const parts = [
      [work.active_jobs, copy('activeWorkJobs', { defaultValue: 'Active jobs' })],
      [work.upcoming_bookings, copy('activeWorkBookings', { defaultValue: 'Upcoming bookings' })],
      [work.open_orders, copy('activeWorkOrders', { defaultValue: 'Open orders' })],
      [work.recent_payments, copy('activeWorkPayments', { defaultValue: 'Recent payments' })],
    ];
    return parts.map(([count, text]) => `${count || 0} ${text}`).join(' · ');
  };

  const scheduledSummary = (action) => {
    const when = action.scheduled_for ? new Date(action.scheduled_for).toLocaleString() : '';
    return copy('scheduledSummary', {
      action: action.is_visible ? copy('scheduledRestore', { defaultValue: 'Restore' }) : copy('scheduledHide', { defaultValue: 'Hide' }),
      when,
      defaultValue: `${action.is_visible ? 'Restore' : 'Hide'} on ${when}`,
    });
  };

  const timezoneOptions = TIMEZONES.includes(scheduleTz) ? TIMEZONES : [scheduleTz, ...TIMEZONES];

  return (
    <div className="pv-admin" style={{ padding: '2rem', background: 'var(--color-bg)', minHeight: '100vh' }}>
      <style>{`
        .pv-admin button:focus-visible, .pv-admin input:focus-visible, .pv-admin select:focus-visible, .pv-admin a:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .pv-admin *, .pv-admin *::before, .pv-admin *::after { animation: none !important; transition: none !important; }
        }
      `}</style>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <EyeOff size={26} />{copy('title', { defaultValue: 'Profile visibility' })}
      </h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: '0.4rem', marginBottom: '1.5rem', maxWidth: '60rem' }}>
        {copy('description', { defaultValue: 'Hide a helper, business, or restaurant profile from public view.' })}
      </p>

      {approvalNotice && (
        <div role="status" style={{ ...card, borderLeft: '4px solid var(--color-primary)', marginBottom: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <ShieldCheck size={18} aria-hidden style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: '0.15rem' }} />
          <div style={{ flex: 1, color: 'var(--color-text)', fontSize: '0.9rem' }}>
            <strong>{copy('approvalRequested', { defaultValue: 'Approval requested. A second admin must approve it before it takes effect.' })}</strong>
            {approvalNotice.approvalId && <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>#{approvalNotice.approvalId}</div>}
            {approvalNotice.hint && <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>{approvalNotice.hint}</div>}
          </div>
          <button type="button" style={btn} onClick={() => setApprovalNotice(null)} aria-label={copy('close', { defaultValue: 'Close' })}>
            <X size={15} aria-hidden />
          </button>
        </div>
      )}

      <div style={{ ...card, display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: '1 1 16rem' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(query, typeFilter, visibilityFilter, page); }}
            placeholder={copy('searchPlaceholder', { defaultValue: 'Search by name or email (min 2 characters)' })}
            aria-label={copy('searchPlaceholder', { defaultValue: 'Search by name or email (min 2 characters)' })}
            style={{ ...input, width: '100%', paddingLeft: '2.2rem' }}
            data-testid="pv-search-input"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label={copy('typeFilter', { defaultValue: 'Profile type' })}
          style={input}
        >
          <option value="all">{copy('typeAll', { defaultValue: 'All types' })}</option>
          <option value="helper">{copy('typeHelper', { defaultValue: 'Helpers' })}</option>
          <option value="business">{copy('typeBusiness', { defaultValue: 'Businesses' })}</option>
          <option value="restaurant">{copy('typeRestaurant', { defaultValue: 'Restaurants' })}</option>
        </select>
        <select
          value={visibilityFilter}
          onChange={(e) => { setVisibilityFilter(e.target.value); setPage(1); }}
          aria-label={copy('visibilityFilter', { defaultValue: 'Visibility' })}
          style={input}
        >
          <option value="all">{copy('visibilityAll', { defaultValue: 'All visibility' })}</option>
          <option value="visible">{copy('statusVisible', { defaultValue: 'Visible publicly' })}</option>
          <option value="hidden">{copy('statusHidden', { defaultValue: 'Hidden by admin' })}</option>
          <option value="unlisted">{copy('statusUnlisted', { defaultValue: 'Not listed by owner' })}</option>
          <option value="active">{copy('statusActive', { defaultValue: 'Active' })}</option>
          <option value="inactive">{copy('statusInactive', { defaultValue: 'Inactive' })}</option>
        </select>
        <button type="button" style={btnPrimary} onClick={() => search(query, typeFilter, visibilityFilter, page)} disabled={loading || query.trim().length === 1} data-testid="pv-search-button">
          {loading ? copy('searching', { defaultValue: 'Searching' }) : copy('search', { defaultValue: 'Search' })}
        </button>
        <button type="button" style={btn} onClick={refresh} disabled={loading} aria-label={copy('refresh', { defaultValue: 'Refresh results' })}>
          <RefreshCw size={15} aria-hidden />
        </button>
        <button type="button" style={btn} onClick={exportResults} disabled={!results.length}>
          <Download size={15} aria-hidden /> {copy('export', { defaultValue: 'Export page' })}
        </button>
        <button type="button" style={btn} onClick={exportAll} disabled={exportingAll || !searched} data-testid="pv-export-all">
          <Download size={15} aria-hidden /> {exportingAll ? copy('exporting', { defaultValue: 'Exporting' }) : copy('exportAll', { defaultValue: 'Export all' })}
        </button>
      </div>

      <div style={{ ...card, display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
        <Save size={15} aria-hidden style={{ color: 'var(--color-text-muted)' }} />
        <input
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          placeholder={copy('viewNamePlaceholder', { defaultValue: 'e.g. Hidden helpers' })}
          aria-label={copy('saveView', { defaultValue: 'Save current view' })}
          style={{ ...input, flex: '0 1 12rem' }}
          maxLength={60}
          data-testid="pv-view-name"
        />
        <button type="button" style={btn} onClick={saveCurrentView} disabled={!viewName.trim()} data-testid="pv-save-view">
          {copy('saveView', { defaultValue: 'Save current view' })}
        </button>
        {savedViews.length > 0 && (
          <span style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{copy('savedViews', { defaultValue: 'Saved views' })}:</span>
            {savedViews.map((view) => (
              <span key={view.name} style={{ ...badge('var(--color-bg)', 'var(--color-text)'), padding: '0.25rem 0.35rem 0.25rem 0.6rem' }}>
                <button
                  type="button"
                  onClick={() => applySavedView(view)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '0.75rem', fontWeight: 600, padding: 0 }}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSavedView(view.name)}
                  aria-label={`${copy('deleteView', { defaultValue: 'Delete view' })}: ${view.name}`}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0.15rem', display: 'inline-flex' }}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </span>
            ))}
          </span>
        )}
      </div>

      {searched && results.length > 0 && (
        <div style={{ ...card, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <button type="button" style={btn} onClick={toggleAll}>
            <CheckSquare size={15} aria-hidden /> {selected.length === results.length ? copy('clearSelection', { defaultValue: 'Clear selection' }) : copy('selectPage', { defaultValue: 'Select page' })}
          </button>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{copy('resultCount', { count: pageInfo.total, defaultValue: `${pageInfo.total} profiles` })}</span>
          {selected.length > 0 && <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                data-testid="pv-dry-run"
              />
              {copy('bulkDryRun', { defaultValue: 'Dry run' })}
            </label>
            <button type="button" style={btnDanger} onClick={() => bulkApply(false)} disabled={saving}>{copy('bulkHide', { defaultValue: 'Hide selected' })}</button>
            <button type="button" style={btn} onClick={() => bulkApply(true)} disabled={saving}>{copy('bulkRestore', { defaultValue: 'Restore selected' })}</button>
          </>}
        </div>
      )}

      {bulkPreview && (
        <div style={{ ...card, marginBottom: '1rem', border: '1px solid var(--color-primary)' }} role="dialog" aria-label={copy('bulkDryRunTitle', { defaultValue: 'Dry-run preview' })}>
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', color: 'var(--color-text)' }}>
            {copy('bulkDryRunTitle', { defaultValue: 'Dry-run preview' })}: {bulkPreview.isVisible ? copy('bulkRestore', { defaultValue: 'Restore selected' }) : copy('bulkHide', { defaultValue: 'Hide selected' })} ({bulkPreview.targets.length})
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', color: 'var(--color-text)' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '0.5rem' }}>{copy('bulkItem', { defaultValue: 'Profile' })}</th>
                  <th style={{ padding: '0.5rem' }}>{copy('bulkItemAction', { defaultValue: 'Action' })}</th>
                  <th style={{ padding: '0.5rem' }}>{copy('activeWorkTitle', { defaultValue: 'Active work found' })}</th>
                  <th style={{ padding: '0.5rem' }}>{copy('bulkResults', { defaultValue: 'Results' })}</th>
                </tr>
              </thead>
              <tbody>
                {bulkPreview.results.map((result) => {
                  const target = bulkPreview.targets.find((t) => t.profile_type === result.profile_type && String(t.profile_id) === String(result.profile_id));
                  return (
                    <tr key={`${result.profile_type}:${result.profile_id}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.5rem' }}>{target?.display_name || `${result.profile_type} ${result.profile_id}`}</td>
                      <td style={{ padding: '0.5rem' }}>{result.ok ? (result.action || (bulkPreview.isVisible ? copy('restore') : copy('hide'))) : '—'}</td>
                      <td style={{ padding: '0.5rem', color: 'var(--color-text-muted)' }}>{result.work?.has_active_work ? activeWorkCounts(result.work) : '—'}</td>
                      <td style={{ padding: '0.5rem' }}>
                        {result.ok
                          ? <span style={badge('#f0fdf4', '#15803d')}><CheckCircle2 size={13} aria-hidden /> OK</span>
                          : <span style={{ ...badge('#fef2f2', '#b91c1c'), maxWidth: '16rem', whiteSpace: 'normal' }}>{result.error || 'Error'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {bulkPreview.approvalRequired && (
            <p role="status" style={{ color: 'var(--color-text)', fontSize: '0.9rem', marginTop: '0.75rem' }}>
              <ShieldCheck size={14} aria-hidden style={{ verticalAlign: 'text-bottom' }} /> {copy('approvalRequested', { defaultValue: 'Approval requested. A second admin must approve it before it takes effect.' })}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button type="button" style={btn} disabled={saving} onClick={() => setBulkPreview(null)}>
              {copy('cancel', { defaultValue: 'Cancel' })}
            </button>
            <button type="button" style={btnDanger} disabled={saving} onClick={confirmBulkPreview} data-testid="pv-bulk-apply">
              {saving ? copy('bulkLoading', { defaultValue: 'Applying' }) : copy('bulkApplyConfirm', { count: bulkPreview.targets.length, defaultValue: `Apply to ${bulkPreview.targets.length} profiles?` })}
            </button>
          </div>
        </div>
      )}

      {bulkResults && (() => {
        const failed = (bulkResults.results || []).filter((r) => !r.ok);
        return (
          <div style={{ ...card, marginBottom: '1rem' }} role="status">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-text)' }}>{copy('bulkResults', { defaultValue: 'Results' })}</h2>
              <button type="button" style={btn} onClick={() => setBulkResults(null)} aria-label={copy('close', { defaultValue: 'Close' })}>
                <X size={15} aria-hidden />
              </button>
            </div>
            <p style={{ color: failed.length ? '#b91c1c' : 'var(--color-text)', fontWeight: 600, margin: '0.6rem 0' }}>
              {failed.length
                ? copy('bulkPartialFailures', { failed: failed.length, total: (bulkResults.results || []).length, defaultValue: `${failed.length} of ${(bulkResults.results || []).length} items failed.` })
                : copy('bulkAllOk', { defaultValue: 'All items applied.' })}
            </p>
            {failed.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                {failed.map((r) => (
                  <li key={`${r.profile_type}:${r.profile_id}`}>{r.profile_type} {r.profile_id}: {r.error || 'Error'}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      {bulkPendingApproval && (
        <div role="status" style={{ ...card, borderLeft: '4px solid var(--color-primary)', marginBottom: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <ShieldCheck size={18} aria-hidden style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          <div style={{ flex: 1, color: 'var(--color-text)', fontSize: '0.9rem' }}>
            {copy('approvalRequested', { defaultValue: 'Approval requested. A second admin must approve it before it takes effect.' })}
            {bulkPendingApproval !== true && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}> #{bulkPendingApproval}</span>}
          </div>
          <button type="button" style={btn} onClick={() => setBulkPendingApproval(null)} aria-label={copy('close', { defaultValue: 'Close' })}>
            <X size={15} aria-hidden />
          </button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ ...card, borderLeft: '4px solid #dc2626', marginBottom: '1rem', color: '#dc2626', fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div style={{ ...card, marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setShowApprovals((v) => !v)}
          aria-expanded={showApprovals}
          style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          data-testid="pv-approvals-toggle"
        >
          <ShieldCheck size={15} aria-hidden />
          {copy('approvals', { defaultValue: 'Approvals' })}
          {showApprovals && approvals.length > 0 && <span style={badge('var(--color-bg)', 'var(--color-text)')}>{approvals.length}</span>}
        </button>
        {showApprovals && (
          <div style={{ marginTop: '1rem' }} data-testid="pv-approvals">
            {approvalsLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{copy('approvalsLoading', { defaultValue: 'Loading approvals' })}</p>
            ) : approvals.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{copy('noApprovals', { defaultValue: 'No pending approvals.' })}</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {approvals.map((approval) => {
                  const requesterId = approvalRequesterId(approval);
                  const isOwn = requesterId != null && String(requesterId) === String(user?.id);
                  return (
                    <div key={approval.id} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '0.85rem', display: 'grid', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={badge('#eff6ff', '#1d4ed8')}>{approval.action_type || 'single'}</span>
                        <strong style={{ color: 'var(--color-text)', fontSize: '0.9rem' }}>{summarizeApproval(approval)}</strong>
                      </div>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                        {copy('requestedBy', { name: approvalRequesterName(approval) || '—', defaultValue: `Requested by ${approvalRequesterName(approval) || '—'}` })}
                        {approval.created_at && ` · ${new Date(approval.created_at).toLocaleString()}`}
                        {approval.payload?.reason && ` · ${reasonLabel(approval.payload.reason)}`}
                      </div>
                      {isOwn ? (
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }} role="status">
                          <ShieldCheck size={14} aria-hidden style={{ verticalAlign: 'text-bottom' }} />{' '}
                          {copy('approvalRequested', { defaultValue: 'Approval requested. A second admin must approve it before it takes effect.' })}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            value={reviewNotes[approval.id] || ''}
                            onChange={(e) => setReviewNotes((prev) => ({ ...prev, [approval.id]: e.target.value }))}
                            placeholder={copy('reviewNotePlaceholder', { defaultValue: 'Note for the audit log' })}
                            aria-label={copy('reviewNote', { defaultValue: 'Review note (optional)' })}
                            maxLength={280}
                            style={{ ...input, flex: '1 1 12rem' }}
                          />
                          <button type="button" style={btnPrimary} disabled={reviewingId === approval.id} onClick={() => reviewApproval(approval, 'approved')}>
                            {copy('approve', { defaultValue: 'Approve' })}
                          </button>
                          <button type="button" style={btn} disabled={reviewingId === approval.id} onClick={() => reviewApproval(approval, 'rejected')}>
                            {copy('reject', { defaultValue: 'Reject' })}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ ...card, marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setShowScheduled((v) => !v)}
          aria-expanded={showScheduled}
          style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          data-testid="pv-scheduled-toggle"
        >
          <CalendarClock size={15} aria-hidden />
          {copy('scheduledActions', { defaultValue: 'Scheduled actions' })}
          {showScheduled && scheduledActions.length > 0 && <span style={badge('var(--color-bg)', 'var(--color-text)')}>{scheduledActions.length}</span>}
        </button>
        {showScheduled && (
          <div style={{ marginTop: '1rem' }} data-testid="pv-scheduled">
            {scheduledLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{copy('scheduleLoading', { defaultValue: 'Loading scheduled actions' })}</p>
            ) : scheduledActions.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{copy('noScheduled', { defaultValue: 'No scheduled actions.' })}</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {scheduledActions.map((action) => (
                  <div key={action.id} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '0.85rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={badge(action.is_visible ? '#f0fdf4' : '#fef2f2', action.is_visible ? '#15803d' : '#b91c1c')}>
                      {action.is_visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
                      {action.is_visible ? copy('scheduledRestore', { defaultValue: 'Restore' }) : copy('scheduledHide', { defaultValue: 'Hide' })}
                    </span>
                    <div style={{ flex: '1 1 14rem', color: 'var(--color-text)', fontSize: '0.9rem' }}>
                      <strong>{scheduledSummary(action)}</strong>
                      {(action.profile_type || action.profile_id) && (
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                          {action.profile_type} {action.profile_id}
                          {action.timezone && ` · ${action.timezone}`}
                          {action.reason && ` · ${reasonLabel(action.reason)}`}
                        </div>
                      )}
                    </div>
                    <button type="button" style={btn} onClick={() => cancelScheduled(action)}>
                      {copy('cancelScheduled', { defaultValue: 'Cancel' })}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!searched && !loading && (
        <p style={{ color: 'var(--color-text-muted)' }}>
          {copy('searchPrompt', { defaultValue: 'Search for a helper, business, or restaurant to see and change its public visibility.' })}
        </p>
      )}

      {searched && !loading && results.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>{copy('noResults', { defaultValue: 'No profiles found.' })}</p>
      )}

      <div style={{ display: 'grid', gap: '1rem' }} data-testid="pv-results">
        {results.map((r) => {
          const { Icon } = TYPE_META[r.profile_type] || TYPE_META.helper;
          const hiding = hideTarget
            && hideTarget.profile_type === r.profile_type
            && String(hideTarget.profile_id) === String(r.profile_id);
          const showWorkWarning = hiding && hideWork && hideWork.forKey === keyFor(r) && hideWork.has_active_work;
          return (
            <div key={`${r.profile_type}:${r.profile_id}`} style={card}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span style={{ ...badge('var(--color-bg)', 'var(--color-text-muted)'), padding: '0.45rem' }} aria-hidden>
                  <Icon size={18} />
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', paddingTop: '0.45rem' }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(keyFor(r))}
                    onChange={() => toggleSelected(r)}
                    aria-label={copy('selectProfile', { name: r.display_name, defaultValue: `Select ${r.display_name}` })}
                  />
                </label>
                <div style={{ flex: '1 1 14rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--color-text)', fontSize: '1rem' }}>{r.display_name}</strong>
                    <span style={badge('var(--color-bg)', 'var(--color-text-muted)')}>{typeLabel(r.profile_type)}</span>
                  </div>
                  {r.detail && <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>{r.detail}</div>}
                  <div style={{ marginTop: '0.5rem' }}>
                    {visibilityBadge(r)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" style={btn} disabled={saving} onClick={() => openPreview(r)} data-testid="pv-preview">
                    <MonitorPlay size={15} aria-hidden /> {copy('preview', { defaultValue: 'Preview' })}
                  </button>
                  <button type="button" style={btn} disabled={saving} onClick={() => openSchedule(r)} data-testid="pv-schedule">
                    <CalendarClock size={15} aria-hidden /> {copy('schedule', { defaultValue: 'Schedule' })}
                  </button>
                  <button type="button" style={btn} disabled={historyLoading} onClick={() => loadHistory(r)} data-testid="pv-history">
                    <History size={15} aria-hidden /> {copy('history', { defaultValue: 'History' })}
                  </button>
                  {r.is_hidden_by_admin ? (
                    <button type="button" style={btn} disabled={saving} onClick={() => setRestoreTarget(r)} data-testid="pv-restore">
                      {copy('restore', { defaultValue: 'Restore' })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={btnDanger}
                      disabled={saving}
                      onClick={() => { setHideTarget(r); setHideReason('incomplete_profile'); setHideNote(''); setHideWork(null); setHideAck(false); setApprovalNotice(null); }}
                      data-testid="pv-hide"
                    >
                      {copy('hide', { defaultValue: 'Hide' })}
                    </button>
                  )}
                </div>
              </div>
              {hiding && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)', display: 'grid', gap: '0.75rem', maxWidth: '32rem' }}>
                  <div>
                    <label style={label} htmlFor={`pv-reason-${r.profile_type}-${r.profile_id}`}>
                      {copy('reasonLabel', { defaultValue: 'Reason' })}
                    </label>
                    <select
                      id={`pv-reason-${r.profile_type}-${r.profile_id}`}
                      value={hideReason}
                      onChange={(e) => setHideReason(e.target.value)}
                      style={{ ...input, width: '100%' }}
                    >
                      {REASONS.map((reason) => (
                        <option key={reason} value={reason}>{reasonLabel(reason)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={label} htmlFor={`pv-note-${r.profile_type}-${r.profile_id}`}>
                      {copy('noteLabel', { defaultValue: 'Note (optional)' })}
                    </label>
                    <input
                      id={`pv-note-${r.profile_type}-${r.profile_id}`}
                      value={hideNote}
                      onChange={(e) => setHideNote(e.target.value)}
                      placeholder={copy('notePlaceholder', { defaultValue: 'Internal note, kept in the audit log' })}
                      maxLength={280}
                      style={{ ...input, width: '100%' }}
                    />
                  </div>
                  {hideWorkLoading && (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }} role="status">
                      {copy('activeWorkChecking', { defaultValue: 'Checking for active work' })}
                    </p>
                  )}
                  {showWorkWarning && (
                    <div role="alert" style={{ border: '1px solid #f59e0b', borderRadius: '8px', padding: '0.85rem', background: '#fffbeb', color: '#92400e', display: 'grid', gap: '0.6rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <AlertTriangle size={16} aria-hidden />
                        <strong>{copy('activeWorkTitle', { defaultValue: 'Active work found' })}</strong>
                      </div>
                      <div style={{ fontSize: '0.85rem' }}>{activeWorkCounts(hideWork)}</div>
                      <div style={{ fontSize: '0.85rem' }}>
                        {copy('activeWorkWarning', {
                          count: (hideWork.active_jobs || 0) + (hideWork.upcoming_bookings || 0) + (hideWork.open_orders || 0) + (hideWork.recent_payments || 0),
                          defaultValue: 'This profile has active work. Hiding it blocks new customers, but existing commitments stay in place.',
                        })}
                      </div>
                      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={hideAck} onChange={(e) => setHideAck(e.target.checked)} style={{ marginTop: '0.2rem' }} />
                        {copy('acknowledgeActiveWork', { defaultValue: 'I understand this profile has active work and I still want to hide it.' })}
                      </label>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button type="button" style={btnDanger} disabled={saving || !hideAck} onClick={hideAnyway}>
                          {copy('hideAnyway', { defaultValue: 'Hide anyway' })}
                        </button>
                        <button type="button" style={btn} disabled={saving} onClick={requestHideApproval}>
                          <ShieldCheck size={15} aria-hidden /> {copy('requestApproval', { defaultValue: 'Request approval' })}
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button type="button" style={btn} disabled={saving || hideWorkLoading} onClick={() => { setHideTarget(null); setHideWork(null); setHideAck(false); }}>
                      {copy('cancel', { defaultValue: 'Cancel' })}
                    </button>
                    <button type="button" style={btnDanger} disabled={saving || hideWorkLoading} onClick={() => beginHideConfirm(r)} data-testid="pv-confirm-hide">
                      {hideWorkLoading ? copy('activeWorkChecking', { defaultValue: 'Checking for active work' }) : copy('confirmHide', { defaultValue: 'Hide profile' })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {searched && (pageInfo.total > pageInfo.limit || pageInfo.page > 1) && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
          <button type="button" style={btn} disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>
            <ChevronLeft size={16} aria-hidden /> {copy('previous', { defaultValue: 'Previous' })}
          </button>
          <span style={{ color: 'var(--color-text-muted)' }}>{copy('pageOf', { page: pageInfo.page, pages: Math.max(1, Math.ceil(pageInfo.total / pageInfo.limit)), defaultValue: `Page ${pageInfo.page} of ${Math.max(1, Math.ceil(pageInfo.total / pageInfo.limit))}` })}</span>
          <button type="button" style={btn} disabled={loading || !pageInfo.hasMore} onClick={() => setPage((current) => current + 1)}>
            {copy('next', { defaultValue: 'Next' })} <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      )}

      {historyTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="profile-visibility-history-title" style={{ ...card, marginTop: '1.5rem', border: '1px solid var(--color-border)' }} data-testid="pv-history-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 id="profile-visibility-history-title" style={{ color: 'var(--color-text)', fontSize: '1.1rem', margin: 0 }}>
              {copy('historyTitle', { name: historyTarget.display_name, defaultValue: `Visibility history: ${historyTarget.display_name}` })}
            </h2>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {historyRows.length > 0 && (
                <button type="button" style={btn} disabled={undoing} onClick={() => setUndoTarget(historyTarget)} data-testid="pv-undo">
                  <Undo2 size={15} aria-hidden /> {undoing ? copy('undoing', { defaultValue: 'Undoing' }) : copy('undo', { defaultValue: 'Undo last change' })}
                </button>
              )}
              <button type="button" style={btn} onClick={() => setHistoryTarget(null)}>{copy('closeHistory', { defaultValue: 'Close' })}</button>
            </div>
          </div>
          {undoMessage?.kind === 'success' && (
            <p role="status" style={{ color: '#15803d', fontWeight: 600, marginTop: '0.75rem' }}>
              <CheckCircle2 size={14} aria-hidden style={{ verticalAlign: 'text-bottom' }} /> {copy('undoSuccess', { defaultValue: 'Last change undone.' })}
            </p>
          )}
          {undoMessage?.kind === 'conflict' && (
            <p role="alert" style={{ color: '#b91c1c', fontWeight: 600, marginTop: '0.75rem' }}>
              {copy('undoConflict', { defaultValue: 'Undo conflicts with a newer change. Refresh the page and review the history before retrying.' })}
            </p>
          )}
          {historyLoading ? (
            <p style={{ color: 'var(--color-text-muted)' }}>{copy('loadingHistory', { defaultValue: 'Loading history…' })}</p>
          ) : historyRows.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>{copy('noHistory', { defaultValue: 'No visibility changes recorded.' })}</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.85rem' }}>
              {historyRows.map((entry) => (
                <div key={entry.id} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.6rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  <strong style={{ color: 'var(--color-text)' }}>{entry.action === 'profile_visibility_hidden' ? copy('hide', { defaultValue: 'Hide' }) : copy('restore', { defaultValue: 'Restore' })}</strong>
                  {' · '}{entry.actor_name || copy('admin', { defaultValue: 'Admin' })}{' · '}{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}
                  {entry.description && <div>{entry.description}</div>}
                </div>
              ))}
            </div>
          )}

          <h3 style={{ color: 'var(--color-text)', fontSize: '1rem', margin: '1.25rem 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Bell size={15} aria-hidden /> {copy('notifications', { defaultValue: 'Notifications' })}
          </h3>
          {notificationsLoading ? (
            <p style={{ color: 'var(--color-text-muted)' }}>{copy('notificationsLoading', { defaultValue: 'Loading notifications' })}</p>
          ) : notifications.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{copy('noNotifications', { defaultValue: 'No notifications sent yet.' })}</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {notifications.map((notification, index) => {
                const status = String(notification.status || '').toLowerCase();
                const statusBadge = status === 'sent'
                  ? <span style={badge('#f0fdf4', '#15803d')}>{copy('notificationSent', { defaultValue: 'Sent' })}</span>
                  : status === 'failed'
                    ? <span style={badge('#fef2f2', '#b91c1c')}>{copy('notificationFailed', { defaultValue: 'Failed' })}</span>
                    : <span style={badge('#fffbeb', '#b45309')}>{copy('notificationPending', { defaultValue: 'Pending' })}</span>;
                return (
                  <div key={notification.id || index} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.85rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {statusBadge}
                    <strong style={{ color: 'var(--color-text)' }}>{notification.action || '—'}</strong>
                    <span>{copy('notificationAttempts', { count: notification.attempts ?? 0, defaultValue: `${notification.attempts ?? 0} attempts` })}</span>
                    {notification.sent_at && <span>{new Date(notification.sent_at).toLocaleString()}</span>}
                    {notification.last_error && <span style={{ color: '#b91c1c' }}>{notification.last_error}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
            {copy('notificationRetry', { defaultValue: 'Retries are automatic. Contact the platform owner if a notification stays failed.' })}
          </p>
        </div>
      )}

      {previewTarget && (
        <Modal
          labelledBy="pv-preview-title"
          title={copy('previewTitle', { name: previewTarget.display_name, defaultValue: `Preview: ${previewTarget.display_name}` })}
          onClose={() => { setPreviewTarget(null); setPreviewData(null); }}
          wide
        >
          {previewLoading ? (
            <p style={{ color: 'var(--color-text-muted)' }} role="status">{copy('previewLoading', { defaultValue: 'Loading preview' })}</p>
          ) : !previewData || previewData.unavailable || !previewData.canonical_url ? (
            <p style={{ color: 'var(--color-text-muted)' }}>{copy('previewUnavailable', { defaultValue: 'Preview is not available for this profile.' })}</p>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.85rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                <span>{copy('previewType', { defaultValue: 'Profile type' })}: <strong style={{ color: 'var(--color-text)' }}>{typeLabel(previewData.profile_type || previewTarget.profile_type)}</strong></span>
                <span>{copy('previewVisibility', { defaultValue: 'Current visibility' })}:</span>
                {visibilityBadge({
                  ...previewTarget,
                  is_hidden_by_admin: previewData.is_hidden_by_admin ?? previewTarget.is_hidden_by_admin,
                  is_visible: previewData.is_visible ?? previewTarget.is_visible,
                  hidden_reason: previewTarget.hidden_reason,
                })}
                <span style={badge('var(--color-bg)', 'var(--color-text-muted)')}>
                  {(previewData.owner_visible ?? previewTarget.owner_visible)
                    ? copy('previewOwnerListed', { defaultValue: 'Listed by owner' })
                    : copy('previewOwnerUnlisted', { defaultValue: 'Not listed by owner' })}
                </span>
              </div>
              <iframe
                src={previewData.canonical_url}
                title={copy('previewTitle', { name: previewData.display_name || previewTarget.display_name, defaultValue: `Preview: ${previewData.display_name || previewTarget.display_name}` })}
                style={{ width: '100%', height: '60vh', border: '1px solid var(--color-border)', borderRadius: '8px', background: '#fff' }}
              />
            </div>
          )}
        </Modal>
      )}

      {scheduleTarget && (
        <Modal
          labelledBy="pv-schedule-title"
          title={copy('scheduleTitle', { defaultValue: 'Schedule visibility change' })}
          onClose={() => setScheduleTarget(null)}
        >
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            <div style={{ color: 'var(--color-text)', fontSize: '0.9rem' }}>
              <strong>{scheduleTarget.display_name}</strong>{' '}
              <span style={{ color: 'var(--color-text-muted)' }}>({typeLabel(scheduleTarget.profile_type)})</span>
            </div>
            <div>
              <label style={label} htmlFor="pv-schedule-action">{copy('scheduledAction', { defaultValue: 'Action' })}</label>
              <select id="pv-schedule-action" value={scheduleAction} onChange={(e) => setScheduleAction(e.target.value)} style={{ ...input, width: '100%' }}>
                <option value="hide">{copy('scheduledHide', { defaultValue: 'Hide' })}</option>
                <option value="restore">{copy('scheduledRestore', { defaultValue: 'Restore' })}</option>
              </select>
            </div>
            <div>
              <label style={label} htmlFor="pv-schedule-when">{copy('scheduledFor', { defaultValue: 'Date and time' })}</label>
              <input
                id="pv-schedule-when"
                type="datetime-local"
                value={scheduleWhen}
                onChange={(e) => setScheduleWhen(e.target.value)}
                style={{ ...input, width: '100%' }}
              />
            </div>
            <div>
              <label style={label} htmlFor="pv-schedule-tz">{copy('timezone', { defaultValue: 'Time zone' })}</label>
              <select id="pv-schedule-tz" value={scheduleTz} onChange={(e) => setScheduleTz(e.target.value)} style={{ ...input, width: '100%' }}>
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            {scheduleAction === 'hide' && (
              <>
                <div>
                  <label style={label} htmlFor="pv-schedule-reason">{copy('reasonLabel', { defaultValue: 'Reason' })}</label>
                  <select id="pv-schedule-reason" value={scheduleReason} onChange={(e) => setScheduleReason(e.target.value)} style={{ ...input, width: '100%' }}>
                    {REASONS.map((reason) => (
                      <option key={reason} value={reason}>{reasonLabel(reason)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={label} htmlFor="pv-schedule-note">{copy('noteLabel', { defaultValue: 'Note (optional)' })}</label>
                  <input
                    id="pv-schedule-note"
                    value={scheduleNote}
                    onChange={(e) => setScheduleNote(e.target.value)}
                    placeholder={copy('notePlaceholder', { defaultValue: 'Internal note, kept in the audit log' })}
                    maxLength={280}
                    style={{ ...input, width: '100%' }}
                  />
                </div>
              </>
            )}
            {scheduleFormError && (
              <div role="alert" style={{ color: '#b91c1c', fontWeight: 600, fontSize: '0.875rem' }}>{scheduleFormError}</div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" style={btn} disabled={scheduleSaving} onClick={() => setScheduleTarget(null)}>
                {copy('cancel', { defaultValue: 'Cancel' })}
              </button>
              <button type="button" style={btnPrimary} disabled={scheduleSaving || !scheduleWhen} onClick={submitSchedule} data-testid="pv-schedule-submit">
                {copy('scheduleSubmit', { defaultValue: 'Schedule action' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!restoreTarget}
        title={copy('restoreTitle', { defaultValue: 'Restore public visibility?' })}
        message={restoreTarget && copy('restoreMessage', { name: restoreTarget.display_name, defaultValue: `"${restoreTarget.display_name}" will become publicly visible again.` })}
        confirmLabel={copy('restore', { defaultValue: 'Restore' })}
        cancelLabel={copy('cancel', { defaultValue: 'Cancel' })}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && applyVisibility(restoreTarget, true)}
      />

      <ConfirmDialog
        open={!!undoTarget}
        title={copy('undoTitle', { defaultValue: 'Undo the most recent visibility change?' })}
        message={undoTarget && copy('undoConfirmMessage', { name: undoTarget.display_name, defaultValue: `"${undoTarget.display_name}" will be returned to its previous visibility state.` })}
        confirmLabel={copy('undo', { defaultValue: 'Undo last change' })}
        cancelLabel={copy('cancel', { defaultValue: 'Cancel' })}
        onClose={() => setUndoTarget(null)}
        onConfirm={undoLastChange}
      />
    </div>
  );
}
