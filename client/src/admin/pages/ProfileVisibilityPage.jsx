import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, CheckSquare, ChevronLeft, ChevronRight, Download, Eye, EyeOff, History, RefreshCw, Search, Store, User } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import ConfirmDialog from '../lib/ConfirmDialog';

// Super-admin: public profile visibility control for helpers, businesses, and
// restaurants. Hiding here sets a sticky admin override (is_hidden_by_admin)
// that the public profile endpoints honor even if the owner re-lists their
// own profile. Use it for incomplete profiles or non-compliance.

const TYPE_META = {
  helper: { Icon: User },
  business: { Icon: Building2 },
  restaurant: { Icon: Store },
};

const REASONS = ['incomplete_profile', 'non_compliance', 'admin_decision', 'other'];

export default function ProfileVisibilityPage() {
  const { t } = useTranslation();
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
  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hideTarget, setHideTarget] = useState(null); // profile row being hidden
  const [hideReason, setHideReason] = useState('incomplete_profile');
  const [hideNote, setHideNote] = useState('');
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const searchRequest = useRef(0);

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
  const toggleSelected = (profile) => {
    const key = keyFor(profile);
    setSelected((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  };
  const toggleAll = () => {
    const keys = results.map(keyFor);
    setSelected((prev) => prev.length === keys.length ? [] : keys);
  };
  const bulkApply = async (isVisible) => {
    if (!selected.length) return;
    const targets = results.filter((profile) => selected.includes(keyFor(profile)));
    if (!window.confirm(copy(isVisible ? 'bulkRestoreConfirm' : 'bulkHideConfirm', { count: targets.length, defaultValue: `Apply this action to ${targets.length} profiles?` }))) return;
    setSaving(true);
    setError('');
    try {
      await Promise.all(targets.map((profile) => api.put('/admin/profile-visibility', {
        profile_type: profile.profile_type,
        profile_id: profile.profile_id,
        is_visible: isVisible,
        reason: isVisible ? undefined : 'admin_decision',
      })));
      await refresh();
    } catch (err) {
      logger.error('bulk profile visibility update failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setSaving(false);
    }
  };
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
  const loadHistory = async (profile) => {
    setHistoryTarget(profile);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const { data } = await api.get(`/admin/profile-visibility/${profile.profile_type}/${profile.profile_id}/history`);
      setHistoryRows(data.history || []);
    } catch (err) {
      logger.error('profile visibility history failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setHistoryLoading(false);
    }
  };

  const applyVisibility = useCallback(async (profile, isVisible) => {
    setSaving(true);
    setError('');
    try {
      await api.put('/admin/profile-visibility', {
        profile_type: profile.profile_type,
        profile_id: profile.profile_id,
        is_visible: isVisible,
        reason: isVisible ? undefined : hideReason,
        note: isVisible || !hideNote.trim() ? undefined : hideNote.trim(),
      });
      setResults((prev) =>
        prev.map((r) =>
          r.profile_type === profile.profile_type && String(r.profile_id) === String(profile.profile_id)
            ? {
                ...r,
                is_hidden_by_admin: !isVisible,
                hidden_reason: isVisible ? null : hideReason,
                is_visible: isVisible && r.owner_visible,
              }
            : r
        )
      );
      setHideTarget(null);
      setHideNote('');
      setRestoreTarget(null);
    } catch (err) {
      logger.error('profile visibility update failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setSaving(false);
    }
  }, [hideReason, hideNote, copy]);

  const reasonLabel = (reason) =>
    copy(`reason${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`, { defaultValue: reason });
  const typeLabel = (type) =>
    copy(`type${type.charAt(0).toUpperCase()}${type.slice(1)}`, { defaultValue: type });

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

  return (
    <div style={{ padding: '2rem', background: 'var(--color-bg)', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <EyeOff size={26} />{copy('title', { defaultValue: 'Profile visibility' })}
      </h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: '0.4rem', marginBottom: '1.5rem', maxWidth: '60rem' }}>
        {copy('description', { defaultValue: 'Hide a helper, business, or restaurant profile from public view.' })}
      </p>

      <div style={{ ...card, display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ position: 'relative', flex: '1 1 16rem' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(query, typeFilter, visibilityFilter, page); }}
            placeholder={copy('searchPlaceholder', { defaultValue: 'Search by name or email (min 2 characters)' })}
            aria-label={copy('searchPlaceholder', { defaultValue: 'Search by name or email (min 2 characters)' })}
            style={{ ...input, width: '100%', paddingLeft: '2.2rem' }}
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
        <button type="button" style={btnPrimary} onClick={() => search(query, typeFilter, visibilityFilter, page)} disabled={loading || query.trim().length === 1}>
          {loading ? copy('searching', { defaultValue: 'Searching' }) : copy('search', { defaultValue: 'Search' })}
        </button>
        <button type="button" style={btn} onClick={refresh} disabled={loading} aria-label={copy('refresh', { defaultValue: 'Refresh results' })}>
          <RefreshCw size={15} aria-hidden />
        </button>
        <button type="button" style={btn} onClick={exportResults} disabled={!results.length}>
          <Download size={15} aria-hidden /> {copy('export', { defaultValue: 'Export page' })}
        </button>
      </div>

      {searched && results.length > 0 && (
        <div style={{ ...card, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <button type="button" style={btn} onClick={toggleAll}>
            <CheckSquare size={15} aria-hidden /> {selected.length === results.length ? copy('clearSelection', { defaultValue: 'Clear selection' }) : copy('selectPage', { defaultValue: 'Select page' })}
          </button>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{copy('resultCount', { count: pageInfo.total, defaultValue: `${pageInfo.total} profiles` })}</span>
          {selected.length > 0 && <>
            <button type="button" style={btnDanger} onClick={() => bulkApply(false)} disabled={saving}>{copy('bulkHide', { defaultValue: 'Hide selected' })}</button>
            <button type="button" style={btn} onClick={() => bulkApply(true)} disabled={saving}>{copy('bulkRestore', { defaultValue: 'Restore selected' })}</button>
          </>}
        </div>
      )}

      {error && (
        <div role="alert" style={{ ...card, borderLeft: '4px solid #dc2626', marginBottom: '1rem', color: '#dc2626', fontWeight: 600 }}>
          {error}
        </div>
      )}

      {!searched && !loading && (
        <p style={{ color: 'var(--color-text-muted)' }}>
          {copy('searchPrompt', { defaultValue: 'Search for a helper, business, or restaurant to see and change its public visibility.' })}
        </p>
      )}

      {searched && !loading && results.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>{copy('noResults', { defaultValue: 'No profiles found.' })}</p>
      )}

      <div style={{ display: 'grid', gap: '1rem' }}>
        {results.map((r) => {
          const { Icon } = TYPE_META[r.profile_type] || TYPE_META.helper;
          const hiding = hideTarget
            && hideTarget.profile_type === r.profile_type
            && String(hideTarget.profile_id) === String(r.profile_id);
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
                    {r.is_hidden_by_admin ? (
                      <span style={badge('#fef2f2', '#b91c1c')}>
                        <EyeOff size={13} aria-hidden />
                        {copy('statusHidden', { defaultValue: 'Hidden by admin' })}
                        {r.hidden_reason && ` - ${reasonLabel(r.hidden_reason)}`}
                      </span>
                    ) : r.is_visible ? (
                      <span style={badge('#f0fdf4', '#15803d')}>
                        <Eye size={13} aria-hidden />
                        {copy('statusVisible', { defaultValue: 'Visible publicly' })}
                      </span>
                    ) : (
                      <span style={badge('#fffbeb', '#b45309')}>
                        <EyeOff size={13} aria-hidden />
                        {copy('statusUnlisted', { defaultValue: 'Not listed by owner' })}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <button type="button" style={btn} disabled={historyLoading} onClick={() => loadHistory(r)}>
                    <History size={15} aria-hidden /> {copy('history', { defaultValue: 'History' })}
                  </button>{' '}
                  {r.is_hidden_by_admin ? (
                    <button type="button" style={btn} disabled={saving} onClick={() => setRestoreTarget(r)}>
                      {copy('restore', { defaultValue: 'Restore' })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={btnDanger}
                      disabled={saving}
                      onClick={() => { setHideTarget(r); setHideReason('incomplete_profile'); setHideNote(''); }}
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
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button type="button" style={btn} disabled={saving} onClick={() => setHideTarget(null)}>
                      {copy('cancel', { defaultValue: 'Cancel' })}
                    </button>
                    <button type="button" style={btnDanger} disabled={saving} onClick={() => applyVisibility(r, false)}>
                      {copy('confirmHide', { defaultValue: 'Hide profile' })}
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
        <div role="dialog" aria-modal="true" aria-labelledby="profile-visibility-history-title" style={{ ...card, marginTop: '1.5rem', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
            <h2 id="profile-visibility-history-title" style={{ color: 'var(--color-text)', fontSize: '1.1rem', margin: 0 }}>
              {copy('historyTitle', { name: historyTarget.display_name, defaultValue: `Visibility history: ${historyTarget.display_name}` })}
            </h2>
            <button type="button" style={btn} onClick={() => setHistoryTarget(null)}>{copy('closeHistory', { defaultValue: 'Close' })}</button>
          </div>
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
        </div>
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
    </div>
  );
}
