import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createCareerBoost, createHiringEvent, createInterviewSlots, listPaidCareerFeatures } from '../../../api/careers';
import { formatDate, formatMoney, idempotencyKey, zonedToIso } from '../../../features/careers/careersModel';
import { ActionButton, Check, Empty, ErrorNotice, Field, Loading, LoadError, Notice, useLoad } from '../ui';

const PLANS = ['boost_7d', 'boost_30d'];

function SlotsForm({ ctx, event, locations, onDone }) {
  const { t } = useTranslation();
  const tz = locations[0]?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [f, setF] = useState({ starts_at: '', duration_minutes: 15, capacity: 1, count: 4, location_id: (event.location_ids || [])[0] || '' });
  const [error, setError] = useState(null);
  return (
    <div className="ox-careers-app">
      <div className="ox-careers-form-grid">
        <Field label={t('careers.paid.firstSlot')} htmlFor={`sl-start-${event.id}`}>
          <input id={`sl-start-${event.id}`} type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
        </Field>
        <Field label={t('careers.interview.duration')} htmlFor={`sl-dur-${event.id}`}>
          <input id={`sl-dur-${event.id}`} type="number" min={5} max={120} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })} />
        </Field>
        <Field label={t('careers.paid.slotCount')} htmlFor={`sl-count-${event.id}`}>
          <input id={`sl-count-${event.id}`} type="number" min={1} max={48} value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} />
        </Field>
        <Field label={t('careers.paid.capacity')} htmlFor={`sl-cap-${event.id}`}>
          <input id={`sl-cap-${event.id}`} type="number" min={1} max={20} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} />
        </Field>
      </div>
      <ErrorNotice error={error} />
      <ActionButton
        primary
        disabled={!f.starts_at}
        onClick={async () => {
          setError(null);
          const first = new Date(zonedToIso(f.starts_at, tz)).getTime();
          const slots = Array.from({ length: f.count }, (_, i) => ({
            starts_at: new Date(first + i * f.duration_minutes * 60_000).toISOString(), duration_minutes: f.duration_minutes,
            capacity: f.capacity, timezone: tz, location_id: f.location_id ? Number(f.location_id) : null,
          }));
          try { await createInterviewSlots(ctx.businessId, event.id, slots); onDone(); } catch (err) { setError(err); }
        }}
      >
        {t('careers.paid.addSlots')}
      </ActionButton>
    </div>
  );
}

