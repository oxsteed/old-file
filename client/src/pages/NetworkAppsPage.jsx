// client/src/pages/NetworkAppsPage.jsx
//
// The OxSteed Network full-page app launcher. Mounted at /network and
// /network/apps. Shows every branch the user can open as a card grid.
// The branch catalog is shared with the navbar switcher
// (OxSteedNetworkSwitcher) via utils/networkBranches so the two stay in sync.
//
// This page only routes — each destination enforces its own access. The
// Support Workspace card is shown only when the user is a support agent
// (resolved the same way the navbar does).

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { getNetworkBranches } from '../utils/networkBranches';

export default function NetworkAppsPage() {
  const { t } = useTranslation();
  const [showSupportWorkspace, setShowSupportWorkspace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/support/agent/me');
        if (cancelled) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        setShowSupportWorkspace(list.length > 0);
      } catch {
        if (!cancelled) setShowSupportWorkspace(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const branches = getNetworkBranches(t, { showSupportWorkspace });

  return (
    <PageShell>
      <PageMeta
        title={`${t('nav.network', 'OxSteed Network')}: OxSteed`}
        description={t('network.pageSubtitle', 'One OxSteed account. Switch between every OxSteed branch you have access to.')}
      />
      <div style={{ maxWidth: '64rem', margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
        <header style={{ marginBottom: 'var(--space-5)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-3xl, 1.875rem)', fontWeight: 700, color: 'var(--color-text)' }}>
            {t('nav.network', 'OxSteed Network')}
          </h1>
          <p style={{ marginTop: '0.5rem', color: 'var(--color-text-muted)', fontSize: 'var(--text-md, 1rem)', maxWidth: '42rem' }}>
            {t('network.pageSubtitle', 'One OxSteed account. Switch between every OxSteed branch you have access to.')}
          </p>
        </header>

        <div
          role="list"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {branches.map((b) => (
            <Link
              key={b.key}
              role="listitem"
              to={b.to}
              className="ox-net-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                padding: '1.1rem 1.15rem',
                borderRadius: 'var(--radius-lg, 14px)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                textDecoration: 'none',
                color: 'var(--color-text)',
                transition: 'border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary, #F97316)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ fontSize: 'var(--text-lg, 1.05rem)', fontWeight: 700 }}>{b.title}</span>
              <span style={{ fontSize: 'var(--text-sm, 0.875rem)', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{b.hint}</span>
              <span
                aria-hidden="true"
                style={{
                  marginTop: 'auto', paddingTop: '0.6rem',
                  fontSize: '0.8rem', fontWeight: 600,
                  color: 'var(--color-primary, #F97316)',
                }}
              >
                {t('network.openBranch', 'Open')} →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
