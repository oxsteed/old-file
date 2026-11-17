// OxSteed Invest participation application ("Request investor access").
//
// The five sections are kept distinct by design:
//   1. Identity and organization authority (reviewer findings, read-only here)
//   2. Participation eligibility (the applicant's own attestations)
//   3. Opportunity-specific requirements
//   4. Confidential-document access
//   5. Agreement acceptance (its own endpoint, separate from the rest)
//
// Drafts can be saved and resumed. Applying changes nothing else about the
// account: it sets no global gate and never blocks hiring help, ordering
// food, messaging, or any other ordinary customer activity.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import EmptyState from '../../components/EmptyState';
import { SearchX } from 'lucide-react';
import {
  listOpportunities, getOpportunity, listApplications, createApplication,
  updateApplication, submitApplication, withdrawApplication, acceptAgreement,
  listDocuments, listAgreementVersions,
} from '../../api/invest';
import { investAccessFromProjection, formatInvestCents, applicationStatusLabel, documentVisibilityLabel } from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, InvestSection, InvestField, formatInvestDate, investButtonClassName, investInputClassName, investSecondaryButtonClassName } from './InvestShared';

const EMPTY_ELIGIBILITY = {
  usResident: false,
  adult: false,
  actingAs: 'self',
  organizationName: '',
  creditOnlyAck: false,
  riskAck: false,
  opportunityRequirementsAck: false,
};

function CheckRow({ id, checked, onChange, label, disabled }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm text-gray-200">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="mt-0.5 h-4 w-4 accent-orange-500" />
      <span>{label}</span>
    </label>
  );
}

