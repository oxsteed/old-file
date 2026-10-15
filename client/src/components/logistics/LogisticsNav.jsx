import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LOGISTICS_WORKSPACES,
  workspaceAvailabilityForUser,
} from '../../utils/logisticsWorkspaces';
import './LogisticsNav.css';

/**
 * LogisticsNav - compact, permission-aware workspace navigation.
 *
 * Replaces the repeated workspace tile grids. Renders only the
 * workspaces the current user can access, derived from
 * workspaceAvailabilityForUser(user, businessAccess):
 *
 *   buyer ............ always (guests included)
 *   organizer ........ signed-in users
 *   business ......... eligible business members or admins
 *   distributor ...... signed-in users
 *   operations ....... logistics operators with an operations route
 *   compliance ....... compliance reviewers
 *   admin control .... admins / super admins
 *
 * Native links: keyboard navigable, 44px touch targets, aria-current
 * on the active item, and logical CSS properties for RTL.
 */
const WORKSPACE_LABEL_KEYS = {
  buyer: 'logistics.nav.buyer',
  organizer: 'logistics.nav.organizer',
  business_procurement: 'logistics.nav.businessProcurement',
  distributor: 'logistics.nav.distributor',
  operations: 'logistics.nav.operations',
  compliance: 'logistics.nav.compliance',
  admin_control: 'logistics.nav.adminControl',
};

export default function LogisticsNav({ user, businessAccess = null }) {
  const { t } = useTranslation();
  const availability = workspaceAvailabilityForUser(user, businessAccess);

  const items = [
    { key: 'hub', path: '/logistics', labelKey: 'logistics.nav.hub', exact: true },
    ...LOGISTICS_WORKSPACES.filter((w) => availability[w.key] !== false).map(
      (w) => ({
        key: w.key,
        path: w.path,
        labelKey: WORKSPACE_LABEL_KEYS[w.key] || `logistics.nav.${w.key}`,
        exact: false,
      }),
    ),
  ];

  return (
    <nav className="lx-nav" aria-label={t('logistics.nav.label')}>
      <ul className="lx-nav-list">
        {items.map((item) => (
          <li key={item.key} className="lx-nav-item">
            <NavLink
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `lx-nav-link${isActive ? ' lx-nav-link-active' : ''}`
              }
            >
              {t(item.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
