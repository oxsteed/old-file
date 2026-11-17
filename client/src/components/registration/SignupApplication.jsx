import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import RequestEditor from './AccessRequestEditor';
import { accessAPI } from '../../api/access';
import { isCurrentAuthEpoch } from '../../api/authSessionEpoch';
import { notifyAccessChanged } from '../../hooks/useAccessProjection';

const EDITABLE = ['draft', 'needs_information'];

async function loadApplication({ step, accountId, epoch }) {
  if (step.requestId) {
    const [{ policy }, detail] = await Promise.all([
      accessAPI.getPolicy(step.capability), accessAPI.getRequest(step.requestId),
    ]);
    return { policy, ...detail };
  }
  const { policy } = await accessAPI.getPolicy(step.capability);

  if (!isCurrentAuthEpoch(epoch)) return null;
  try {
    const result = await accessAPI.createRequest({
      capability: step.capability,
      subject: { type: policy.subjectTypes[0] },
      source: 'signup',
      answers: {},
      returnTo: step.returnTo,
    }, `signup-${accountId}`);
    return { policy, request: result.request };
  } catch (error) {
    const data = error?.response?.data;
    if (data?.code === 'request_already_open' && data.requestId) {
      return { policy, ...(await accessAPI.getRequest(data.requestId)) };
    }
    throw error;
  }
}

export default function SignupApplication({ continuation, serviceArea }) {
  const { t } = useTranslation('common');
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef(null);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    let cancelled = false;
    const active = () => !cancelled && isCurrentAuthEpoch(continuation.epoch);
    loadApplication(continuation)
      .then((data) => { if (active()) setResult(data); })
      .catch(() => { if (active()) setResult({ error: true }); });
    return () => { cancelled = true; };
  }, [continuation, attempt]);

  const retry = () => { setResult(null); setAttempt((count) => count + 1); };
  const request = result?.request;
  const editable = request && EDITABLE.includes(request.status);
  return (
    <section className="signup-verification" aria-labelledby="signup-application-title" data-track-private>
      <h3 ref={headingRef} id="signup-application-title" tabIndex={-1}>{t('signupUpgrade.accountReady')}</h3>
      {!result && <p role="status">{t('progressiveAccess.loading')}</p>}
      {result?.error && <>
        <p role="alert">{t('signupUpgrade.applicationLoadFailed')}</p>
        <button type="button" className="signup-secondary" onClick={retry} data-track="ui.access.signup.retry">{t('progressiveAccess.actions.retry')}</button>
      </>}
      {editable && <>
        <p>{t('signupUpgrade.applicationNext')}</p>
        <RequestEditor
          key={`${request.id}:${request.version}`}
          t={t}
          request={request}
          policy={result.policy}
          defaultAnswers={{ serviceArea }}
          onChanged={(updated) => {
            if (!updated) return retry();
            setResult((previous) => ({ ...previous, request: updated }));
            notifyAccessChanged();
          }}
        />
      </>}
      {request && !editable && <p role="status">{t('signupUpgrade.applicationStatus', {
        status: t(`progressiveAccess.status.${request.status}`),
      })}</p>}
      <Link className="signup-text-button" to="/dashboard" data-track="ui.access.signup.continue">
        {t(request && !editable ? 'signupUpgrade.continueToAccount' : 'signupUpgrade.finishLater')}
      </Link>
    </section>
  );
}
