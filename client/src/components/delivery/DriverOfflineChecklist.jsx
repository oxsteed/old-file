import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checklistItems,
  discardEntry,
  enqueueAction,
  flushOutbox,
  holdProofFile,
  isNetworkFailure,
  readOutbox,
  retryEntry,
} from './driverOfflineOutbox';
import {
  completeDeliveryStop,
  deliveryError,
  reportDeliveryIssue,
  updateDeliveryStatus,
  uploadDeliveryProof,
} from '../../api/delivery';

// Group 9 Slice G (item 496): the offline task checklist for the
// assigned driver. The stops and actions for the current job, usable
// offline: status updates, proof metadata, issue reports, and stop
// completions queue in the per-job outbox (driverOfflineOutbox) and
// flush in recorded order on reconnect, with a visible queued/synced
// state per item. The GPS queue is untouched — this extends its
// pattern to actions, it does not duplicate it.
//
// Every action tries the network first; only a network failure
// queues it, so the checklist behaves identically online and off.
// A queued action is never silently dropped: it stays visible as
// queued, synced, or failed until the driver retries or explicitly
// discards it. A photo proof queues its metadata and holds the file
// in memory until connectivity returns (D-89).
const ISSUE_CODES = ['delay', 'damage', 'access_problem', 'missing_shipment', 'customer_report'];

function entryStateKey(state) {
  return state === 'synced' ? 'synced' : state === 'failed' ? 'failed' : state === 'syncing' ? 'syncing' : 'queued';
}

