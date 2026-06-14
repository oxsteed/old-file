// OxSteed Network switcher — the branch/app-switching layer for OxSteed Network.
// Major branches (Marketplace, Restaurants, Logistics, Business Launch, Consulting,
// Support Workspace, Vortex, Settings) live here instead of being buried under
// "Resources". One OxSteed ID, many branches; access is role/permission-gated by
// each destination, so this menu only routes — it does not grant access.
import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getNetworkBranches } from '../utils/networkBranches';

/** The 3x3 grid "apps" glyph used on the Network launcher button. */
function GridGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="9.5" y="3" width="6" height="6" rx="1.5" />
      <rect x="16" y="3" width="5" height="6" rx="1.5" />
      <rect x="3" y="9.5" width="6" height="6" rx="1.5" />
      <rect x="9.5" y="9.5" width="6" height="6" rx="1.5" />
      <rect x="16" y="9.5" width="5" height="6" rx="1.5" />
      <rect x="3" y="16" width="6" height="5" rx="1.5" />
      <rect x="9.5" y="16" width="6" height="5" rx="1.5" />
      <rect x="16" y="16" width="5" height="5" rx="1.5" />
    </svg>
  );
}

/**
 * OxSteed Network branch switcher.
 *
 * @param {boolean}  props.showSupportWorkspace  Show the Support Workspace entry
 *                   (the navbar already resolves whether the user is a support agent).
 * @param {Function} props.onNavigate            Optional callback fired when a branch is chosen
 *                   (used by the mobile menu to close itself).
 * @param {boolean}  props.mobile                Render as an inline list (mobile menu) instead of a dropdown.
 */
export default function OxSteedNetworkSwitcher({ showSupportWorkspace = false, onNavigate, mobile = false }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Branch catalog (shared with the /network full-page launcher).
  const branches = getNetworkBranches(t, { showSupportWorkspace });

  const handleClick = () => {
    setOpen(false);
    if (onNavigate) onNavigate();
  };

  // Inline list variant for the mobile menu.
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        <div style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--color-text-muted)', padding: '0.5rem 0.75rem 0.25rem',
        }}>
          {t('nav.network', 'OxSteed Network')}
        </div>
        {branches.map((b) => (
          <Link
            key={b.to}
            to={b.to}
            onClick={handleClick}
            className="ox-net-option"
            style={{ padding: '0.5rem 0.75rem' }}
          >
            <span className="ox-net-option-title">{b.title}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="ox-btn ox-btn-ghost ox-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="nav-network-menu"
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: open ? 'var(--color-primary)' : 'var(--color-nav-link)' }}
      >
        <GridGlyph size={15} />
        {t('nav.network', 'OxSteed Network')}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          id="nav-network-menu"
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 0.35rem)',
            width: 'min(28rem, calc(100vw - 2rem))',
            padding: '0.5rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.18)',
            zIndex: 60,
          }}
        >
          <div style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            color: 'var(--color-text-muted)', padding: '0.25rem 0.5rem 0.5rem',
          }}>
            {t('network.heading', 'Switch branch')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
            {branches.map((b) => (
              <Link
                key={b.to}
                role="menuitem"
                to={b.to}
                className="ox-net-option"
                onClick={handleClick}
                aria-current={location.pathname.startsWith(b.to) ? 'page' : undefined}
              >
                <span className="ox-net-option-title">{b.title}</span>
                <span className="ox-net-option-hint">{b.hint}</span>
              </Link>
            ))}
          </div>
          <Link
            role="menuitem"
            to="/network"
            onClick={handleClick}
            style={{
              display: 'block', textAlign: 'center', marginTop: '0.35rem',
              padding: '0.5rem', borderRadius: 'var(--radius-sm)',
              fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none',
              color: 'var(--color-primary, #F97316)',
            }}
          >
            {t('network.seeAll', 'See all branches')}
          </Link>
        </div>
      )}
    </div>
  );
}
