import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Briefcase,
  Clock3,
  ExternalLink,
  RefreshCw,
  MessageSquare,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../hooks/useAuth';
import { formatCents, formatDateTime, formatMoney } from '../lib/format';

function normalizeBid(responseData) {
  return responseData?.data || responseData || null;
}

function statusTone(status) {
  const map = {
    pending: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20',
    accepted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/20',
    withdrawn: 'bg-slate-500/15 text-slate-300 border-slate-500/20',
  };
  return map[status] || 'bg-white/5 text-slate-300 border-white/10';
}

function Section({ title, icon: Icon, children, className = '' }) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-slate-950/75 p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-center gap-2 text-white">
        {Icon && <Icon size={18} className="text-orange-300" />}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function BidDetailPage() {
  const { t } = useTranslation();
  const { bidId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [bid, setBid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const loadBid = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get(`/bids/${bidId}`);
      setBid(normalizeBid(response.data));
    } catch (err) {
      setError(err.response?.data?.error || t('common.error', { defaultValue: 'Failed to load bid.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bidId) loadBid();
  }, [bidId]);

  const isHelperOwner = String(user?.id || '') === String(bid?.helper_id || '');
  const canWithdraw = isHelperOwner && bid?.status === 'pending';
  const amountCents = useMemo(() => {
    if (!bid) return 0;
    if (Number.isFinite(Number(bid.amount_cents))) return Number(bid.amount_cents);
    return Math.round(Number(bid.amount || 0) * 100);
  }, [bid]);

  const handleWithdraw = async () => {
    if (!canWithdraw) return;
    if (!window.confirm(t('myBids.withdrawConfirm', { defaultValue: 'Are you sure you want to withdraw this bid?' }))) return;
    try {
      setWithdrawing(true);
      await api.post(`/bids/${bidId}/withdraw`);
      toast.success(t('myBids.withdrawSuccess', { defaultValue: 'Bid withdrawn.' }));
      await loadBid();
    } catch (err) {
      toast.error(err.response?.data?.error || t('myBids.withdrawError', { defaultValue: 'Failed to withdraw bid.' }));
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="animate-pulse rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-white/10" />
            <div className="h-5 w-48 rounded bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !bid) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <PageMeta title={t('activity.bidDetails', { defaultValue: 'Bid Details' })} noIndex />
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-12">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950/80 p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-300">
              <Briefcase size={28} />
            </div>
            <h1 className="text-2xl font-semibold text-white">{t('activity.bidUnavailable', { defaultValue: 'Bid unavailable' })}</h1>
            <p className="mt-3 text-slate-300">{error || t('activity.bidUnavailableBody', { defaultValue: 'We could not load this bid.' })}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={loadBid}
                className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3 font-semibold text-white transition hover:bg-orange-600"
              >
                <RefreshCw size={16} />
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
              <button
                type="button"
                onClick={() => navigate('/my-bids')}
                className="inline-flex items-center gap-2 rounded-full bg-white/5 px-5 py-3 font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <ArrowLeft size={16} />
                {t('myBids.title', { defaultValue: 'My Bids' })}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const amountLabel = formatCents(amountCents, { currency: bid.currency_code });
  const etaLabel = bid.eta_hours ? `${bid.eta_hours} ${t('common.hours', { defaultValue: 'hours' })}` : t('common.notSet', { defaultValue: 'Not set' });
  const jobLink = `/jobs/${bid.job_id}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <PageMeta title={t('activity.bidDetails', { defaultValue: 'Bid Details' })} noIndex />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/my-bids')}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <ArrowLeft size={16} />
            {t('common.back', { defaultValue: 'Back' })}
          </button>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
            {t('activity.bidDetails', { defaultValue: 'Bid Details' })}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <Section title={bid.job_title || t('myBids.untitledJob', { defaultValue: 'Untitled Job' })} icon={Briefcase}>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusTone(bid.status)}`}>
                  {t(`myBids.status${String(bid.status || 'pending').charAt(0).toUpperCase()}${String(bid.status || 'pending').slice(1)}`, { defaultValue: bid.status })}
                </span>
                {bid.job_status && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                    {bid.job_status.replace(/_/g, ' ')}
                  </span>
                )}
                {bid.job_category && (
                  <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-200">
                    {bid.job_category}
                  </span>
                )}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">{t('activity.amount', { defaultValue: 'Amount' })}</div>
                  <div className="text-3xl font-semibold text-emerald-300">{amountLabel}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">{t('activity.eta', { defaultValue: 'ETA' })}</div>
                  <div className="text-3xl font-semibold text-sky-300">{etaLabel}</div>
                </div>
              </div>

              <div className="mt-5 text-sm text-slate-300">
                <span className="font-medium text-slate-200">{t('activity.jobLocation', { defaultValue: 'Location' })}: </span>
                {[bid.location_city, bid.location_state].filter(Boolean).join(', ') || t('common.notSet', { defaultValue: 'Not set' })}
              </div>
            </Section>

            <Section title={t('activity.bidMessage', { defaultValue: 'Message' })} icon={MessageSquare}>
              <p className="whitespace-pre-wrap text-slate-300 leading-7">{bid.message || t('common.none', { defaultValue: 'None' })}</p>
            </Section>

            <Section title={t('activity.nextStep', { defaultValue: 'Next step' })} icon={ShieldCheck}>
              <p className="text-slate-300 leading-7">
                {bid.status === 'pending'
                  ? t('activity.bidNextStepPending', { defaultValue: 'Wait for the customer to review this bid from the job detail or bids workflow.' })
                  : bid.status === 'accepted'
                    ? t('activity.bidNextStepAccepted', { defaultValue: 'This bid has been accepted. Continue through the booking and job workflow.' })
                    : t('activity.bidNextStepHistory', { defaultValue: 'Accepted, rejected, and withdrawn bids remain in history for long-term tracking.' })}
              </p>
            </Section>
          </div>

          <div className="space-y-6">
            <Section title={t('activity.bidContext', { defaultValue: 'Bid context' })} icon={Wallet}>
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('activity.bidId', { defaultValue: 'Bid ID' })}</dt>
                  <dd className="mt-1 break-all text-sm text-slate-100">{bid.id}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('activity.helper', { defaultValue: 'Helper' })}</dt>
                  <dd className="mt-1 text-sm text-slate-100">{bid.helper_name || t('common.unknown', { defaultValue: 'Unknown' })}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('activity.submitted', { defaultValue: 'Submitted' })}</dt>
                  <dd className="mt-1 text-sm text-slate-100">{formatDateTime(bid.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('activity.currency', { defaultValue: 'Currency' })}</dt>
                  <dd className="mt-1 text-sm text-slate-100">{bid.currency_code || 'USD'}</dd>
                </div>
              </dl>
            </Section>

            <Section title={t('activity.helperProfile', { defaultValue: 'Helper profile' })} icon={User}>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/15 text-lg font-semibold text-orange-200">
                  {(bid.helper_name || '?').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-white">{bid.helper_name || t('common.unknown', { defaultValue: 'Unknown' })}</div>
                  <div className="text-sm text-slate-400">
                    {bid.helper_rating ? formatMoney(bid.helper_rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : t('common.noRating', { defaultValue: 'No rating yet' })}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to={jobLink}
                  className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600"
                >
                  {t('activity.viewJob', { defaultValue: 'View Job' })}
                  <ExternalLink size={15} />
                </Link>
                {canWithdraw && (
                  <button
                    type="button"
                    onClick={handleWithdraw}
                    disabled={withdrawing}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {withdrawing ? <RefreshCw size={15} className="animate-spin" /> : null}
                    {withdrawing
                      ? t('common.saving', { defaultValue: 'Saving…' })
                      : t('myBids.withdraw', { defaultValue: 'Withdraw Bid' })}
                  </button>
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
