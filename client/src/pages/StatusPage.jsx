import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';

const CHECKS = [
  {
    key: 'web',
    label: 'OxSteed web app',
    description: 'Public website and application shell',
    url: '/health',
    critical: true,
  },
  {
    key: 'api',
    label: 'Core API',
    description: 'Authentication, accounts, marketplace, and restaurant APIs',
    url: '/api/health',
    critical: true,
  },
  {
    key: 'deep',
    label: 'Database and cache',
    description: 'Database connectivity plus optional Redis signal',
    url: '/api/health/deep',
    critical: true,
  },
];

const STATUS_COPY = {
  operational: {
    title: 'All OxSteed systems operational',
    message: 'Core OxSteed services are responding normally.',
    color: '#16a34a',
    icon: CheckCircle2,
  },
  degraded: {
    title: 'OxSteed is partially degraded',
    message: 'One or more services are responding slowly or reporting degraded health.',
    color: '#f97316',
    icon: AlertTriangle,
  },
  outage: {
    title: 'OxSteed is experiencing an outage',
    message: 'A critical service is currently unavailable.',
    color: '#dc2626',
    icon: XCircle,
  },
  checking: {
    title: 'Checking OxSteed systems',
    message: 'Running live service checks now.',
    color: '#2563eb',
    icon: RefreshCw,
  },
};

function classifyResult(response, payload) {
  if (!response.ok) return response.status >= 500 ? 'outage' : 'degraded';
  const status = String(payload?.status || '').toLowerCase();
  if (status === 'ok' || status === 'healthy' || status === 'operational') return 'operational';
  if (status === 'degraded') return 'degraded';
  return 'operational';
}

function formatTimestamp(value) {
  if (!value) return 'Not checked yet';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function StatusBadge({ status }) {
  const normalized = status || 'checking';
  const meta = STATUS_COPY[normalized] || STATUS_COPY.checking;
  const Icon = meta.icon;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      borderRadius: 999,
      padding: '8px 12px',
      background: `${meta.color}14`,
      color: meta.color,
      fontWeight: 800,
      fontSize: 13,
      letterSpacing: '.01em',
      textTransform: 'capitalize',
    }}>
      <Icon size={16} />
      {normalized === 'checking' ? 'Checking' : normalized}
    </span>
  );
}

