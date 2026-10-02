import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Building2,
  CheckCircle2,
  DollarSign,
  Globe,
  Layers,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useTranslation } from 'react-i18next';

const PERIOD_OPTIONS = ['7d', '30d', '90d', '1y'];

const CATEGORY_META = {
  direct_revenue: {
    titleKey: 'superMoney.catDirectTitle',
    descriptionKey: 'superMoney.catDirectDesc',
    tone: 'border-emerald-500/30 bg-emerald-500/8',
    icon: DollarSign,
  },
  volume_signal: {
    titleKey: 'superMoney.catVolumeTitle',
    descriptionKey: 'superMoney.catVolumeDesc',
    tone: 'border-sky-500/30 bg-sky-500/8',
    icon: TrendingUp,
  },
  partner_flow: {
    titleKey: 'superMoney.catPartnerTitle',
    descriptionKey: 'superMoney.catPartnerDesc',
    tone: 'border-amber-500/30 bg-amber-500/8',
    icon: Briefcase,
  },
  configured_program: {
    titleKey: 'superMoney.catConfiguredTitle',
    descriptionKey: 'superMoney.catConfiguredDesc',
    tone: 'border-fuchsia-500/30 bg-fuchsia-500/8',
    icon: Building2,
  },
};

const STATUS_META = {
  live_revenue: {
    labelKey: 'superMoney.statusLive',
    className: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300',
  },
  volume_only: {
    labelKey: 'superMoney.statusVolume',
    className: 'border-sky-500/30 bg-sky-500/12 text-sky-300',
  },
  partner_payout_flow: {
    labelKey: 'superMoney.statusPartner',
    className: 'border-amber-500/30 bg-amber-500/12 text-amber-300',
  },
  configured_program_economics: {
    labelKey: 'superMoney.statusConfigured',
    className: 'border-fuchsia-500/30 bg-fuchsia-500/12 text-fuchsia-300',
  },
};