export default function DriverOfflineChecklist({ job, stops = [], itemPhotos = [], executors, onChanged }) {
  const { t } = useTranslation();
  const jobId = job?.id;
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pickupPieces, setPickupPieces] = useState('');
  const [conditionAck, setConditionAck] = useState(false);
  const [conditionNote, setConditionNote] = useState('');
  const [issueCode, setIssueCode] = useState('delay');
  const [issueDescription, setIssueDescription] = useState('');
  const [proofValue, setProofValue] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientContact, setRecipientContact] = useState('');
  const [proofConfirmed, setProofConfirmed] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  // Group 9 partials Wave 2 Batch N (468, D-542): the customer photos
  // for the condition acknowledgment, passed down from the detail page.
  const pickupPhotos = (itemPhotos || []).filter((photo) => photo.url);

  const refreshEntries = useCallback(() => {
    if (!jobId) return;
    setEntries(readOutbox(window.localStorage, jobId));
  }, [jobId]);

  useEffect(() => {
    refreshEntries();
    const handleOnline = () => {
      if (!jobId || !executors) return;
      flushOutbox(window.localStorage, jobId, executors).then(() => {
        refreshEntries();
        onChanged?.();
      });
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [jobId, executors, refreshEntries, onChanged]);

  const queueOrRun = useCallback(async (kind, payload, runOnline) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await runOnline();
      setNotice(t('delivery.offline.actionDone'));
      onChanged?.();
      return true;
    } catch (failure) {
      if (isNetworkFailure(failure)) {
        const entry = enqueueAction(window.localStorage, jobId, kind, payload);
        if (kind === 'proof' && proofFile) holdProofFile(entry.id, proofFile);
        setNotice(t('delivery.offline.actionQueued'));
        refreshEntries();
        return true;
      }
      setError(deliveryError(failure, t, 'delivery.errors.status'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [jobId, onChanged, proofFile, refreshEntries, t]);

  // Group 9 partials Wave 2 Batch N (467, G9-A5, D-541): the count
  // starts blank and must be typed. A blank or out-of-range count
  // never queues a pickup action: queuing the booked count would
  // flush later as a rubber-stamp confirmation. The server 400s
  // without a typed count too, but the queue must never hold one.
  const handlePickup = () => {
    const pieces = Number(pickupPieces);
    if (!Number.isInteger(pieces) || pieces < 1 || pieces > 9999) {
      setError(t('delivery.detail.pickupPiecesRequired'));
      return;
    }
    const payload = {
      status: 'picked_up',
      pickupConfirmedPieces: pieces,
      conditionAcknowledged: conditionAck,
      conditionNote,
    };
    queueOrRun('status', payload, () => updateDeliveryStatus(jobId, 'picked_up', {
      pickupConfirmedPieces: pieces, conditionAcknowledged: conditionAck, conditionNote,
    }));
  };

  const handleInTransit = () => queueOrRun(
    'status',
    { status: 'in_transit' },
    () => updateDeliveryStatus(jobId, 'in_transit'),
  );

  const handleCompleteStop = (stopId) => queueOrRun(
    'stop_complete',
    { stopId },
    () => completeDeliveryStop(jobId, stopId),
  );

  const handleIssue = async () => {
    const payload = { code: issueCode, description: issueDescription };
    const done = await queueOrRun('issue', payload, () => reportDeliveryIssue(jobId, payload));
    if (done) setIssueDescription('');
  };

  const handleProof = () => {
    const proofType = job.proof_preference;
    const payload = { proofType };
    if (proofType === 'pin') payload.proofValue = proofValue;
    if (proofType === 'recipient_confirmation') {
      Object.assign(payload, { recipientName, recipientContact, confirmed: proofConfirmed });
    }
    queueOrRun('proof', payload, async () => {
      if (['photo', 'signature'].includes(proofType)) {
        if (!proofFile) throw new Error('Missing proof');
        const uploaded = await uploadDeliveryProof(jobId, proofFile, proofType);
        if (!uploaded?.uploadId) throw new Error('Missing upload receipt');
        await updateDeliveryStatus(jobId, 'delivered', { proofType, uploadId: uploaded.uploadId });
      } else {
        await updateDeliveryStatus(jobId, 'delivered', payload);
      }
      setProofValue(''); setProofFile(null);
    });
  };

  const handleSyncNow = async () => {
    if (!executors) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await flushOutbox(window.localStorage, jobId, executors);
      refreshEntries();
      setNotice(t('delivery.offline.synced'));
      onChanged?.();
    } catch {
      setError(t('delivery.offline.syncFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = (id) => {
    retryEntry(window.localStorage, jobId, id);
    refreshEntries();
    handleSyncNow();
  };

  const handleDiscard = (id) => {
    discardEntry(window.localStorage, jobId, id);
    refreshEntries();
  };

  const items = checklistItems(job, stops, entries);
  const queued = entries.filter((entry) => entry.state === 'queued' || entry.state === 'syncing');
  const canPickup = job?.status === 'assigned';
  const canTransit = job?.status === 'picked_up';
  const canProof = job?.status === 'in_transit';
  const pendingStops = (stops || []).filter((stop) => stop.status !== 'completed' && !stop.completed_at);

  return (
    <section className="delivery-panel" aria-label={t('delivery.offline.title')}>
      <h2>{t('delivery.offline.title')}</h2>
      <p>{t('delivery.offline.subtitle')}</p>
      {error && <p className="delivery-alert delivery-alert--error" role="alert">{error}</p>}
      {notice && <p className="delivery-alert delivery-alert--success" role="status">{notice}</p>}

      <ol className="delivery-timeline">
        {items.map((item) => (
          <li key={item.key}>
            <span className="delivery-timeline__dot" />
            <div>
              <strong>
                {item.labelParams
                  ? t(item.labelKey, item.labelParams)
                  : t(item.labelKey)}
              </strong>
              {' · '}
              <span>{t(`delivery.offline.states.${item.state}`)}</span>
            </div>
          </li>
        ))}
      </ol>

      {canPickup && (
        <fieldset className="delivery-form-fields" disabled={busy}>
          <h3>{t('delivery.offline.pickupTitle')}</h3>
          <label className="delivery-field">{t('delivery.detail.pickupPieces')}
            <input className="delivery-input" type="number" min="1" max="9999" inputMode="numeric" value={pickupPieces} onChange={(event) => setPickupPieces(event.target.value)} />
          </label>
          {/* Group 9 partials Wave 2 Batch N (468, D-542): the same
            photos-or-no-photos statement as the detail-page form, so
            the driver is never asserting blind from this surface. */}
          {pickupPhotos.length ? (
            <div className="delivery-item-photos">
              <p>{t('delivery.detail.pickupConditionPhotos')}</p>
              <div className="delivery-item-photos__grid">
                {pickupPhotos.map((photo) => (
                  <img key={photo.id} src={photo.url} alt={t('delivery.detail.itemPhoto')} />
                ))}
              </div>
            </div>
          ) : <p>{t('delivery.detail.pickupConditionNoPhotos')}</p>}
          <label><input type="checkbox" checked={conditionAck} onChange={(event) => setConditionAck(event.target.checked)} data-track="ui.53919f0dd7.1" /> {pickupPhotos.length ? t('delivery.detail.pickupCondition') : t('delivery.detail.pickupConditionSelfChecked')}</label>
          <label className="delivery-field">{t('delivery.detail.pickupConditionNote')}
            <input className="delivery-input" value={conditionNote} onChange={(event) => setConditionNote(event.target.value)} maxLength={500} />
          </label>
          <button type="button" className="delivery-button delivery-button--primary" disabled={!conditionAck} onClick={handlePickup} data-track="ui.53919f0dd7.2">
            {t('delivery.offline.confirmPickup')}
          </button>
        </fieldset>
      )}

      {canTransit && (
        <button type="button" className="delivery-button delivery-button--primary" disabled={busy} onClick={handleInTransit} data-track="ui.53919f0dd7.3">
          {t('delivery.offline.markInTransit')}
        </button>
      )}

      {pendingStops.length > 0 && (
        <div>
          <h3>{t('delivery.offline.stopsTitle')}</h3>
          {pendingStops.map((stop) => (
            <p key={stop.id}>
              {stop.label || stop.address || stop.id}
              {' '}
              <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => handleCompleteStop(stop.id)} data-track="ui.53919f0dd7.4">
                {t('delivery.offline.completeStop')}
              </button>
            </p>
          ))}
        </div>
      )}

      {canProof && (
        <fieldset className="delivery-form-fields" disabled={busy}>
          <h3>{t('delivery.detail.submitProof')}</h3>
          <p>{t('delivery.detail.proofPreference', { type: t(`delivery.proofTypes.${job.proof_preference}`) })}</p>
          {job.proof_preference === 'pin' && (
            <label className="delivery-field">{t('delivery.detail.pin')}
              <input className="delivery-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={proofValue} onChange={(event) => setProofValue(event.target.value)} />
            </label>
          )}
          {job.proof_preference === 'recipient_confirmation' && (
            <>
              <label className="delivery-field">{t('delivery.detail.recipientName')}
                <input className="delivery-input" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={160} />
              </label>
              <label className="delivery-field">{t('delivery.ui.recipientContact')}
                <input className="delivery-input" value={recipientContact} onChange={(event) => setRecipientContact(event.target.value)} maxLength={160} />
              </label>
              <label><input type="checkbox" checked={proofConfirmed} onChange={(event) => setProofConfirmed(event.target.checked)} data-track="ui.53919f0dd7.5" /> {t('delivery.ui.recipientConfirmed')}</label>
            </>
          )}
          {['photo', 'signature'].includes(job.proof_preference) && (
            <label className="delivery-field">{t('delivery.detail.proofFile')}
              <input type="file" accept={job.proof_preference === 'signature' ? 'image/jpeg,image/png,image/webp,application/pdf' : 'image/jpeg,image/png,image/webp'} onChange={(event) => { const file = event.target.files?.[0]; setProofFile(file || null); }} />
              <small>{t('delivery.offline.proofFileHeld')}</small>
            </label>
          )}
          <button type="button" className="delivery-button delivery-button--primary" onClick={handleProof} data-track="ui.53919f0dd7.6">
            {t('delivery.detail.markDelivered')}
          </button>
        </fieldset>
      )}

      <fieldset className="delivery-form-fields" disabled={busy}>
        <h3>{t('delivery.detail.report')}</h3>
        <label className="delivery-field">{t('delivery.ui.issueType')}
          <select className="delivery-input" value={issueCode} onChange={(event) => setIssueCode(event.target.value)}>
            {ISSUE_CODES.map((code) => <option key={code} value={code}>{t(`delivery.ui.issueCodes.${code}`)}</option>)}
          </select>
        </label>
        <label className="delivery-field">{t('delivery.detail.issuePlaceholder')}
          <textarea className="delivery-input" value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} maxLength={2000} />
        </label>
        <button type="button" className="delivery-button delivery-button--secondary" disabled={!issueDescription.trim()} onClick={handleIssue} data-track="ui.53919f0dd7.7">
          {t('delivery.detail.report')}
        </button>
      </fieldset>

      <div>
        <h3>{t('delivery.offline.queueTitle')}</h3>
        {queued.length > 0 && <p role="status">{t('delivery.offline.queuedCount', { count: queued.length })}</p>}
        {entries.length === 0 && <p>{t('delivery.offline.queueEmpty')}</p>}
        {entries.length > 0 && (
          <ul>
            {entries.map((entry) => (
              <li key={entry.id}>
                <span>{t(`delivery.offline.actionKinds.${entry.kind}`)}</span>
                {' · '}
                <span>{t(`delivery.offline.states.${entryStateKey(entry.state)}`)}</span>
                {entry.needsFile && <span>{` · ${t('delivery.offline.needsFile')}`}</span>}
                {entry.error && !entry.needsFile && <span>{` · ${entry.error}`}</span>}
                {entry.state === 'failed' && (
                  <>
                    {' '}
                    <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => handleRetry(entry.id)} data-track="ui.53919f0dd7.8">
                      {t('delivery.offline.retry')}
                    </button>
                    {' '}
                    <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => handleDiscard(entry.id)} data-track="ui.53919f0dd7.9">
                      {t('delivery.offline.discard')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {queued.length > 0 && (
          <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={handleSyncNow} data-track="ui.53919f0dd7.10">
            {t('delivery.offline.syncNow')}
          </button>
        )}
      </div>
    </section>
  );
}
