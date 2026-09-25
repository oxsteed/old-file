import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Briefcase,
  CalendarDays,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShieldCheck,
  Store,
  Wrench,
} from 'lucide-react';
import '../styles/Dashboard.css';

const link = (to, labelKey, defaultLabel, Icon, tone = '', activityKey = '', action = '') => ({
  to,
  labelKey,
  defaultLabel,
  Icon,
  tone,
  activityKey,
  action,
});

export const DASHBOARD_QUICK_LINKS = {
  helper: [
    link('/helper/clients', 'helperDashboard.client', 'Client', LayoutDashboard),
    link('/activity', 'helperDashboard.viewHistory', 'View history', Activity, 'history'),
    link('/verify-identity', 'helperDashboard.verifyId', 'Verify ID', ShieldCheck, 'verify'),
    link('/jobs', 'helperDashboard.browseJobs', 'Browse jobs', Briefcase),
    link('/my-bids', 'helperDashboard.myBids', 'My bids', FileText, '', 'bids'),
    link('/calendar', 'nav.calendar', 'Calendar', CalendarDays, '', 'calendar'),
    link('/helper/messages', 'nav.messages', 'Messages', MessageSquare, '', 'messages'),
    link('/disputes', 'helperDashboard.disputes', 'Disputes', ShieldCheck, '', 'disputes'),
    link('/settings', 'nav.settings', 'Settings', Settings),
  ],
  life: [
    link('/activity', 'dashboard.recentActivity', 'Recent activity', Activity),
    link('/calendar', 'nav.calendar', 'Calendar', CalendarDays),
    link('/planned-needs', 'dashboards.life.plannedNeeds', 'Planned needs', FileText),
    link('/settings', 'nav.settings', 'Account settings', Settings),
  ],
  toolOwner: [
    link('/tool-rentals', 'toolRentals.browsePage', 'Tool rentals', Wrench),
    link('/tool-rentals/analytics', 'toolRentals.analytics', 'Rental analytics', Activity),
    link('/calendar', 'nav.calendar', 'Calendar', CalendarDays),
    link('/settings', 'nav.settings', 'Settings', Settings),
  ],
  franchise: [
    link('/franchise/status', 'franchiseApplicantDashboard.title', 'Application status', FileText),
    link('/franchise/territory', 'franchiseApplicantDashboard.territory', 'Territory', Store),
    link('/support/escalation', 'nav.support', 'Support', ShieldCheck),
    link('/settings', 'nav.settings', 'Settings', Settings),
  ],
  consultant: [
    link('/consulting/contractor-dashboard', 'consultantContractorDashboard.page.title', 'Consultant dashboard', LayoutDashboard),
    link('/consulting', 'nav.consulting', 'Consulting', Briefcase),
    link('/messages', 'nav.messages', 'Messages', MessageSquare),
    link('/settings', 'nav.settings', 'Settings', Settings),
  ],
  businessOwner: [
    link('/business-hub', 'nav.business', 'Business hub', Store),
    link('/messages', 'nav.messages', 'Messages', MessageSquare),
    link('/calendar', 'nav.calendar', 'Calendar', CalendarDays),
    link('/settings', 'nav.settings', 'Settings', Settings),
  ],
  businessRole: [
    link('/messages', 'nav.messages', 'Messages', MessageSquare),
    link('/calendar', 'nav.calendar', 'Calendar', CalendarDays),
    link('/vortex', 'businessRoleDashboard.viewAllWorkspaces', 'Workspaces', Store),
    link('/settings', 'nav.settings', 'Settings', Settings),
  ],
};

export default function DashboardQuickLinks({ items, className = '', activity = {}, onActivityOpen, onAction }) {
  const { t } = useTranslation();

  return (
    <nav
      className={`dashboard-quick-links ${className}`.trim()}
      aria-label={t('dashboard.quickLinks', { defaultValue: 'Quick links' })}
    >
      <span className="dashboard-quick-links__label">
        {t('dashboard.quickLinks', { defaultValue: 'Quick links' })}
      </span>
      {items.map(({ to, labelKey, defaultLabel, Icon, tone, activityKey, action }) => (
        <Link
          key={to}
          to={to}
          onClick={(event) => {
            if (action) onAction?.(action, event);
            if (activityKey) onActivityOpen?.(activityKey);
          }}
          className={`dashboard-quick-links__link${tone ? ` dashboard-quick-links__link--${tone}` : ''}`}
        >
          <Icon size={15} aria-hidden="true" />
          <span>{t(labelKey, { defaultValue: defaultLabel })}</span>
          {activityKey && activity[activityKey] > 0 && (
            <span
              className="dashboard-quick-links__activity"
              aria-label={t('helperDashboard.newActivityCount', { count: activity[activityKey] })}
            >
              {activity[activityKey] > 99 ? '99+' : activity[activityKey]}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
