import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { accessAPI } from '../../api/access';

const NS = 'common';
const errorCode = (err) => err?.response?.data?.code || null;

function toFormState(fields, answers) {
  const out = {};
  for (const f of fields) {
    const v = answers?.[f.name];
    if (f.type === 'string_list') out[f.name] = Array.isArray(v) ? v.join(', ') : '';
    else if (f.type === 'service_area') out[f.name] = { country: '', region: '', city: '', postalCode: '', ...(v || {}) };
    else if (f.type === 'integer') out[f.name] = v === undefined || v === null ? '' : String(v);
    else out[f.name] = v ?? '';
  }
  return out;
}

function toAnswers(fields, state) {
  const out = {};
  for (const f of fields) {
    const v = state[f.name];
    if (f.type === 'string_list') {
      const list = String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) out[f.name] = list;
    } else if (f.type === 'service_area') {
      const area = {};
      for (const k of ['country', 'region', 'city', 'postalCode']) {
        const s = String(v?.[k] || '').trim();
        if (s) area[k] = k === 'country' ? s.toUpperCase() : s;
      }
      if (Object.keys(area).length) out[f.name] = area;
    } else if (f.type === 'integer') {
      if (String(v).trim() !== '') out[f.name] = Number.parseInt(v, 10);
    } else if (String(v || '').trim() !== '') {
      out[f.name] = String(v).trim();
    }
  }
  return out;
}