export default function StatusPage() {
  const [checks, setChecks] = useState(() => CHECKS.map((check) => ({
    ...check,
    status: 'checking',
    latencyMs: null,
    checkedAt: null,
    detail: 'Waiting for first check.',
  })));
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const overallStatus = useMemo(() => {
    if (checks.some((check) => check.status === 'checking')) return 'checking';
    if (checks.some((check) => check.critical && check.status === 'outage')) return 'outage';
    if (checks.some((check) => check.status !== 'operational')) return 'degraded';
    return 'operational';
  }, [checks]);

  const overall = STATUS_COPY[overallStatus];
  const OverallIcon = overall.icon;

  async function runChecks() {
    setRefreshing(true);
    const nextChecks = await Promise.all(CHECKS.map(async (check) => {
      const startedAt = performance.now();
      try {
        const response = await fetch(`${check.url}?status_page=1&t=${Date.now()}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json') ? await response.json() : null;
        const latencyMs = Math.round(performance.now() - startedAt);
        const status = classifyResult(response, payload);
        const detail = payload?.checks
          ? Object.entries(payload.checks)
              .map(([name, result]) => `${name}: ${result?.ok ? 'ok' : 'attention'}`)
              .join(' · ')
          : payload?.error || payload?.status || `HTTP ${response.status}`;

        return {
          ...check,
          status,
          latencyMs,
          checkedAt: new Date().toISOString(),
          detail,
        };
      } catch (error) {
        return {
          ...check,
          status: 'outage',
          latencyMs: Math.round(performance.now() - startedAt),
          checkedAt: new Date().toISOString(),
          detail: error?.message || 'Could not reach service.',
        };
      }
    }));

    setChecks(nextChecks);
    setLastUpdated(new Date().toISOString());
    setRefreshing(false);
  }

  useEffect(() => {
    runChecks();
    const interval = window.setInterval(runChecks, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <PageShell hideNav hideFooter>
      <PageMeta
        title="OxSteed Status"
        description="Live public status for OxSteed core services, APIs, and infrastructure."
        url="https://status.oxsteed.com/"
      />

      <div style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top left, rgba(249,115,22,.18), transparent 34rem), radial-gradient(circle at bottom right, rgba(37,99,235,.14), transparent 30rem), #08111f',
        color: '#f8fafc',
        padding: '28px clamp(18px, 4vw, 56px)',
      }}>
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          maxWidth: 1120,
          margin: '0 auto 44px',
        }}>
          <a href="https://oxsteed.com" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            color: '#f8fafc',
            textDecoration: 'none',
            fontWeight: 900,
            fontSize: 24,
            letterSpacing: '-.04em',
          }}>
            <span style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(135deg, #ff7a1a, #f97316)',
              color: '#08111f',
              boxShadow: '0 18px 45px rgba(249,115,22,.28)',
            }}>
              Ox
            </span>
            OxSteed Status
          </a>

          <button
            type="button"
            onClick={runChecks}
            disabled={refreshing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid rgba(255,255,255,.18)',
              borderRadius: 999,
              background: 'rgba(255,255,255,.08)',
              color: '#f8fafc',
              padding: '10px 14px',
              fontWeight: 800,
              cursor: refreshing ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={16} style={{ animation: refreshing ? 'ox-status-spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </header>

        <main style={{ maxWidth: 1120, margin: '0 auto' }}>
          <section style={{
            border: '1px solid rgba(255,255,255,.14)',
            borderRadius: 34,
            padding: 'clamp(24px, 5vw, 54px)',
            background: 'linear-gradient(145deg, rgba(15,23,42,.92), rgba(15,23,42,.68))',
            boxShadow: '0 28px 90px rgba(0,0,0,.34)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              inset: 'auto -6rem -7rem auto',
              width: 260,
              height: 260,
              borderRadius: '50%',
              background: `${overall.color}22`,
              filter: 'blur(6px)',
            }} />

            <div style={{ position: 'relative', display: 'grid', gap: 24 }}>
              <StatusBadge status={overallStatus} />
              <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
                <h1 style={{
                  margin: 0,
                  fontSize: 'clamp(42px, 8vw, 84px)',
                  lineHeight: .92,
                  letterSpacing: '-.075em',
                }}>
                  {overall.title}
                </h1>
                <p style={{
                  margin: 0,
                  color: '#cbd5e1',
                  fontSize: 'clamp(17px, 2vw, 22px)',
                  lineHeight: 1.6,
                }}>
                  {overall.message}
                </p>
              </div>

              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                color: '#cbd5e1',
                fontSize: 14,
              }}>
                <span style={metricPillStyle}>
                  <Clock3 size={16} />
                  Last updated {formatTimestamp(lastUpdated)}
                </span>
                <span style={metricPillStyle}>
                  <Activity size={16} />
                  Auto-refreshes every 60 seconds
                </span>
                <span style={metricPillStyle}>
                  <ShieldCheck size={16} />
                  Public health checks only
                </span>
              </div>
            </div>
          </section>

          <section style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            marginTop: 18,
          }}>
            {checks.map((check) => {
              const statusMeta = STATUS_COPY[check.status] || STATUS_COPY.checking;
              const Icon = statusMeta.icon;
              return (
                <article key={check.key} style={{
                  border: '1px solid rgba(255,255,255,.13)',
                  borderRadius: 26,
                  background: 'rgba(15,23,42,.72)',
                  padding: 22,
                  boxShadow: '0 18px 50px rgba(0,0,0,.24)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 48,
                      height: 48,
                      borderRadius: 16,
                      background: `${statusMeta.color}16`,
                      color: statusMeta.color,
                    }}>
                      <Icon size={24} />
                    </span>
                    <StatusBadge status={check.status} />
                  </div>

                  <h2 style={{ margin: '18px 0 8px', fontSize: 22, letterSpacing: '-.04em' }}>
                    {check.label}
                  </h2>
                  <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.55 }}>
                    {check.description}
                  </p>

                  <dl style={{
                    display: 'grid',
                    gap: 10,
                    margin: '18px 0 0',
                    paddingTop: 16,
                    borderTop: '1px solid rgba(255,255,255,.1)',
                    color: '#cbd5e1',
                    fontSize: 14,
                  }}>
                    <div style={detailRowStyle}>
                      <dt>Endpoint</dt>
                      <dd>{check.url}</dd>
                    </div>
                    <div style={detailRowStyle}>
                      <dt>Latency</dt>
                      <dd>{check.latencyMs === null ? 'Checking...' : `${check.latencyMs} ms`}</dd>
                    </div>
                    <div style={detailRowStyle}>
                      <dt>Detail</dt>
                      <dd>{check.detail}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </section>

          <footer style={{
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 28,
            color: '#94a3b8',
            fontSize: 14,
          }}>
            <span>Need help? <a href="mailto:support@oxsteed.com" style={{ color: '#fb923c' }}>support@oxsteed.com</a></span>
            <span>Powered by OxSteed Network</span>
          </footer>
        </main>
      </div>

      <style>{`
        @keyframes ox-status-spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 620px) {
          #main-content { padding: 0 !important; }
        }
      `}</style>
    </PageShell>
  );
}

const metricPillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 999,
  background: 'rgba(255,255,255,.06)',
};

const detailRowStyle = {
  display: 'grid',
  gridTemplateColumns: '82px 1fr',
  gap: 12,
};
