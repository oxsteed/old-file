import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useAuth } from '../hooks/useAuth';

function fmtCurrency(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
}

export default function LifeExpensesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currency = user?.preferred_currency || 'USD';
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const qs = filter === 'all' ? 'limit=100' : `limit=100&type=${filter}`;
    api.get(`/life/expenses?${qs}`)
      .then((r) => {
        if (cancelled) return;
        setExpenses(Array.isArray(r.data?.expenses) ? r.data.expenses : []);
        setSummary(r.data?.summary || null);
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
          <h1 className="text-3xl font-bold tracking-tight mt-2">{t('lifePages.expenses.title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.expenses.subtitle')}</p>
        </div>

        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
              <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.expenses.income')}</div>
              <div className="text-lg font-semibold">{fmtCurrency(summary.total_income, currency)}</div>
            </div>
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
              <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.expenses.expenses')}</div>
              <div className="text-lg font-semibold">{fmtCurrency(summary.total_expenses, currency)}</div>
            </div>
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
              <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.expenses.net')}</div>
              <div className="text-lg font-semibold">{fmtCurrency(summary.net, currency)}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {['all', 'expense', 'income'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold ${filter === f ? 'bg-orange-500 text-white' : 'border'}`}
              style={filter === f ? undefined : { borderColor: 'var(--color-border, #1f2937)' }}
            >
              {t(`lifePages.expenses.filter.${f}`)}
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
        ) : expenses.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.expenses.empty')}</p>
        ) : (
          <ul className="divide-y rounded-xl border px-5" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
            {expenses.map((e) => (
              <li key={e.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{e.description || e.category}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                    {e.occurred_at ? new Date(e.occurred_at).toLocaleDateString() : ''} · {e.category}
                    {e.frequency && e.frequency !== 'one_time' ? ` · ${e.frequency}` : ''}
                  </div>
                </div>
                <div className={`text-sm font-semibold whitespace-nowrap ${e.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                  {e.type === 'income' ? '+' : '-'}{fmtCurrency(e.amount, currency)}
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
