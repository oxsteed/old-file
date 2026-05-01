import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Headphones, MessageSquare, RefreshCw } from 'lucide-react';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

function kindLabel(kind, t) {
  if (kind === 'business') return t('supportAgentPortal.kindBusiness');
  if (kind === 'helper') return t('supportAgentPortal.kindHelper');
  if (kind === 'platform') return t('supportAgentPortal.kindPlatform');
  return kind || '—';
}

export default function SupportAgentPortalPage() {
  const { t } = useTranslation();
  const { isHelper } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/support/agent/me');
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setGlobalAvailability = async (isAvailable) => {
    setSaving(true);
    setError(null);
    try {
      await api.patch('/support/agent/me/availability', { is_available: isAvailable });
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const anyOnline = rows.some((r) => r.is_available);

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--app-text)] flex items-center gap-2">
              <Headphones className="text-orange-500 shrink-0" size={28} aria-hidden />
              {t('supportAgentPortal.title')}
            </h1>
            <p className="text-[var(--muted-text)] text-sm mt-2">{t('supportAgentPortal.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--muted-text)] hover:text-[var(--app-text)]"
            aria-label={t('common.retry')}
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-700/50 bg-red-950/20 text-red-200 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-[var(--muted-text)]">{t('supportAgentPortal.loading')}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-8 text-center">
            <p className="text-[var(--app-text)] font-medium">{t('supportAgentPortal.emptyTitle')}</p>
            <p className="text-[var(--muted-text)] text-sm mt-2">{t('supportAgentPortal.emptyBody')}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <button
                type="button"
                disabled={saving || anyOnline}
                onClick={() => setGlobalAvailability(true)}
                className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-40"
              >
                {saving ? t('supportAgentPortal.saving') : t('supportAgentPortal.goOnline')}
              </button>
              <button
                type="button"
                disabled={saving || !anyOnline}
                onClick={() => setGlobalAvailability(false)}
                className="px-4 py-2 rounded-lg bg-gray-700 text-white text-sm font-medium disabled:opacity-40"
              >
                {saving ? t('supportAgentPortal.saving') : t('supportAgentPortal.goOffline')}
              </button>
              <Link
                to={isHelper ? '/helper/messages' : '/messages'}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--app-text)] hover:border-orange-500/60"
              >
                <MessageSquare size={16} />
                {t('supportAgentPortal.openMessages')}
              </Link>
            </div>

            <ul className="space-y-3">
              {rows.map((row) => (
                <li
                  key={row.agent_id}
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">
                        {t('supportAgentPortal.employer')} · {kindLabel(row.employer_kind, t)}
                      </p>
                      <p className="text-[var(--app-text)] font-semibold">{row.employer_label}</p>
                      {row.service_business_name && (
                        <p className="text-sm text-[var(--muted-text)] mt-1">
                          {t('supportAgentPortal.serviceContext')}: {row.service_business_name}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-[var(--muted-text)]">{t('supportAgentPortal.status')}</p>
                      <p className="text-[var(--app-text)] font-medium">{row.status}</p>
                      <p className="text-[var(--muted-text)] mt-2">{t('supportAgentPortal.availability')}</p>
                      <p className={row.is_available ? 'text-green-500 font-medium' : 'text-gray-400'}>
                        {row.is_available ? t('common.available') : t('common.unavailable')}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </PageShell>
  );
}
