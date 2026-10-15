import { useAuth } from '../../context/AuthContext';
import LogisticsNav from './LogisticsNav';
import './LogisticsLayout.css';

/**
 * LogisticsLayout - shared wrapper for all Logistics pages.
 *
 * Provides the compact, permission-aware workspace navigation plus a
 * consistent content width, typography, and spacing built on the site's
 * theme tokens (var(--color-*) / var(--space-*)). Pages keep rendering
 * PageShell themselves; this sits inside it.
 *
 * Props:
 *  - title / subtitle: optional page header
 *  - actions: optional header actions (buttons/links)
 *  - businessAccess: optional { eligibleBusinesses, businesses } from
 *    getBusinessProcurementAccess(); without it, gated workspaces fall
 *    back to admin/operator-only visibility
 *  - showNav: set false when a page handles navigation itself
 */
export default function LogisticsLayout({
  children,
  title,
  subtitle,
  actions,
  businessAccess = null,
  showNav = true,
  className = '',
}) {
  const { user } = useAuth();

  return (
    <div className={`lx-layout ${className}`.trim()}>
      {showNav && <LogisticsNav user={user} businessAccess={businessAccess} />}
      <div className="lx-layout-content">
        {(title || subtitle || actions) && (
          <header className="lx-layout-header">
            <div className="lx-layout-heading">
              {title && <h1 className="lx-layout-title">{title}</h1>}
              {subtitle && <p className="lx-layout-sub">{subtitle}</p>}
            </div>
            {actions && <div className="lx-layout-actions">{actions}</div>}
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
