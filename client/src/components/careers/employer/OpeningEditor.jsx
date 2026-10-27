import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import CountrySelect from '../../CountrySelect';
import { checkCareerOpening, createCareerOpening, getEmployerOpening, updateCareerOpening } from '../../../api/careers';
import {
  DEPARTMENTS, EMPLOYMENT_TYPES, EOR_PATH_STAGES, PATH_STAGES, PAY_PERIODS, TEAM_ROLES, WORKPLACE_TYPES,
  fieldErrorsFrom, formToOpeningPayload, openingToForm, validateOpeningForm,
} from '../../../features/careers/careersModel';
import { Check, ErrorNotice, Field, Loading, Notice } from '../ui';

const STATUS_NEXT = { draft: ['open', 'closed'], open: ['paused', 'closed', 'filled'], paused: ['open', 'closed', 'filled'], closed: [], filled: [] };

function ComplianceBox({ result }) {
  const { t } = useTranslation();
  if (!result) return null;
  const { blocking = [], warnings = [] } = result;
  return (
    <div className="ox-careers-section">
      {blocking.length ? (
        <Notice tone="error">
          <strong>{t('careers.compliance.blocking')}</strong>
          <ul>{blocking.map((b, i) => <li key={`${b.code}-${i}`}>{t(`careers.compliance.codes.${b.code}`)}</li>)}</ul>
        </Notice>
      ) : <Notice tone="success">{t('careers.compliance.ok')}</Notice>}
      {warnings.length ? (
        <Notice tone="warn">
          <strong>{t('careers.compliance.warnings')}</strong>
          <ul>{warnings.map((w, i) => <li key={`${w.code}-${i}`}>{t(`careers.compliance.codes.${w.code}`)}{w.match ? ` (“${w.match}”)` : ''}</li>)}</ul>
        </Notice>
      ) : null}
      {result.payTransparencyLaw ? <p className="ox-careers-subtle">{t('careers.compliance.payLaw', { rule: result.rule?.legal_ref || result.jurisdiction || '' })}</p> : null}
    </div>
  );
}

