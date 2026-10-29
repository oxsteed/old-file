import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, MessageSquare, Receipt, RefreshCw } from 'lucide-react';
import { useBusinessOperations } from '../../hooks/useBusinessOperations';
import '../../styles/BusinessOperationsOverview.css';

const CARDS = [
  { section: 'bookings', field: 'today', label: 'todayBookings', panel: 'calendar', icon: CalendarDays },
  { section: 'messages', field: 'unanswered', label: 'unansweredMessages', panel: 'messages', icon: MessageSquare },
  { section: 'invoices', field: 'overdue', label: 'overdueInvoices', panel: 'invoices', icon: Receipt },
];

export default function BusinessOperationsOverview({ businessId, viewerId, role, onOpen, availablePanels }) {
  const { t, i18n } = useTranslation();
  const { data, error, loading, retry } = useBusinessOperations(businessId, viewerId, role);
  const tr = (key, options) => t(`businessOperations.${key}`, options);
  const number = value => new Intl.NumberFormat(i18n.language).format(value);
  const canOpen = panel => !availablePanels || availablePanels.includes(panel);
  const tasks = data?.tasks || [];
  return <section className="business-operations" aria-busy={loading}>
    <header className="business-operations__heading">
      <div><h2>{tr('title')}</h2><p>{tr('description')}</p></div>
      <button type="button" onClick={retry} disabled={loading} className="business-operations__refresh" data-track="business.operations.refresh">
        <RefreshCw size={16} aria-hidden="true" />{tr('refresh')}
      </button>
    </header>
    {loading && <p role="status">{tr('loading')}</p>}
    {error && <p role="alert">{tr('loadError')}</p>}
    {data && <>
      <p className="business-operations__zone">{tr('timezone', { timezone: data.timezone })}</p>
      {data.partial && <p role="status">{tr('partial')}</p>}
      <dl className="business-operations__cards">
        {CARDS.filter(card => data.sections[card.section]?.available).map(({ section, field, label, panel, icon: Icon }) => {
          const status = data.sections[section];
          const labelKey = section === 'bookings' && status.scope === 'self' ? 'yourTodayBookings' : label;
          return <div key={section} className="business-operations__card">
            <dt><Icon size={18} aria-hidden="true" />{tr(labelKey)}</dt>
            <dd>{status.status === 'ready' ? number(status[field]) : tr('unavailable')}</dd>
            {canOpen(panel) && <button type="button" onClick={() => onOpen(panel)} data-track="business.operations.open">
              {tr(`open.${section}`)}<ArrowRight size={15} aria-hidden="true" />
            </button>}
          </div>;
        })}
      </dl>
      <section className="business-operations__attention" aria-label={tr('needsAttention')}>
        <h3>{tr('needsAttention')}</h3>
        {tasks.length ? <ul>{tasks.map(task => <li key={task.type}>
          <span>{tr(`tasks.${task.type}`, { count: task.count })}</span>
          {canOpen(task.panel) && <button type="button" onClick={() => onOpen(task.panel, task)} data-track="business.operations.task">
            {tr('review')}<ArrowRight size={15} aria-hidden="true" />
          </button>}
        </li>)}</ul> : <p>{tr(data.partial ? 'attentionUnavailable' : 'nothingPending')}</p>}
      </section>
      {data.canViewAnalytics && canOpen('analytics') && <button type="button" className="business-operations__analytics" onClick={() => onOpen('analytics')} data-track="business.operations.analytics">
        {tr('viewAnalytics')}<ArrowRight size={15} aria-hidden="true" />
      </button>}
    </>}
  </section>;
}
