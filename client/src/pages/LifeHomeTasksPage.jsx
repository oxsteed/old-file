import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import './LifeHomeTasksPage.css';

export default function LifeHomeTasksPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Group 1, item 26: calendar view of the same home tasks, grouped by
  // due date. No new data model: due_date already exists on every task.
  const [view, setView] = useState('list');
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const qs = filter === 'all' ? '' : `?completed=${filter === 'completed'}`;
    api.get(`/life/home-tasks${qs}`)
      .then((r) => {
        if (!cancelled) setTasks(Array.isArray(r.data?.home_tasks) ? r.data.home_tasks : []);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter, attempt]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
      <Navbar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <div>
          <Link to="/dashboard" className="text-sm text-orange-400 underline">{t('lifePages.backToDashboard')}</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{t('lifePages.homeTasks.title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.homeTasks.subtitle')}</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {['all', 'open', 'completed'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold ${filter === f ? 'bg-orange-500 text-white' : 'border'}`}
              style={filter === f ? undefined : { borderColor: 'var(--color-border, #1f2937)' }}
            >
              {t(`lifePages.homeTasks.filter.${f}`)}
            </button>
          ))}
          <span className="w-2" aria-hidden="true" />
          {['list', 'calendar'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold ${view === v ? 'bg-orange-500 text-white' : 'border border-border'}`}
            >
              {t(`lifePages.homeTasks.view.${v}`)}
            </button>
          ))}
        </div>

        {view === 'calendar' && !loading && !failed && (
          <HomeTasksCalendar tasks={tasks} month={calMonth} onMonthChange={setCalMonth} t={t} />
        )}

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.loading')}</p>
        ) : failed ? (
          <div role="alert" className="rounded-xl p-4 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-sm" style={{ color: '#fca5a5' }}>{t('lifePages.loadFailed')}</span>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="shrink-0 text-sm font-semibold text-red-300 underline">{t('common.retry')}</button>
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.homeTasks.empty')}</p>
        ) : view === 'list' ? (
          <ul className="flex flex-col gap-3">
            {tasks.map((tk) => (
              <li key={tk.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-sm font-medium ${tk.is_completed ? 'line-through opacity-60' : ''}`}>{tk.title}</span>
                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                    {tk.is_completed ? t('lifePages.homeTasks.completed') : (tk.urgency || '')}
                  </span>
                </div>
                {tk.description && <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{tk.description}</p>}
                <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                  {tk.due_date ? new Date(tk.due_date).toLocaleDateString() : ''}
                  {tk.vehicle_name ? ` · ${tk.vehicle_name}` : ''}
                  {tk.home_name ? ` · ${tk.home_name}` : ''}
                  {tk.estimated_cost != null ? ` · $${Number(tk.estimated_cost).toFixed(0)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}

// Group 1, item 26: a month grid of the customer's home tasks, grouped by
// their existing due_date. Overdue tasks surface first so nothing slips.
function HomeTasksCalendar({ tasks, month, onMonthChange, t }) {
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const firstWeekday = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const byDay = new Map();
  const overdue = [];
  for (const tk of tasks) {
    if (!tk.due_date) continue;
    const key = String(tk.due_date).slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(tk);
    if (!tk.is_completed && key < todayKey) overdue.push(tk);
  }

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta) => onMonthChange(new Date(year, monthIdx + delta, 1));
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdayLabels = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    new Date(2026, 0, 4 + d).toLocaleDateString(undefined, { weekday: 'short' }),
  );

  return (
    <section aria-label={t('lifePages.homeTasks.calendarTitle')}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <button type="button" onClick={() => shift(-1)} className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold">
          {t('lifePages.homeTasks.prevMonth')}
        </button>
        <h2 className="text-lg font-semibold">{monthLabel}</h2>
        <button type="button" onClick={() => shift(1)} className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold">
          {t('lifePages.homeTasks.nextMonth')}
        </button>
      </div>
      {overdue.length > 0 && (
        <p role="status" className="text-sm mb-3 text-red-300">
          {t('lifePages.homeTasks.overdueCount', { count: overdue.length })}
          {': '}
          {overdue.slice(0, 3).map((tk) => tk.title).join(', ')}
          {overdue.length > 3 ? '…' : ''}
        </p>
      )}
      <div className="grid grid-cols-7 gap-1" role="grid">
        {weekdayLabels.map((wd) => (
          <div key={wd} className="text-center text-xs font-semibold py-1 text-muted">{wd}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} aria-hidden="true" />;
          const key = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayTasks = byDay.get(key) || [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              role="gridcell"
              aria-label={`${monthLabel} ${day}${dayTasks.length ? `: ${dayTasks.map((tk) => tk.title).join(', ')}` : ''}`}
              className={`min-h-16 rounded-lg border p-1.5 text-xs ${isToday ? 'ht-cal-day-today' : 'ht-cal-day'}`}
            >
              <span className="font-semibold">{day}</span>
              {dayTasks.slice(0, 2).map((tk) => (
                <span key={tk.id} className={`block truncate mt-0.5 ${tk.is_completed ? 'line-through opacity-60' : ''}`} title={tk.title}>
                  {tk.title}
                </span>
              ))}
              {dayTasks.length > 2 && (
                <span className="block mt-0.5 text-muted">
                  {t('lifePages.homeTasks.moreTasks', { count: dayTasks.length - 2 })}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {tasks.filter((tk) => !tk.due_date).length > 0 && (
        <p className="text-sm mt-3 text-muted">
          {t('lifePages.homeTasks.unscheduledCount', { count: tasks.filter((tk) => !tk.due_date).length })}
        </p>
      )}
    </section>
  );
}
