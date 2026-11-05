import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function LifeHomeTasksPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

        <div className="flex gap-2">
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
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.loading')}</p>
        ) : failed ? (
          <div role="alert" className="rounded-xl p-4 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-sm" style={{ color: '#fca5a5' }}>{t('lifePages.loadFailed')}</span>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="shrink-0 text-sm font-semibold text-red-300 underline">{t('common.retry')}</button>
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.homeTasks.empty')}</p>
        ) : (
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
        )}
      </main>
      <Footer />
    </div>
  );
}
