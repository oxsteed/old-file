// DriverWeeklyReportPage.jsx
//
// Group 9 Slice F (item 495): the driver's weekly work report —
// jobs completed, distance/pieces, earnings accrued/paid, adjustments,
// exceptions, hours/availability — generated every Monday for the
// week that just ended, only for weeks with activity (D-86). Read-only
// here: generation is the Monday sweep, and the PDF download renders
// the stored report.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import {
  listMyWeeklyReports, getMyWeeklyReport, downloadMyWeeklyReport,
  deliveryMoney, deliveryDate, deliveryError,
} from '../api/delivery';
import '../styles/DeliveryPage.css';

export default function DriverWeeklyReportPage() {
  const { t, i18n } = useTranslation();
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listMyWeeklyReports();
      setReports(Array.isArray(data?.reports) ? data.reports : []);
    } catch (failure) {
      setError(deliveryError(failure, t, 'delivery.weeklyReport.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const open = async (id) => {
    setBusy(true);
    setError('');
    try {
      const data = await getMyWeeklyReport(id);
      setSelected(data?.report || null);
    } catch (failure) {
      setError(deliveryError(failure, t, 'delivery.weeklyReport.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const money = (cents) => deliveryMoney(cents, i18n.language, 'USD');
  const date = (value) => deliveryDate(value, i18n.language);
  const payload = selected?.payload || {};
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];

  return (
    <PageShell>
      <PageMeta title={t('delivery.weeklyReport.title')} description={t('delivery.weeklyReport.subtitle')} />
      <div className="delivery-page" dir={i18n.dir()}>
        <header className="delivery-hero">
          <div>
            <Link className="delivery-back-link" to="/delivery/payouts">{t('delivery.detail.back')}</Link>
            <h1>{t('delivery.weeklyReport.title')}</h1>
            <p>{t('delivery.weeklyReport.subtitle')}</p>
          </div>
        </header>
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        {loading && <p role="status">{t('delivery.weeklyReport.loading')}</p>}
        {!loading && reports.length === 0 && <p>{t('delivery.weeklyReport.empty')}</p>}
        {!loading && reports.length > 0 && (
          <section className="delivery-panel"><h2>{t('delivery.weeklyReport.listTitle')}</h2>
            <div className="delivery-extra-list">{reports.map((report) => (
              <div key={report.id}>
                <span>{t('delivery.weeklyReport.week', { start: report.week_start, end: report.week_end })}</span>
                <strong>{t('delivery.weeklyReport.jobsCompleted', { count: report.jobs_completed })} · {money(report.earnings_accrued_cents)}</strong>
                <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => open(report.id)} data-track="ui.5027cae717.1">{t('delivery.weeklyReport.view')}</button>
                <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => downloadMyWeeklyReport(report.id, report.week_start)} data-track="ui.5027cae717.2">{t('delivery.weeklyReport.download')}</button>
              </div>
            ))}</div>
          </section>
        )}
        {selected && (
          <section className="delivery-panel"><h2>{t('delivery.weeklyReport.week', { start: selected.week_start, end: selected.week_end })}</h2>
            <p>{t('delivery.weeklyReport.timezone', { timezone: selected.timezone })}</p>
            <dl className="delivery-breakdown">
              <div><dt>{t('delivery.weeklyReport.jobsCompletedLabel')}</dt><dd>{selected.jobs_completed}</dd></div>
              <div><dt>{t('delivery.weeklyReport.jobsCancelledLabel')}</dt><dd>{selected.jobs_cancelled}</dd></div>
              <div><dt>{t('delivery.weeklyReport.distanceLabel')}</dt><dd>{Number(selected.distance_miles || 0)} mi</dd></div>
              <div><dt>{t('delivery.weeklyReport.piecesLabel')}</dt><dd>{selected.pieces}</dd></div>
              <div><dt>{t('delivery.weeklyReport.workedLabel')}</dt><dd>{t('delivery.weeklyReport.workedMinutes', { count: selected.worked_minutes })}</dd></div>
              <div><dt>{t('delivery.weeklyReport.earningsAccruedLabel')}</dt><dd>{money(selected.earnings_accrued_cents)}</dd></div>
              <div><dt>{t('delivery.weeklyReport.earningsPaidLabel')}</dt><dd>{money(selected.earnings_paid_cents)}</dd></div>
              <div><dt>{t('delivery.weeklyReport.adjustmentsLabel')}</dt><dd>{selected.adjustments_count}</dd></div>
              <div><dt>{t('delivery.weeklyReport.exceptionsLabel')}</dt><dd>{selected.exceptions_count}</dd></div>
              {payload.availability && (payload.availability.availableFrom || payload.availability.availableUntil) && (
                <div><dt>{t('delivery.weeklyReport.availabilityLabel')}</dt><dd>{payload.availability.availableFrom ? date(payload.availability.availableFrom) : '…'} – {payload.availability.availableUntil ? date(payload.availability.availableUntil) : '…'}</dd></div>
              )}
            </dl>
            <h3>{t('delivery.weeklyReport.jobsTitle')}</h3>
            {!jobs.length && <p>{t('delivery.weeklyReport.jobsEmpty')}</p>}
            {jobs.map((job) => (
              <p key={job.id}>
                <Link to={`/delivery/jobs/${job.id}`}>{job.reference}</Link>
                {' · '}{job.originCity || ''} → {job.destinationCity || ''}
                {' · '}{job.distanceMiles ?? '—'} mi · {job.pieces} {t('delivery.weeklyReport.piecesLabel')}
                {' · '}{money(job.driverPayoutCents)} · {job.deliveredAt ? date(job.deliveredAt) : ''}
              </p>
            ))}
          </section>
        )}
      </div>
    </PageShell>
  );
}