function formatMoneyFromCents(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatPercent(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe >= 0 ? '+' : '-'}${Math.abs(safe).toFixed(1)}%`;
}

function SummaryCard({ icon: Icon, label, value, hint, tone = 'text-white', trend = null }) {
  return (
    <div className="rounded-[26px] border border-gray-800 bg-[#111318] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{label}</p>
          <p className={`mt-3 text-3xl font-semibold ${tone}`}>{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/75">
          <Icon className="h-5 w-5 text-gray-300" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm leading-6 text-gray-400">{hint}</p>
        {trend ? (
          <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
            trend >= 0
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}>
            {trend >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {formatPercent(trend)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChannelCard({ channel }) {
  const { t } = useTranslation();
  const statusMeta = STATUS_META[channel.trackingStatus] || STATUS_META.volume_only;

  return (
    <article className="rounded-[26px] border border-gray-800 bg-[#111318] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusMeta.className}`}>
              {t(statusMeta.labelKey)}
            </span>
            {!!channel.count && (
              <span className="rounded-full border border-gray-700 bg-gray-900/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                {t('superMoney.trackedCount', { count: formatCompactNumber(channel.count) })}
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white">{channel.label}</h3>
          <p className="mt-2 text-sm leading-6 text-gray-400">{channel.note}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-3 py-2 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('superMoney.colPeriod')}</p>
          <p className="mt-1 text-lg font-semibold text-white">{formatMoneyFromCents(channel.periodCents)}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/55 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('superMoney.colLifetime')}</p>
          <p className="mt-2 text-lg font-semibold text-white">{formatMoneyFromCents(channel.lifetimeCents)}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/55 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('superMoney.colPipeline')}</p>
          <p className="mt-2 text-lg font-semibold text-amber-300">{formatMoneyFromCents(channel.pendingCents)}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/55 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('superMoney.colRefunds')}</p>
          <p className="mt-2 text-lg font-semibold text-red-300">{formatMoneyFromCents(channel.refundsCents)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(channel.sources || []).map((source) => (
          <span
            key={source}
            className="rounded-full border border-gray-700 bg-black/20 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400"
          >
            {source.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </article>
  );
}

function ControlCard({ title, value, hint, icon: Icon }) {
  return (
    <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{title}</p>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-800 bg-gray-900/75">
          <Icon className="h-4 w-4 text-gray-400" />
        </div>
      </div>
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-gray-500">{hint}</p>
    </div>
  );
}

export default function MoneyPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('30d');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await adminApi.get('/admin/super/money', { params: { period } });
        if (!active) return;
        setPayload(data);
      } catch (err) {
        if (!active) return;
        setError(err.response?.data?.error || t('superMoney.errorLoad'));
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchData();
    return () => {
      active = false;
    };
  }, [period, reloadNonce]);

  const groupedChannels = useMemo(() => {
    const grouped = {
      direct_revenue: [],
      volume_signal: [],
      partner_flow: [],
      configured_program: [],
    };

    (payload?.channels || []).forEach((channel) => {
      if (!grouped[channel.category]) grouped[channel.category] = [];
      grouped[channel.category].push(channel);
    });

    return grouped;
  }, [payload]);

  const feeSettingRows = useMemo(() => {
    const settings = payload?.controls?.feeSettings || {};
    return [
      ['starter', 'superMoney.feeStarter', settings.platform_fee_starter],
      ['pro', 'superMoney.feePro', settings.platform_fee_pro],
      ['elite', 'superMoney.feeElite', settings.platform_fee_elite],
      ['broker', 'superMoney.feeBroker', settings.platform_fee_broker],
      ['brokerCut', 'superMoney.feeBrokerCut', settings.broker_cut_rate],
      ['tier2', 'superMoney.feeTier2', settings.tier2_subscription_cents ? formatMoneyFromCents(Number(settings.tier2_subscription_cents)) : null],
      ['tier3', 'superMoney.feeTier3', settings.tier3_subscription_cents ? formatMoneyFromCents(Number(settings.tier3_subscription_cents)) : null],
    ].filter(([, , value]) => value !== undefined && value !== null && value !== '');
  }, [payload]);

  const recentMovements = payload?.recentMovements || [];
  const summary = payload?.summary || {};

  return (
    <div className="min-h-full bg-[#07090d] px-4 py-6 text-gray-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[34px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.22),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.16),_transparent_28%),#0d1016] p-6 lg:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-orange-200">
                <Sparkles className="h-3.5 w-3.5" />
                {t('superMoney.badge')}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">
                {t('superMoney.title')}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 lg:text-base">
                {t('superMoney.intro')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setPeriod(option)}
                  className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                    period === option
                      ? 'bg-orange-500 text-white'
                      : 'border border-gray-700 bg-gray-900/70 text-gray-300 hover:border-gray-500 hover:text-white'
                  }`}
                >
                  {t('superDashboard.period' + option)}
                </button>
              ))}
              <button
                onClick={() => setReloadNonce((current) => current + 1)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/70 px-3.5 py-2 text-sm font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t('superDashboard.refresh')}
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-[26px] border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={DollarSign}
            label={t('superMoney.summaryTracked')}
            value={loading ? '...' : formatMoneyFromCents(summary.trackedRevenuePeriodCents)}
            hint={t('superMoney.summaryTrackedHint')}
            tone="text-white"
            trend={summary.trackedGrowth}
          />
          <SummaryCard
            icon={TrendingUp}
            label={t('superMoney.summaryGmv')}
            value={loading ? '...' : formatMoneyFromCents(summary.gmvPeriodCents)}
            hint={t('superMoney.summaryGmvHint')}
            tone="text-sky-300"
          />
          <SummaryCard
            icon={Layers}
            label={t('superMoney.summaryPipeline')}
            value={loading ? '...' : formatMoneyFromCents(summary.pipelineCents)}
            hint={t('superMoney.summaryPipelineHint')}
            tone="text-amber-300"
          />
          <SummaryCard
            icon={Shield}
            label={t('superMoney.summaryOutflow')}
            value={loading ? '...' : formatMoneyFromCents(summary.outflowsLifetimeCents)}
            hint={t('superMoney.summaryOutflowHint')}
            tone="text-red-300"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
          <div className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{t('superMoney.revenueArchitecture')}</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{t('superMoney.howMakesMoney')}</h2>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3 text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('superMoney.lifetimeTracked')}</p>
                <p className="mt-1 text-xl font-semibold text-white">
                  {loading ? '...' : formatMoneyFromCents(summary.trackedRevenueLifetimeCents)}
                </p>
              </div>
            </div>

            <div className="space-y-5">
              {Object.entries(CATEGORY_META).map(([key, meta]) => {
                const Icon = meta.icon;
                const items = groupedChannels[key] || [];

                return (
                  <div key={key} className={`rounded-[26px] border p-4 lg:p-5 ${meta.tone}`}>
                    <div className="mb-4 flex items-start gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">{t(meta.titleKey)}</h3>
                        <p className="mt-1 text-sm leading-6 text-gray-300">{t(meta.descriptionKey)}</p>
                      </div>
                    </div>

                    {items.length ? (
                      <div className="grid gap-4">
                        {items.map((channel) => <ChannelCard key={channel.key} channel={channel} />)}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-700 bg-black/15 px-4 py-5 text-sm text-gray-400">
                        {t('superMoney.noChannelData')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
                  <Globe className="h-5 w-5 text-gray-300" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{t('superMoney.controlLevers')}</p>
                  <h2 className="text-xl font-semibold text-white">{t('superMoney.pricingTakeRate')}</h2>
                </div>
              </div>

              <div className="grid gap-3">
                <ControlCard
                  title={t('superMoney.countryOverrides')}
                  value={loading ? '...' : String(payload?.controls?.pricingOverrides || 0)}
                  hint={payload?.controls?.overrideCountries?.length ? t('superMoney.countryOverridesHint', { countries: `${payload.controls.overrideCountries.slice(0, 5).join(', ')}${payload.controls.overrideCountries.length > 5 ? '…' : ''}` }) : t('superMoney.countryOverridesHintNone')}
                  icon={Globe}
                />
                <ControlCard
                  title={t('superMoney.franchiseRoyalty')}
                  value={loading ? '...' : `${payload?.controls?.franchiseRoyaltyBps || 0} bps`}
                  hint={t('superMoney.franchiseRoyaltyHint')}
                  icon={Building2}
                />
                <ControlCard
                  title={t('superMoney.franchiseMarketingFee')}
                  value={loading ? '...' : `${payload?.controls?.franchiseMarketingFeeBps || 0} bps`}
                  hint={t('superMoney.franchiseMarketingFeeHint')}
                  icon={Sparkles}
                />
              </div>

              <div className="mt-5 rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">{t('superMoney.feeSettingsTitle')}</h3>
                  <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                    {t('superMoney.liveKeys', { count: feeSettingRows.length })}
                  </span>
                </div>
                <div className="space-y-2">
                  {feeSettingRows.map(([id, labelKey, value]) => (
                    <div key={id} className="flex items-center justify-between gap-4 rounded-2xl border border-gray-800 bg-black/15 px-3 py-2.5 text-sm">
                      <span className="text-gray-400">{t(labelKey)}</span>
                      <span className="font-semibold text-white">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
                  <CheckCircle2 className="h-5 w-5 text-gray-300" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{t('superMoney.diagnostics')}</p>
                  <h2 className="text-xl font-semibold text-white">{t('superMoney.operationalChecks')}</h2>
                </div>
              </div>

              <div className="grid gap-3">
                {[
                  ['subs', 'superMoney.diagSubscriptions', payload?.diagnostics?.activeSubscriptions || 0],
                  ['api', 'superMoney.diagApiProducts', payload?.diagnostics?.publishedApiProducts || 0],
                  ['recurring', 'superMoney.diagRecurringApi', payload?.diagnostics?.recurringApiProducts || 0],
                  ['franchise', 'superMoney.diagFranchiseStores', payload?.diagnostics?.launchedFranchiseStores || 0],
                ].map(([id, labelKey, value]) => (
                  <div key={id} className="rounded-2xl border border-gray-800 bg-[#111318] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-gray-500">{t(labelKey)}</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{loading ? '...' : formatCompactNumber(value)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{t('superMoney.recentMovement')}</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{t('superMoney.latestSignals')}</h2>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900/80 px-3 py-2 text-sm text-gray-300">
              {t('superMoney.latestEntries', { count: recentMovements.length })}
            </div>
          </div>

          <div className="grid gap-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-gray-700 bg-[#111318] px-4 py-8 text-center text-sm text-gray-400">
                {t('superMoney.loadingActivity')}
              </div>
            ) : recentMovements.length ? (
              recentMovements.map((item) => {
                const positive = Number(item.amount_cents) >= 0;
                return (
                  <div key={`${item.source}-${item.id}`} className="rounded-[24px] border border-gray-800 bg-[#111318] px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            {item.source}
                          </span>
                          <span className="rounded-full border border-gray-700 bg-black/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-300">
                            {String(item.label || t('superMoney.movementFallback')).replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300">
                          {item.description || t('superMoney.movementFallback')}
                        </p>
                        <p className="mt-2 text-xs text-gray-500">
                          {new Date(item.created_at).toLocaleString()}
                        </p>
                      </div>

                      <div className={`text-right text-lg font-semibold ${positive ? 'text-emerald-300' : 'text-red-300'}`}>
                        {positive ? '+' : '-'}
                        {formatMoneyFromCents(Math.abs(Number(item.amount_cents) || 0))}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-700 bg-[#111318] px-4 py-8 text-center text-sm text-gray-400">
                {t('superMoney.noMovement')}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
