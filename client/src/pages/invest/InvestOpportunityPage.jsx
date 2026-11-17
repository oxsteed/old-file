// OxSteed Invest opportunity detail.
//
// Answers the eight spec questions from the API detail response, with
// provenance kept explicit (entity-provided vs checked). The verification
// badge describes only what a reviewer recorded at approval and never
// implies a guarantee. Funding totals label reserved commitments as
// pending, never as completed funding. Documents are the access-filtered
// list from the API; Q and A is visible to related investors only.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import EmptyState from '../../components/EmptyState';
import { FileText, MessageSquare } from 'lucide-react';
import { getOpportunity, listQuestions, askQuestion, listApplications } from '../../api/invest';
import { investAccessFromProjection, formatInvestCents, fundingProgress, provenanceLabelKey, opportunityStatusLabel, documentVisibilityLabel } from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, InvestSection, formatInvestDate, investButtonClassName, investInputClassName, investSecondaryButtonClassName } from './InvestShared';

export default function InvestOpportunityPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useTranslation();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [detail, setDetail] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [myApplication, setMyApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [questionText, setQuestionText] = useState('');
  const [questionNotice, setQuestionNotice] = useState(null);
  const [questionError, setQuestionError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getOpportunity(id);
      setDetail(data);
      try {
        const q = await listQuestions(id);
        setQuestions(Array.isArray(q?.questions) ? q.questions : []);
      } catch {
        setQuestions(null);
      }
      try {
        const apps = await listApplications();
        const mine = (Array.isArray(apps?.applications) ? apps.applications : []).find((a) => String(a.opportunityId) === String(id));
        setMyApplication(mine || null);
      } catch {
        setMyApplication(null);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.detail.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  const submitQuestion = async (event) => {
    event.preventDefault();
    setQuestionError(null);
    setQuestionNotice(null);
    if (!questionText.trim()) {
      setQuestionError(t('invest.detail.qa.questionRequired'));
      return;
    }
    try {
      const created = await askQuestion(id, questionText.trim());
      setQuestions((current) => (current ? [created?.question || created, ...current] : [created?.question || created]));
      setQuestionText('');
      setQuestionNotice(t('invest.detail.qa.asked'));
    } catch (e) {
      setQuestionError(e?.response?.data?.error || e.message || t('invest.detail.qa.askFailed'));
    }
  };

  const opportunity = detail?.opportunity || null;
  const progress = detail?.funding
    ? fundingProgress(detail.funding.targetCents, detail.funding.reservedCents, detail.funding.completedCents)
    : null;
  const verification = detail?.verification || null;
  const canAsk = !!myApplication && ['draft', 'submitted', 'under_review', 'needs_information', 'approved'].includes(myApplication.status);

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        {loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {error ? <InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={load} /> : null}

        {!loading && !error && opportunity ? (
          <div className="flex flex-col gap-6">
            <div>
              <Link to="/invest" className="text-sm text-orange-400 hover:text-orange-300">
                {t('invest.detail.backToDirectory')}
              </Link>
              <h1 className="mt-2 text-2xl font-bold text-white">{opportunity.title}</h1>
              <p className="mt-1 text-sm text-gray-300">
                {opportunity.entityName || t('invest.directory.entityUnknown')}
                {opportunity.entityActivity ? ` (${opportunity.entityActivity})` : ''}
                {opportunity.entityLocation ? ` - ${opportunity.entityLocation}` : ''}
              </p>
              <p className="mt-2 text-sm text-gray-400 leading-relaxed">{opportunity.purpose}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-200">
                  {opportunityStatusLabel(opportunity.status, t)}
                </span>
                <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-200">
                  {t('invest.common.structure.revenueShare')}
                </span>
                <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-200">
                  {t('invest.common.country.usOnly')}
                </span>
              </div>
            </div>

            {verification ? (
              <div className={`rounded-2xl border p-4 ${verification.status === 'verified_items' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
                <p className="text-sm font-semibold text-white">
                  {verification.status === 'verified_items'
                    ? t('invest.detail.verification.verifiedTitle')
                    : t('invest.detail.verification.notVerifiedTitle')}
                </p>
                {verification.verifiedItems && verification.verifiedItems.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-300">
                    {verification.verifiedItems.map((item, index) => (
                      <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-sm text-gray-300 leading-relaxed">{verification.note}</p>
              </div>
            ) : null}

            {progress ? (
              <InvestSection title={t('invest.detail.funding.title')}>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-gray-400">{t('invest.directory.card.target')}</dt>
                    <dd className="mt-1 font-semibold text-white">{formatInvestCents(progress.targetCents, 'USD')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.detail.funding.reserved')}</dt>
                    <dd className="mt-1 font-semibold text-white">{formatInvestCents(progress.reservedCents, 'USD')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.detail.funding.completed')}</dt>
                    <dd className="mt-1 font-semibold text-white">{formatInvestCents(progress.completedCents, 'USD')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.directory.card.deadline')}</dt>
                    <dd className="mt-1 font-semibold text-white">{formatInvestDate(opportunity.deadlineAt) || t('invest.common.notSet')}</dd>
                  </div>
                </dl>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800" aria-hidden="true">
                  <div className="h-2 rounded-full bg-orange-500" style={{ width: `${progress.percent}%` }} />
                </div>
                <p className="text-xs text-gray-400">{t('invest.detail.funding.pendingNote')}</p>
                <p className="text-xs text-amber-200/90 leading-relaxed">{t('invest.common.riskNotice')}</p>
              </InvestSection>
            ) : null}

            <InvestSection title={t('invest.detail.answers.title')} hint={t('invest.detail.answers.hint')}>
              {(detail.answers || []).map((item, index) => (
                <div key={index} className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
                  <p className="text-sm font-semibold text-white">{item.question}</p>
                  <p className="mt-1 text-sm text-gray-300 leading-relaxed">{item.answer}</p>
                  <p className="mt-2 text-xs text-gray-500">{t(provenanceLabelKey(item.provenance))}</p>
                </div>
              ))}
            </InvestSection>

            <InvestSection title={t('invest.detail.exit.title')} hint={t('invest.detail.exit.hint')}>
              <p className="text-sm text-gray-300 leading-relaxed">{t('invest.detail.exit.cancellation')}</p>
              <p className="text-sm text-gray-300 leading-relaxed">{t('invest.detail.exit.distributions')}</p>
              <p className="text-sm text-gray-300 leading-relaxed">{t('invest.detail.exit.transfer')}</p>
            </InvestSection>

            <InvestSection title={t('invest.detail.documents.title')} hint={t('invest.detail.documents.hint')}>
              {!detail.documents || detail.documents.length === 0 ? (
                <EmptyState icon={FileText} title={t('invest.detail.documents.empty.title')} copy={t('invest.detail.documents.empty.copy')} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {detail.documents.map((doc) => (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
                      <span className="text-sm font-medium text-white">{doc.title}</span>
                      <span className="flex items-center gap-2 text-xs text-gray-400">
                        {doc.confidential ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">{t('invest.detail.documents.confidential')}</span> : null}
                        <span>{documentVisibilityLabel(doc.visibility, t)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </InvestSection>

            <InvestSection title={t('invest.detail.qa.title')} hint={t('invest.detail.qa.hint')}>
              {questions === null ? (
                <p className="text-sm text-gray-400 leading-relaxed">{t('invest.detail.qa.notAvailable')}</p>
              ) : questions.length === 0 ? (
                <EmptyState icon={MessageSquare} title={t('invest.detail.qa.empty.title')} copy={t('invest.detail.qa.empty.copy')} />
              ) : (
                <ul className="flex flex-col gap-3">
                  {questions.map((q) => (
                    <li key={q.id} className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
                      <p className="text-sm font-medium text-white">{q.question}</p>
                      {q.answer ? (
                        <p className="mt-2 text-sm text-gray-300 leading-relaxed">{q.answer}</p>
                      ) : (
                        <p className="mt-2 text-sm text-gray-500">{t('invest.detail.qa.unanswered')}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canAsk ? (
                <form onSubmit={submitQuestion} className="mt-2 flex flex-col gap-2">
                  <label htmlFor="invest-question" className="text-sm font-medium text-gray-200">{t('invest.detail.qa.askLabel')}</label>
                  <textarea
                    id="invest-question"
                    value={questionText}
                    onChange={(event) => setQuestionText(event.target.value)}
                    rows={3}
                    className={investInputClassName}
                  />
                  {questionError ? <p className="text-sm text-red-300" role="alert">{questionError}</p> : null}
                  {questionNotice ? <p className="text-sm text-emerald-300" role="status">{questionNotice}</p> : null}
                  <div>
                    <button type="submit" className={investButtonClassName}>{t('invest.detail.qa.askButton')}</button>
                  </div>
                </form>
              ) : null}
            </InvestSection>

            <div className="flex flex-wrap gap-3">
              {access.investEnabled && myApplication?.status === 'approved' ? (
                <Link to={`/invest/opportunities/${opportunity.id}/commit`} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">
                  {t('invest.detail.actions.commit')}
                </Link>
              ) : null}
              {access.investEnabled ? (
                <Link to={`/invest/apply?opportunityId=${opportunity.id}`} className={investSecondaryButtonClassName}>
                  {myApplication ? t('invest.detail.actions.viewApplication') : t('invest.detail.actions.apply')}
                </Link>
              ) : null}
              <Link to="/invest/my-investments" className={investSecondaryButtonClassName}>
                {t('invest.directory.myInvestments')}
              </Link>
            </div>
            {myApplication ? (
              <p className="text-sm text-gray-400">
                {t('invest.detail.applicationStatus', { status: myApplication.status })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
