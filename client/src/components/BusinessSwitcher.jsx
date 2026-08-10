import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { listBusinesses, listManagedBusinesses } from '../api/businesses';
import { getMyBusinesses, setWorkspaceContext } from '../api/vortex';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';

const LS_KEY = 'oxs:bh:lastBusinessId';

/**
 * Global business switcher for the navbar.
 *
 * Renders nothing for users who own/manage zero businesses.
 * Renders a single-business chip (no dropdown) for users with exactly one.
 * Renders a dropdown for users with multiple, with quick switching that
 * navigates to /business/:businessId/workspace/<currentTab>.
 *
 * Source of truth for the active business (in priority order):
 *   1. useParams().businessId — when we're already on a /business/:id/workspace URL
 *   2. localStorage('oxs:bh:lastBusinessId')
 *   3. First business in the list
 */
export default function BusinessSwitcher({ compact = false }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeParams = useParams();
  const routeBusinessId = routeParams.businessId ? String(routeParams.businessId) : null;
  const routeTab = routeParams.tab ? String(routeParams.tab) : null;

  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Don't try to fetch until we have a logged-in user.
  const userId = user && user.id ? user.id : null;

  useEffect(() => {
    if (!userId) {
      setBusinesses([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Primary: unified /me/businesses (post-team-role spec).
      // Fallback: legacy listBusinesses + listManagedBusinesses (pre-migration-245
      // deployments don't have the new endpoint yet).
      try {
        const data = await getMyBusinesses();
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length > 0) {
          const normalized = items
            .filter(b => b.status === 'active')
            .map(b => ({
              id: b.business_id,
              business_name: b.business_name,
              _role: b.role,
              _is_owner: b.is_owner,
              _last_selected_at: b.last_selected_at,
            }));
          setBusinesses(normalized);
          setLoading(false);
          return;
        }
      } catch (_) {
        // fall through to legacy
      }
      try {
        const [owned, managed] = await Promise.all([
          listBusinesses().catch(() => []),
          listManagedBusinesses().catch(() => []),
        ]);
        if (cancelled) return;
        const ownedTagged = (owned || []).map(b => ({ ...b, _role: 'owner', _is_owner: true }));
        const managedTagged = (managed || []).map(b => ({ ...b, _role: b.role || 'manager', _is_owner: false }));
        const seen = new Set(ownedTagged.map(b => String(b.id)));
        const merged = [
          ...ownedTagged,
          ...managedTagged.filter(b => !seen.has(String(b.id))),
        ];
        setBusinesses(merged);
      } catch {
        if (!cancelled) setBusinesses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const activeId = routeBusinessId
    || (typeof window !== 'undefined' && localStorage.getItem(LS_KEY))
    || (businesses[0] && String(businesses[0].id))
    || null;

  const active = businesses.find(b => String(b.id) === String(activeId)) || null;

  const switchTo = useCallback((id) => {
    if (!id) return;
    localStorage.setItem(LS_KEY, String(id));
    // Best-effort: record the user's current workspace selection server-side
    // so subsequent logins land on the right business.
    setWorkspaceContext(id).catch(() => {});
    const tab = routeTab && routeBusinessId ? routeTab : '';
    const path = tab
      ? `/business/${id}/workspace/${tab}`
      : `/business/${id}/workspace`;
    navigate(path);
    setOpen(false);
  }, [navigate, routeTab, routeBusinessId]);

  if (!userId || loading || businesses.length === 0) return null;

  // Single business → just a static link, no dropdown.
  if (businesses.length === 1) {
    const b = businesses[0];
    const path = `/business/${b.id}/workspace`;
    return (
      <Link
        to={path}
        className="ox-biz-switcher ox-biz-switcher--single"
        title={b.business_name || t('businessHub.title')}
      >
        <BizAvatar name={b.business_name} />
        {!compact && <span className="ox-biz-switcher__name">{b.business_name}</span>}
      </Link>
    );
  }

  return (
    <div className={`ox-biz-switcher ${compact ? 'ox-biz-switcher--compact' : ''}`} ref={menuRef}>
      <button
        type="button"
        className="ox-biz-switcher__btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('businessHub.switchBusiness', { defaultValue: 'Switch business' })}
      >
        <BizAvatar name={active && active.business_name} />
        {!compact && (
          <>
            <span className="ox-biz-switcher__name">
              {active ? active.business_name : t('businessHub.title')}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </>
        )}
      </button>
      {open && (
        <div className="ox-biz-switcher__menu" role="menu">
          {businesses.map(b => {
            const isActive = String(b.id) === String(activeId);
            return (
              <button
                key={b.id}
                type="button"
                role="menuitem"
                className={`ox-biz-switcher__item ${isActive ? 'ox-biz-switcher__item--active' : ''}`}
                onClick={() => switchTo(b.id)}
              >
                <BizAvatar name={b.business_name} />
                <span className="ox-biz-switcher__item-text">
                  <span className="ox-biz-switcher__item-name">{b.business_name}</span>
                  <span className="ox-biz-switcher__item-role">{b._role || 'owner'}</span>
                </span>
                {isActive && (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2 7 L6 11 L12 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
          {LAUNCH_VISIBILITY.vortexWorkspaceEntry && <Link
            to="/vortex"
            role="menuitem"
            className="ox-biz-switcher__item ox-biz-switcher__item--vortex"
            onClick={() => setOpen(false)}
          >
            <span className="ox-biz-switcher__avatar" aria-hidden="true">+</span>
            <span className="ox-biz-switcher__item-text">
              <span className="ox-biz-switcher__item-name">
                {t('businessHub.switchToVortex', { defaultValue: 'Join or manage workspaces' })}
              </span>
              <span className="ox-biz-switcher__item-role">
                {t('businessHub.vortexHint', { defaultValue: 'Enter access code' })}
              </span>
            </span>
          </Link>}
        </div>
      )}
    </div>
  );
}

function BizAvatar({ name }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0])
    .join('')
    .toUpperCase() || '?';
  return <span className="ox-biz-switcher__avatar" aria-hidden="true">{initials}</span>;
}
