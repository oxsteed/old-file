import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { Card, CardHeader, Btn } from './dashboardUI';
import { formatCents, formatDate } from '../lib/format';

const IcoDollar = (p) => (
  <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${p.cls || 'text-gray-400'}`}>
    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
  </svg>
);

const STATUS_STYLE = {
  earned: 'bg-emerald-500/15 text-emerald-400',
  not_ready: 'bg-gray-700/40 text-gray-400',
  pending: 'bg-yellow-500/15 text-yellow-400',
  processing: 'bg-purple-500/15 text-purple-400',
  paid: 'bg-blue-500/15 text-blue-400',
};

const STATUS_KEY = {
  earned: 'statusEarned',
  not_ready: 'statusNotReady',
  pending: 'statusPending',
  processing: 'statusProcessing',
  paid: 'statusPaid',
};

const StatusPill = ({ status, t, prefix }) => {
  const key = STATUS_KEY[status] || 'statusNotReady';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[status] || STATUS_STYLE.not_ready}`}>
      {t(`${prefix}.${key}`)}
    </span>
  );
};

const StatCell = ({ label, value }) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{label}</p>
    <p className="text-xl font-bold text-white">{value}</p>
  </div>
);

export default function HelperJobEarnings() {
  const { t } = useTranslation();
  const prefix = 'helperDashboard.jobEarnings';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await api.get('/main-app/earnings');
        if (!cancelled) setData(res.data);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const summary = data?.summary || {};
  const currency = summary.currencyCode || 'USD';
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const weekly = Array.isArray(data?.weekly) ? [...data.weekly].reverse() : [];
  const maxWeekly = weekly.reduce((m, w) => Math.max(m, Number(w.amountCents || 0)), 0);

  const retry = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get('/main-app/earnings');
      setData(res.data);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader icon={IcoDollar} title={t(`${prefix}.title`)} />
      {loading && (
        <p className="text-gray-500 text-sm text-center py-8">{t(`${prefix}.loading`)}</p>
      )}
      {!loading && failed && (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm mb-4">{t(`${prefix}.loadFailed`)}</p>
          <Btn variant="secondary" onClick={retry}>{t(`${prefix}.retry`)}</Btn>
        </div>
      )}
      {!loading && !failed && (summary.completedJobs || 0) === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">{t(`${prefix}.noJobs`)}</p>
      )}
      {!loading && !failed && (summary.completedJobs || 0) > 0 && (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCell label={t(`${prefix}.lifetime`)} value={formatCents(summary.lifetimeCents, { currency })} />
          <StatCell label={t(`${prefix}.thisWeek`)} value={formatCents(summary.weekCents, { currency })} />
          <StatCell label={t(`${prefix}.thisMonth`)} value={formatCents(summary.monthCents, { currency })} />
          <StatCell label={t(`${prefix}.completedJobs`)} value={String(summary.completedJobs)} />
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCell label={t(`${prefix}.available`)} value={formatCents(summary.availableCents, { currency })} />
          <StatCell label={t(`${prefix}.pendingPayout`)} value={formatCents(summary.pendingCents, { currency })} />
          <StatCell label={t(`${prefix}.paidOut`)} value={formatCents(summary.paidCents, { currency })} />
        </div>
        {weekly.length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-3">{t(`${prefix}.weeklyTrend`)}</p>
            <div className="flex items-end gap-1.5 h-24" role="img" aria-label={t(`${prefix}.weeklyTrend`)}>
              {weekly.map((w) => {
                const amt = Number(w.amountCents || 0);
                const pct = maxWeekly > 0 ? Math.max(4, Math.round((amt / maxWeekly) * 100)) : 4;
                return (
                  <div key={w.period} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                    <div
                      className="w-full max-w-6 rounded-t bg-emerald-500/60"
                      style={{ height: `${pct}%` }}
                      title={`${formatDate(w.period, { month: 'short', day: 'numeric' })}: ${formatCents(amt, { currency })}`}
                    />
                    <span className="text-[8px] text-gray-600 leading-none">{formatDate(w.period, { month: 'numeric', day: 'numeric', year: undefined })}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t(`${prefix}.recentJobs`)}</p>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {jobs.slice(0, 10).map((job) => (
              <div key={job.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{job.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{formatDate(job.completedAt)}</p>
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <StatusPill status={job.payoutStatus} t={t} prefix={prefix} />
                  <span className="text-sm font-bold text-emerald-400 whitespace-nowrap">
                    {formatCents(job.amountCents, { currency: job.currencyCode || currency })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>)}
    </Card>
  );
}
