// OxSteed Invest entity fundraising: "My raises".
//
// The caller's own entity raises (drafts and published raises) via
// GET /api/invest/opportunities?scope=mine. Drafts stay private here:
// only the entity representative sees them. Rendering is projection-only.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import EmptyState from '../../components/EmptyState';
import { Inbox } from 'lucide-react';
import { listMyOpportunities } from '../../api/invest';
import { investAccessFromProjection, formatInvestCents, fundingProgress, opportunityStatusLabel } from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, InvestSection, formatInvestDate, investButtonClassName, investSecondaryButtonClassName } from './InvestShared';

export default function InvestEntityRaisesPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [opportunities, setOpportunities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const preselectedBusiness = searchParams.get('businessId') || '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyOpportunities('publication_date');
      setOpportunities(Array.isArray(data?.opportunities) ? data.opportunities : []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.entity.raises.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (access.investEnabled) load(); else if (projection) setLoading(false); }, [access.investEnabled, projection, load]);

  const raiseHref = preselectedBusiness ? `/invest/entity/raise?businessId=${encodeURIComponent(preselectedBusiness)}` : '/invest/entity/raise';

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.entity.raises.title')}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{t('invest.entity.raises.intro')}</p>

        {!projection && loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {projection && !access.investEnabled ? (
          <div className="mt-6"><InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice></div>
        ) : null}
        {error ? <div className="mt-6"><InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={load} /></div> : null}

        {!loading && !error && access.investEnabled ? (
          <div className="mt-6 flex flex-col gap-6">
            <div>
              <Link to={raiseHref} className={investButtonClassName}>{t('invest.entity.raises.newRaise')}</Link>
            </div>
            {opportunities && opportunities.length === 0 ? (
              <EmptyState icon={Inbox} title={t('invest.entity.raises.empty.title')} copy={t('invest.entity.raises.empty.copy')} />
            ) : null}
            {(opportunities || []).map((opportunity) => {
              const progress = fundingProgress(opportunity.targetCents, opportunity.reservedCents, opportunity.completedCents);
              return (
                <InvestSection key={opportunity.id} title={opportunity.title}>
                  <p className="text-sm text-gray-300">
                    {opportunityStatusLabel(opportunity.status, t)}
                    {' - '}
                    {t('invest.entity.raises.card.target', { amount: formatInvestCents(opportunity.targetCents, 'USD') })}
                  </p>
                  <p className="text-sm text-gray-300">
                    {t('invest.entity.raises.card.committed', { amount: formatInvestCents(progress.reservedCents, 'USD') })}
                    {' - '}
                    {t('invest.entity.raises.card.completed', { amount: formatInvestCents(progress.completedCents, 'USD') })}
                    {' - '}
                    {t('invest.entity.raises.card.progress', { percent: progress.percent })}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t('invest.entity.raises.card.deadline', { date: formatInvestDate(opportunity.deadlineAt) || t('invest.common.notSet') })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/invest/entity/raises/${opportunity.id}`} className={investSecondaryButtonClassName}>
                      {t('invest.entity.raises.card.manage')}
                    </Link>
                    {opportunity.status === 'draft' ? (
                      <Link to={`/invest/entity/raises/${opportunity.id}/edit`} className={investSecondaryButtonClassName}>
                        {t('invest.entity.raises.card.edit')}
                      </Link>
                    ) : null}
                    {opportunity.status === 'published' ? (
                      <Link to={`/invest/opportunities/${opportunity.id}`} className={investSecondaryButtonClassName}>
                        {t('invest.entity.raises.card.viewPublic')}
                      </Link>
                    ) : null}
                  </div>
                </InvestSection>
              );
            })}
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
