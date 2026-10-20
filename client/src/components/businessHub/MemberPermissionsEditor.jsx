import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { getTeamCatalog, setMembershipOverrides } from '../../api/vortex';

// S-08: per-member permission overrides editor.
//
// The permission catalog (team_permissions + team_role_permissions) is the
// single source of truth. For each catalog code the editor shows the
// member's role default and a tri-state choice: inherit the role default,
// force allow, or force deny. Saving replaces the member's whole override
// set through PUT /businesses/:id/memberships/:membershipId/overrides; the
// server validates codes, ranks and expiries and answers with typed error
// codes, which are mapped to messages below.
const ERROR_KEY_BY_CODE = {
  unknown_permission_code: 'businessHub.permissionsEditor.errorUnknownCode',
  override_expiry_in_past: 'businessHub.permissionsEditor.errorPastExpiry',
  invalid_override_expiry: 'businessHub.permissionsEditor.errorPastExpiry',
  cannot_grant_above_level: 'businessHub.permissionsEditor.errorAboveLevel',
  target_rank_too_high: 'businessHub.permissionsEditor.errorRank',
  cannot_edit_own_overrides: 'businessHub.permissionsEditor.errorOwn',
};

export default function MemberPermissionsEditor({ businessId, member, onClose, onSaved }) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choices, setChoices] = useState({});
  const [details, setDetails] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getTeamCatalog(businessId)
      .then((data) => {
        if (cancelled) return;
        setCatalog(data);
        const initialChoices = {};
        const initialDetails = {};
        for (const o of member.overrides || []) {
          initialChoices[o.permission_code] = o.effect;
          initialDetails[o.permission_code] = {
            reason: o.reason || '',
            expires_at: o.expires_at ? String(o.expires_at).slice(0, 16) : '',
          };
        }
        setChoices(initialChoices);
        setDetails(initialDetails);
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [businessId, member]);

  const roleDefaults = useMemo(() => {
    if (!catalog) return new Set();
    const role = (catalog.roles || []).find((r) => r.code === member.role);
    return new Set(role ? role.permissions || [] : []);
  }, [catalog, member.role]);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const byGroup = new Map();
    for (const p of catalog.permissions || []) {
      const key = p.group_key || 'general';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(p);
    }
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  const memberName = member.first_name
    ? `${member.first_name} ${member.last_name || ''}`.trim()
    : (member.member_email || member.invite_email || '');

  async function handleSave() {
    const overrides = [];
    for (const [code, effect] of Object.entries(choices)) {
      if (effect !== 'allow' && effect !== 'deny') continue;
      const entry = { permission_code: code, effect };
      const d = details[code] || {};
      if (d.reason && d.reason.trim()) entry.reason = d.reason.trim();
      if (d.expires_at) entry.expires_at = new Date(d.expires_at).toISOString();
      overrides.push(entry);
    }
    setSaving(true);
    setError('');
    try {
      await setMembershipOverrides(businessId, member.id, overrides);
      toast.success(t('businessHub.permissionsEditor.saved'));
      onSaved();
    } catch (err) {
      const code = err?.response?.data?.code;
      const key = code && ERROR_KEY_BY_CODE[code];
      setError(key ? t(key) : (err?.response?.data?.error || t('businessHub.permissionsEditor.saveError')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bh-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bh-modal" style={{ maxWidth: '720px', width: '100%' }}>
        <h2>{t('businessHub.permissionsEditor.title')}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)', marginBottom: '0.25rem' }}>
          {memberName}
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
          {t('businessHub.permissionsEditor.description')}
        </p>

        {loadFailed ? (
          <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{t('businessHub.permissionsEditor.loadError')}</p>
        ) : !catalog ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>{t('businessHub.permissionsEditor.loading')}</p>
        ) : (
          <div style={{ maxHeight: '50vh', overflowY: 'auto', marginBottom: '1rem' }}>
            {groups.map(([groupKey, perms]) => (
              <div key={groupKey} style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-text)', marginBottom: '0.4rem' }}>
                  {groupKey}
                </h3>
                {perms.map((p) => {
                  const choice = choices[p.code] || 'inherit';
                  const overridden = choice === 'allow' || choice === 'deny';
                  const d = details[p.code] || {};
                  return (
                    <div key={p.code} style={{ padding: '0.45rem 0', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 220px', minWidth: '180px' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{p.code}</div>
                          {p.description && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--muted-text)' }}>{p.description}</div>
                          )}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>
                          {roleDefaults.has(p.code)
                            ? t('businessHub.permissionsEditor.roleDefaultOn')
                            : t('businessHub.permissionsEditor.roleDefaultOff')}
                        </span>
                        <select
                          className="bh-select"
                          aria-label={p.code}
                          value={choice}
                          onChange={(e) => setChoices((prev) => ({ ...prev, [p.code]: e.target.value }))}
                        >
                          <option value="inherit">{t('businessHub.permissionsEditor.inherit')}</option>
                          <option value="allow">{t('businessHub.permissionsEditor.allow')}</option>
                          <option value="deny">{t('businessHub.permissionsEditor.deny')}</option>
                        </select>
                      </div>
                      {overridden && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                          <input
                            type="text"
                            value={d.reason || ''}
                            placeholder={t('businessHub.permissionsEditor.reasonPlaceholder')}
                            onChange={(e) => setDetails((prev) => ({
                              ...prev,
                              [p.code]: { ...(prev[p.code] || {}), reason: e.target.value },
                            }))}
                            style={{ flex: '1 1 200px' }}
                          />
                          <label style={{ fontSize: '0.78rem', color: 'var(--muted-text)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            {t('businessHub.permissionsEditor.expiresLabel')}
                            <input
                              type="datetime-local"
                              value={d.expires_at || ''}
                              onChange={(e) => setDetails((prev) => ({
                                ...prev,
                                [p.code]: { ...(prev[p.code] || {}), expires_at: e.target.value },
                              }))}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {error && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
        <div className="bh-modal-actions">
          <button className="bh-btn" onClick={onClose} disabled={saving}>{t('businessHub.btnCancel')}</button>
          <button className="bh-btn primary" onClick={handleSave} disabled={saving || !catalog}>
            {saving ? t('businessHub.permissionsEditor.saving') : t('businessHub.permissionsEditor.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
