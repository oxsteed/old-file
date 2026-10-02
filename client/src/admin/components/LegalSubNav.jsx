import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminRoute } from '../adminRouteManifest';

const LEGAL_SUBNAV_ITEMS = [
  { routeKey: 'legalAcceptances', labelKey: 'adminNav.legalAcceptances' },
  { routeKey: 'legalAuditLog', labelKey: 'adminNav.legalAuditLog' },
  { routeKey: 'legalComplianceMetrics', labelKey: 'adminNav.legalComplianceMetrics' },
  { routeKey: 'legalCcpaRequests', labelKey: 'adminNav.legalCcpaRequests' },
];

export default function LegalSubNav() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('adminNav.legal')} className="flex gap-2 overflow-x-auto pb-1">
      {LEGAL_SUBNAV_ITEMS.map((item) => (
        <NavLink
          key={item.routeKey}
          to={adminRoute(item.routeKey).path}
          className={({ isActive }) => `whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition ${isActive ? 'border-orange-500/60 bg-orange-500/15 text-orange-200' : 'border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-500 hover:text-white'}`}
        >
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
