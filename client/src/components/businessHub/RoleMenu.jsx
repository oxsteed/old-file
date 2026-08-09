// client/src/components/businessHub/RoleMenu.jsx
//
// Role-aware top menu rail that sits above the existing tab strip
// inside BusinessHubPage. It fetches the user's membership/permissions
// for the active business and renders the menu defined in
// utils/businessHubRoleMenu.js for that role.
//
// On menu-item click it calls setTab(item.tab), reusing the existing
// tab state and tab rendering inside BusinessHubPage. No new pages.

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyMembership } from '../../api/vortex';
import { buildVisibleMenu, getMenuForRole } from '../../utils/businessHubRoleMenu';
import { LAUNCH_VISIBILITY } from '../../utils/launchScope';

const ROLE_PILL_STYLES = {
  owner:           { bg: 'rgba(249,115,22,0.12)', color: '#c2410c', border: 'rgba(249,115,22,0.4)' },
  manager:         { bg: 'rgba(59,130,246,0.12)', color: '#1d4ed8', border: 'rgba(59,130,246,0.4)' },
  representative:  { bg: 'rgba(168,85,247,0.12)', color: '#7e22ce', border: 'rgba(168,85,247,0.4)' },
  employee:        { bg: 'rgba(20,184,166,0.12)', color: '#0f766e', border: 'rgba(20,184,166,0.4)' },
  support_agent:   { bg: 'rgba(244,63,94,0.12)',  color: '#be123c', border: 'rgba(244,63,94,0.4)' },
};

export default function RoleMenu({ businessId, activeTab, onSelectTab }) {
  const { t } = useTranslation();
  const [membership, setMembership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!businessId) { setLoading(false); return undefined; }
    setLoading(true);
    setErrored(false);
    (async () => {
      try {
        const data = await getMyMembership(businessId);
        if (cancelled) return;
        setMembership(data || null);
      } catch (_) {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const role = membership?.role || 'owner';
  const permissions = useMemo(() => new Set(membership?.permissions || []), [membership]);
  const menu = useMemo(() => buildVisibleMenu(role, permissions), [role, permissions]);
  const config = getMenuForRole(role);

  if (loading || errored || !membership) {
    // Don't render the role menu until we know who the user is — the
    // existing tab strip stays usable in the meantime.
    return null;
  }

  // Owner only sees the rail when there are 2+ roles in play (i.e. they
  // also belong to other businesses or have invited people). We still
  // render it for owners because it's the cleaner navigation; the existing
  // tab strip below stays for fine-grained access.
  const pillStyle = ROLE_PILL_STYLES[role] || ROLE_PILL_STYLES.owner;

  return (
    <nav
      className="bh-role-menu"
      aria-label={t('businessHub.menu.aria', { defaultValue: 'Workspace navigation' })}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        marginBottom: '0.75rem',
        borderRadius: 14,
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.15rem 0.6rem',
            borderRadius: 999,
            fontSize: '0.72rem',
            fontWeight: 600,
            textTransform: 'capitalize',
            background: pillStyle.bg,
            color: pillStyle.color,
            border: `1px solid ${pillStyle.border}`,
          }}
        >
          {t(`vortex.roles.${role}`, { defaultValue: role.replace('_', ' ') })}
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted-text)' }}>
          {t('businessHub.menu.intro', {
            defaultValue: 'Your view is tailored to your role.',
          })}
        </span>
      </div>
      <ul
        role="menu"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.35rem',
        }}
      >
        {menu.map((item) => {
          const isActive = activeTab === item.tab;
          return (
            <li key={item.id} role="none">
              <button
                role="menuitem"
                type="button"
                onClick={() => item.tab && onSelectTab && onSelectTab(item.tab)}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  appearance: 'none',
                  border: '1px solid',
                  borderColor: isActive ? pillStyle.color : 'var(--border-color)',
                  background: isActive ? pillStyle.bg : 'transparent',
                  color: isActive ? pillStyle.color : 'var(--app-text)',
                  padding: '0.4rem 0.85rem',
                  borderRadius: 10,
                  fontSize: '0.85rem',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}
              >
                {t(item.label, { defaultValue: item.id })}
              </button>
            </li>
          );
        })}
      </ul>
      {LAUNCH_VISIBILITY.businessHubRoleMenuWidgets && config.widgets && config.widgets.length > 0 && role !== 'owner' ? (
        <div style={{ fontSize: '0.72rem', color: 'var(--muted-text)' }}>
          {t('businessHub.menu.widgetsHint', {
            defaultValue: 'Home widgets shown on Overview: {{list}}',
            list: config.widgets.map((w) => t(`businessHub.widgets.${w}`, { defaultValue: w.replace(/_/g, ' ') })).join(', '),
          })}
        </div>
      ) : null}
    </nav>
  );
}
