// Settings → Applications (progressive account access, WP-010..WP-014 client).
// Shows what the account can already do, its applications with status and
// next action, and the capabilities it may apply for. The server is the
// authority; this page only renders /api/me/access* responses.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BadgeCheck, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import RequestEditor from '../../components/registration/AccessRequestEditor';
import Footer from '../../components/Footer';
import { accessAPI } from '../../api/access';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../../api/authSessionEpoch';
import { useAuth } from '../../context/AuthContext';
import { notifyAccessChanged, ACCESS_CHANGED_EVENT } from '../../hooks/useAccessProjection';
import { LAUNCH_VISIBILITY } from '../../utils/launchScope';

const NS = 'common';
const OPEN = ['draft', 'submitted', 'in_review', 'needs_information'];
const EDITABLE = ['draft', 'needs_information'];
const DOMAIN_SIGNUP_RESUME_PATHS = new Set(['/vortex', '/credit/apply']);

// AC-010: an approved application names where the capability is used day to
// day, so the applicant can act on the grant immediately.
const USE_NOW_ROUTES = Object.freeze({
  'helper.offer_services': '/jobs',
  'business.own': '/business-hub',
  'restaurant.own': '/business-hub',
  'tool_owner.list_equipment': '/tool-rentals',
  'consultant.accept_paying_clients': '/consulting/contractor-dashboard',
  'logistics.ship': '/logistics',
  'investor.reporting': '/investor/dashboard',
  'franchise.operate': '/franchise/territory',
});

const errorCode = (err) => err?.response?.data?.code || null;

function capabilityLabel(t, capability) {
  return t(`progressiveAccess.capabilities.${capability}`, { ns: NS, defaultValue: capability });
}

const formatDate = (value, language) => (value
  ? new Intl.DateTimeFormat(language || 'en', { dateStyle: 'medium' }).format(new Date(value))
  : null);

