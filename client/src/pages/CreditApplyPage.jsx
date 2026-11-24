import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Clock, Loader2, XCircle } from 'lucide-react';
import { getCsrfToken } from '../api/csrfToken';
import api from '../api/axios';

const SURFACE_OPTIONS = ['food_online', 'food_pos', 'chat', 'jobs', 'direct', 'qr', 'subscriptions', 'delivery', 'consulting', 'invoices', 'products', 'rentals'];

// G-25: participant status labels, keyed by the server status. The keys
// exist in the credit catalog; the lookup is dynamic so the static-key
// gate skips it, but every value resolves.
const STATUS_KEY = {
  pending: 'creditApplyStatusPending',
  active: 'creditApplyStatusActive',
  suspended: 'creditApplyStatusSuspended',
  revoked: 'creditApplyStatusRevoked',
};

// Group 13 (655, D-359): activation checklist. The server derives each
// step's state from the participant record (`GET /participants/me`
// returns `activationChecklist` per participant); the fallback below
// mirrors the same rules for a payload without the field, and the
// no-application checklist is the same three steps before a record
// exists. Read-only: it never changes activation state.
const CHECKLIST_STEP_KEY = {
  application: 'creditApplyChecklistStepApplication',
  identity: 'creditApplyChecklistStepIdentity',
  approval: 'creditApplyChecklistStepApproval',
};
const CHECKLIST_STATE_KEY = {
  done: 'creditApplyChecklistDone',
  pending: 'creditApplyChecklistPending',
  blocked: 'creditApplyChecklistBlocked',
};
const CHECKLIST_DETAIL_KEY = {
  submitted: 'creditApplyChecklistDetailSubmitted',
  not_submitted: 'creditApplyChecklistDetailNotSubmitted',
  verified: 'creditApplyChecklistDetailVerified',
  awaiting_verification: 'creditApplyChecklistDetailAwaitingVerification',
  approved: 'creditApplyChecklistDetailApproved',
  approval_requested: 'creditApplyChecklistDetailApprovalRequested',
  awaiting_review: 'creditApplyChecklistDetailAwaitingReview',
  needs_verification: 'creditApplyChecklistDetailNeedsVerification',
  needs_application: 'creditApplyChecklistDetailNeedsApplication',
  closed: 'creditApplyChecklistDetailClosed',
};
const CHECKLIST_STATE_ICON = {
  done: CheckCircle2,
  pending: Clock,
  blocked: XCircle,
};
const CHECKLIST_STATE_CLASS = {
  done: 'text-emerald-400',
  pending: 'text-amber-400',
  blocked: 'text-red-400',
};
const EMPTY_CHECKLIST = [
  { id: 'application', state: 'pending', detail: 'not_submitted' },
  { id: 'identity', state: 'pending', detail: 'awaiting_verification' },
  { id: 'approval', state: 'blocked', detail: 'needs_application' },
];

function fallbackChecklist(participant) {
  const status = participant?.status || 'pending';
  const diditVerified = participant?.diditVerified === true;
  const closed = status === 'suspended' || status === 'revoked';
  return [
    { id: 'application', state: 'done', detail: 'submitted' },
    closed
      ? { id: 'identity', state: 'blocked', detail: 'closed' }
      : diditVerified
        ? { id: 'identity', state: 'done', detail: 'verified' }
        : { id: 'identity', state: 'pending', detail: 'awaiting_verification' },
    status === 'active'
      ? { id: 'approval', state: 'done', detail: 'approved' }
      : closed
        ? { id: 'approval', state: 'blocked', detail: 'closed' }
        : !diditVerified
          ? { id: 'approval', state: 'blocked', detail: 'needs_verification' }
          : { id: 'approval', state: 'pending', detail: 'awaiting_review' },
  ];
}

