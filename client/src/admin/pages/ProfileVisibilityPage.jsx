import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Eye, EyeOff, Search, Store, User } from 'lucide-react';
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
  const copy = (key, options) => t(`adminProfileVisibility.${key}`, options);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hideTarget, setHideTarget] = useState(null); // profile row being hidden
  const [hideReason, setHideReason] = useState('incomplete_profile');
  const [hideNote, setHideNote] = useState('');
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/admin/profile-visibility/search', {
        params: { q, type: typeFilter },
      });
      setResults(data.results || []);
      setSearched(true);
    } catch (err) {
      logger.error('profile visibility search failed', { message: err.message });
      setError(copy('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter, copy]);

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
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
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
        <button type="button" style={btnPrimary} onClick={search} disabled={loading || query.trim().length < 2}>
          {loading ? copy('searching', { defaultValue: 'Searching' }) : copy('search', { defaultValue: 'Search' })}
        </button>
      </div>

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
