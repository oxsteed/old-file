// OxSteed Invest entity fundraising: edit a private draft raise.
//
// A draft opportunity can be fixed here; the form reuses the raise-page
// fields (title, purpose, target, minimum, deadline, valuation rule, use
// of proceeds, intermediary reference, and the entity-details fields) and
// saves through PUT /api/invest/opportunities/:id with the opportunity's
// expectedVersion, so a stale read cannot overwrite a newer draft. Saving
// never publishes: the draft stays private, and submitting it for review
// only sends it for review. Agreement text is NOT edited here; agreement
// versions are created from the manage page. Once the opportunity leaves
// draft, direct edits are refused (409 invest_opportunity_amendment_required)
// and material changes go through the controlled amendment process with
// investor notice and reconfirmation. There is no reviewer
// effective/reject step for amendments: the API offers draft-to-proposed
// only, and the controlled process is notice plus reconfirmation, which
// already exists. All rendering is projection-only: the page reads
// GET /api/me/access through investAccessFromProjection and never checks
// role or mode.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import { getOpportunity, getOpportunityPreview, submitOpportunityForReview, updateOpportunity } from '../../api/invest';
import { investAccessFromProjection, parseAmountToCents, formatInvestCents, opportunityStatusLabel } from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, InvestSection, InvestField, formatInvestDate, investButtonClassName, investInputClassName, investSecondaryButtonClassName } from './InvestShared';

const EMPTY_FORM = {
  title: '',
  purpose: '',
  target: '',
  minimum: '',
  deadline: '',
  valuationRule: '',
  useOfProceeds: '',
  intermediaryRef: '',
  legalDetails: '',
  financials: '',
  ownership: '',
  risks: '',
  relatedParties: '',
};

/** ISO timestamp to a local YYYY-MM-DD date-input value. */
function toDateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formFromOpportunity(opportunity) {
  const details = opportunity.details || {};
  return {
    title: opportunity.title || '',
    purpose: opportunity.purpose || '',
    target: opportunity.targetCents ? String(Number(opportunity.targetCents) / 100) : '',
    minimum: opportunity.minimumCents ? String(Number(opportunity.minimumCents) / 100) : '',
    deadline: toDateInputValue(opportunity.deadlineAt),
    valuationRule: opportunity.valuationRule || '',
    useOfProceeds: opportunity.useOfProceeds || '',
    intermediaryRef: opportunity.intermediaryRef || '',
    legalDetails: details.legalDetails || '',
    financials: details.financials || '',
    ownership: details.ownership || '',
    risks: details.risks || '',
    relatedParties: details.relatedParties || '',
  };
}

export default function InvestEntityRaiseEditPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useTranslation();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [opportunity, setOpportunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { opportunity: loaded } = await getOpportunity(id);
      setOpportunity(loaded);
      setForm(formFromOpportunity(loaded));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.entity.edit.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { if (access.investEnabled) load(); else if (projection) setLoading(false); }, [access.investEnabled, projection, load]);

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const validate = () => {
    if (!form.title.trim()) return t('invest.entity.raise.errors.title');
    if (!form.purpose.trim()) return t('invest.entity.raise.errors.purpose');
    const targetCents = parseAmountToCents(form.target);
    if (!targetCents) return t('invest.entity.raise.errors.target');
    const minimumCents = form.minimum.trim() ? parseAmountToCents(form.minimum) : 0;
    if (minimumCents === null || minimumCents > targetCents) return t('invest.entity.raise.errors.minimum');
    if (!form.deadline || Number.isNaN(new Date(form.deadline).getTime()) || new Date(form.deadline) <= new Date()) {
      return t('invest.entity.raise.errors.deadline');
    }
    if (!form.valuationRule.trim()) return t('invest.entity.raise.errors.valuation');
    if (!form.useOfProceeds.trim()) return t('invest.entity.raise.errors.useOfProceeds');
    return null;
  };

  const submit = async (event) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      const details = {};
      for (const key of ['legalDetails', 'financials', 'ownership', 'risks', 'relatedParties']) {
        if (form[key].trim()) details[key] = form[key].trim();
      }
      const { opportunity: updated } = await updateOpportunity(id, {
        title: form.title.trim(),
        purpose: form.purpose.trim(),
        targetCents: parseAmountToCents(form.target),
        minimumCents: form.minimum.trim() ? parseAmountToCents(form.minimum) : 0,
        deadlineAt: new Date(form.deadline).toISOString(),
        valuationRule: form.valuationRule.trim(),
        useOfProceeds: form.useOfProceeds.trim(),
        intermediaryRef: form.intermediaryRef.trim() || null,
        details,
        expectedVersion: opportunity.expectedVersion,
      });
      setOpportunity(updated);
      setSaved(true);
      try {
        setPreview(await getOpportunityPreview(id));
      } catch {
        setPreview(null);
      }
    } catch (e) {
      if (e?.response?.data?.code === 'invest_opportunity_amendment_required') {
        setFormError(t('invest.entity.edit.error.amendmentRequired'));
      } else {
        setFormError(e?.response?.data?.error || e.message || t('invest.entity.edit.error.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitForReview = async () => {
    if (!opportunity) return;
    setBusy(true);
    setFormError(null);
    try {
      await submitOpportunityForReview(opportunity.id);
      setSubmitted(true);
    } catch (e) {
      setFormError(e?.response?.data?.error || e.message || t('invest.entity.raise.error.submitFailed'));
    } finally {
      setBusy(false);
    }
  };

  const isDraft = opportunity && opportunity.status === 'draft';

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.entity.edit.title')}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{t('invest.entity.edit.intro')}</p>

        {!projection && loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {projection && !access.investEnabled ? (
          <div className="mt-6"><InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice></div>
        ) : null}
        {error ? <div className="mt-6"><InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={load} /></div> : null}

        {!loading && !error && access.investEnabled && opportunity && !isDraft ? (
          <div className="mt-6 flex flex-col gap-4">
            <InvestNotice tone="warn">{t('invest.entity.edit.notEditable.copy')}</InvestNotice>
            <div>
              <Link to={`/invest/entity/raises/${opportunity.id}`} className={investSecondaryButtonClassName}>
                {t('invest.entity.raise.manageLink')}
              </Link>
            </div>
          </div>
        ) : null}

        {!loading && !error && access.investEnabled && isDraft ? (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-6">
            <InvestNotice tone="info">{t('invest.entity.edit.draftNotice')}</InvestNotice>
            <InvestSection title={t('invest.entity.raise.sections.raise.title')} hint={t('invest.entity.raise.sections.raise.hint')}>
              <InvestField label={t('invest.entity.raise.form.title.label')}>
                <input type="text" value={form.title} onChange={(e) => setField('title', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.purpose.label')} hint={t('invest.entity.raise.form.purpose.hint')}>
                <textarea rows={3} value={form.purpose} onChange={(e) => setField('purpose', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.target.label')} hint={t('invest.entity.raise.form.target.hint')}>
                <input type="text" inputMode="decimal" value={form.target} onChange={(e) => setField('target', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.minimum.label')} hint={t('invest.entity.raise.form.minimum.hint')}>
                <input type="text" inputMode="decimal" value={form.minimum} onChange={(e) => setField('minimum', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.deadline.label')} hint={t('invest.entity.raise.form.deadline.hint')}>
                <input type="date" value={form.deadline} onChange={(e) => setField('deadline', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.valuation.label')} hint={t('invest.entity.raise.form.valuation.hint')}>
                <input type="text" value={form.valuationRule} onChange={(e) => setField('valuationRule', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.useOfProceeds.label')}>
                <textarea rows={3} value={form.useOfProceeds} onChange={(e) => setField('useOfProceeds', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.intermediary.label')} hint={t('invest.entity.raise.form.intermediary.hint')}>
                <input type="text" value={form.intermediaryRef} onChange={(e) => setField('intermediaryRef', e.target.value)} className={investInputClassName} />
              </InvestField>
            </InvestSection>

            <InvestSection title={t('invest.entity.raise.sections.details.title')} hint={t('invest.entity.raise.sections.details.hint')}>
              <InvestField label={t('invest.entity.raise.form.legal.label')} hint={t('invest.entity.raise.form.legal.hint')}>
                <textarea rows={4} value={form.legalDetails} onChange={(e) => setField('legalDetails', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.financials.label')} hint={t('invest.entity.raise.form.financials.hint')}>
                <textarea rows={4} value={form.financials} onChange={(e) => setField('financials', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.ownership.label')}>
                <textarea rows={3} value={form.ownership} onChange={(e) => setField('ownership', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.risks.label')}>
                <textarea rows={3} value={form.risks} onChange={(e) => setField('risks', e.target.value)} className={investInputClassName} />
              </InvestField>
              <InvestField label={t('invest.entity.raise.form.relatedParties.label')} hint={t('invest.entity.raise.form.relatedParties.hint')}>
                <textarea rows={3} value={form.relatedParties} onChange={(e) => setField('relatedParties', e.target.value)} className={investInputClassName} />
              </InvestField>
            </InvestSection>

            {formError ? <p className="text-sm text-red-300" role="alert">{formError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={investButtonClassName}>
                {busy ? t('invest.entity.edit.saving') : t('invest.entity.edit.save')}
              </button>
              <Link to={`/invest/entity/raises/${opportunity.id}`} className={investSecondaryButtonClassName}>
                {t('invest.entity.raise.manageLink')}
              </Link>
            </div>
          </form>
        ) : null}

        {saved && opportunity ? (
          <div className="mt-6 flex flex-col gap-6">
            <InvestNotice tone="ok">{t('invest.entity.edit.saved.title')}</InvestNotice>
            <InvestSection title={opportunity.title} hint={t('invest.entity.edit.saved.copy')}>
              <p className="text-sm text-gray-300">
                {opportunityStatusLabel(opportunity.status, t)}
                {' - '}
                {t('invest.entity.raise.created.target', { amount: formatInvestCents(opportunity.targetCents, 'USD') })}
                {' - '}
                {formatInvestDate(opportunity.deadlineAt)}
              </p>
              {submitted ? (
                <InvestNotice tone="ok">{t('invest.entity.raise.submitted.copy')}</InvestNotice>
              ) : (
                <>
                  <InvestNotice tone="warn">{t('invest.entity.raise.submitReviewNote')}</InvestNotice>
                  <div>
                    <button type="button" disabled={busy} onClick={submitForReview} className={investButtonClassName}>
                      {t('invest.entity.raise.submitReview')}
                    </button>
                  </div>
                </>
              )}
              {formError ? <p className="text-sm text-red-300" role="alert">{formError}</p> : null}
              <div>
                <Link to={`/invest/entity/raises/${opportunity.id}`} className={investSecondaryButtonClassName}>
                  {t('invest.entity.raise.manageLink')}
                </Link>
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
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
