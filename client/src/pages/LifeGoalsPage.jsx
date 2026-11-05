import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function LifeGoalsPage() {
  const { t } = useTranslation();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api.get('/life/goals')
      .then((r) => {
        if (!cancelled) setGoals(Array.isArray(r.data?.goals) ? r.data.goals : []);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
      <Navbar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <div>
          <Link to="/dashboard" className="text-sm text-orange-400 underline">{t('lifePages.backToDashboard')}</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{t('lifePages.goals.title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.goals.subtitle')}</p>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.loading')}</p>
        ) : failed ? (
          <div role="alert" className="rounded-xl p-4 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-sm" style={{ color: '#fca5a5' }}>{t('lifePages.loadFailed')}</span>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="shrink-0 text-sm font-semibold text-red-300 underline">{t('common.retry')}</button>
          </div>
        ) : goals.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.goals.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {goals.map((g) => {
              const target = Number(g.target_value || 0);
              const current = Number(g.current_value || 0);
              const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
              return (
                <li key={g.id} className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
                  <div className="flex justify-between items-baseline gap-3">
                    <span className="text-base font-medium">{g.title}</span>
                    <span className="text-sm whitespace-nowrap" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                      {g.is_completed ? t('lifePages.goals.completed') : `${pct}%`}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,0.15)' }}>
                    <div className="h-full" style={{ width: `${pct}%`, background: '#F97316' }} />
                  </div>
                  <div className="mt-2 text-xs" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                    {t('lifePages.goals.progress', { current, target })}
                    {g.due_date ? ` · ${new Date(g.due_date).toLocaleDateString()}` : ''}
                    {g.goal_type ? ` · ${g.goal_type}` : ''}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <Footer />
    </div>
  );
}
