import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function LifeVehiclesPage() {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api.get('/vehicles/my')
      .then((r) => {
        if (!cancelled) setVehicles(Array.isArray(r.data) ? r.data : []);
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
          <h1 className="text-3xl font-bold tracking-tight mt-2">{t('lifePages.vehicles.title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.vehicles.subtitle')}</p>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.loading')}</p>
        ) : failed ? (
          <div role="alert" className="rounded-xl p-4 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-sm" style={{ color: '#fca5a5' }}>{t('lifePages.loadFailed')}</span>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="shrink-0 text-sm font-semibold text-red-300 underline">{t('common.retry')}</button>
          </div>
        ) : vehicles.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.vehicles.empty')}</p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {vehicles.map((v) => (
              <li key={v.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
                <div className="text-base font-semibold">
                  {v.nickname || `${v.year || ''} ${v.make_name || ''} ${v.model_name || ''}`.trim()}
                </div>
                <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                  {[v.year, v.make_name, v.model_name].filter(Boolean).join(' ')}
                </div>
                {v.notes && <p className="text-sm mt-2">{v.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </div>
  );
}
