// OxSteed Invest entity fundraising: manage one raise.
//
// Published-opportunity management for the entity representative: answer
// investor questions, publish updates, run the controlled amendment
// process, and keep agreement versions. Missed updates surface as
// OVERDUE and never disappear. Material changes go through amendments
// with investor notice and reconfirmation; terms never change silently
// after commitments exist. After closing, the reporting schedule and
// obligations list are shown here. Rendering is projection-only.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import EmptyState from '../../components/EmptyState';
import { Inbox } from 'lucide-react';
import {
  getOpportunity, getOpportunityPreview, submitOpportunityForReview,
  listQuestions, answerQuestion, listUpdates, createUpdate, publishUpdate,
  listAmendments, createAmendment, proposeAmendment,
  listAgreementVersions, createAgreementVersion,
} from '../../api/invest';
import { investAccessFromProjection, formatInvestCents, fundingProgress, opportunityStatusLabel, amendmentStatusLabel, updateStatusLabel } from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, InvestSection, InvestField, formatInvestDate, investButtonClassName, investInputClassName, investSecondaryButtonClassName } from './InvestShared';

export default function InvestEntityManagePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useTranslation();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [detail, setDetail] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [amendments, setAmendments] = useState([]);
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState({});
  const [updateForm, setUpdateForm] = useState({ title: '', body: '', dueAt: '' });
  const [amendmentForm, setAmendmentForm] = useState({ summary: '', newAgreementVersionId: '' });
  const [proposeDeadline, setProposeDeadline] = useState({});
  const [agreementBody, setAgreementBody] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailData, questionData, updateData, amendmentData, versionData] = await Promise.all([
        getOpportunity(id),
        listQuestions(id),
        listUpdates(id),
        listAmendments(id),
        listAgreementVersions(id),
      ]);
      setDetail(detailData);
      setQuestions(Array.isArray(questionData?.questions) ? questionData.questions : []);
      setUpdates(Array.isArray(updateData?.updates) ? updateData.updates : []);
      setAmendments(Array.isArray(amendmentData?.amendments) ? amendmentData.amendments : []);
      setVersions(Array.isArray(versionData?.agreementVersions) ? versionData.agreementVersions : []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.entity.manage.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { if (access.investEnabled) load(); else if (projection) setLoading(false); }, [access.investEnabled, projection, load]);

  const run = async (fn, successKey) => {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      await fn();
      if (successKey) setNotice(t(successKey));
      await load();
    } catch (e) {
      setActionError(e?.response?.data?.error || e.message || t('invest.entity.manage.error.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const opportunity = detail?.opportunity || null;
  const funding = detail?.funding || {};
  const progress = fundingProgress(funding.targetCents, funding.reservedCents, funding.completedCents);
  const openQuestions = questions.filter((q) => q.status === 'open');
  const answeredQuestions = questions.filter((q) => q.status !== 'open');

  const showPreview = async () => {
    setBusy(true);
    setActionError(null);
    try {
      setPreview(await getOpportunityPreview(id));
    } catch (e) {
      setActionError(e?.response?.data?.error || e.message || t('invest.entity.manage.error.previewFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submitForReview = () => run(
    () => submitOpportunityForReview(id),
    'invest.entity.manage.submitted',
  );

  const submitAnswer = (questionId) => {
    const answer = (answers[questionId] || '').trim();
    if (!answer) {
      setActionError(t('invest.entity.manage.questions.answerRequired'));
      return;
    }
    return run(
      () => answerQuestion(id, questionId, answer),
      'invest.entity.manage.questions.answered',
    );
  };

  const submitUpdate = (event) => {
    event.preventDefault();
    if (!updateForm.title.trim() || !updateForm.body.trim()) {
      setActionError(t('invest.entity.manage.updates.required'));
      return;
    }
    return run(
      () => createUpdate(id, {
        title: updateForm.title.trim(),
        body: updateForm.body.trim(),
        dueAt: updateForm.dueAt ? new Date(updateForm.dueAt).toISOString() : null,
      }).then(() => setUpdateForm({ title: '', body: '', dueAt: '' })),
      'invest.entity.manage.updates.created',
    );
  };

  const submitAmendment = (event) => {
    event.preventDefault();
    if (!amendmentForm.summary.trim()) {
      setActionError(t('invest.entity.manage.amendments.required'));
      return;
    }
    return run(
      () => createAmendment(id, {
        changes: { summary: amendmentForm.summary.trim() },
        newAgreementVersionId: amendmentForm.newAgreementVersionId || null,
      }).then(() => setAmendmentForm({ summary: '', newAgreementVersionId: '' })),
      'invest.entity.manage.amendments.created',
    );
  };

  const submitPropose = (amendmentId) => {
    const deadline = proposeDeadline[amendmentId];
    if (!deadline || Number.isNaN(new Date(deadline).getTime()) || new Date(deadline) <= new Date()) {
      setActionError(t('invest.entity.manage.amendments.deadlineRequired'));
      return;
    }
    return run(
      () => proposeAmendment(id, amendmentId, new Date(deadline).toISOString()),
      'invest.entity.manage.amendments.proposed',
    );
  };

  const submitAgreementVersion = (event) => {
    event.preventDefault();
    if (!agreementBody.trim()) {
      setActionError(t('invest.entity.manage.agreements.required'));
      return;
    }
    return run(
      () => createAgreementVersion(id, agreementBody.trim()).then(() => setAgreementBody('')),
      'invest.entity.manage.agreements.created',
    );
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.entity.manage.title')}</h1>
        {opportunity ? (
          <p className="mt-2 text-sm text-gray-400 leading-relaxed">{opportunity.title}</p>
        ) : null}

        {!projection && loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {projection && !access.investEnabled ? (
          <div className="mt-6"><InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice></div>
        ) : null}
        {error ? <div className="mt-6"><InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={load} /></div> : null}
        {notice ? <div className="mt-6"><InvestNotice tone="ok">{notice}</InvestNotice></div> : null}
        {actionError ? <div className="mt-6"><InvestError message={actionError} retryLabel={t('invest.common.retry')} onRetry={load} /></div> : null}

        {!loading && !error && access.investEnabled && detail && opportunity ? (
          <div className="mt-6 flex flex-col gap-6">
            <InvestSection title={t('invest.entity.manage.status.title')}>
              <p className="text-sm text-gray-300">
                {opportunityStatusLabel(opportunity.status, t)}
                {' - '}
                {t('invest.entity.manage.status.target', { amount: formatInvestCents(opportunity.targetCents, 'USD') })}
                {' - '}
                {t('invest.entity.manage.status.committed', { amount: formatInvestCents(progress.reservedCents, 'USD') })}
                {' - '}
                {t('invest.entity.manage.status.completed', { amount: formatInvestCents(progress.completedCents, 'USD') })}
                {' - '}
                {t('invest.entity.manage.status.progress', { percent: progress.percent })}
              </p>
              <p className="text-xs text-gray-500">
                {t('invest.entity.manage.status.deadline', { date: formatInvestDate(opportunity.deadlineAt) || t('invest.common.notSet') })}
              </p>
              {opportunity.closingConditionsApprovedAt ? (
                <p className="text-xs text-emerald-300">{t('invest.entity.manage.status.conditionsApproved')}</p>
              ) : null}
              {opportunity.closedAt ? (
                <p className="text-xs text-gray-400">{t('invest.entity.manage.status.closedAt', { date: formatInvestDate(opportunity.closedAt) || '' })}</p>
              ) : null}
              {opportunity.status === 'draft' ? (
                <>
                  <InvestNotice tone="warn">{t('invest.entity.raise.submitReviewNote')}</InvestNotice>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/invest/entity/raises/${opportunity.id}/edit`} className={investSecondaryButtonClassName}>
                      {t('invest.entity.raises.card.edit')}
                    </Link>
                    <button type="button" disabled={busy} onClick={submitForReview} className={investButtonClassName}>
                      {t('invest.entity.raise.submitReview')}
                    </button>
                  </div>
                </>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={showPreview} className={investSecondaryButtonClassName}>
                  {t('invest.entity.manage.preview.button')}
                </button>
                {opportunity.status === 'published' ? (
                  <Link to={`/invest/opportunities/${opportunity.id}`} className={investSecondaryButtonClassName}>
                    {t('invest.entity.raises.card.viewPublic')}
                  </Link>
                ) : null}
              </div>
            </InvestSection>

            {preview ? (
              <InvestSection title={t('invest.entity.raise.preview.title')} hint={t('invest.entity.raise.preview.hint')}>
                {(preview.answers || []).map((item) => (
                  <div key={item.question}>
                    <p className="text-sm font-medium text-white">{item.question}</p>
                    <p className="mt-1 text-sm text-gray-300 leading-relaxed">{item.answer}</p>
                  </div>
                ))}
                {preview.verification ? (
                  <p className="text-xs text-gray-400 leading-relaxed">{preview.verification.note}</p>
                ) : null}
              </InvestSection>
            ) : null}

            <InvestSection title={t('invest.entity.manage.questions.title')} hint={t('invest.entity.manage.questions.hint')}>
              {questions.length === 0 ? (
                <EmptyState icon={Inbox} title={t('invest.entity.manage.questions.empty.title')} copy={t('invest.entity.manage.questions.empty.copy')} />
              ) : null}
              {openQuestions.map((q) => (
                <div key={q.id} className="rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
                  <p className="text-sm font-medium text-white">{q.question}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatInvestDate(q.createdAt)}</p>
                  <div className="mt-3 flex flex-col gap-2">
                    <textarea
                      rows={3}
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      className={investInputClassName}
                      aria-label={t('invest.entity.manage.questions.answerLabel')}
                    />
                    <div>
                      <button type="button" disabled={busy} onClick={() => submitAnswer(q.id)} className={investButtonClassName}>
                        {t('invest.entity.manage.questions.answerButton')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {answeredQuestions.map((q) => (
                <div key={q.id} className="rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
                  <p className="text-sm font-medium text-white">{q.question}</p>
                  <p className="mt-1 text-sm text-gray-300 leading-relaxed">{q.answer}</p>
                  <p className="mt-1 text-xs text-gray-500">{t('invest.entity.manage.questions.answeredLabel')}</p>
                </div>
              ))}
            </InvestSection>

            <InvestSection title={t('invest.entity.manage.updates.title')} hint={t('invest.entity.manage.updates.hint')}>
              <form onSubmit={submitUpdate} className="flex flex-col gap-3">
                <InvestField label={t('invest.entity.manage.updates.form.title')}>
                  <input type="text" value={updateForm.title} onChange={(e) => setUpdateForm((p) => ({ ...p, title: e.target.value }))} className={investInputClassName} />
                </InvestField>
                <InvestField label={t('invest.entity.manage.updates.form.body')}>
                  <textarea rows={3} value={updateForm.body} onChange={(e) => setUpdateForm((p) => ({ ...p, body: e.target.value }))} className={investInputClassName} />
                </InvestField>
                <InvestField label={t('invest.entity.manage.updates.form.due')} hint={t('invest.entity.manage.updates.form.dueHint')}>
                  <input type="date" value={updateForm.dueAt} onChange={(e) => setUpdateForm((p) => ({ ...p, dueAt: e.target.value }))} className={investInputClassName} />
                </InvestField>
                <div>
                  <button type="submit" disabled={busy} className={investButtonClassName}>
                    {t('invest.entity.manage.updates.form.submit')}
                  </button>
                </div>
              </form>
              {updates.length === 0 ? (
                <EmptyState icon={Inbox} title={t('invest.entity.manage.updates.empty.title')} copy={t('invest.entity.manage.updates.empty.copy')} />
              ) : null}
              {updates.map((u) => (
                <div key={u.id} className="rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{u.title}</p>
                    <span className={`text-xs font-semibold ${u.status === 'overdue' ? 'text-amber-300' : 'text-gray-400'}`}>
                      {updateStatusLabel(u.status, t)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-300 leading-relaxed">{u.body}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {u.status === 'overdue'
                      ? t('invest.entity.manage.updates.overdue', { date: formatInvestDate(u.dueAt) || '' })
                      : formatInvestDate(u.dueAt) || formatInvestDate(u.publishedAt) || ''}
                  </p>
                  {u.status !== 'published' ? (
                    <div className="mt-2">
                      <button type="button" disabled={busy} onClick={() => run(() => publishUpdate(id, u.id), 'invest.entity.manage.updates.published')} className={investSecondaryButtonClassName}>
                        {t('invest.entity.manage.updates.publish')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </InvestSection>

            <InvestSection title={t('invest.entity.manage.amendments.title')} hint={t('invest.entity.manage.amendments.hint')}>
              <form onSubmit={submitAmendment} className="flex flex-col gap-3">
                <InvestField label={t('invest.entity.manage.amendments.form.summary')} hint={t('invest.entity.manage.amendments.form.summaryHint')}>
                  <textarea rows={3} value={amendmentForm.summary} onChange={(e) => setAmendmentForm((p) => ({ ...p, summary: e.target.value }))} className={investInputClassName} />
                </InvestField>
                <InvestField label={t('invest.entity.manage.amendments.form.version')} hint={t('invest.entity.manage.amendments.form.versionHint')}>
                  <select value={amendmentForm.newAgreementVersionId} onChange={(e) => setAmendmentForm((p) => ({ ...p, newAgreementVersionId: e.target.value }))} className={investInputClassName}>
                    <option value="">{t('invest.entity.manage.amendments.form.noNewVersion')}</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>{t('invest.my.agreementVersion', { version: v.versionNumber })}</option>
                    ))}
                  </select>
                </InvestField>
                <div>
                  <button type="submit" disabled={busy} className={investButtonClassName}>
                    {t('invest.entity.manage.amendments.form.submit')}
                  </button>
                </div>
              </form>
              {amendments.length === 0 ? (
                <EmptyState icon={Inbox} title={t('invest.entity.manage.amendments.empty.title')} copy={t('invest.entity.manage.amendments.empty.copy')} />
              ) : null}
              {amendments.map((a) => (
                <div key={a.id} className="rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{a.changes?.summary || t('invest.entity.manage.amendments.untitled')}</p>
                    <span className="text-xs font-semibold text-gray-400">{amendmentStatusLabel(a.status, t)}</span>
                  </div>
                  {a.status === 'proposed' ? (
                    <p className="mt-1 text-xs text-amber-200 leading-relaxed">
                      {t('invest.entity.manage.amendments.proposedState', {
                        sent: formatInvestDate(a.noticeSentAt) || '',
                        deadline: formatInvestDate(a.reconfirmationDeadlineAt) || '',
                      })}
                    </p>
                  ) : null}
                  {a.status === 'draft' ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <InvestField label={t('invest.entity.manage.amendments.propose.deadline')}>
                        <input
                          type="date"
                          value={proposeDeadline[a.id] || ''}
                          onChange={(e) => setProposeDeadline((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          className={investInputClassName}
                        />
                      </InvestField>
                      <button type="button" disabled={busy} onClick={() => submitPropose(a.id)} className={investButtonClassName}>
                        {t('invest.entity.manage.amendments.propose.button')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </InvestSection>

            <InvestSection title={t('invest.entity.manage.agreements.title')} hint={t('invest.entity.manage.agreements.hint')}>
              {versions.length === 0 ? (
                <EmptyState icon={Inbox} title={t('invest.entity.manage.agreements.empty.title')} copy={t('invest.entity.manage.agreements.empty.copy')} />
              ) : null}
              {versions.map((v) => (
                <div key={v.id} className="rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
                  <p className="text-sm font-medium text-white">{t('invest.my.agreementVersion', { version: v.versionNumber })}</p>
                  <p className="mt-1 break-all font-mono text-xs text-gray-400">{v.contentHash}</p>
                </div>
              ))}
              <form onSubmit={submitAgreementVersion} className="flex flex-col gap-3">
                <InvestField label={t('invest.entity.manage.agreements.form.body')}>
                  <textarea rows={4} value={agreementBody} onChange={(e) => setAgreementBody(e.target.value)} className={investInputClassName} />
                </InvestField>
                <div>
                  <button type="submit" disabled={busy} className={investButtonClassName}>
                    {t('invest.entity.manage.agreements.form.submit')}
                  </button>
                </div>
              </form>
            </InvestSection>

            {opportunity.status === 'closed' ? (
              <InvestSection title={t('invest.entity.manage.obligations.title')} hint={t('invest.entity.manage.obligations.hint')}>
                <ul className="flex flex-col gap-2 text-sm text-gray-300 leading-relaxed">
                  <li>{t('invest.entity.manage.obligations.item1')}</li>
                  <li>{t('invest.entity.manage.obligations.item2')}</li>
                  <li>{t('invest.entity.manage.obligations.item3')}</li>
                </ul>
              </InvestSection>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
