import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminRoute } from '../adminRouteManifest';

const SUPPORT_SUBNAV_ITEMS = [
  { routeKey: 'support', labelKey: 'adminNav.supportTickets' },
  { routeKey: 'supportAgentDashboard', labelKey: 'adminNav.supportAgentDashboard' },
  { routeKey: 'supportAgents', labelKey: 'adminNav.supportAgents' },
  { routeKey: 'supportAgentOnboarding', labelKey: 'adminNav.supportAgentOnboarding' },
  { routeKey: 'supportShifts', labelKey: 'adminNav.supportShifts' },
  { routeKey: 'supportTeamHierarchy', labelKey: 'adminNav.supportTeam' },
  { routeKey: 'supportEscalations', labelKey: 'adminNav.supportEscalations' },
  { routeKey: 'supportSla', labelKey: 'adminNav.supportSla' },
  { routeKey: 'supportKnowledgeBase', labelKey: 'adminNav.supportKnowledgeBase' },
  { routeKey: 'supportTemplates', labelKey: 'adminNav.supportTemplates' },
  { routeKey: 'supportMetrics', labelKey: 'adminNav.supportMetrics' },
  { routeKey: 'supportPerformance', labelKey: 'adminNav.supportPerformance' },
  { routeKey: 'supportCsat', labelKey: 'adminNav.supportCsat' },
  { routeKey: 'supportQa', labelKey: 'adminNav.supportQa' },
  { routeKey: 'supportSettings', labelKey: 'adminNav.supportSettings' },
  { routeKey: 'supportAudit', labelKey: 'adminNav.supportAuditLog' },
];

export default function SupportSubNav() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('adminNav.supportSection', { defaultValue: 'Support section' })} className="flex gap-2 overflow-x-auto pb-1">
      {SUPPORT_SUBNAV_ITEMS.map((item) => (
        <NavLink
          key={item.routeKey}
          to={adminRoute(item.routeKey).path}
          end={item.routeKey === 'support'}
          className={({ isActive }) => `whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition ${isActive ? 'border-orange-500/60 bg-orange-500/15 text-orange-200' : 'border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-500 hover:text-white'}`}
        >
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
