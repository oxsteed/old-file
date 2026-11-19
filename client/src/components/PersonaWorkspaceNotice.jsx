import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { capabilityShortcuts, modeBackedByAccess, projectionActive } from '../utils/accessProjection';
import { familyForMode, primaryRouteForFamily } from '../utils/personaNavigation';

// G-13: customer-first landing is kept by design (vision §5 rule 1), but an
// approved persona workspace must be discoverable from landing instead of
// silently discarding the saved preference. When the projection is ready
// and the saved preference is backed by access, render a notice plus working
// shortcuts: the catalog primary for the preferred family first (G-40 route
// map), then the capability shortcuts for anything else the account holds.
// A customer preference never renders this: customer Home is already the
// landing. A backed preference whose workspace is not ready (activation
// incomplete, reporting without an audience) renders nothing: the setup
// path in nav covers it.
export default function PersonaWorkspaceNotice({ preferredMode, projection }) {
  const { t } = useTranslation();
  const { t: accessT } = useTranslation('common');
  if (!projectionActive(projection)) return null;
  if (!preferredMode || preferredMode === 'customer') return null;
  if (!modeBackedByAccess(preferredMode, projection.access)) return null;
  const family = familyForMode(preferredMode);
  const primaryTo = family ? primaryRouteForFamily(family.id, projection) : null;
  if (family?.capability && !primaryTo) return null;
  const links = [];
  if (primaryTo) links.push({ id: 'workspace-primary', to: primaryTo, labelKey: 'progressiveAccess.home.openWorkspace', common: true });
  for (const shortcut of capabilityShortcuts('customer', projection)) {
    if (!links.some((item) => item.to === shortcut.to)) links.push(shortcut);
  }
  if (!links.length) return null;
  return (
    <div className="mx-auto max-w-5xl px-4 pt-3">
      <p role="status" className="text-sm text-gray-700 dark:text-gray-300">{accessT('progressiveAccess.home.workspaceReady')}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {links.map((item) => (
          <li key={item.id}>
            <Link className="text-sm font-medium text-primary underline" to={item.to}>
              {item.common ? accessT(item.labelKey) : t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