function FieldInput({ t, field, value, onChange, idPrefix }) {
  const id = `${idPrefix}-${field.name}`;
  const label = t(`progressiveAccess.fields.${field.name}`, { ns: NS, defaultValue: field.name });
  const cls = 'mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-primary';
  const required = field.required ? <span aria-hidden="true"> *</span> : null;
  if (field.type === 'service_area') {
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-content">{label}{required}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {['country', 'region', 'city', 'postalCode'].map((k) => (
            <label key={k} htmlFor={`${id}-${k}`} className="block text-xs text-muted">
              {t(`progressiveAccess.fields.area.${k}`, { ns: NS })}
              <input
                id={`${id}-${k}`}
                className={cls}
                value={value?.[k] || ''}
                maxLength={k === 'country' ? 2 : 120}
                autoComplete={k === 'country' ? 'country' : k === 'postalCode' ? 'postal-code' : k === 'city' ? 'address-level2' : 'address-level1'}
                onChange={(e) => onChange({ ...(value || {}), [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  let control;
  if (field.type === 'text') {
    control = <textarea id={id} className={cls} rows={4} maxLength={field.maxLength} value={value} onChange={(e) => onChange(e.target.value)} />;
  } else if (field.type === 'enum') {
    control = (
      <select id={id} className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('progressiveAccess.choose', { ns: NS })}</option>
        {(field.options || []).map((o) => (
          <option key={o} value={o}>{t(`progressiveAccess.options.${o}`, { ns: NS, defaultValue: o })}</option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        className={cls}
        type={field.type === 'integer' ? 'number' : field.type === 'url' ? 'url' : 'text'}
        inputMode={field.type === 'integer' ? 'numeric' : undefined}
        min={field.min}
        max={field.max}
        maxLength={field.maxLength}
        dir={field.type === 'url' ? 'ltr' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <label htmlFor={id} className="block text-sm font-medium text-content">
      {label}{required}
      {field.type === 'string_list' && <span className="block text-xs font-normal text-muted">{t('progressiveAccess.listHint', { ns: NS })}</span>}
      {control}
    </label>
  );
}

export default function RequestEditor({ t, request, policy, defaultAnswers, onChanged, onClose }) {
  const fields = useMemo(() => policy?.form?.fields || [], [policy]);
  const [state, setState] = useState(() => toFormState(fields, { ...defaultAnswers, ...request.answers }));
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  // AC-021: a reviewer decision (or any version bump) that lands while the
  // applicant is editing must not wipe unsaved answers. The form keeps its
  // state across version changes and surfaces a notice instead of failing.
  const lastSeenVersionRef = useRef(request.version);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (request.version !== lastSeenVersionRef.current) setStale(true);
  }, [request.version]);
  const keyRef = useRef({});
  const keyFor = (action) => {
    const k = `${action}:${request.version}`;
    if (!keyRef.current[k]) {
      // Same fallback as api/access.js: crypto.randomUUID() is unavailable in
      // insecure contexts, and a missing key must never block a submit.
      let key = null;
      try { key = crypto.randomUUID(); } catch { key = null; }
      keyRef.current[k] = key || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return keyRef.current[k];
  };

  const run = async (action) => {
    setBusy(true);
    setFieldErrors({});
    try {
      const answers = toAnswers(fields, state);
      const body = { expectedVersion: request.version, answers };
      const result = action === 'save'
        ? await accessAPI.updateRequest(request.id, body, keyFor('update'))
        : await accessAPI.transition(request.id, action, body, keyFor(action));
      toast.success(t(`progressiveAccess.toast.${action}`, { ns: NS }));
      lastSeenVersionRef.current = result.request?.version ?? request.version;
      onChanged(result.request);
      if (action !== 'save') onClose?.();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'request_version_conflict') {
        // Keep the typed answers; the refetch after onChanged(null) delivers
        // the newer version and the stale notice explains what to do.
        toast.error(t('progressiveAccess.errors.versionConflict', { ns: NS }));
        setStale(true);
        onChanged(null);
      } else if (code === 'validation_failed') {
        setFieldErrors(err.response.data.fields || {});
        toast.error(t('progressiveAccess.errors.validation', { ns: NS }));
      } else {
        toast.error(t('progressiveAccess.errors.generic', { ns: NS }));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitAction = request.status === 'needs_information' ? 'resubmit' : 'submit';
  return (
    <section aria-labelledby={`req-${request.id}-title`} className="mt-3 space-y-4 rounded-xl border border-border p-4">
      <h3 id={`req-${request.id}-title`} className="text-sm font-semibold text-content">
        {t('progressiveAccess.editTitle', { ns: NS, capability: t(`progressiveAccess.capabilities.${request.capability}`, { ns: NS, defaultValue: request.capability }) })}
      </h3>
      {request.informationRequest && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-content" role="note">
          <span className="font-medium">{t('progressiveAccess.reviewerAsked', { ns: NS })}</span> {request.informationRequest}
        </p>
      )}
      {stale && (
        <div role="status" className="rounded-lg bg-amber-500/10 p-3 text-sm text-content">
          <p>{t('progressiveAccess.staleNotice', { ns: NS })}</p>
          <button
            type="button"
            onClick={() => { lastSeenVersionRef.current = request.version; setStale(false); }}
            className="mt-1 text-xs font-medium text-primary hover:underline"
            data-track="ui.access.applications.stale_ack"
          >
            {t('progressiveAccess.staleDismiss', { ns: NS })}
          </button>
        </div>
      )}
      {fields.map((f) => (
        <div key={f.name}>
          <FieldInput
            t={t}
            field={f}
            idPrefix={`req-${request.id}`}
            value={state[f.name]}
            onChange={(v) => setState((s) => ({ ...s, [f.name]: v }))}
          />
          {fieldErrors[f.name] && (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }} role="alert">
              {t(`progressiveAccess.fieldErrors.${fieldErrors[f.name]}`, { ns: NS, defaultValue: t('progressiveAccess.fieldErrors.invalid', { ns: NS }) })}
            </p>
          )}
        </div>
      ))}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" disabled={busy} onClick={() => run('save')} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-content hover:bg-surface-2 disabled:opacity-50" data-track="ui.access.applications.save">
          {t('progressiveAccess.actions.save', { ns: NS })}
        </button>
        <button type="button" disabled={busy} onClick={() => run(submitAction)} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-solid hover:opacity-90 disabled:opacity-50" data-track="ui.access.applications.submit">
          {t(`progressiveAccess.actions.${submitAction}`, { ns: NS })}
        </button>
        {onClose && <button type="button" disabled={busy} onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted hover:text-content" data-track="ui.access.applications.close">
          {t('progressiveAccess.actions.close', { ns: NS })}
        </button>}
      </div>
    </section>
  );
}
