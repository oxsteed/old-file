import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getBusinessOnboarding, saveBusinessOnboarding, completeBusinessOnboarding, updateBusiness } from '../../api/businesses';
import { useDirtyForm } from '../attention/useDirtyForm';
import './BusinessOnboarding.css';

const fields = ['business_name', 'address_city', 'description'];
const profileChecks = new Set(['name', 'category', 'location', 'description']);

export default function BusinessOnboarding({ businessId, onAttentionAction }) {
  const { t, i18n } = useTranslation('attention');
  const text = (key, opts) => t(`onboarding.${key}`, opts);
  const { user } = useAuth();
  const { setDirty, clearDirty } = useDirtyForm();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const generation = useRef(0);
  const dirty = data && fields.some(key => form[key] !== (data.business[key] || ''));

  const load = useCallback(async () => {
    const version = ++generation.current;
    setState('loading'); setData(null); setNotice(null); setBusy(false);
    try {
      const result = await getBusinessOnboarding(businessId);
      if (!result?.business || !Array.isArray(result.checks)) throw new Error('Invalid setup response');
      if (version !== generation.current) return;
      setData(result);
      setForm(Object.fromEntries(fields.map(key => [key, result.business[key] || ''])));
      setState('ready'); clearDirty();
    } catch (error) {
      if (version !== generation.current) return;
      setState([403, 404].includes(error?.response?.status) ? 'unavailable' : 'error');
    }
  }, [businessId, user?.id, clearDirty]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);
  useEffect(() => { setDirty(Boolean(dirty)); return () => setDirty(false); }, [dirty, setDirty]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function act(publish = false) {
    if (busy || !data) return;
    const version = generation.current;
    setBusy(true); setNotice(null);
    try {
      if (publish) {
        await completeBusinessOnboarding(businessId);
      } else {
        await updateBusiness(businessId, form);
        if (version !== generation.current) return;
        const fresh = await getBusinessOnboarding(businessId);
        if (version !== generation.current) return;
        await saveBusinessOnboarding(businessId, {
          currentStep: fresh.readyToPublish && fresh.business.setup_status === 'active' ? 'complete'
            : fresh.checks.find(check => !check.complete)?.id || 'publish',
          completedSteps: fresh.checks.filter(check => check.complete).map(check => check.id),
        });
      }
      if (version !== generation.current) return;
      await load();
      if (version + 1 !== generation.current) return;
      setNotice(publish ? 'published' : 'saved');
      onAttentionAction?.();
    } catch (error) {
      if (version !== generation.current) return;
      if ([403, 404].includes(error?.response?.status)) {
        setData(null); setState('unavailable'); clearDirty();
      } else {
        setNotice(publish && error?.response?.status === 409 ? 'incomplete' : 'saveError');
      }
    } finally {
      if (version === generation.current || version + 1 === generation.current) setBusy(false);
    }
  }

  if (state !== 'ready') return <section className="business-onboarding" dir={i18n.dir()}>
    <p role={state === 'loading' ? 'status' : 'alert'}>{text(state)}</p>
    {state !== 'unavailable' && state !== 'loading' && <button type="button" onClick={load} data-track="ui.bbda5d079e.1">{t('list.retry')}</button>}
  </section>;

  const business = data.business;
  const base = `/business/${encodeURIComponent(businessId)}/workspace`;
  const restaurant = business.business_kind === 'restaurant';
  const restaurantRoute = `/restaurants/merchant?business=${encodeURIComponent(businessId)}`;
  const published = data.readyToPublish && business.setup_status === 'active' && business.is_active !== false && business.is_listed !== false;
  const nextRoute = check => profileChecks.has(check.id) ? `${base}/profile`
    : restaurant ? `${restaurantRoute}&tab=${check.id === 'menu' ? 'menu' : 'store'}` : `${base}/services`;
  const navigateSafely = event => {
    if (busy || (dirty && !window.confirm(t('actions.confirmDiscard')))) event.preventDefault();
    else clearDirty();
  };

  return <section className="business-onboarding" dir={i18n.dir()} aria-labelledby="business-onboarding-title">
    <header><h1 id="business-onboarding-title">{text('title', { name: business.business_name })}</h1>
      <p>{text('intro')}</p>
      <p role="status">{text(published ? 'live' : data.readyToPublish ? 'ready' : 'remaining', {
        count: data.checks.filter(check => !check.complete).length,
      })}</p>
      {data.progress?.updated_at && <p>{text('lastSaved', { date: new Date(data.progress.updated_at).toLocaleString(i18n.language) })}</p>}
    </header>
    <ul className="business-onboarding-checks">{data.checks.map(check => <li key={check.id}>
      <div><strong>{text(`checks.${check.id}`)}</strong><span>{text(check.complete ? 'done' : 'todo')}</span></div>
      {!check.complete && <Link to={nextRoute(check)} onClick={navigateSafely}>{text('manage')}</Link>}
    </li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); act(); }} data-track="ui.bbda5d079e.2">
      <h2>{text('details')}</h2>
      {fields.map(key => <label key={key} htmlFor={`setup-${businessId}-${key}`}>
        {text(`fields.${key}`)}
        {key === 'description' ? <textarea id={`setup-${businessId}-${key}`} value={form[key]} disabled={busy} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} />
          : <input id={`setup-${businessId}-${key}`} required maxLength={key === 'business_name' ? 200 : 100} value={form[key]} disabled={busy} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} />}
      </label>)}
      <button type="submit" disabled={busy || !dirty} data-track="ui.bbda5d079e.3">{text(busy ? 'saving' : 'save')}</button>
    </form>
    <div className="business-onboarding-actions">
      <button type="button" onClick={load} disabled={busy || dirty} data-track="ui.bbda5d079e.4">{text('refresh')}</button>
      {!published && data.permissions?.canPublish && <button type="button" onClick={() => act(true)} disabled={busy || dirty || !data.readyToPublish} data-track="ui.bbda5d079e.5">{text('publish')}</button>}
      {!published && !data.permissions?.canPublish && <p>{text('ownerOnly')}</p>}
      <Link to={base} onClick={navigateSafely}>{text('workspace')}</Link>
    </div>
    {notice && <p role={['saveError', 'incomplete'].includes(notice) ? 'alert' : 'status'}>{text(notice)}</p>}
  </section>;
}