export default function OpeningEditor({ ctx, openingId, locations = [], onSaved, onCancel }) {
  const { t } = useTranslation();
  const platform = ctx.employerType === 'platform';
  const [form, setForm] = useState(() => openingToForm(null));
  const [loading, setLoading] = useState(Boolean(openingId));
  const [errors, setErrors] = useState({});
  const [compliance, setCompliance] = useState(null);
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [currentStatus, setCurrentStatus] = useState('draft');

  useEffect(() => {
    let active = true;
    if (!openingId) {
      setForm({ ...openingToForm(null), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
      setCompliance(null);
      setCurrentStatus('draft');
      return undefined;
    }
    setLoading(true);
    getEmployerOpening(openingId)
      .then((r) => { if (!active) return; setForm(openingToForm(r.opening)); setCompliance(r.compliance); setCurrentStatus(r.opening.status); })
      .catch((err) => active && setFailure(err))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [openingId]);

  if (loading) return <Loading />;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const localError = (k) => (['required', 'payRequired', 'maxBelowMin'].includes(errors[k]) ? t(`careers.employer.formErrors.${errors[k]}`) : errors[k] || null);
  const statuses = openingId ? [currentStatus, ...(STATUS_NEXT[currentStatus] || [])] : ['draft', 'open'];

  const runCheck = async () => {
    setFailure(null);
    try {
      const r = await checkCareerOpening(ctx, formToOpeningPayload(form, ctx), openingId);
      setCompliance(r.compliance);
      setErrors(r.field_errors || {});
    } catch (err) { setFailure(err); }
  };

  const save = async (e) => {
    e.preventDefault();
    setFailure(null);
    const local = validateOpeningForm(form);
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      const payload = formToOpeningPayload(form, ctx);
      const r = openingId ? await updateCareerOpening(openingId, payload) : await createCareerOpening(ctx, payload);
      setCompliance(r.compliance || null);
      setSuggestions(r.requirement_suggestions || null);
      toast.success(t('careers.employer.saved'));
      onSaved?.(r.opening);
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      const blocked = err?.response?.data?.code === 'compliance_blocked' ? String(err.response.data.fields?.compliance || '') : '';
      if (blocked) setCompliance({ blocking: blocked.split(',').filter(Boolean).map((code) => ({ code })), warnings: [] });
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ox-careers-panel" onSubmit={save} noValidate data-track="ui.9591bfe1ea.1">
      <h2>{openingId ? t('careers.employer.editOpening') : t('careers.employer.newOpening')}</h2>
      <div className="ox-careers-form-grid">
        <Field label={t('careers.fields.title')} htmlFor="o-title" error={localError('title')}>
          <input id="o-title" maxLength={160} value={form.title} onChange={(e) => set('title')(e.target.value)} />
        </Field>
        <Field label={t('careers.fields.department')} htmlFor="o-dept">
          <select id="o-dept" value={form.department} onChange={(e) => set('department')(e.target.value)}>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`careers.department.${d}`)}</option>)}
          </select>
        </Field>
        <Field label={t('careers.fields.pathStage')} htmlFor="o-path">
          <select id="o-path" value={form.path_stage} onChange={(e) => set('path_stage')(e.target.value)}>
            {PATH_STAGES.map((p) => <option key={p} value={p}>{t(`careers.path.${p}`)}</option>)}
          </select>
        </Field>
        <Field label={t('careers.fields.employment')} htmlFor="o-employment">
          <select id="o-employment" value={form.employment_type} onChange={(e) => set('employment_type')(e.target.value)}>
            {EMPLOYMENT_TYPES.map((p) => <option key={p} value={p}>{t(`careers.employment.${p}`)}</option>)}
          </select>
        </Field>
        <Field label={t('careers.fields.workplace')} htmlFor="o-workplace">
          <select id="o-workplace" value={form.workplace_type} onChange={(e) => set('workplace_type')(e.target.value)}>
            {WORKPLACE_TYPES.map((w) => <option key={w} value={w}>{t(`careers.workplace.${w}`)}</option>)}
          </select>
        </Field>
        <Field label={t('careers.fields.country')} htmlFor="o-country" error={localError('country_code')}>
          <CountrySelect id="o-country" value={form.country_code} onChange={set('country_code')} />
        </Field>
        <Field label={t('careers.fields.region')} htmlFor="o-region" error={errors.region}>
          <input id="o-region" value={form.region} onChange={(e) => set('region')(e.target.value)} />
        </Field>
        <Field label={t('careers.fields.city')} htmlFor="o-city" error={errors.city}>
          <input id="o-city" value={form.city} onChange={(e) => set('city')(e.target.value)} />
        </Field>
        <Field label={t('careers.profile.postal')} htmlFor="o-postal" error={errors.postal_code}>
          <input id="o-postal" value={form.postal_code} onChange={(e) => set('postal_code')(e.target.value)} />
        </Field>
        <Field label={t('careers.fields.timezone')} htmlFor="o-tz" error={errors.timezone}>
          <input id="o-tz" value={form.timezone} onChange={(e) => set('timezone')(e.target.value)} placeholder="America/New_York" />
        </Field>
      </div>

      <fieldset className="ox-careers-section">
        <legend>{t('careers.employer.payTitle')}</legend>
        <p className="ox-careers-subtle">{t('careers.employer.payRequired')}</p>
        <div className="ox-careers-form-grid">
          <Field label={t('careers.fields.currency')} htmlFor="o-cur" error={errors.currency_code}>
            <input id="o-cur" maxLength={3} value={form.currency_code} onChange={(e) => set('currency_code')(e.target.value.toUpperCase())} />
          </Field>
          <Field label={t('careers.fields.payMin')} htmlFor="o-min" error={localError('compensation_min')}>
            <input id="o-min" type="number" min={0} step="0.01" value={form.compensation_min} onChange={(e) => set('compensation_min')(e.target.value)} />
          </Field>
          <Field label={t('careers.fields.payMax')} htmlFor="o-max" error={localError('compensation_max')}>
            <input id="o-max" type="number" min={0} step="0.01" value={form.compensation_max} onChange={(e) => set('compensation_max')(e.target.value)} />
          </Field>
          <Field label={t('careers.fields.payPeriod')} htmlFor="o-period">
            <select id="o-period" value={form.compensation_period} onChange={(e) => set('compensation_period')(e.target.value)}>
              {PAY_PERIODS.map((p) => <option key={p} value={p}>{t(`careers.period.${p}`)}</option>)}
            </select>
          </Field>
          <Field label={t('careers.fields.closeDate')} htmlFor="o-close" error={errors.applications_close_at}>
            <input id="o-close" type="date" value={form.applications_close_at} onChange={(e) => set('applications_close_at')(e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <Field label={t('careers.fields.description')} htmlFor="o-desc" error={errors.description}>
        <textarea id="o-desc" rows={6} value={form.description} onChange={(e) => set('description')(e.target.value)} />
      </Field>
      <Field label={t('careers.fields.requirements')} htmlFor="o-req" error={errors.requirements}>
        <textarea id="o-req" rows={4} value={form.requirements} onChange={(e) => set('requirements')(e.target.value)} />
      </Field>
      <div className="ox-careers-form-grid">
        <Field label={t('careers.fields.benefits')} htmlFor="o-benefits" error={errors.benefits_summary}>
          <textarea id="o-benefits" rows={3} value={form.benefits_summary} onChange={(e) => set('benefits_summary')(e.target.value)} />
        </Field>
        <Field label={t('careers.fields.schedule')} htmlFor="o-schedule" error={errors.schedule_summary}>
          <textarea id="o-schedule" rows={3} value={form.schedule_summary} onChange={(e) => set('schedule_summary')(e.target.value)} />
        </Field>
      </div>
      <div className="ox-careers-form-grid">
        <Field label={t('careers.employer.requiredCredentials')} htmlFor="o-reqcred" hint={t('careers.profile.commaHint')}>
          <input id="o-reqcred" value={form.required_credentials} onChange={(e) => set('required_credentials')(e.target.value)} />
        </Field>
        <Field label={t('careers.employer.preferredCredentials')} htmlFor="o-prefcred" hint={t('careers.profile.commaHint')}>
          <input id="o-prefcred" value={form.preferred_credentials} onChange={(e) => set('preferred_credentials')(e.target.value)} />
        </Field>
        <Field label={t('careers.employer.requiredLanguages')} htmlFor="o-langs" hint={t('careers.profile.commaHint')}>
          <input id="o-langs" value={form.required_languages} onChange={(e) => set('required_languages')(e.target.value)} />
        </Field>
        <Field label={t('careers.fields.authorization')} htmlFor="o-auth">
          <select id="o-auth" value={form.work_authorization} onChange={(e) => set('work_authorization')(e.target.value)}>
            {['local_authorized', 'visa_sponsorship'].map((a) => <option key={a} value={a}>{t(`careers.authorization.${a}`)}</option>)}
          </select>
        </Field>
      </div>
      {suggestions?.length ? <Notice>{t('careers.employer.requirementSuggestions', { list: suggestions.map((s) => (typeof s === 'string' ? s : s.code)).join(', ') })}</Notice> : null}

      {!platform ? (
        <fieldset className="ox-careers-section">
          <legend>{t('careers.employer.storesTitle')}</legend>
          {locations.length ? locations.map((l) => (
            <Check key={l.id} id={`o-loc-${l.id}`} label={[l.name, l.city].filter(Boolean).join(' · ')} checked={form.location_ids.includes(Number(l.id))} onChange={(on) => set('location_ids')(on ? [...form.location_ids, Number(l.id)] : form.location_ids.filter((x) => x !== Number(l.id)))} />
          )) : <p className="ox-careers-subtle">{t('careers.employer.noStores')}</p>}
          {errors.location_ids ? <p className="ox-careers-error">{errors.location_ids}</p> : null}
          <div className="ox-careers-form-grid">
            <Field label={t('careers.fields.teamRole')} htmlFor="o-role" error={errors.team_role}>
              <select id="o-role" value={form.team_role} onChange={(e) => set('team_role')(e.target.value)}>
                {TEAM_ROLES.map((r) => <option key={r} value={r}>{t(`careers.teamRole.${r}`)}</option>)}
              </select>
            </Field>
            <Field label={t('careers.employer.employerModel')} htmlFor="o-model" hint={t('careers.employer.eorHint')} error={errors.employer_model}>
              <select id="o-model" value={EOR_PATH_STAGES.includes(form.path_stage) ? form.employer_model : 'direct'} disabled={!EOR_PATH_STAGES.includes(form.path_stage)} onChange={(e) => set('employer_model')(e.target.value)}>
                <option value="direct">{t('careers.employer.model.direct')}</option>
                <option value="oxsteed_eor">{t('careers.employer.model.oxsteed_eor')}</option>
              </select>
            </Field>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="ox-careers-section">
        <legend>{t('careers.employer.optionsTitle')}</legend>
        <Check id="o-guest" label={t('careers.employer.allowGuest')} checked={form.allow_guest_applications} onChange={set('allow_guest_applications')} />
        <Check id="o-hide" label={t('careers.employer.hideIdentity')} checked={form.hide_identity_until_offer} onChange={set('hide_identity_until_offer')} />
        <Check id="o-internal" label={t('careers.employer.internal')} checked={form.is_internal} onChange={set('is_internal')} />
        <Check id="o-ai" label={t('careers.employer.aiRanking')} checked={form.ai_ranking_enabled} onChange={set('ai_ranking_enabled')} />
        <p className="ox-careers-hint">{t('careers.employer.aiRankingHint')}</p>
        <Check id="o-check" label={t('careers.employer.backgroundCheck')} checked={form.background_check_required} onChange={set('background_check_required')} />
        {form.background_check_required ? (
          <div className="ox-careers-form-grid">
            <Field label={t('careers.employer.checkPackage')} htmlFor="o-pkg" error={errors.background_check_package}>
              <input id="o-pkg" value={form.background_check_package} onChange={(e) => set('background_check_package')(e.target.value)} />
            </Field>
            <Field label={t('careers.employer.checkReason')} htmlFor="o-pkgreason" error={localError('background_check_reason')}>
              <input id="o-pkgreason" value={form.background_check_reason} onChange={(e) => set('background_check_reason')(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <div className="ox-careers-form-grid">
          <Field label={t('careers.employer.minAge')} htmlFor="o-minage" hint={t('careers.employer.minAgeHint')} error={errors.min_age}>
            <input id="o-minage" type="number" min={18} max={25} value={form.min_age} onChange={(e) => set('min_age')(Number(e.target.value))} />
          </Field>
          {Number(form.min_age) > 18 ? (
            <Field label={t('careers.employer.minAgeReason')} htmlFor="o-minagereason" error={errors.min_age_reason}>
              <input id="o-minagereason" value={form.min_age_reason} onChange={(e) => set('min_age_reason')(e.target.value)} />
            </Field>
          ) : null}
          <Field label={t('careers.fields.status')} htmlFor="o-status" error={errors.status}>
            <select id="o-status" value={form.status} onChange={(e) => set('status')(e.target.value)}>
              {statuses.map((s) => <option key={s} value={s}>{t(`careers.openingStatus.${s}`)}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>

      <ComplianceBox result={compliance} />
      <ErrorNotice error={failure} />
      <div className="ox-careers-actions">
        <button type="button" className="ox-careers-btn" onClick={runCheck} data-track="ui.9591bfe1ea.2">{t('careers.employer.checkCompliance')}</button>
        <button type="submit" className="ox-careers-btn primary" disabled={saving} data-track="ui.9591bfe1ea.3">{saving ? t('careers.common.saving') : t('careers.employer.saveOpening')}</button>
        {onCancel ? <button type="button" className="ox-careers-btn" onClick={onCancel} data-track="ui.9591bfe1ea.4">{t('careers.common.cancel')}</button> : null}
      </div>
    </form>
  );
}
