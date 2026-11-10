import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { applyReferralCode, getEmployerPlan, openPlanPortal, startPlanCheckout } from '../../../api/careers';
import { ActionButton, Field, Loading, LoadError, Notice, useCareerErrors, useLoad } from '../ui';
import { PLANS } from '../../../features/careers/marketplaceModel';
import { formatDate } from '../../../features/careers/careersModel';

const LIMITS = ['candidate_alerts', 'shortlists', 'talent_invites_per_month', 'analytics_export', 'agency_clients'];

/** Employer plans with a free trial (Stripe Checkout/Portal), and referral codes. */
export default function PlanPanel({ ctx }) {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const data = useLoad(() => getEmployerPlan(ctx.businessId), [ctx.businessId]);
  const [code, setCode] = useState('');
  const result = new URLSearchParams(window.location.search).get('checkout');
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <LoadError error={data.error} onRetry={data.reload} />;
  const p = data.data;
  const sub = p.subscription;
  return (
    <div className="ox-careers-grid">
      {result === 'success' ? <Notice tone="success">{t('careers.mk.plan.checkoutDone')}</Notice> : null}
      {!p.enabled ? <Notice>{t('careers.mk.plan.off')}</Notice> : null}
      {sub ? (
        <section className="ox-careers-panel">
          <h3>{t('careers.mk.plan.current', { plan: t(`careers.mk.plan.names.${sub.plan}`) })}</h3>
          <p className="ox-careers-subtle">
            {t(`careers.mk.plan.status.${sub.status}`)}
            {sub.trial_ends_at ? ` · ${t('careers.mk.plan.trialEnds', { date: formatDate(sub.trial_ends_at, i18n.language) })}` : ''}
            {sub.current_period_end ? ` · ${t(sub.cancel_at_period_end ? 'careers.mk.plan.endsOn' : 'careers.mk.plan.renewsOn', { date: formatDate(sub.current_period_end, i18n.language) })}` : ''}
          </p>
          <ActionButton onClick={async () => { const r = await openPlanPortal(ctx.businessId); if (r?.portal_url) window.location.assign(r.portal_url); }}>{t('careers.mk.plan.manage')}</ActionButton>
        </section>
      ) : null}
      <div className="ox-careers-split">
        {['free', ...PLANS].map((plan) => (
          <article key={plan} className={`ox-careers-panel${p.entitlements?.plan === plan ? ' active' : ''}`}>
            <h3>{t(`careers.mk.plan.names.${plan}`)}</h3>
            <ul className="ox-careers-list">
              {LIMITS.map((k) => {
                const v = p.catalog?.[plan]?.[k];
                return <li key={k}>{typeof v === 'boolean' ? `${t(`careers.mk.plan.limits.${k}`)}: ${v ? t('careers.common.yes') : t('careers.common.no')}` : t(`careers.mk.plan.limits.${k}`, { count: v ?? 0 })}</li>;
              })}
            </ul>
            {plan !== 'free' && p.enabled && !sub ? (
              <ActionButton primary disabled={!p.configured || !p.prices?.[plan]} onClick={async () => {
                const r = await startPlanCheckout(ctx.businessId, plan, code.trim() || undefined);
                if (r?.checkout_url) window.location.assign(r.checkout_url);
              }}
              >{p.trial_days ? t('careers.mk.plan.startTrial', { count: p.trial_days }) : t('careers.mk.plan.choose')}</ActionButton>
            ) : null}
          </article>
        ))}
      </div>
      <section className="ox-careers-section">
        <h3>{t('careers.mk.plan.referralTitle')}</h3>
        <p className="ox-careers-subtle">{t('careers.mk.plan.referralHint')}</p>
        <form className="ox-careers-actions" onSubmit={async (e) => {
          e.preventDefault();
          try { await applyReferralCode(ctx.businessId, code.trim()); toast.success(t('careers.mk.plan.referralApplied')); } catch (err) { toast.error(errorText(err)); }
        }}
        >
          <Field label={t('careers.mk.plan.referralCode')} htmlFor="plan-ref"><input id="plan-ref" dir="ltr" maxLength={20} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
          <button type="submit" className="ox-careers-btn" disabled={code.trim().length < 4}>{t('careers.mk.plan.applyCode')}</button>
        </form>
      </section>
    </div>
  );
}
