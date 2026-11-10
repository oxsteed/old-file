import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { getCareerPreferences, getMyReferrals, getScreenerDefaults, saveScreenerDefaults, updateCareerPreferences } from '../../../api/careers';
import { ActionButton, Check, Field, Loading, LoadError, Notice, useCareerErrors, useLoad } from '../ui';
import { AVAILABLE_NOW_HOURS, SCREENER_PRESETS, formatCents } from '../../../features/careers/marketplaceModel';
import { formatWhen } from '../../../features/careers/careersModel';
import ScreenerFields from './ScreenerFields';

const DEFAULTABLE = ['work_authorization', 'min_age_18', 'drivers_license', 'reliable_transport', 'relocate', 'shift_availability', 'years_experience', 'education', 'lift_weight', 'start_date'];

/** Worker settings: same-day "available now", SMS consent, saved screener answers, referral code. */
export default function CareerSettingsTab() {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const prefs = useLoad(() => getCareerPreferences(), []);
  const defaults = useLoad(() => getScreenerDefaults(), []);
  const referrals = useLoad(() => getMyReferrals().catch(() => null), []);
  const [answers, setAnswers] = useState({});
  useEffect(() => { if (defaults.data) setAnswers(defaults.data); }, [defaults.data]);

  const patch = async (body) => {
    try { prefs.setData(await updateCareerPreferences(body)); toast.success(t('careers.mk.settings.saved')); } catch (err) { toast.error(errorText(err)); }
  };
  if (prefs.loading && !prefs.data) return <Loading />;
  if (prefs.error) return <LoadError error={prefs.error} onRetry={prefs.reload} />;
  const p = prefs.data || {};
  const questions = DEFAULTABLE.map((code) => ({ id: code, kind: 'preset', preset_code: code, prompt: code, ...SCREENER_PRESETS[code], choices: SCREENER_PRESETS[code].choices || [] }));
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-section">
        <h2>{t('careers.mk.settings.availableTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.mk.settings.availableHint')}</p>
        <Check id="show-online" label={t('careers.mk.settings.showOnline')} checked={p.show_online_status} onChange={(v) => patch({ show_online_status: v })} />
        {p.show_online_status ? (
          <div className="ox-careers-actions">
            {p.available_now
              ? <span className="ox-careers-chip ok">{t('careers.mk.settings.availableUntil', { when: formatWhen(p.available_now_until, undefined, i18n.language) })}</span>
              : null}
            {AVAILABLE_NOW_HOURS.map((h) => <ActionButton key={h} onClick={() => patch({ available_now_hours: h })}>{t('careers.mk.settings.availableFor', { count: h })}</ActionButton>)}
            {p.available_now ? <ActionButton onClick={() => patch({ available_now_hours: 0 })}>{t('careers.mk.settings.availableStop')}</ActionButton> : null}
          </div>
        ) : null}
      </section>
      <section className="ox-careers-section">
        <h2>{t('careers.mk.settings.smsTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.mk.settings.smsHint')}</p>
        {!p.sms_available ? <Notice>{t('careers.mk.settings.smsUnavailable')}</Notice> : null}
        {p.sms_available && !p.phone_verified ? <Notice tone="warn">{t('careers.mk.settings.smsVerifyPhone')}</Notice> : null}
        <Check id="sms-opt-in" label={t('careers.mk.settings.smsConsent')} checked={p.sms_opt_in} disabled={!p.sms_available} onChange={(v) => patch({ sms_opt_in: v })} />
      </section>
      <section className="ox-careers-section">
        <h2>{t('careers.mk.settings.defaultsTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.mk.settings.defaultsHint')}</p>
        <ScreenerFields questions={questions} answers={answers} onChange={setAnswers} />
        <ActionButton primary onClick={async () => {
          const body = Object.fromEntries(DEFAULTABLE.map((c) => [c, answers[c] === undefined || (Array.isArray(answers[c]) && !answers[c].length) ? '' : answers[c]]));
          defaults.setData(await saveScreenerDefaults(body));
          toast.success(t('careers.mk.settings.saved'));
        }}
        >{t('careers.mk.common.save')}</ActionButton>
      </section>
      {referrals.data?.enabled ? (
        <section className="ox-careers-section">
          <h2>{t('careers.mk.referrals.title')}</h2>
          <p className="ox-careers-subtle">{t('careers.mk.referrals.hint', { percent: referrals.data.rate_bps / 100, months: referrals.data.months })}</p>
          <Field label={t('careers.mk.referrals.yourCode')} htmlFor="ref-code">
            <input id="ref-code" readOnly value={referrals.data.code} dir="ltr" />
          </Field>
          <ActionButton onClick={async () => { await navigator.clipboard.writeText(referrals.data.code); toast.success(t('careers.mk.actions.linkCopied')); }}>{t('careers.mk.referrals.copy')}</ActionButton>
          <p>{t('careers.mk.referrals.stats', {
            businesses: referrals.data.businesses,
            pending: formatCents(referrals.data.pending_cents, referrals.data.currency, i18n.language),
            approved: formatCents(referrals.data.approved_cents, referrals.data.currency, i18n.language),
            paid: formatCents(referrals.data.paid_cents, referrals.data.currency, i18n.language),
          })}</p>
        </section>
      ) : null}
    </div>
  );
}
