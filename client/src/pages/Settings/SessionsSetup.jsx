import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MonitorSmartphone, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import { userSessionsAPI } from '../../api/userSessions';

// Review P3-14-F03: user-facing session management. Lists the account's
// active sessions, revokes one session, and offers "log out everywhere"
// (every session except the current one) through GET/DELETE
// /api/users/me/sessions.
function describeDevice(session) {
  const ua = String(session?.user_agent || '').trim();
  if (!ua) return null;
  const lower = ua.toLowerCase();
  const parts = [];
  if (lower.includes('mobile') || lower.includes('android') || lower.includes('iphone')) {
    parts.push('Mobile');
  } else if (lower.includes('tablet') || lower.includes('ipad')) {
    parts.push('Tablet');
  } else {
    parts.push('Desktop');
  }
  if (lower.includes('chrome') && !lower.includes('edg')) parts.push('Chrome');
  else if (lower.includes('safari') && !lower.includes('chrome')) parts.push('Safari');
  else if (lower.includes('firefox')) parts.push('Firefox');
  else if (lower.includes('edg')) parts.push('Edge');
  return parts.join(' · ');
}

function SessionRow({ session, onRevoke, busy, t }) {
  const deviceLabel = describeDevice(session) || t('sessions.unknownDevice');
  const lastActive = session.last_used_at
    ? t('sessions.lastActive', { date: new Date(session.last_used_at).toLocaleString() })
    : null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2/80 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <MonitorSmartphone size={18} className="shrink-0 text-muted" />
        <div className="min-w-0">
          <p className="truncate text-sm text-content">
            {deviceLabel}
            {session.is_current && (
              <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                {t('sessions.thisDevice')}
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted">
            {[session.ip_address, lastActive].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {!session.is_current && (
        <button
          type="button"
          onClick={() => onRevoke(session)}
          disabled={busy}
          className="shrink-0 text-xs hover:opacity-90 disabled:opacity-50"
          style={{ color: 'var(--color-error)' }} data-track="ui.f970d649f7.1"
        >
          {t('sessions.revoke')}
        </button>
      )}
    </div>
  );
}

export default function SessionsSetup() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await userSessionsAPI.listSessions();
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch {
      setLoadError(true);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const confirmRevokeSession = async () => {
    const session = revokeTarget;
    if (!session?.id || busy) return;
    if (session.is_current) {
      toast.error(t('sessions.revokeCurrentBlocked'));
      setRevokeTarget(null);
      return;
    }
    setBusy(true);
    try {
      await userSessionsAPI.revokeSession(session.id);
      await fetchSessions();
      setRevokeTarget(null);
      toast.success(t('sessions.revoked'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('sessions.revokeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmLogoutEverywhere = async () => {
    if (busy) return;
    const others = sessions.filter((s) => !s.is_current);
    if (others.length === 0) {
      setLogoutAllOpen(false);
      return;
    }
    setBusy(true);
    try {
      for (const session of others) {
        // Sequential revokes: the endpoint is strict-rate-limited.
        await userSessionsAPI.revokeSession(session.id);
      }
      await fetchSessions();
      setLogoutAllOpen(false);
      toast.success(t('sessions.loggedOutEverywhere'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('sessions.logoutEverywhereFailed'));
      await fetchSessions();
    } finally {
      setBusy(false);
    }
  };

  const otherCount = sessions.filter((s) => !s.is_current).length;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-content">
      <Navbar />
      <main className="flex-1 px-4 py-10">
        <div className="mx-auto max-w-lg">
          <Link
            to="/settings"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-content"
          >
            <ArrowLeft size={16} /> {t('twoFactor.backToSettings')}
          </Link>

          <div className="rounded-2xl border border-border bg-surface p-8">
            <div className="mb-6 flex items-center gap-3">
              <MonitorSmartphone className="text-primary" size={28} />
              <div>
                <h1 className="text-2xl font-bold text-content">{t('sessions.pageTitle')}</h1>
                <p className="text-sm text-muted">{t('sessions.pageSubtitle')}</p>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-muted">{t('sessions.loading')}</p>
            ) : loadError ? (
              <div className="space-y-3">
                <p className="text-sm text-muted" role="alert">{t('sessions.loadFailed')}</p>
                <button
                  type="button"
                  onClick={fetchSessions}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-content hover:bg-surface-2" data-track="ui.f970d649f7.2"
                >
                  {t('sessions.retry')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.length === 0 && (
                  <div className="rounded-xl border border-border px-4 py-6 text-center">
                    <p className="text-sm font-medium text-content">{t('sessions.empty')}</p>
                    <p className="mt-1 text-xs text-muted">{t('sessions.emptyDesc')}</p>
                  </div>
                )}

                {sessions.length > 0 && (
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        onRevoke={setRevokeTarget}
                        busy={busy}
                        t={t}
                      />
                    ))}
                  </div>
                )}

                {otherCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setLogoutAllOpen(true)}
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-content hover:bg-surface-2 disabled:opacity-50" data-track="ui.f970d649f7.3"
                  >
                    <LogOut size={16} />
                    {busy ? t('sessions.working') : t('sessions.logoutEverywhere')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />

      {revokeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={() => !busy && setRevokeTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-revoke-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-content shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="session-revoke-title" className="text-lg font-semibold text-content">
              {t('sessions.revokeTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted">{t('sessions.revokeConfirm')}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                disabled={busy}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-content hover:bg-surface-2 disabled:opacity-50" data-track="ui.f970d649f7.4"
              >
                {t('sessions.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmRevokeSession}
                disabled={busy}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-on-solid hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--color-error)' }} data-track="ui.f970d649f7.5"
              >
                {busy ? t('sessions.working') : t('sessions.confirmRevoke')}
              </button>
            </div>
          </div>
        </div>
      )}

      {logoutAllOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={() => !busy && setLogoutAllOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-logout-all-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-content shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="session-logout-all-title" className="text-lg font-semibold text-content">
              {t('sessions.logoutEverywhereTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted">{t('sessions.logoutEverywhereConfirm')}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setLogoutAllOpen(false)}
                disabled={busy}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-content hover:bg-surface-2 disabled:opacity-50" data-track="ui.f970d649f7.6"
              >
                {t('sessions.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmLogoutEverywhere}
                disabled={busy}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-on-solid hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--color-error)' }} data-track="ui.f970d649f7.7"
              >
                {busy ? t('sessions.working') : t('sessions.confirmLogoutEverywhere')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
