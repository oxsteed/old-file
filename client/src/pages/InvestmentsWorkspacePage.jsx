import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Landmark, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import useAccessProjection from '../hooks/useAccessProjection';
import PageShell from '../components/PageShell';
import { investAccessFromProjection, investorWorkspaceSections } from '../utils/invest';
import { InvestLoading, InvestNotice } from './invest/InvestShared';

const ICONS = {
  reports: FileText,
  opportunities: Landmark,
  contributions: WalletCards,
};

export default function InvestmentsWorkspacePage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const sections = investorWorkspaceSections(projection);
  const projectionPending = !projection || ['loading', 'refreshing'].includes(projection.status);
  const projectionUnavailable = projection && !['loading', 'refreshing', 'ready'].includes(projection.status);

  return (
    <PageShell>
      <div className="min-h-screen bg-gray-950 px-4 py-8 text-white md:px-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">
              {t('investorDashboard.header.mode')}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              {t('invest.workspace.title')}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-gray-300">
              {t('invest.workspace.intro')}
            </p>
          </header>

          {projectionPending ? <InvestLoading label={t('invest.common.loading')} /> : null}
          {projectionUnavailable ? (
            <InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice>
          ) : null}

          {!projectionPending && !projectionUnavailable && !access.investEnabled ? (
            <InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice>
          ) : null}

          {!projectionPending && !projectionUnavailable && access.investEnabled ? (
            <div className="grid gap-5 md:grid-cols-3" aria-label={t('invest.workspace.title')}>
              {sections.map((section) => {
                const Icon = ICONS[section.id];
                const actionKey = section.available ? 'invest.workspace.actions.open' : 'invest.workspace.actions.setup';
                const statusKey = section.available
                  ? (section.readOnly ? 'invest.workspace.status.readOnly' : 'invest.workspace.status.available')
                  : 'invest.workspace.status.setup';
                return (
                  <section
                    key={section.id}
                    className="flex min-h-[250px] flex-col rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                        <Icon size={22} aria-hidden="true" />
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${section.available ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200'}`}>
                        {t(statusKey)}
                      </span>
                    </div>
                    <h2 className="mt-6 text-xl font-semibold">{t(section.titleKey)}</h2>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-400">
                      {t(section.descriptionKey)}
                    </p>
                    <Link
                      to={section.to}
                      className="mt-6 inline-flex items-center justify-center rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                    >
                      {t(actionKey)}
                    </Link>
                  </section>
                );
              })}
            </div>
          ) : null}

          <p className="max-w-3xl text-xs leading-relaxed text-gray-500">
            {t('invest.common.riskNotice')}
          </p>
        </div>
      </div>
    </PageShell>
  );
}
