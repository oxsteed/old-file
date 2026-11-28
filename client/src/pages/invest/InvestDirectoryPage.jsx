// OxSteed Invest directory ("Explore investments").
//
// Neutral sort only: publication date or closing date, chosen by the
// visitor. No score, no ranking, no recommendation. Progress is shown
// accurately: reserved commitments are labeled as commitments, never as
// completed funding.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import EmptyState from '../../components/EmptyState';
import { SearchX } from 'lucide-react';
import { listOpportunities } from '../../api/invest';
import { investAccessFromProjection, formatInvestCents, fundingProgress, opportunityStatusLabel } from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, formatInvestDate, investSecondaryButtonClassName } from './InvestShared';

const SORTS = ['publication_date', 'closing_date'];

export default function InvestDirectoryPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [sort, setSort] = useState('publication_date');
  const [opportunities, setOpportunities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (nextSort) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listOpportunities(nextSort);
      setOpportunities(Array.isArray(data?.opportunities) ? data.opportunities : []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.directory.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (access.investEnabled) load(sort);
    else if (projection) setLoading(false);
  }, [access.investEnabled, projection, sort, load]);

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.directory.title')}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{t('invest.directory.intro')}</p>

        {!projection && loading ? <InvestLoading label={t('invest.common.loading')} /> : null}

        {projection && !access.investEnabled ? (
          <div className="mt-6">
            <InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice>
          </div>
        ) : null}

        {access.investEnabled ? (
          <div className="mt-6 flex flex-col gap-6">
            {/* Slice 5g, 732: planned participation explanation. */}
            <section className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
              <h2 className="text-base font-semibold text-white">{t('invest.directory.participation.title')}</h2>
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-gray-300">
                <li>{t('invest.directory.participation.creditOnly')}</li>
                <li>{t('invest.directory.participation.structure')}</li>
                <li>{t('invest.directory.participation.pending')}</li>
                <li>{access.investCommitmentsEnabled ? t('invest.directory.participation.gateOn') : t('invest.directory.participation.gateOff')}</li>
              </ul>
            </section>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="invest-sort" className="text-sm font-medium text-gray-200">
                {t('invest.directory.sort.label')}
              </label>
              <select
                id="invest-sort"
                value={sort}
                onChange={(event) => setSort(SORTS.includes(event.target.value) ? event.target.value : 'publication_date')}
                className="rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
              >
                <option value="publication_date">{t('invest.directory.sort.publicationDate')}</option>
                <option value="closing_date">{t('invest.directory.sort.closingDate')}</option>
              </select>
              <Link to="/invest/apply" className={investSecondaryButtonClassName}>{t('invest.directory.requestAccess')}</Link>
              <Link to="/invest/my-investments" className={investSecondaryButtonClassName}>{t('invest.directory.myInvestments')}</Link>
            </div>

            {loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
            {error ? <InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={() => load(sort)} /> : null}

            {!loading && !error && opportunities && opportunities.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title={t('invest.directory.empty.title')}
                copy={t('invest.directory.empty.copy')}
              />
            ) : null}

            {!loading && !error && opportunities && opportunities.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {opportunities.map((opportunity) => {
                  const progress = fundingProgress(opportunity.targetCents, opportunity.reservedCents, opportunity.completedCents);
                  return (
                    <li key={opportunity.id} className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-white">{opportunity.title}</h2>
                          <p className="mt-1 text-sm text-gray-300">
                            {opportunity.entityName || t('invest.directory.entityUnknown')}
                            {opportunity.entityActivity ? ` (${opportunity.entityActivity})` : ''}
                            {opportunity.entityLocation ? ` - ${opportunity.entityLocation}` : ''}
                          </p>
                          <p className="mt-2 text-sm text-gray-400 leading-relaxed">{opportunity.purpose}</p>
                        </div>
                        <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-200">
                          {opportunityStatusLabel(opportunity.status, t)}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                        <div>
                          <dt className="text-gray-400">{t('invest.directory.card.target')}</dt>
                          <dd className="mt-1 font-semibold text-white">{formatInvestCents(opportunity.targetCents, 'USD')}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">{t('invest.directory.card.minimum')}</dt>
                          <dd className="mt-1 font-semibold text-white">{formatInvestCents(opportunity.minimumCents, 'USD')}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">{t('invest.directory.card.deadline')}</dt>
                          <dd className="mt-1 font-semibold text-white">{formatInvestDate(opportunity.deadlineAt) || t('invest.common.notSet')}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">{t('invest.directory.card.structure')}</dt>
                          <dd className="mt-1 font-semibold text-white">{t('invest.common.structure.revenueShare')}</dd>
                        </div>
                      </dl>
                      <div className="mt-4">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800" aria-hidden="true">
                          <div className="h-2 rounded-full bg-orange-500" style={{ width: `${progress.percent}%` }} />
                        </div>
                        <p className="mt-2 text-xs text-gray-400">
                          {t('invest.directory.card.progress', { percent: progress.percent })}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          {t('invest.directory.card.committed', {
                            reserved: formatInvestCents(progress.reservedCents, 'USD'),
                            completed: formatInvestCents(progress.completedCents, 'USD'),
                          })}
                        </p>
                      </div>
                      <p className="mt-3 text-xs text-amber-200/90 leading-relaxed">{t('invest.common.riskNotice')}</p>
                      <div className="mt-4">
                        <Link
                          to={`/invest/opportunities/${opportunity.id}`}
                          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                        >
                          {t('invest.directory.card.view')}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
