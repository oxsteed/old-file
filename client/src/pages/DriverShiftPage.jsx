// DriverShiftPage.jsx
//
// Group 9 Slice G (item 500): driver shifts and shift closeout —
// start shift / end shift. A shift records the driver's availability
// window; closeout is an explicit driver action that summarizes the
// shift (jobs completed, distance, pieces, worked minutes, earnings
// accrued, exceptions raised), confirms any open items, and closes
// the shift with a closeout summary the driver can review later.
// A driver has at most one open shift (D-93). Closeout refuses,
// with the list, while the driver still has an active in-progress
// job (D-94); open issues must be explicitly confirmed. Closing a
// shift never deletes history, payouts, or receipts.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import {
  startDriverShift, getOpenDriverShift, listDriverShifts, getDriverShift,
  closeDriverShift, deliveryMoney, deliveryDate, deliveryError,
} from '../api/delivery';
import '../styles/DeliveryPage.css';

export default function DriverShiftPage() {
  const { t, i18n } = useTranslation();
  const [openShift, setOpenShift] = useState(null);
  const [summary, setSummary] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState(null);
  const [confirmIssues, setConfirmIssues] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [openData, listData] = await Promise.all([getOpenDriverShift(), listDriverShifts()]);
      setOpenShift(openData?.shift || null);
      setSummary(openData?.summary || null);
      setShifts(Array.isArray(listData?.shifts) ? listData.shifts : []);
    } catch (failure) {
      setError(deliveryError(failure, t, 'delivery.shift.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const money = (cents) => deliveryMoney(cents, i18n.language, 'USD');
  const date = (value) => deliveryDate(value, i18n.language);

  const start = async () => {
    setBusy(true); setError(''); setNotice(''); setBlocked(null);
    try {
      await startDriverShift();
      setNotice(t('delivery.shift.started'));
      await load();
    } catch (failure) {
      setError(deliveryError(failure, t, 'delivery.shift.loadFailed'));
    } finally { setBusy(false); }
  };

  const closeout = async () => {
    if (!openShift) return;
    setBusy(true); setError(''); setNotice(''); setBlocked(null);
    try {
      const data = await closeDriverShift(openShift.id, { confirmOpenIssues: confirmIssues });
      setSelected(data?.shift || null);
      setNotice(t('delivery.shift.closed'));
      setConfirmIssues(false);
      await load();
    } catch (failure) {
      setError(deliveryError(failure, t, 'delivery.shift.loadFailed'));
      const fields = failure?.response?.data?.fields;
      if (fields?.activeJobs || fields?.openIssues) setBlocked(fields);
    } finally { setBusy(false); }
  };

  const open = async (id) => {
    setBusy(true); setError('');
    try {
      const data = await getDriverShift(id);
      setSelected(data?.shift || null);
    } catch (failure) {
      setError(deliveryError(failure, t, 'delivery.shift.loadFailed'));
    } finally { setBusy(false); }
  };

  const closeoutSummary = selected?.closeout_summary || selected?.closeoutSummary || {};
  const openIssues = summary?.openIssues || [];
  const activeJobs = summary?.activeJobs || [];
  const unsubmittedProofs = summary?.unsubmittedProofJobs || [];

  return (
    <PageShell>
      <PageMeta title={t('delivery.shift.title')} description={t('delivery.shift.subtitle')} />
      <div className="delivery-page" dir={i18n.dir()}>
        <header className="delivery-hero">
          <div>
            <Link className="delivery-back-link" to="/delivery">{t('delivery.detail.back')}</Link>
            <h1>{t('delivery.shift.title')}</h1>
            <p>{t('delivery.shift.subtitle')}</p>
          </div>
        </header>
        {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
        {notice && <p className="delivery-alert delivery-alert--success" role="status">{notice}</p>}
        {loading && <p role="status">{t('delivery.shift.loading')}</p>}

        {!loading && !openShift && (
          <section className="delivery-panel">
            <h2>{t('delivery.shift.noOpenShift')}</h2>
            <p>{t('delivery.shift.startHint')}</p>
            <button type="button" className="delivery-button delivery-button--primary" disabled={busy} onClick={start} data-track="ui.9d7e678baa.1">
              {t('delivery.shift.start')}
            </button>
          </section>
        )}

        {!loading && openShift && (
          <section className="delivery-panel">
            <h2>{t('delivery.shift.openTitle')}</h2>
            <p>{t('delivery.shift.startedAt', { date: date(openShift.startedAt) })}</p>
            {summary && (
              <dl className="delivery-breakdown">
                <div><dt>{t('delivery.shift.jobsCompletedLabel')}</dt><dd>{summary.jobsCompleted}</dd></div>
                <div><dt>{t('delivery.shift.distanceLabel')}</dt><dd>{summary.distanceMiles} mi</dd></div>
                <div><dt>{t('delivery.shift.piecesLabel')}</dt><dd>{summary.pieces}</dd></div>
                <div><dt>{t('delivery.shift.workedLabel')}</dt><dd>{t('delivery.shift.workedMinutes', { count: summary.workedMinutes })}</dd></div>
                <div><dt>{t('delivery.shift.earningsLabel')}</dt><dd>{money(summary.earningsAccruedCents)}</dd></div>
                <div><dt>{t('delivery.shift.exceptionsLabel')}</dt><dd>{summary.exceptionsCount}</dd></div>
              </dl>
            )}
            {activeJobs.length > 0 && (
              <div className="delivery-alert delivery-alert--warning" role="alert">
                <p>{t('delivery.shift.activeJobsBlock')}</p>
                <ul>
                  {activeJobs.map((job) => (
                    <li key={job.id}><Link to={`/delivery/jobs/${job.id}`}>{job.reference}</Link>{` · ${t(`delivery.helper.status.${job.status}`)}`}</li>
                  ))}
                </ul>
                {unsubmittedProofs.length > 0 && (
                  <p>{t('delivery.shift.unsubmittedProofs', { count: unsubmittedProofs.length })}</p>
                )}
              </div>
            )}
            {blocked?.activeJobs && (
              <div className="delivery-alert delivery-alert--error" role="alert">
                <p>{t('delivery.shift.activeJobsBlock')}</p>
                <ul>
                  {blocked.activeJobs.map((job) => (
                    <li key={job.id}><Link to={`/delivery/jobs/${job.id}`}>{job.reference}</Link>{` · ${t(`delivery.helper.status.${job.status}`)}`}</li>
                  ))}
                </ul>
              </div>
            )}
            {openIssues.length > 0 && (
              <div className="delivery-alert delivery-alert--warning" role="alert">
                <p>{t('delivery.shift.openIssuesTitle')}</p>
                <ul>
                  {openIssues.map((issue) => (
                    <li key={issue.id}>{issue.jobReference ? `${issue.jobReference} · ` : ''}{t(`delivery.ui.issueCodes.${issue.code}`)}{issue.description ? ` · ${issue.description}` : ''}</li>
                  ))}
                </ul>
                <label>
                  <input type="checkbox" checked={confirmIssues} onChange={(event) => setConfirmIssues(event.target.checked)} data-track="ui.9d7e678baa.2" />
                  {' '}{t('delivery.shift.confirmOpenIssues')}
                </label>
              </div>
            )}
            <button
              type="button"
              className="delivery-button delivery-button--primary"
              disabled={busy || activeJobs.length > 0 || (openIssues.length > 0 && !confirmIssues)}
              onClick={closeout}
              data-track="ui.9d7e678baa.3"
            >
              {t('delivery.shift.closeout')}
            </button>
          </section>
        )}

        {!loading && shifts.length > 0 && (
          <section className="delivery-panel"><h2>{t('delivery.shift.historyTitle')}</h2>
            <div className="delivery-extra-list">{shifts.map((shift) => (
              <div key={shift.id}>
                <span>
                  {date(shift.startedAt)}
                  {shift.endedAt ? ` – ${date(shift.endedAt)}` : ` · ${t('delivery.shift.open')}`}
                </span>
                <strong>
                  {shift.status === 'closed'
                    ? t('delivery.shift.jobsCompleted', { count: shift.closeoutSummary?.jobsCompleted ?? 0 })
                    : t('delivery.shift.open')}
                </strong>
                {shift.status === 'closed' && (
                  <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => open(shift.id)} data-track="ui.9d7e678baa.4">
                    {t('delivery.shift.view')}
                  </button>
                )}
              </div>
            ))}</div>
          </section>
        )}
        {!loading && shifts.length === 0 && <p>{t('delivery.shift.empty')}</p>}

        {selected?.status === 'closed' && (
          <section className="delivery-panel">
            <h2>{t('delivery.shift.closeoutTitle')}</h2>
            <p>{t('delivery.shift.closedAt', { date: date(selected.endedAt) })}</p>
            <dl className="delivery-breakdown">
              <div><dt>{t('delivery.shift.jobsCompletedLabel')}</dt><dd>{closeoutSummary.jobsCompleted ?? 0}</dd></div>
              <div><dt>{t('delivery.shift.distanceLabel')}</dt><dd>{closeoutSummary.distanceMiles ?? 0} mi</dd></div>
              <div><dt>{t('delivery.shift.piecesLabel')}</dt><dd>{closeoutSummary.pieces ?? 0}</dd></div>
              <div><dt>{t('delivery.shift.workedLabel')}</dt><dd>{t('delivery.shift.workedMinutes', { count: closeoutSummary.workedMinutes ?? 0 })}</dd></div>
              <div><dt>{t('delivery.shift.earningsLabel')}</dt><dd>{money(closeoutSummary.earningsAccruedCents ?? 0)}</dd></div>
              <div><dt>{t('delivery.shift.exceptionsLabel')}</dt><dd>{closeoutSummary.exceptionsCount ?? 0}</dd></div>
            </dl>
            {(closeoutSummary.jobs || []).map((job) => (
              <p key={job.id}>
                <Link to={`/delivery/jobs/${job.id}`}>{job.reference}</Link>
                {' · '}{job.originCity || ''} → {job.destinationCity || ''}
                {' · '}{job.distanceMiles ?? '—'} mi · {job.pieces} {t('delivery.shift.piecesLabel')}
                {' · '}{money(job.driverPayoutCents)} · {job.deliveredAt ? date(job.deliveredAt) : ''}
              </p>
            ))}
            {(closeoutSummary.openIssues || []).length > 0 && (
              <p>{t('delivery.shift.openIssuesConfirmed')}</p>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}