// AC-010: the server already returns every decision recorded on the request;
// render it as an accessible timeline so the applicant sees what happened and
// when without contacting support.
function RequestHistory({ t, language, history }) {
  if (!history?.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('progressiveAccess.historyTitle', { ns: NS })}</p>
      <ol className="mt-2 space-y-1.5">
        {history.map((h, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <time dateTime={h.at} className="text-muted">{formatDate(h.at, language)}</time>
            <span className="font-medium text-content">
              {t(`progressiveAccess.historyAction.${h.action}`, { ns: NS, defaultValue: h.action })}
            </span>
            {h.publicReasonCode && (
              <span className="text-muted">{t(`progressiveAccess.reasons.${h.publicReasonCode}`, { ns: NS, defaultValue: '' })}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatusBadge({ t, status }) {
  const tone = status === 'approved' ? 'bg-emerald-500/15 text-emerald-600'
    : status === 'declined' ? 'bg-red-500/15 text-red-600'
      : status === 'needs_information' ? 'bg-amber-500/15 text-amber-700'
        : 'bg-primary/15 text-primary';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`progressiveAccess.status.${status}`, { ns: NS, defaultValue: status })}
    </span>
  );
}

export default function ApplicationsPage() {
  const { user } = useAuth();
  const epoch = currentAuthEpoch();
  return user?.id == null ? null : <AccountApplications key={`${user.id}:${epoch}`} accountId={user.id} epoch={epoch} />;
}

function AccountApplications({ accountId, epoch }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const [params, setParams] = useSearchParams();
  const [access, setAccess] = useState(null);
  const [requests, setRequests] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [openId, setOpenId] = useState(params.get('request'));
  const [detail, setDetail] = useState(null);
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const returnFocusRef = useRef(null);

  // WP-016: an approval or revocation while this page is open is picked up
  // on focus / access-changed, re-rendered in place (silent reload: no
  // loading swap, so focus never jumps) and announced politely.
  const versionRef = useRef(null);
  const heldBeforeRef = useRef(null);
  const openIdRef = useRef(null);
  openIdRef.current = openId;
  const [announce, setAnnounce] = useState('');
  const load = useCallback(async (silent = false) => {
    if (!isCurrentAuthEpoch(epoch)) return;
    if (!silent) setLoading(true);
    setLoadError(false);
    try {
      const [a, r, p] = await Promise.all([accessAPI.getAccess(accountId), accessAPI.listRequests({ limit: 50 }), accessAPI.listPolicies()]);
      if (!isCurrentAuthEpoch(epoch)) return;
      const heldNow = a.access?.personal || [];
      const version = a.access ? JSON.stringify([heldNow, (a.access.organizations || []).map((o) => [o.id, o.role])]) : null;
      if (versionRef.current !== null && version !== versionRef.current) {
        // Name the capability when the change is an approval so the applicant
        // knows what they can now do, not just that "something" changed.
        const newlyApproved = heldNow.filter((c) => !heldBeforeRef.current?.has(c));
        setAnnounce(newlyApproved.length > 0
          ? t('progressiveAccess.accessApproved', { ns: NS, capability: capabilityLabel(t, newlyApproved[0]) })
          : t('progressiveAccess.accessUpdated', { ns: NS }));
        notifyAccessChanged();
      }
      heldBeforeRef.current = new Set(heldNow);
      versionRef.current = version;
      setAccess(a.access);
      setRequests(r.requests || []);
      setPolicies(p.policies || []);
      setUnavailable(false);
      // AC-021: refresh the open request during silent reloads so a reviewer
      // change reaches the editor without remounting it (unsaved answers
      // survive; the editor flags the version change instead of failing).
      if (silent && openIdRef.current) {
        const d = await accessAPI.getRequest(openIdRef.current).catch(() => null);
        if (d && isCurrentAuthEpoch(epoch)) setDetail(d);
      }
    } catch (err) {
      if (!isCurrentAuthEpoch(epoch)) return;
      if (errorCode(err) === 'feature_disabled') setUnavailable(true);
      else setLoadError(true);
    } finally {
      if (isCurrentAuthEpoch(epoch)) setLoading(false);
    }
  }, [accountId, epoch, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => { load(true); };
    window.addEventListener('focus', refresh);
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(ACCESS_CHANGED_EVENT, refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    let cancelled = false;
    accessAPI.getRequest(openId)
      .then((d) => { if (!cancelled && isCurrentAuthEpoch(epoch)) setDetail(d); })
      .catch(() => { if (!cancelled && isCurrentAuthEpoch(epoch)) { setDetail(null); setOpenId(null); } });
    return () => { cancelled = true; };
  }, [openId, epoch]);

  const openRequest = (id) => {
    if (!isCurrentAuthEpoch(epoch)) return;
    setOpenId(id);
    const next = new URLSearchParams(params);
    if (id) next.set('request', id); else next.delete('request');
    setParams(next, { replace: true });
  };

  const closeEditor = () => {
    openRequest(null);
    // Keep keyboard users at the action that opened the inline editor instead
    // of sending focus to the page root after the editor unmounts.
    window.requestAnimationFrame(() => returnFocusRef.current?.focus?.());
  };

  const held = new Set(access?.personal || []);
  const openCaps = new Set(requests.filter((r) => OPEN.includes(r.status)).map((r) => r.capability));
  const applyable = policies.filter((p) => p.applicantMayRequest && !held.has(p.capability) && !openCaps.has(p.capability));
  const policyFor = (capability) => policies.find((p) => p.capability === capability);
  const signupResume = access?.signupResume;
  const resumeCapability = signupResume?.requestId == null ? signupResume?.capability : null;
  const showDomainResume = held.has('customer') && signupResume && !signupResume.capability
    && DOMAIN_SIGNUP_RESUME_PATHS.has(signupResume.statusPath);

  const startApplication = async (capability) => {
    setBusy(true);
    try {
      const type = policyFor(capability)?.subjectTypes.includes('business_proposal') ? 'business_proposal' : 'self';
      const resumingSignup = capability === resumeCapability;
      const result = await accessAPI.createRequest({
        capability,
        subject: { type },
        source: resumingSignup ? 'signup' : 'settings',
        answers: {},
        ...(resumingSignup ? { returnTo: access.signupResume.returnTo } : {}),
      }, resumingSignup ? `signup-${accountId}` : undefined);
      await load();
      openRequest(result.request.id);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'request_already_open') {
        toast(t('progressiveAccess.errors.alreadyOpen', { ns: NS }));
        await load();
      } else if (code === 'access_already_granted') {
        toast(t('progressiveAccess.errors.alreadyGranted', { ns: NS }));
        await load();
      } else {
        toast.error(t('progressiveAccess.errors.generic', { ns: NS }));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return;
    setBusy(true);
    try {
      await accessAPI.transition(withdrawTarget.id, 'withdraw', { expectedVersion: withdrawTarget.version });
      toast.success(t('progressiveAccess.toast.withdraw', { ns: NS }));
      setWithdrawTarget(null);
      openRequest(null);
      await load();
    } catch (err) {
      toast.error(errorCode(err) === 'request_version_conflict'
        ? t('progressiveAccess.errors.versionConflict', { ns: NS })
        : t('progressiveAccess.errors.generic', { ns: NS }));
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Silent reload: a non-silent load swaps the whole list for a loading
  // indicator and unmounts the open editor, which would wipe the typed
  // answers on exactly the version-conflict path AC-021 must preserve.
  const onChanged = async () => { await load(true); notifyAccessChanged(); if (openId) setDetail(await accessAPI.getRequest(openId).catch(() => null)); };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-content">
      <Navbar />
      <main className="flex-1 px-4 py-10">
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        <div className="mx-auto max-w-2xl">
          <Link to="/settings" className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-content" data-track="ui.access.applications.back">
            <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden="true" /> {t('progressiveAccess.backToSettings', { ns: NS })}
          </Link>

          <div className="rounded-2xl border border-border bg-surface p-5 sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <FileText className="shrink-0 text-primary" size={28} aria-hidden="true" />
              <div>
                <h1 className="text-2xl font-bold text-content">{t('progressiveAccess.pageTitle', { ns: NS })}</h1>
                <p className="text-sm text-muted">{t('progressiveAccess.pageSubtitle', { ns: NS })}</p>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-muted" role="status">{t('progressiveAccess.loading', { ns: NS })}</p>
            ) : unavailable ? (
              <p className="text-sm text-muted" role="status">{t('progressiveAccess.unavailable', { ns: NS })}</p>
            ) : loadError ? (
              <div className="space-y-3">
                <p className="text-sm text-muted" role="alert">{t('progressiveAccess.loadFailed', { ns: NS })}</p>
                <button type="button" onClick={load} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-content hover:bg-surface-2" data-track="ui.access.applications.retry">
                  {t('progressiveAccess.actions.retry', { ns: NS })}
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {showDomainResume && (
                  <section aria-labelledby="access-signup-resume-title" className="rounded-xl border border-border p-4">
                    <h2 id="access-signup-resume-title" className="text-lg font-semibold text-content">
                      {t('signupUpgrade.intentConfirmed', { ns: NS })}
                    </h2>
                    <p className="mt-1 text-sm text-muted">{t(`signupUpgrade.admission.${signupResume.kind}`, { ns: NS })}</p>
                    <Link to={signupResume.statusPath} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline">
                      {t('signupUpgrade.viewNextStep', { ns: NS })}
                    </Link>
                  </section>
                )}
                <section aria-labelledby="access-held-title">
                  <h2 id="access-held-title" className="mb-2 text-lg font-semibold text-content">{t('progressiveAccess.heldTitle', { ns: NS })}</h2>
                  <ul className="flex flex-wrap gap-2">
                    {[...held].map((c) => (
                      <li key={c} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-sm text-content">
                        <BadgeCheck size={14} className="text-primary" aria-hidden="true" /> {capabilityLabel(t, c)}
                      </li>
                    ))}
                  </ul>
                  {(access?.organizations || []).length > 0 && (
                    <p className="mt-2 text-xs text-muted">{t('progressiveAccess.organizations', { ns: NS, count: access.organizations.length })}</p>
                  )}
                </section>

                <section aria-labelledby="access-requests-title">
                  <h2 id="access-requests-title" className="mb-2 text-lg font-semibold text-content">{t('progressiveAccess.requestsTitle', { ns: NS })}</h2>
                  {requests.length === 0 ? (
                    <p className="text-sm text-muted">{t('progressiveAccess.noRequests', { ns: NS })}</p>
                  ) : (
                    <ul className="space-y-3">
                      {requests.map((r) => (
                        <li key={r.id} className="rounded-xl bg-surface-2/80 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-content">{capabilityLabel(t, r.capability)}</p>
                              {r.publicReasonCode && ['approved', 'declined', 'needs_information'].includes(r.status) && (
                                <p className="text-xs text-muted">{t(`progressiveAccess.reasons.${r.publicReasonCode}`, { ns: NS, defaultValue: '' })}</p>
                              )}
                              {r.submittedAt && (
                                <p className="text-xs text-muted">{t('progressiveAccess.submittedOn', { ns: NS, date: formatDate(r.submittedAt, language) })}</p>
                              )}
                              {r.subjectDisplay?.name && (
                                <p className="max-w-full truncate text-xs text-muted" title={r.subjectDisplay.name}>
                                  {r.subjectDisplay.name}
                                </p>
                              )}
                            </div>
                            <StatusBadge t={t} status={r.status} />
                          </div>
                          {r.businessLaunch && (
                            <p className="mt-2 text-xs text-muted">
                              {t('businessLaunchStatus.businessLaunchRequest')} · {t(`businessLaunchStatus.status_${r.businessLaunch.status}`)}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-3">
                            {r.status === 'approved' && USE_NOW_ROUTES[r.capability] && (
                              <Link
                                to={USE_NOW_ROUTES[r.capability]}
                                className="text-sm font-medium text-primary hover:underline"
                                data-track="ui.access.applications.use_now"
                              >
                                {t(`progressiveAccess.useNow.${r.capability}`, { ns: NS, defaultValue: '' })}
                              </Link>
                            )}
                            {LAUNCH_VISIBILITY.consulting && r.subjectDisplay?.kind === 'new_business'
                              && OPEN.includes(r.status) && !r.businessLaunch && (
                                <Link
                                  to="/consulting-intake"
                                  state={{ accessRequestId: r.id, accessAccountId: String(accountId) }}
                                  className="text-sm font-medium text-primary hover:underline"
                                  data-track="ui.access.applications.business-launch"
                                >
                                  {t('network.businessLaunch.title')}
                                </Link>
                            )}
                            {!(openId === r.id && EDITABLE.includes(r.status)) && (
                              <button
                                type="button"
                                onClick={(event) => { returnFocusRef.current = event.currentTarget; openRequest(openId === r.id ? null : r.id); }}
                                className="text-sm font-medium text-primary hover:underline"
                                data-track="ui.access.applications.view_status"
                              >
                                {t(openId === r.id ? 'progressiveAccess.actions.close' : 'progressiveAccess.viewStatus', { ns: NS })}
                              </button>
                            )}
                            {EDITABLE.includes(r.status) && (
                              <button
                                type="button"
                                onClick={(event) => { returnFocusRef.current = event.currentTarget; openRequest(r.id); }}
                                className="text-sm font-medium text-primary hover:underline"
                                data-track="ui.access.applications.continue"
                              >
                                {t('progressiveAccess.actions.continue', { ns: NS })}
                              </button>
                            )}
                            {OPEN.includes(r.status) && (
                              <Link
                                to={`/support/escalation?from=access-request&accessRequestId=${encodeURIComponent(String(r.id))}`}
                                className="text-sm font-medium text-primary hover:underline"
                                data-track="ui.access.applications.support"
                              >
                                {t('supportWidget.contactHuman', { defaultValue: 'Contact human support' })}
                              </Link>
                            )}
                            {r.availableActions?.includes('withdraw') && (
                              <button type="button" onClick={() => setWithdrawTarget(r)} className="text-sm hover:underline" style={{ color: 'var(--color-error)' }} data-track="ui.access.applications.withdraw">
                                {t('progressiveAccess.actions.withdraw', { ns: NS })}
                              </button>
                            )}
                            {['declined', 'withdrawn'].includes(r.status) && policyFor(r.capability)?.applicantMayRequest
                              && !held.has(r.capability) && !openCaps.has(r.capability) && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => startApplication(r.capability)}
                                className="text-sm font-medium text-primary hover:underline"
                                data-track="ui.access.applications.apply_again"
                              >
                                {t('progressiveAccess.actions.applyAgain', { ns: NS })}
                              </button>
                            )}
                          </div>
                          {openId === r.id && detail?.request && (
                            <>
                              <RequestHistory t={t} language={language} history={detail.history} />
                              {EDITABLE.includes(detail.request.status) && (
                                <RequestEditor
                                  key={detail.request.id}
                                  t={t}
                                  request={detail.request}
                                  policy={policyFor(detail.request.capability)}
                                  onChanged={onChanged}
                                  onClose={closeEditor}
                                />
                              )}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {applyable.length > 0 && (
                  <section aria-labelledby="access-apply-title">
                    <h2 id="access-apply-title" className="mb-2 text-lg font-semibold text-content">{t('progressiveAccess.applyTitle', { ns: NS })}</h2>
                    <ul className="space-y-2">
                      {applyable.map((p) => (
                        <li key={p.capability} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-content">{capabilityLabel(t, p.capability)}</p>
                            <p className="text-xs text-muted">{t(`progressiveAccess.capabilityHelp.${p.capability}`, { ns: NS, defaultValue: '' })}</p>
                          </div>
                          <button type="button" disabled={busy} onClick={() => startApplication(p.capability)} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-solid hover:opacity-90 disabled:opacity-50" data-track="ui.access.applications.apply">
                            {t(p.capability === resumeCapability ? 'progressiveAccess.actions.continue' : 'progressiveAccess.actions.apply', { ns: NS })}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />

      {withdrawTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => !busy && setWithdrawTarget(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="access-withdraw-title" className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-content shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="access-withdraw-title" className="text-lg font-semibold text-content">{t('progressiveAccess.withdrawTitle', { ns: NS })}</h2>
            <p className="mt-2 text-sm text-muted">{t('progressiveAccess.withdrawConfirm', { ns: NS, capability: capabilityLabel(t, withdrawTarget.capability) })}</p>
            <div className="mt-5 flex gap-3">
              <button type="button" disabled={busy} onClick={() => setWithdrawTarget(null)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-content hover:bg-surface-2 disabled:opacity-50" data-track="ui.access.applications.withdraw_cancel">
                {t('progressiveAccess.actions.cancel', { ns: NS })}
              </button>
              <button type="button" disabled={busy} onClick={confirmWithdraw} className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-on-solid hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--color-error)' }} data-track="ui.access.applications.withdraw_confirm">
                {t('progressiveAccess.actions.confirmWithdraw', { ns: NS })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
