import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { getCareerSettings, grantHiringScope, listHiringScopes, revokeHiringScope, updateCareerSettings } from '../../../api/careers';
import { ActionButton, Check, ErrorNotice, Field, Loading, LoadError, Notice, useLoad } from '../ui';

function ProviderLine({ name, status }) {
  const { t } = useTranslation();
  const state = !status?.enabled ? 'off' : status?.configured === false ? 'unconfigured' : 'on';
  return (
    <li>
      <span>{t(`careers.settings.providers.${name}`)}</span>
      <span className={`ox-careers-chip ${state === 'on' ? 'ok' : 'warn'}`}>{t(`careers.settings.providerState.${state}`)}</span>
    </li>
  );
}

function Scopes({ ctx }) {
  const { t } = useTranslation();
  const scopes = useLoad(() => listHiringScopes(ctx.businessId), [ctx.businessId]);
  const [f, setF] = useState({ membership_id: '', scope_level: 'brand', region_id: '' });
  const [error, setError] = useState(null);
  if (scopes.loading && !scopes.data) return <Loading />;
  if (scopes.error) return <LoadError error={scopes.error} onRetry={scopes.reload} />;
  const d = scopes.data || {};
  return (
    <section className="ox-careers-panel">
      <h2>{t('careers.scopes.title')}</h2>
      <p className="ox-careers-subtle">{t('careers.scopes.intro')}</p>
      {(d.scopes || []).length ? (
        <table className="ox-careers-table">
          <thead><tr><th>{t('careers.scopes.manager')}</th><th>{t('careers.scopes.level')}</th><th>{t('careers.scopes.region')}</th><th /></tr></thead>
          <tbody>
            {d.scopes.map((s) => (
              <tr key={s.id}>
                <td>{[s.first_name, s.last_name].filter(Boolean).join(' ')}</td>
                <td>{t(`careers.scopes.levels.${s.scope_level}`)}</td>
                <td>{(d.regions || []).find((r) => Number(r.id) === Number(s.region_id))?.name || ''}</td>
                <td>{d.is_owner ? <ActionButton danger onClick={async () => { await revokeHiringScope(ctx.businessId, s.id); scopes.reload(); }}>{t('careers.scopes.revoke')}</ActionButton> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="ox-careers-empty">{t('careers.scopes.none')}</p>}
      {d.is_owner ? (
        <div className="ox-careers-form-grid ox-careers-section">
          <Field label={t('careers.scopes.manager')} htmlFor="scope-mgr">
            <select id="scope-mgr" value={f.membership_id} onChange={(e) => setF({ ...f, membership_id: e.target.value })}>
              <option value="">{t('careers.common.choose')}</option>
              {(d.managers || []).map((m) => <option key={m.membership_id} value={m.membership_id}>{[m.first_name, m.last_name].filter(Boolean).join(' ')}</option>)}
            </select>
          </Field>
          <Field label={t('careers.scopes.level')} htmlFor="scope-level">
            <select id="scope-level" value={f.scope_level} onChange={(e) => setF({ ...f, scope_level: e.target.value })}>
              <option value="brand">{t('careers.scopes.levels.brand')}</option>
              <option value="region">{t('careers.scopes.levels.region')}</option>
            </select>
          </Field>
          {f.scope_level === 'region' ? (
            <Field label={t('careers.scopes.region')} htmlFor="scope-region">
              <select id="scope-region" value={f.region_id} onChange={(e) => setF({ ...f, region_id: e.target.value })}>
                <option value="">{t('careers.common.choose')}</option>
                {(d.regions || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          ) : null}
          <div>
            <ActionButton
              primary
              disabled={!f.membership_id || (f.scope_level === 'region' && !f.region_id)}
              onClick={async () => {
                setError(null);
                try {
                  await grantHiringScope(ctx.businessId, { membership_id: Number(f.membership_id), scope_level: f.scope_level, region_id: f.scope_level === 'region' ? Number(f.region_id) : null });
                  setF({ membership_id: '', scope_level: 'brand', region_id: '' });
                  scopes.reload();
                } catch (err) { setError(err); }
              }}
            >
              {t('careers.scopes.grant')}
            </ActionButton>
          </div>
        </div>
      ) : <p className="ox-careers-subtle">{t('careers.scopes.ownerOnly')}</p>}
      <ErrorNotice error={error} />
    </section>
  );
}

export default function SettingsPanel({ ctx }) {
  const { t } = useTranslation();
  const { data, loading, error, reload, setData } = useLoad(() => getCareerSettings(ctx.businessId), [ctx.businessId]);
  const [f, setF] = useState(null);
  const [token, setToken] = useState('');
  const [certify, setCertify] = useState(false);
  const [saveError, setSaveError] = useState(null);
  useEffect(() => { if (data) setF({ ...data }); }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const providers = data.providers || {};
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-panel">
        <h2>{t('careers.settings.title')}</h2>
        <ul className="ox-careers-steps">
          {['checkr', 'eor', 'billing', 'ai_ranking'].map((p) => <ProviderLine key={p} name={p} status={providers[p]} />)}
        </ul>
        <div className="ox-careers-form-grid ox-careers-section">
          <Field label={t('careers.employer.employerModel')} htmlFor="set-model">
            <select id="set-model" value={f.default_employer_model} onChange={(e) => set('default_employer_model')(e.target.value)}>
              <option value="direct">{t('careers.employer.model.direct')}</option>
              <option value="oxsteed_eor">{t('careers.employer.model.oxsteed_eor')}</option>
            </select>
          </Field>
          <Field label={t('careers.settings.nudge')} htmlFor="set-nudge">
            <input id="set-nudge" type="number" min={1} max={100} value={f.shift_nudge_threshold ?? 6} onChange={(e) => set('shift_nudge_threshold')(Number(e.target.value))} />
          </Field>
          <Field label={t('careers.settings.grace')} htmlFor="set-grace">
            <input id="set-grace" type="number" min={0} max={60} value={f.clock_in_grace_minutes ?? 7} onChange={(e) => set('clock_in_grace_minutes')(Number(e.target.value))} />
          </Field>
        </div>
        <Check id="set-guest" label={t('careers.settings.guestDefault')} checked={f.allow_guest_applications_default} onChange={set('allow_guest_applications_default')} />
        <Check id="set-hide" label={t('careers.settings.hideDefault')} checked={f.hide_identity_default} onChange={set('hide_identity_default')} />
        <Check id="set-ai" label={t('careers.settings.aiDefault')} checked={f.ai_ranking_default} onChange={set('ai_ranking_default')} />
        <Check id="set-digest" label={t('careers.settings.digestOptOut')} checked={f.employer_digest_opt_out} onChange={set('employer_digest_opt_out')} />
      </section>
      <section className="ox-careers-panel">
        <h2>{t('careers.settings.checksTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.settings.checksIntro')}</p>
        {!providers.checkr?.enabled ? <Notice tone="warn">{t('careers.settings.checkrOff')}</Notice> : null}
        <Check id="set-checks" label={t('careers.settings.checksEnabled')} checked={f.background_checks_enabled} onChange={set('background_checks_enabled')} />
        {f.background_checks_enabled && !data.permissible_purpose_certified_at ? (
          <Check id="set-certify" label={t('careers.settings.certify')} checked={certify} onChange={setCertify} />
        ) : null}
        <Field label={t('careers.settings.checkrToken')} htmlFor="set-token" hint={data.checkr_connected ? t('careers.settings.checkrConnected') : t('careers.settings.checkrTokenHint')}>
          <input id="set-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
      </section>
      <ErrorNotice error={saveError} />
      <div className="ox-careers-actions">
        <ActionButton
          primary
          onClick={async () => {
            setSaveError(null);
            try {
              const body = {
                default_employer_model: f.default_employer_model, allow_guest_applications_default: f.allow_guest_applications_default,
                hide_identity_default: f.hide_identity_default, ai_ranking_default: f.ai_ranking_default,
                employer_digest_opt_out: f.employer_digest_opt_out, shift_nudge_threshold: f.shift_nudge_threshold,
                clock_in_grace_minutes: f.clock_in_grace_minutes, background_checks_enabled: f.background_checks_enabled,
                certify_permissible_purpose: certify || undefined,
                ...(token ? { checkr_access_token: token } : {}),
              };
              setData(await updateCareerSettings(ctx.businessId, body));
              setToken('');
              toast.success(t('careers.settings.saved'));
            } catch (err) { setSaveError(err); }
          }}
        >
          {t('careers.settings.save')}
        </ActionButton>
      </div>
      <Scopes ctx={ctx} />
    </div>
  );
}