export default function InvestApplicationPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [searchParams] = useSearchParams();
  const opportunityId = searchParams.get('opportunityId');

  const [chooser, setChooser] = useState(null);
  const [opportunity, setOpportunity] = useState(null);
  const [application, setApplication] = useState(null);
  const [eligibility, setEligibility] = useState(EMPTY_ELIGIBILITY);
  const [documents, setDocuments] = useState([]);
  const [agreementVersions, setAgreementVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!opportunityId) {
        const data = await listOpportunities('publication_date');
        setChooser(Array.isArray(data?.opportunities) ? data.opportunities : []);
        return;
      }
      const data = await getOpportunity(opportunityId);
      setOpportunity(data?.opportunity || null);
      const apps = await listApplications();
      const mine = (Array.isArray(apps?.applications) ? apps.applications : [])
        .find((a) => String(a.opportunityId) === String(opportunityId));
      if (mine) {
        setApplication(mine);
        setEligibility({ ...EMPTY_ELIGIBILITY, ...(mine.eligibility || {}) });
      }
      try {
        const docs = await listDocuments(opportunityId);
        setDocuments(Array.isArray(docs?.documents) ? docs.documents : (Array.isArray(docs) ? docs : []));
      } catch { setDocuments([]); }
      try {
        const versions = await listAgreementVersions(opportunityId);
        setAgreementVersions(Array.isArray(versions?.versions) ? versions.versions : (Array.isArray(versions) ? versions : []));
      } catch { setAgreementVersions([]); }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.application.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [opportunityId, t]);

  useEffect(() => {
    if (access.investEnabled) load();
    else if (projection) setLoading(false);
  }, [load, access.investEnabled, projection]);

  const editable = application && ['draft', 'needs_information'].includes(application.status);
  const currentVersion = agreementVersions.length
    ? agreementVersions[agreementVersions.length - 1]
    : null;

  const saveDraft = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      let app = application;
      if (!app) {
        const created = await createApplication(opportunityId, currentVersion?.id || undefined);
        app = created?.application || created;
        setApplication(app);
      }
      const updated = await updateApplication(app.id, eligibility);
      const next = updated?.application || updated;
      setApplication(next);
      setEligibility({ ...EMPTY_ELIGIBILITY, ...(next?.eligibility || {}) });
      setNotice(t('invest.application.draftSaved'));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.application.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      if (!application) {
        setError(t('invest.application.error.saveFirst'));
        return;
      }
      const updated = await submitApplication(application.id);
      setApplication(updated?.application || updated);
      setNotice(t('invest.application.submitted'));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.application.error.submitFailed'));
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await withdrawApplication(application.id);
      setApplication(updated?.application || updated);
      setNotice(t('invest.application.withdrawn'));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.application.error.withdrawFailed'));
    } finally {
      setSaving(false);
    }
  };

  const accept = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await acceptAgreement(application.id);
      setApplication(updated?.application || updated);
      setNotice(t('invest.application.agreementAccepted'));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.application.error.acceptFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.application.title')}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{t('invest.application.intro')}</p>
        <div className="mt-4">
          <InvestNotice>{t('invest.application.noBlockNotice')}</InvestNotice>
        </div>

        {loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {projection && !access.investEnabled ? (
          <div className="mt-6">
            <InvestNotice tone="warn">{t('invest.common.notAvailable')}</InvestNotice>
          </div>
        ) : null}
        {error ? <div className="mt-6"><InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={load} /></div> : null}
        {notice ? <div className="mt-6"><InvestNotice tone="ok">{notice}</InvestNotice></div> : null}

        {!loading && !error && access.investEnabled && !opportunityId ? (
          <div className="mt-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-white">{t('invest.application.choose.title')}</h2>
            {!chooser || chooser.length === 0 ? (
              <EmptyState icon={SearchX} title={t('invest.directory.empty.title')} copy={t('invest.directory.empty.copy')} />
            ) : (
              <ul className="flex flex-col gap-3">
                {chooser.map((opp) => (
                  <li key={opp.id} className="rounded-2xl border border-gray-700 bg-gray-900 p-4">
                    <Link to={`/invest/apply?opportunityId=${opp.id}`} className="text-base font-semibold text-white hover:text-orange-300">
                      {opp.title}
                    </Link>
                    <p className="mt-1 text-sm text-gray-400">
                      {opp.entityName || t('invest.directory.entityUnknown')}
                      {opp.entityLocation ? ` - ${opp.entityLocation}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {!loading && !error && access.investEnabled && opportunityId && opportunity ? (
          <div className="mt-6 flex flex-col gap-6">
            <div>
              <Link to={`/invest/opportunities/${opportunity.id}`} className="text-sm text-orange-400 hover:text-orange-300">
                {opportunity.title}
              </Link>
              {application ? (
                <p className="mt-2 text-sm text-gray-300">
                  {t('invest.application.currentStatus', { status: applicationStatusLabel(application.status, t) })}
                </p>
              ) : (
                <p className="mt-2 text-sm text-gray-300">{t('invest.application.noApplicationYet')}</p>
              )}
              {application?.reviewNote ? (
                <p className="mt-2 text-sm text-amber-200 leading-relaxed">{application.reviewNote}</p>
              ) : null}
            </div>

            <InvestSection title={t('invest.application.sections.identity.title')} hint={t('invest.application.sections.identity.hint')}>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-gray-400">{t('invest.application.sections.identity.identityVerified')}</dt>
                  <dd className="mt-1 font-semibold text-white">
                    {application?.identityVerified ? t('invest.common.yes') : t('invest.common.notYet')}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">{t('invest.application.sections.identity.authorityVerified')}</dt>
                  <dd className="mt-1 font-semibold text-white">
                    {application?.authorityVerified ? t('invest.common.yes') : t('invest.common.notYet')}
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-gray-400 leading-relaxed">{t('invest.application.sections.identity.note')}</p>
            </InvestSection>

            <InvestSection title={t('invest.application.sections.eligibility.title')} hint={t('invest.application.sections.eligibility.hint')}>
              <CheckRow
                id="invest-elig-us"
                checked={!!eligibility.usResident}
                onChange={(v) => setEligibility((c) => ({ ...c, usResident: v }))}
                label={t('invest.application.sections.eligibility.usResident')}
                disabled={!editable && !!application}
              />
              <CheckRow
                id="invest-elig-adult"
                checked={!!eligibility.adult}
                onChange={(v) => setEligibility((c) => ({ ...c, adult: v }))}
                label={t('invest.application.sections.eligibility.adult')}
                disabled={!editable && !!application}
              />
              <InvestField label={t('invest.application.sections.eligibility.actingAs')}>
                <select
                  value={eligibility.actingAs || 'self'}
                  onChange={(e) => setEligibility((c) => ({ ...c, actingAs: e.target.value }))}
                  disabled={!editable && !!application}
                  className={investInputClassName}
                >
                  <option value="self">{t('invest.application.sections.eligibility.actingAsSelf')}</option>
                  <option value="organization">{t('invest.application.sections.eligibility.actingAsOrganization')}</option>
                </select>
              </InvestField>
              {eligibility.actingAs === 'organization' ? (
                <InvestField label={t('invest.application.sections.eligibility.organizationName')}>
                  <input
                    type="text"
                    value={eligibility.organizationName || ''}
                    onChange={(e) => setEligibility((c) => ({ ...c, organizationName: e.target.value }))}
                    disabled={!editable && !!application}
                    className={investInputClassName}
                  />
                </InvestField>
              ) : null}
              <CheckRow
                id="invest-elig-credit"
                checked={!!eligibility.creditOnlyAck}
                onChange={(v) => setEligibility((c) => ({ ...c, creditOnlyAck: v }))}
                label={t('invest.application.sections.eligibility.creditOnlyAck')}
                disabled={!editable && !!application}
              />
              <CheckRow
                id="invest-elig-risk"
                checked={!!eligibility.riskAck}
                onChange={(v) => setEligibility((c) => ({ ...c, riskAck: v }))}
                label={t('invest.application.sections.eligibility.riskAck')}
                disabled={!editable && !!application}
              />
            </InvestSection>

            <InvestSection title={t('invest.application.sections.requirements.title')} hint={t('invest.application.sections.requirements.hint')}>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-gray-400">{t('invest.directory.card.minimum')}</dt>
                  <dd className="mt-1 font-semibold text-white">{formatInvestCents(opportunity.minimumCents, 'USD')}</dd>
                </div>
                <div>
                  <dt className="text-gray-400">{t('invest.directory.card.target')}</dt>
                  <dd className="mt-1 font-semibold text-white">{formatInvestCents(opportunity.targetCents, 'USD')}</dd>
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
              <CheckRow
                id="invest-elig-opp"
                checked={!!eligibility.opportunityRequirementsAck}
                onChange={(v) => setEligibility((c) => ({ ...c, opportunityRequirementsAck: v }))}
                label={t('invest.application.sections.requirements.ack')}
                disabled={!editable && !!application}
              />
            </InvestSection>

            <InvestSection title={t('invest.application.sections.documents.title')} hint={t('invest.application.sections.documents.hint')}>
              {documents.length === 0 ? (
                <p className="text-sm text-gray-400">{t('invest.detail.documents.empty.copy')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
                      <span className="text-sm font-medium text-white">{doc.title}</span>
                      <span className="text-xs text-gray-400">{documentVisibilityLabel(doc.visibility, t)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </InvestSection>

            <InvestSection title={t('invest.application.sections.agreement.title')} hint={t('invest.application.sections.agreement.hint')}>
              {currentVersion ? (
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-gray-400">{t('invest.application.sections.agreement.version')}</dt>
                    <dd className="mt-1 font-semibold text-white">{currentVersion.versionNumber}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-gray-400">{t('invest.application.sections.agreement.hash')}</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-gray-300">{currentVersion.contentHash}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-gray-400">{t('invest.application.sections.agreement.none')}</p>
              )}
              <p className="text-sm text-gray-400 leading-relaxed">
                {application?.agreementAcceptedAt
                  ? t('invest.application.sections.agreement.acceptedAt', { date: formatInvestDate(application.agreementAcceptedAt) || application.agreementAcceptedAt })
                  : t('invest.application.sections.agreement.notAccepted')}
              </p>
              {application && !application.agreementAcceptedAt ? (
                <div>
                  <button type="button" onClick={accept} disabled={saving} className={investButtonClassName}>
                    {t('invest.application.sections.agreement.acceptButton')}
                  </button>
                </div>
              ) : null}
            </InvestSection>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={saveDraft} disabled={saving || (!!application && !editable)} className={investButtonClassName}>
                {t('invest.application.saveDraft')}
              </button>
              {editable ? (
                <button type="button" onClick={submit} disabled={saving} className={investSecondaryButtonClassName}>
                  {t('invest.application.submit')}
                </button>
              ) : null}
              {application && application.status !== 'withdrawn' ? (
                <button type="button" onClick={withdraw} disabled={saving} className={investSecondaryButtonClassName}>
                  {t('invest.application.withdraw')}
                </button>
              ) : null}
              <Link to="/invest/my-investments" className={investSecondaryButtonClassName}>
                {t('invest.directory.myInvestments')}
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
