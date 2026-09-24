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

const link = (to, labelKey, defaultLabel, Icon) => ({ to, labelKey, defaultLabel, Icon });

export const DASHBOARD_QUICK_LINKS = {
  helper: [
    link('/jobs', 'helperDashboard.browseJobs', 'Browse jobs', Briefcase),
    link('/my-bids', 'helperDashboard.myBids', 'My bids', FileText),
    link('/calendar', 'nav.calendar', 'Calendar', CalendarDays),
    link('/helper/messages', 'nav.messages', 'Messages', MessageSquare),
    link('/disputes', 'helperDashboard.disputes', 'Disputes', ShieldCheck),
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

export default function DashboardQuickLinks({ items, className = '' }) {
  const { t } = useTranslation();

  return (
    <nav
      className={`dashboard-quick-links ${className}`.trim()}
      aria-label={t('dashboard.quickLinks', { defaultValue: 'Quick links' })}
    >
      <span className="dashboard-quick-links__label">
        {t('dashboard.quickLinks', { defaultValue: 'Quick links' })}
      </span>
      {items.map(({ to, labelKey, defaultLabel, Icon }) => (
        <Link key={to} to={to} className="dashboard-quick-links__link">
          <Icon size={15} aria-hidden="true" />
          <span>{t(labelKey, { defaultValue: defaultLabel })}</span>
        </Link>
      ))}
    </nav>
  );
}
