// Admin → Access applications (progressive access WP-012 client).
// Reviewer queue and decision panel over /api/admin/access-requests. The
// server decides authority on every call (scoped queue, 404 resource
// hiding, self-review ban, version + evidence checks); this page only
// renders what it is given and sends the version it rendered.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { accessAPI } from '../../api/access';

const NS = 'common';
const STATUSES = ['submitted', 'in_review', 'needs_information', 'approved', 'declined', 'withdrawn'];
const REASONS = ['review_complete', 'service_area_required', 'service_categories_required', 'identity_verification_required',
  'business_details_required', 'ownership_not_verified', 'duplicate_request', 'not_eligible_in_market', 'policy_not_met', 'other_contact_support'];
const errorCode = (err) => err?.response?.data?.code || null;

function formatAnswer(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean).join(', ');
  return value === undefined || value === null ? '' : String(value);
}

function DecisionPanel({ t, data, onDecided }) {
  const req = data.request;
  const [reasonCode, setReasonCode] = useState('review_complete');
  const [note, setNote] = useState('');
  const [infoRequest, setInfoRequest] = useState('');
  const [audienceConfirmed, setAudienceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const keys = useRef({});
  const keyFor = (action) => {
    const k = `${action}:${req.version}`;
    if (!keys.current[k]) keys.current[k] = crypto.randomUUID();
    return keys.current[k];
  };

  const decide = async (decision) => {
    setBusy(true);
    try {
      await accessAPI.reviewDecide(req.id, {
        decision,
        expectedVersion: req.version,
        evidenceRevision: req.evidenceRevision,
        reasonCode: decision === 'approve' || decision === 'decline' || decision === 'request_information' ? reasonCode : undefined,
        note: note.trim() || undefined,
        informationRequest: decision === 'request_information' ? infoRequest.trim() : undefined,
      }, keyFor(decision));
      toast.success(t('progressiveAccess.admin.decided', { ns: NS }));
      onDecided();
    } catch (err) {
      const code = errorCode(err);
      const key = code === 'self_review_forbidden' ? 'admin.errors.selfReview'
        : code === 'decision_not_permitted' ? 'admin.errors.notPermitted'
          : code === 'request_version_conflict' ? 'errors.versionConflict'
            : code === 'policy_changed' ? 'admin.policyChanged'
              : code === 'validation_failed' ? 'errors.validation'
                : 'errors.generic';
      toast.error(t(`progressiveAccess.${key}`, { ns: NS }));
      if (code === 'request_version_conflict' || code === 'invalid_transition') onDecided();
    } finally {
      setBusy(false);
    }
  };

  const actions = req.reviewerActions || [];
  const needsInvestorConfirmation = req.capability === 'investor.reporting' && actions.includes('approve');
  const policyStale = data.currentPolicyVersion && req.policyVersion !== data.currentPolicyVersion;
  const cls = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t(`progressiveAccess.capabilities.${req.capability}`, { ns: NS, defaultValue: req.capability })}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t(`progressiveAccess.status.${req.status}`, { ns: NS, defaultValue: req.status })}
        </p>
      </header>

      <section aria-labelledby="ar-applicant">
        <h3 id="ar-applicant" className="text-sm font-semibold text-gray-900 dark:text-white">{t('progressiveAccess.admin.applicant', { ns: NS })}</h3>
        <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-gray-500">{t('progressiveAccess.admin.applicant', { ns: NS })}</dt>
          <dd className="text-gray-900 dark:text-gray-100">{req.applicant.displayName || req.applicant.id}</dd>
          <dt className="text-gray-500">{t('progressiveAccess.admin.emailVerified', { ns: NS })}</dt>
          <dd>{t(req.applicant.emailVerified ? 'progressiveAccess.admin.yes' : 'progressiveAccess.admin.no', { ns: NS })}</dd>
          <dt className="text-gray-500">{t('progressiveAccess.admin.identityVerified', { ns: NS })}</dt>
          <dd>{t(req.applicant.identityVerified ? 'progressiveAccess.admin.yes' : 'progressiveAccess.admin.no', { ns: NS })}</dd>
          <dt className="text-gray-500">{t('progressiveAccess.admin.currentAccess', { ns: NS })}</dt>
          <dd>{(data.currentAccess || []).map((c) => t(`progressiveAccess.capabilities.${c}`, { ns: NS, defaultValue: c })).join(', ')}</dd>
        </dl>
      </section>

      <section aria-labelledby="ar-answers">
        <h3 id="ar-answers" className="text-sm font-semibold text-gray-900 dark:text-white">{t('progressiveAccess.admin.answers', { ns: NS })}</h3>
        <dl className="mt-1 space-y-1 text-sm">
          {(data.policy?.form?.fields || []).map((f) => (
            <div key={f.name} className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
              <dt className="text-gray-500">{t(`progressiveAccess.fields.${f.name}`, { ns: NS, defaultValue: f.name })}</dt>
              <dd className="break-words text-gray-900 dark:text-gray-100 sm:col-span-2" dir="auto">{formatAnswer(req.answers?.[f.name])}</dd>
            </div>
          ))}
        </dl>
        {policyStale && <p className="mt-2 text-xs text-amber-700" role="note">{t('progressiveAccess.admin.policyChanged', { ns: NS })}</p>}
      </section>

      <section aria-labelledby="ar-history">
        <h3 id="ar-history" className="text-sm font-semibold text-gray-900 dark:text-white">{t('progressiveAccess.admin.history', { ns: NS })}</h3>
        <ol className="mt-1 space-y-1 text-xs text-gray-600 dark:text-gray-300">
          {(data.history || []).map((h) => (
            <li key={h.id}>
              {new Date(h.created_at).toLocaleString()} · {h.action} · {t(`progressiveAccess.status.${h.to_status}`, { ns: NS, defaultValue: h.to_status })}
              {h.internal_note ? <span dir="auto"> · {h.internal_note}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {actions.length > 0 && (
        <section aria-labelledby="ar-decide" className="space-y-3">
          <h3 id="ar-decide" className="sr-only">{t('progressiveAccess.admin.title', { ns: NS })}</h3>
          {(actions.includes('approve') || actions.includes('decline')) && (
            <label className="block text-sm text-gray-700 dark:text-gray-200">
              {t('progressiveAccess.admin.reasonCode', { ns: NS })}
              <select className={cls} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                {REASONS.map((r) => <option key={r} value={r}>{t(`progressiveAccess.reasons.${r}`, { ns: NS })}</option>)}
              </select>
            </label>
          )}
          {actions.includes('request_information') && (
            <label className="block text-sm text-gray-700 dark:text-gray-200">
              {t('progressiveAccess.admin.informationRequest', { ns: NS })}
              <textarea className={cls} rows={2} maxLength={1000} value={infoRequest} onChange={(e) => setInfoRequest(e.target.value)} />
            </label>
          )}
          {needsInvestorConfirmation && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
              <input type="checkbox" checked={audienceConfirmed} onChange={(e) => setAudienceConfirmed(e.target.checked)} className="mt-0.5" />
              <span>{t('progressiveAccess.admin.investorConfirm', { ns: NS })}</span>
            </label>
          )}
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            {t('progressiveAccess.admin.note', { ns: NS })}
            <textarea className={cls} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a}
                type="button"
                disabled={busy || (a === 'request_information' && !infoRequest.trim()) || (a === 'approve' && needsInvestorConfirmation && !audienceConfirmed)}
                onClick={() => decide(a)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${a === 'approve' ? 'bg-emerald-600 text-white' : a === 'decline' ? 'bg-red-600 text-white' : 'border border-gray-300 text-gray-900 dark:border-gray-600 dark:text-gray-100'}`}
                data-track={`ui.admin.access_requests.${a}`}
              >
                {t(`progressiveAccess.admin.actions.${a}`, { ns: NS })}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function AccessRequestsQueue() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('submitted');
  const [capability, setCapability] = useState('');
  const [items, setItems] = useState([]);
  const [caps, setCaps] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async (after = null) => {
    setLoading(true);
    setFailed(false);
    try {
      const d = await accessAPI.reviewQueue({ status, capability: capability || undefined, after: after || undefined, limit: 25 });
      setItems((prev) => (after ? [...prev, ...(d.requests || [])] : d.requests || []));
      setCursor(d.nextCursor || null);
      setCaps(d.capabilities || []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [status, capability]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (id) => {
    setSelected(id);
    setDetail(null);
    try { setDetail(await accessAPI.reviewGet(id)); } catch { setSelected(null); toast.error(t('progressiveAccess.errors.generic', { ns: NS })); }
  }, [t]);

  const capOptions = useMemo(() => caps, [caps]);
  const selectCls = 'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('progressiveAccess.admin.title', { ns: NS })}</h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{t('progressiveAccess.admin.subtitle', { ns: NS })}</p>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="text-sm text-gray-700 dark:text-gray-200">
          {t('progressiveAccess.admin.status', { ns: NS })}
          <select className={`${selectCls} block`} value={status} onChange={(e) => { setStatus(e.target.value); setSelected(null); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`progressiveAccess.status.${s}`, { ns: NS })}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-200">
          {t('progressiveAccess.admin.capability', { ns: NS })}
          <select className={`${selectCls} block`} value={capability} onChange={(e) => { setCapability(e.target.value); setSelected(null); }}>
            <option value="">{t('progressiveAccess.admin.all', { ns: NS })}</option>
            {capOptions.map((c) => <option key={c} value={c}>{t(`progressiveAccess.capabilities.${c}`, { ns: NS, defaultValue: c })}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          {failed ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{t('progressiveAccess.loadFailed', { ns: NS })}</p>
              <button type="button" onClick={() => load()} className="rounded-lg border border-gray-300 px-3 py-1.5" data-track="ui.admin.access_requests.retry">{t('progressiveAccess.actions.retry', { ns: NS })}</button>
            </div>
          ) : items.length === 0 && !loading ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('progressiveAccess.admin.empty', { ns: NS })}</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700" aria-busy={loading}>
              {items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openDetail(r.id)}
                    aria-current={selected === r.id ? 'true' : undefined}
                    className={`w-full px-3 py-2 text-start text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${selected === r.id ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                    data-track="ui.admin.access_requests.open"
                  >
                    <span className="block font-medium text-gray-900 dark:text-white">{r.applicant?.displayName || r.applicant?.id}</span>
                    <span className="block text-xs text-gray-600 dark:text-gray-300">
                      {t(`progressiveAccess.capabilities.${r.capability}`, { ns: NS, defaultValue: r.capability })}
                      {r.submittedAt ? ` · ${new Date(r.submittedAt).toLocaleDateString()}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cursor && (
            <button type="button" disabled={loading} onClick={() => load(cursor)} className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50" data-track="ui.admin.access_requests.more">
              {t('progressiveAccess.admin.loadMore', { ns: NS })}
            </button>
          )}
        </div>
        <div className="lg:col-span-3">
          {!selected ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('progressiveAccess.admin.select', { ns: NS })}</p>
          ) : !detail ? (
            <p className="text-sm text-gray-600" role="status">{t('progressiveAccess.loading', { ns: NS })}</p>
          ) : (
            <DecisionPanel key={`${detail.request.id}:${detail.request.version}`} t={t} data={detail} onDecided={() => { load(); openDetail(detail.request.id); }} />
          )}
        </div>
      </div>
    </div>
  );
}