function ActivationChecklist({ participant }) {
  const { t } = useTranslation('credit');
  const steps = !participant
    ? EMPTY_CHECKLIST
    : Array.isArray(participant.activationChecklist) && participant.activationChecklist.length === 3
      ? participant.activationChecklist
      : fallbackChecklist(participant);
  return (
    <div>
      <p className="text-sm font-semibold text-white">{t('creditApplyChecklistTitle')}</p>
      <p className="mt-1 text-sm text-gray-400">{t('creditApplyChecklistIntro')}</p>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => {
          const Icon = CHECKLIST_STATE_ICON[step.state] || Clock;
          const stateClass = CHECKLIST_STATE_CLASS[step.state] || 'text-gray-400';
          return (
            <li key={step.id} className="flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-950/40 px-3 py-3">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${stateClass}`} />
              <div>
                <p className="text-sm font-semibold text-white">
                  {t(CHECKLIST_STEP_KEY[step.id] || 'creditApplyChecklistStepApplication')}
                  {' · '}
                  <span className={stateClass}>{t(CHECKLIST_STATE_KEY[step.state] || 'creditApplyChecklistPending')}</span>
                </p>
                <p className="mt-0.5 text-sm text-gray-400">{t(CHECKLIST_DETAIL_KEY[step.detail] || 'creditApplyChecklistDetailAwaitingReview')}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Credit Everywhere Phase 1 — self-serve participant apply.
 * A business owner or helper applies for their business/profile to accept
 * OxSteed Credit. The application lands in the admin pending queue;
 * activation needs a second admin plus Didit verification.
 */
export default function CreditApplyPage() {
  const { t } = useTranslation('credit');
  const [participantType, setParticipantType] = useState('business');
  const [businessId, setBusinessId] = useState('');
  const [notes, setNotes] = useState('');
  const [surfaces, setSurfaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [participants, setParticipants] = useState([]);

  // G-25: show the caller's real application status instead of a static
  // "submitted". A pending or active participant has no form to re-file.
  useEffect(() => {
    api.get('/oxsteed-credit/participants/me')
      .then((res) => setParticipants(res.data?.participants || []))
      .catch(() => {});
  }, []);

  const hasOpenApplication = participants.some((p) => p.status === 'pending' || p.status === 'active');

  const toggleSurface = (surface) => {
    setSurfaces((current) =>
      current.includes(surface) ? current.filter((s) => s !== surface) : [...current, surface]
    );
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Pentest fix: this raw fetch bypasses the shared axios instance,
      // so it must attach the CSRF token itself for cookie sessions.
      const csrfToken = getCsrfToken();
      const response = await fetch('/api/oxsteed-credit/participants/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        credentials: 'include',
        body: JSON.stringify({
          participantType,
          businessId: businessId || undefined,
          notes: notes || undefined,
          allowedSurfaces: surfaces,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || data?.message || t('creditApplyFailed'));
      }
      setDone(true);
      api.get('/oxsteed-credit/participants/me')
        .then((res) => setParticipants(res.data?.participants || []))
        .catch(() => {});
    } catch (err) {
      setError(err.message || t('creditApplyFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('creditApplyEyebrow')}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('creditApplyTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">{t('creditApplyDescription')}</p>
        <p className="mt-2 text-sm leading-6 text-gray-400">{t('creditApplyCustomerNote')}</p>
      </header>
      {participants.length > 0 && (
        <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-4">
          <p className="text-sm font-semibold text-white">{t('creditApplyMyStatus')}</p>
          <ul className="space-y-1">
            {participants.map((participant) => (
              <li key={participant.participantId} className="text-sm text-gray-300">
                {t(participant.participantType === 'helper' ? 'adminParticipantTypeHelper' : 'adminParticipantTypeBusiness')}
                {' · '}
                {t(STATUS_KEY[participant.status] || 'creditApplyStatusPending')}
              </li>
            ))}
          </ul>
          {participants.map((participant) => (
            <div key={participant.participantId} className="border-t border-gray-800 pt-3">
              <ActivationChecklist participant={participant} />
            </div>
          ))}
        </div>
      )}
      {participants.length === 0 && (
        <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-4">
          <ActivationChecklist participant={null} />
        </div>
      )}
      {done ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-4 text-sm text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">{t('creditApplySubmitted')}</p>
            <p className="mt-1 text-emerald-400/80">{t('creditApplySubmittedDetail')}</p>
          </div>
        </div>
      ) : hasOpenApplication ? null : (
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-gray-800 bg-gray-950/40 p-5">
          {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
          <div>
            <span className="mb-2 block text-xs font-semibold text-gray-400">{t('creditApplyType')}</span>
            <div className="flex gap-3">
              {['business', 'helper'].map((type) => (
                <label key={type} className="flex items-center gap-2 rounded-xl border border-gray-700 px-4 py-3 text-sm text-gray-200 cursor-pointer hover:border-orange-400">
                  <input type="radio" name="participantType" value={type} checked={participantType === type} onChange={() => setParticipantType(type)} className="accent-orange-500" />
                  {t(type === 'business' ? 'adminParticipantTypeBusiness' : 'adminParticipantTypeHelper')}
                </label>
              ))}
            </div>
          </div>
          {participantType === 'business' && (
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-400">{t('creditApplyBusinessId')}</span>
              <input required value={businessId} onChange={(event) => setBusinessId(event.target.value)} inputMode="numeric" placeholder={t('adminBusinessIdPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
            </label>
          )}
          <div>
            <span className="mb-2 block text-xs font-semibold text-gray-400">{t('creditApplySurfaces')}</span>
            <div className="flex flex-wrap gap-2">
              {SURFACE_OPTIONS.map((surface) => (
                <button key={surface} type="button" onClick={() => toggleSurface(surface)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${surfaces.includes(surface) ? 'border-orange-400 bg-orange-500/15 text-orange-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                  {surface}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-400">{t('creditApplyNotes')}</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder={t('creditApplyNotesPlaceholder')} className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
          </label>
          <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('creditApplySubmit')}
          </button>
        </form>
      )}
    </main>
  );
}
