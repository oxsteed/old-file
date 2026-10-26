import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// Shared building blocks for the Careers screens.

/** Localized error text: known server codes first, then the server message. */
export function useCareerErrors() {
  const { t, i18n } = useTranslation();
  return useCallback((err, fallbackKey = 'careers.errors.generic') => {
    const code = err?.response?.data?.code;
    if (code && i18n.exists(`careers.errors.${code}`)) return t(`careers.errors.${code}`);
    return err?.response?.data?.error || t(fallbackKey);
  }, [t, i18n]);
}

/** Load data on mount / when deps change; returns { data, loading, error, reload }. */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (mine === seq.current) setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, loading: false, error }));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function Tabs({ tabs, active, onChange, label }) {
  return (
    <div className="ox-careers-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`ox-careers-tab${active === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)} data-track="ui.effb090bb8.1"
         
        >
          {tab.label}
          {tab.badge ? <span className="ox-careers-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div className="ox-careers-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="ox-careers-hint">{hint}</p> : null}
      {error ? <p className="ox-careers-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function Check({ label, checked, onChange, id, disabled }) {
  return (
    <label className="ox-careers-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-track="ui.effb090bb8.2" />
      <span>{label}</span>
    </label>
  );
}

/** Yes/No radio pair for lawful application questions. */
export function YesNo({ name, label, value, onChange, error }) {
  const { t } = useTranslation();
  return (
    <fieldset className="ox-careers-yesno">
      <legend>{label}</legend>
      <label className="ox-careers-check">
        <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} data-track="ui.effb090bb8.3" />
        <span>{t('careers.common.yes')}</span>
      </label>
      <label className="ox-careers-check">
        <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} data-track="ui.effb090bb8.4" />
        <span>{t('careers.common.no')}</span>
      </label>
      {error ? <p className="ox-careers-error" role="alert">{error}</p> : null}
    </fieldset>
  );
}

export function Notice({ tone = 'info', children }) {
  return <div className={`ox-careers-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="ox-careers-lead" aria-live="polite">{t('careers.common.loading')}</p>;
}

export function LoadError({ error, onRetry }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  if (!error) return null;
  return (
    <Notice tone="error">
      {errorText(error)}{' '}
      {onRetry ? <button type="button" className="ox-careers-btn" onClick={onRetry} data-track="ui.effb090bb8.5">{t('careers.common.retry')}</button> : null}
    </Notice>
  );
}

export function Empty({ children }) {
  return <p className="ox-careers-empty">{children}</p>;
}

/** Button that runs an async action once at a time. */
export function ActionButton({ onClick, children, primary, danger, disabled, confirm }) {
  const [busy, setBusy] = useState(false);
  const errorText = useCareerErrors();
  return (
    <button
      type="button"
      className={`ox-careers-btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}`}
      disabled={disabled || busy}
     
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try { await onClick(); } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
      }} data-track="ui.effb090bb8.6"
    >
      {children}
    </button>
  );
}

export function StageChip({ stage }) {
  const { t } = useTranslation();
  return <span className={`ox-careers-chip stage-${stage}`}>{t(`careers.stage.${stage}`)}</span>;
}

export function Select({ id, value, onChange, options, disabled }) {
  return (
    <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const ERROR_LINKS = {
  identity_verification_required: { to: '/verify-identity', key: 'careers.errors.verifyLink' },
  age_verification_required: { to: '/settings/privacy', key: 'careers.errors.ageLink' },
  account_required: { to: '/join', key: 'careers.errors.joinLink' },
};

/** An error message with the next step when the server names one. */
export function ErrorNotice({ error, fallbackKey }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  if (!error) return null;
  const link = ERROR_LINKS[error?.response?.data?.code];
  return (
    <Notice tone="error">
      {errorText(error, fallbackKey)}
      {link ? <>{' '}<Link to={link.to}>{t(link.key)}</Link></> : null}
    </Notice>
  );
}
