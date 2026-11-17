// OxSteed Invest entity fundraising: "Raise capital".
//
// A private draft application for one of the caller's businesses. Creating
// the draft never publishes anything, and submitting it only sends it for
// review: publication is a separate reviewer step. Sensitive identity or
// financial documents never go in this form; they belong in the restricted
// verification and document flows. All rendering is projection-only: the
// page reads GET /api/me/access through investAccessFromProjection and
// never checks role or mode.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import EmptyState from '../../components/EmptyState';
import { Inbox } from 'lucide-react';
import { listBusinesses, listManagedBusinesses } from '../../api/businesses';
import { createOpportunity, createAgreementVersion, getOpportunityPreview, submitOpportunityForReview } from '../../api/invest';
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
  agreementBody: '',
};

export default function InvestEntityRaisePage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState(() => searchParams.get('businessId') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [authority, setAuthority] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [preview, setPreview] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const loadBusinesses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [owned, managed] = await Promise.all([
        listBusinesses(),
        listManagedBusinesses().catch(() => []),
      ]);
      const seen = new Set();
      const merged = [...(owned || []), ...(managed || [])].filter((b) => {
        const key = String(b.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setBusinesses(merged);
      if (!businessId && merged.length === 1) setBusinessId(String(merged[0].id));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.entity.raise.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [businessId, t]);

  useEffect(() => { if (access.investEnabled) loadBusinesses(); else if (projection) setLoading(false); }, [access.investEnabled, projection, loadBusinesses]);

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const validate = () => {
    if (!businessId) return t('invest.entity.raise.errors.business');
    if (!authority) return t('invest.entity.raise.errors.authority');
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
    if (!form.agreementBody.trim()) return t('invest.entity.raise.errors.agreement');
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
      const { opportunity } = await createOpportunity({
        businessId: Number(businessId),
        title: form.title.trim(),
        purpose: form.purpose.trim(),
        targetCents: parseAmountToCents(form.target),
        minimumCents: form.minimum.trim() ? parseAmountToCents(form.minimum) : 0,
        deadlineAt: new Date(form.deadline).toISOString(),
        valuationRule: form.valuationRule.trim(),
        useOfProceeds: form.useOfProceeds.trim(),
        intermediaryRef: form.intermediaryRef.trim() || null,
        details,
      });
      setCreated(opportunity);
      try {
        await createAgreementVersion(opportunity.id, form.agreementBody.trim());
      } catch (e) {
        setFormError(e?.response?.data?.error || e.message || t('invest.entity.raise.error.agreementFailed'));
      }
      try {
        setPreview(await getOpportunityPreview(opportunity.id));
      } catch {
        setPreview(null);
      }
    } catch (e) {
      setFormError(e?.response?.data?.error || e.message || t('invest.entity.raise.error.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submitForReview = async () => {
    if (!created) return;
    setBusy(true);
    setFormError(null);
    try {
      await submitOpportunityForReview(created.id);
      setSubmitted(true);
    } catch (e) {
      setFormError(e?.response?.data?.error || e.message || t('invest.entity.raise.error.submitFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.entity.raise.title')}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{t('invest.entity.raise.intro')}</p>

        {!projection && loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {projection && !access.investEnabled ? (
          <div className="mt-6"><InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice></div>
        ) : null}
        {error ? <div className="mt-6"><InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={loadBusinesses} /></div> : null}

        {!loading && !error && access.investEnabled && businesses && businesses.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={Inbox} title={t('invest.entity.raise.business.empty.title')} copy={t('invest.entity.raise.business.empty.copy')} />
          </div>
        ) : null}

        {!loading && !error && access.investEnabled && businesses && businesses.length > 0 && !created ? (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-6">
            <InvestNotice tone="info">{t('invest.entity.raise.documentsNotice')}</InvestNotice>
            <InvestSection title={t('invest.entity.raise.sections.entity.title')} hint={t('invest.entity.raise.sections.entity.hint')}>
              <InvestField label={t('invest.entity.raise.business.label')}>
                <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} className={investInputClassName}>
                  <option value="">{t('invest.entity.raise.business.choose')}</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={String(b.id)}>{b.business_name || b.name || String(b.id)}</option>
                  ))}
                </select>
              </InvestField>
              <label className="flex items-start gap-2 text-sm text-gray-200">
                <input type="checkbox" checked={authority} onChange={(e) => setAuthority(e.target.checked)} className="mt-0.5" />
                <span>{t('invest.entity.raise.authority.label')}</span>
              </label>
              <p className="text-xs text-gray-400 leading-relaxed">{t('invest.entity.raise.authority.hint')}</p>
            </InvestSection>

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

            <InvestSection title={t('invest.entity.raise.sections.agreement.title')} hint={t('invest.entity.raise.sections.agreement.hint')}>
              <InvestField label={t('invest.entity.raise.form.agreement.label')}>
                <textarea rows={6} value={form.agreementBody} onChange={(e) => setField('agreementBody', e.target.value)} className={investInputClassName} />
              </InvestField>
            </InvestSection>

            {formError ? <p className="text-sm text-red-300" role="alert">{formError}</p> : null}
            <div>
              <button type="submit" disabled={busy} className={investButtonClassName}>
                {busy ? t('invest.entity.raise.creating') : t('invest.entity.raise.submit')}
              </button>
            </div>
          </form>
        ) : null}

        {created ? (
          <div className="mt-6 flex flex-col gap-6">
            <InvestNotice tone="ok">{t('invest.entity.raise.created.title')}</InvestNotice>
            <InvestSection title={created.title} hint={t('invest.entity.raise.created.copy')}>
              <p className="text-sm text-gray-300">
                {opportunityStatusLabel(created.status, t)}
                {' - '}
                {t('invest.entity.raise.created.target', { amount: formatInvestCents(created.targetCents, 'USD') })}
                {' - '}
                {formatInvestDate(created.deadlineAt)}
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
                <Link to={`/invest/entity/raises/${created.id}`} className={investSecondaryButtonClassName}>
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