export default function PaidPanel({ ctx, openings, locations, billing }) {
  const { t, i18n } = useTranslation();
  const paid = useLoad(() => listPaidCareerFeatures(ctx.businessId), [ctx.businessId]);
  const [boost, setBoost] = useState({ opening_id: '', plan: 'boost_7d' });
  const [boostKey, setBoostKey] = useState(() => idempotencyKey('boost'));
  const [ev, setEv] = useState({ name: '', starts_at: '', ends_at: '', location_ids: [], opening_ids: [] });
  const [error, setError] = useState(null);
  const [slotsFor, setSlotsFor] = useState(null);
  const open = openings.filter((o) => o.status === 'open');
  const checkout = (url) => { if (url) window.location.assign(url); };

  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.paid.rankingNote')}</Notice>
      {!billing?.enabled || billing?.configured === false ? <Notice tone="warn">{t('careers.paid.billingOff')}</Notice> : null}
      <ErrorNotice error={error} />
      <section className="ox-careers-panel">
        <h2>{t('careers.paid.boostTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.paid.boostIntro')}</p>
        <div className="ox-careers-form-grid">
          <Field label={t('careers.talent.opening')} htmlFor="boost-op">
            <select id="boost-op" value={boost.opening_id} onChange={(e) => setBoost({ ...boost, opening_id: e.target.value })}>
              <option value="">{t('careers.common.choose')}</option>
              {open.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </Field>
          <Field label={t('careers.paid.plan')} htmlFor="boost-plan">
            <select id="boost-plan" value={boost.plan} onChange={(e) => setBoost({ ...boost, plan: e.target.value })}>
              {PLANS.map((p) => <option key={p} value={p}>{t(`careers.paid.plans.${p}`)}</option>)}
            </select>
          </Field>
        </div>
        <ActionButton
          primary
          disabled={!boost.opening_id}
          onClick={async () => {
            setError(null);
            try {
              const r = await createCareerBoost(ctx.businessId, { opening_id: Number(boost.opening_id), plan: boost.plan }, boostKey);
              setBoostKey(idempotencyKey('boost'));
              paid.reload();
              checkout(r.checkout_url);
            } catch (err) { setError(err); }
          }}
        >
          {t('careers.paid.buyBoost')}
        </ActionButton>
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.paid.eventTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.paid.eventIntro')}</p>
        <div className="ox-careers-form-grid">
          <Field label={t('careers.paid.eventName')} htmlFor="ev-name">
            <input id="ev-name" value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} />
          </Field>
          <Field label={t('careers.paid.starts')} htmlFor="ev-start">
            <input id="ev-start" type="date" value={ev.starts_at} onChange={(e) => setEv({ ...ev, starts_at: e.target.value })} />
          </Field>
          <Field label={t('careers.paid.ends')} htmlFor="ev-end">
            <input id="ev-end" type="date" value={ev.ends_at} onChange={(e) => setEv({ ...ev, ends_at: e.target.value })} />
          </Field>
        </div>
        <fieldset className="ox-careers-section">
          <legend>{t('careers.employer.storesTitle')}</legend>
          {locations.map((l) => (
            <Check key={l.id} id={`ev-loc-${l.id}`} label={l.name} checked={ev.location_ids.includes(Number(l.id))} onChange={(on) => setEv({ ...ev, location_ids: on ? [...ev.location_ids, Number(l.id)] : ev.location_ids.filter((x) => x !== Number(l.id)) })} />
          ))}
        </fieldset>
        <fieldset className="ox-careers-section">
          <legend>{t('careers.paid.openings')}</legend>
          {open.map((o) => (
            <Check key={o.id} id={`ev-op-${o.id}`} label={o.title} checked={ev.opening_ids.includes(Number(o.id))} onChange={(on) => setEv({ ...ev, opening_ids: on ? [...ev.opening_ids, Number(o.id)] : ev.opening_ids.filter((x) => x !== Number(o.id)) })} />
          ))}
        </fieldset>
        <ActionButton
          primary
          disabled={!ev.name || !ev.starts_at || !ev.ends_at || !ev.opening_ids.length}
          onClick={async () => {
            setError(null);
            try {
              const r = await createHiringEvent(ctx.businessId, { ...ev, starts_at: `${ev.starts_at}T00:00:00Z`, ends_at: `${ev.ends_at}T23:59:59Z` });
              paid.reload();
              checkout(r.checkout_url);
            } catch (err) { setError(err); }
          }}
        >
          {t('careers.paid.buyEvent')}
        </ActionButton>
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.paid.historyTitle')}</h2>
        {paid.loading && !paid.data ? <Loading /> : null}
        <LoadError error={paid.error} onRetry={paid.reload} />
        {paid.data && !paid.data.boosts?.length && !paid.data.hiring_events?.length ? <Empty>{t('careers.paid.none')}</Empty> : null}
        {(paid.data?.boosts || []).map((b) => (
          <div key={`b${b.id}`} className="ox-careers-row ox-careers-app">
            <span>{t(`careers.paid.plans.${b.plan}`)} · {openings.find((o) => Number(o.id) === Number(b.opening_id))?.title || `#${b.opening_id}`}</span>
            <span className="ox-careers-subtle">{b.price_cents != null ? formatMoney(b.price_cents / 100, (b.currency || 'usd').toUpperCase(), i18n.language) : ''} {b.ends_at ? `→ ${formatDate(b.ends_at, i18n.language)}` : ''}</span>
            <span className="ox-careers-chip">{t(`careers.paid.status.${b.status}`)}</span>
          </div>
        ))}
        {(paid.data?.hiring_events || []).map((e) => (
          <div key={`e${e.id}`} className="ox-careers-app">
            <div className="ox-careers-row">
              <span>{e.name} · {formatDate(e.starts_at, i18n.language)} – {formatDate(e.ends_at, i18n.language)}</span>
              <span className="ox-careers-chip">{t(`careers.paid.status.${e.status}`)}</span>
            </div>
            {e.status === 'active' ? (
              slotsFor === e.id ? <SlotsForm ctx={ctx} event={e} locations={locations} onDone={() => { setSlotsFor(null); paid.reload(); }} /> : (
                <button type="button" className="ox-careers-btn" onClick={() => setSlotsFor(e.id)} data-track="ui.f8facc4ebe.1">{t('careers.paid.addSlots')}</button>
              )
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}
