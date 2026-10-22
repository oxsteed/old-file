import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import '../styles/JobDetailPage.css';
import { JOB_FIELD_RULES } from '../shared/jobSchema.js';
import {
  ACCEPTED_JOB_STATUSES, SCHEMA_LIMITS, buildJobPatch, canEditJob, classifyEditError, fieldErrorKeys, formFromJob,
} from '../utils/jobEditModel';

const LOCKED_FORM_FIELDS = new Set(['budget_type', 'budget_min', 'budget_max', 'description', 'category_name', 'recurrence']);

function newIdempotencyKey() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

/** Owner edit form for a posted job (PATCH /api/jobs/:id with optimistic concurrency). */
export default function JobEditPage() {
  const { id } = useParams();
  const { user } = useAuth();
  return <JobEditContent key={`${id}:${user?.id ?? 'guest'}`} />;
}

function JobEditContent() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { fetchJob, job, loading, error, updateJob } = useJobs();
  const formId = useId();
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const summaryRef = useRef(null);

  useEffect(() => { void fetchJob(id); }, [id, fetchJob]);
  useEffect(() => { if (job && String(job.id) === String(id)) setForm(formFromJob(job)); }, [job?.id, job?.version, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = useMemo(() => (job && form ? buildJobPatch(job, form) : null), [job, form]);
  const accepted = ACCEPTED_JOB_STATUSES.includes(job?.status);
  const pendingBids = Number(job?.bid_count || 0) > 0;

  if (!job || !form) {
    return (
      <PageShell>
        <div className="jdp-page jdp-state" aria-busy={loading}>
          {error ? <><h1>{t('jobDetail.loadFailed')}</h1>
            <button type="button" className="jdp-btn-primary" onClick={() => fetchJob(id)} data-track="ui.72b588b129.1">{t('jobDetail.retry')}</button></>
            : <p role="status">{t('jobDetail.loadingJob')}</p>}
        </div>
      </PageShell>
    );
  }

  if (!canEditJob(job, user)) {
    return (
      <PageShell>
        <div className="jdp-page jdp-state">
          <h1>{t('jobEdit.notEditableTitle')}</h1>
          <p>{t('jobEdit.failures.notEditable')}</p>
          <Link className="jdp-btn-primary" to={`/jobs/${id}`}>{t('jobEdit.backToJob')}</Link>
        </div>
      </PageShell>
    );
  }

  const set = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[field]; return next; });
  };
  const errorFor = (field) => fieldErrors[field] && <p id={`${formId}-${field}-error`} className="jdp-bid-error" role="alert">{t(fieldErrors[field], { field: t(`jobEdit.fields.${labelFor(field)}`) })}</p>;
  const describedBy = (field) => (fieldErrors[field] ? `${formId}-${field}-error` : undefined);
  const lockedNow = (field) => accepted && LOCKED_FORM_FIELDS.has(field);

  async function handleSubmit(event) {
    event.preventDefault();
    setFailure(null);
    const { patch, errors, changedFields } = buildJobPatch(job, form);
    if (Object.keys(errors).length) {
      setFieldErrors(fieldErrorKeys(errors));
      summaryRef.current?.focus();
      return;
    }
    if (!changedFields.length) {
      toast(t('jobEdit.noChanges'));
      return;
    }
    setSaving(true);
    try {
      const result = await updateJob(id, patch, { version: job.version, idempotencyKey: idempotencyKey.current });
      idempotencyKey.current = newIdempotencyKey();
      toast.success(result.bids_flagged_for_reconfirm > 0
        ? t('jobEdit.savedWithReconfirm', { count: result.bids_flagged_for_reconfirm })
        : t('jobEdit.saved'));
      navigate(`/jobs/${id}`);
    } catch (err) {
      const kind = classifyEditError(err);
      if (kind.kind === 'fields') setFieldErrors(kind.fields);
      else setFailure(kind.kind);
      // A conflict or validation failure is a final answer for this payload.
      idempotencyKey.current = newIdempotencyKey();
      summaryRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  async function reloadLatest() {
    setFailure(null);
    setFieldErrors({});
    const latest = await fetchJob(id);
    if (latest) setForm(formFromJob(latest));
  }

  const textField = (field, { type = 'text', multiline = false, max, min, required = false, autoComplete } = {}) => (
    <div className="jdp-field">
      <label htmlFor={`${formId}-${field}`}>{t(`jobEdit.fields.${labelFor(field)}`)}{required ? ' *' : ''}</label>
      {multiline
        ? <textarea id={`${formId}-${field}`} rows={5} value={form[field]} onChange={set(field)} maxLength={max} minLength={min}
            required={required} disabled={lockedNow(field) || saving} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={describedBy(field)} />
        : <input id={`${formId}-${field}`} type={type} value={form[field]} onChange={set(field)} maxLength={max} minLength={min}
            required={required} disabled={lockedNow(field) || saving} autoComplete={autoComplete}
            aria-invalid={Boolean(fieldErrors[field])} aria-describedby={describedBy(field)} />}
      {max && multiline && <span className="jdp-char-count">{form[field].length} / {max}</span>}
      {errorFor(field)}
    </div>
  );
  const selectField = (field, options, optionKey) => (
    <div className="jdp-field">
      <label htmlFor={`${formId}-${field}`}>{t(`jobEdit.fields.${labelFor(field)}`)}</label>
      <select id={`${formId}-${field}`} value={form[field]} onChange={set(field)} disabled={lockedNow(field) || saving}
        aria-invalid={Boolean(fieldErrors[field])} aria-describedby={describedBy(field)}>
        {options.map((option) => <option key={option} value={option}>{t(`jobEdit.${optionKey}.${option}`)}</option>)}
      </select>
      {errorFor(field)}
    </div>
  );

  return (
    <PageShell>
      <PageMeta title={t('jobEdit.pageTitle')} description={t('jobEdit.pageTitle')} noIndex />
      <div className="jdp-page">
        <div className="jdp-topbar"><Link className="jdp-back" to={`/jobs/${id}`}>‹ {t('jobEdit.backToJob')}</Link></div>
        <section className="jdp-card" aria-labelledby={`${formId}-heading`}>
          <h1 id={`${formId}-heading`} className="jdp-title">{t('jobEdit.pageTitle')}</h1>
          <p>{t('jobEdit.intro')}</p>
          {pendingBids && !accepted && <p className="jdp-count" role="note">{t('jobEdit.bidsWarning')}</p>}
          {accepted && <p className="jdp-count" role="note">{t('jobEdit.lockedAfterHire')}</p>}
          {draft?.material && pendingBids && !accepted && <p className="jdp-count" role="status">{t('jobEdit.materialPreview')}</p>}
          <div ref={summaryRef} tabIndex={-1} aria-live="assertive">
            {failure && <div className="jdp-bid-error" role="alert">
              <p>{t(`jobEdit.failures.${failure}`)}</p>
              {failure === 'conflict' && <button type="button" className="jdp-btn-ghost" onClick={reloadLatest} data-track="ui.72b588b129.2">{t('jobEdit.reloadLatest')}</button>}
            </div>}
            {Object.keys(fieldErrors).length > 0 && <p className="jdp-bid-error" role="alert">{t('jobEdit.fixErrors', { count: Object.keys(fieldErrors).length })}</p>}
          </div>
          <form onSubmit={handleSubmit} className="jdp-bid-form" noValidate data-track="ui.72b588b129.3">
            <fieldset disabled={saving}>
              <legend className="jdp-small-heading">{t('jobEdit.sections.basics')}</legend>
              {textField('title', { max: SCHEMA_LIMITS.titleMax, min: SCHEMA_LIMITS.titleMin, required: true })}
              {textField('description', { multiline: true, max: SCHEMA_LIMITS.descriptionMax, min: SCHEMA_LIMITS.descriptionMin, required: true })}
              {textField('category_name', { max: JOB_FIELD_RULES.category_name.max })}
            </fieldset>
            <fieldset disabled={saving}>
              <legend className="jdp-small-heading">{t('jobEdit.sections.budget')}</legend>
              {selectField('budget_type', JOB_FIELD_RULES.budget_type.options, 'budgetTypes')}
              {form.budget_type !== 'open' && <div className="jdp-bid-form-row">
                {textField('budget_min', { type: 'text' })}
                {form.budget_type === 'range' && textField('budget_max', { type: 'text' })}
              </div>}
            </fieldset>
            <fieldset disabled={saving}>
              <legend className="jdp-small-heading">{t('jobEdit.sections.timing')}</legend>
              {selectField('urgency', JOB_FIELD_RULES.urgency.options, 'urgencies')}
              <div className="jdp-bid-form-row">
                {textField('scheduled_date', { type: 'date' })}
                {textField('scheduled_time', { type: 'time' })}
              </div>
              {selectField('recurrence', JOB_FIELD_RULES.recurrence.options, 'recurrences')}
              {selectField('site_access', JOB_FIELD_RULES.site_access.options, 'siteAccessOptions')}
            </fieldset>
            <fieldset disabled={saving}>
              <legend className="jdp-small-heading">{t('jobEdit.sections.location')}</legend>
              {textField('location_address', { max: JOB_FIELD_RULES.location_address.max, autoComplete: 'street-address' })}
              <div className="jdp-bid-form-row">
                {textField('location_city', { max: JOB_FIELD_RULES.location_city.max, required: true, autoComplete: 'address-level2' })}
                {textField('location_state', { max: JOB_FIELD_RULES.location_state.max, autoComplete: 'address-level1' })}
              </div>
              <div className="jdp-bid-form-row">
                {textField('location_zip', { max: JOB_FIELD_RULES.location_zip.max, autoComplete: 'postal-code' })}
                {textField('location_country', { max: JOB_FIELD_RULES.location_country.max, required: true, autoComplete: 'country-name' })}
              </div>
            </fieldset>
            <fieldset disabled={saving}>
              <legend className="jdp-small-heading">{t('jobEdit.sections.notes')}</legend>
              {textField('notes', { multiline: true, max: SCHEMA_LIMITS.notesMax })}
              {textField('private_notes', { multiline: true, max: SCHEMA_LIMITS.notesMax })}
              <p className="jdp-count">{t('jobEdit.privateNotesHelp')}</p>
            </fieldset>
            <div className="jdp-modal-actions">
              <Link className="jdp-btn-ghost" to={`/jobs/${id}`}>{t('jobEdit.cancel')}</Link>
              <button type="submit" className="jdp-btn-primary" disabled={saving || !draft?.changedFields.length} data-track="ui.72b588b129.4">
                {saving ? t('jobEdit.saving') : t('jobEdit.save')}
              </button>
            </div>
          </form>
        </section>
      </div>
    </PageShell>
  );
}

function labelFor(field) {
  return {
    title: 'title', description: 'description', category_name: 'category', budget_type: 'budgetType',
    budget_min: 'budgetMin', budget_max: 'budgetMax', urgency: 'urgency', scheduled_date: 'scheduleDate',
    scheduled_time: 'scheduleTime', recurrence: 'recurrence', site_access: 'siteAccess', location_address: 'address',
    location_city: 'city', location_state: 'state', location_zip: 'zip', location_country: 'country',
    notes: 'notes', private_notes: 'privateNotes',
  }[field] || 'other';
}

