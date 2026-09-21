import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Download, Loader2, ScrollText, Hand } from 'lucide-react';
import api from '../../../api/axios';
import { canCustomerRespondToAgreement, parseAgreementMarker } from './messengerAgreements.js';
import './MessengerDock.css';

export default function AgreementCard({
  markerText,
  initialAgreement = null,
  agreementId: idProp,
  token: tokenProp,
  isProvider = false,
  isAuthenticated = false,
  guestVerified = false,
  guestAuthHeaders = null,
  onStatusChange,
  onRequestVerify,
  compact = false,
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => (markerText ? parseAgreementMarker(markerText) : null), [markerText]);
  const agreementId = idProp || parsed?.id || initialAgreement?.id;
  const token = tokenProp || parsed?.token || initialAgreement?.token || '';

  const [agreement, setAgreement] = useState(initialAgreement);
  const [loading, setLoading] = useState(!initialAgreement && Boolean(agreementId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!agreementId) return;
    setLoading(true);
    setError(null);
    try {
      const params = token ? { token } : {};
      const { data } = await api.get(`/chat/agreements/${agreementId}`, {
        params,
        headers: guestAuthHeaders || undefined,
      });
      setAgreement(data);
    } catch {
      if (parsed) {
        setAgreement({
          id: parsed.id,
          token: parsed.token,
          status: parsed.status,
          version: parsed.version,
          title: parsed.title,
        });
      } else {
        setError(t('helperProfile.messenger.agreementLoadError'));
      }
    } finally {
      setLoading(false);
    }
  }, [agreementId, token, guestAuthHeaders, parsed, t]);

  useEffect(() => {
    if (!initialAgreement) load();
  }, [initialAgreement, load]);

  const status = agreement?.status || parsed?.status || 'shared';
  const title = agreement?.title || parsed?.title || t('helperProfile.messenger.agreementFallbackTitle');
  const respondGate = canCustomerRespondToAgreement(agreement || { status }, {
    isAuthenticated,
    guestVerified,
  });

  const respond = async (action) => {
    if (!agreementId) return;
    if (!isAuthenticated && !guestVerified) {
      onRequestVerify?.();
      return;
    }
    if (!respondGate.ok && action !== 'acknowledge') return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(
        `/chat/agreements/${agreementId}/respond`,
        {
          action,
          token: token || agreement?.token,
          reason: action === 'decline' ? reason || undefined : undefined,
        },
        { headers: guestAuthHeaders || undefined },
      );
      setAgreement(data.agreement || { ...agreement, status: action === 'accept' ? 'accepted' : action });
      onStatusChange?.(data.agreement?.status, data);
    } catch {
      setError(t('helperProfile.messenger.agreementRespondError'));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!agreementId) return;
    try {
      const { data } = await api.get(`/chat/agreements/${agreementId}/download`, {
        params: token ? { token } : {},
        headers: guestAuthHeaders || undefined,
      });
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('helperProfile.messenger.agreementDownloadError'));
    }
  };

  if (loading) {
    return (
      <div className="messenger-artifact-card agreement-card compact">
        <Loader2 className="spin" size={16} /> {t('helperProfile.messenger.agreementLoading')}
      </div>
    );
  }

  return (
    <div
      className={`messenger-artifact-card agreement-card ${compact ? 'compact' : ''}`}
      role="region"
      aria-label={t('helperProfile.messenger.agreementCardAria', { title })}
    >
      <div className="artifact-card-head">
        <ScrollText size={14} aria-hidden />
        <span className="artifact-eyebrow">{t('helperProfile.messenger.agreementEyebrow')}</span>
        <span className={`artifact-status status-${status}`}>
          {t(`helperProfile.messenger.agreementStatus.${status}`, { defaultValue: status })}
        </span>
      </div>
      <div className="artifact-card-body">
        <div className="artifact-title">{title}</div>
        <div className="artifact-meta">
          {t('helperProfile.messenger.agreementVersion', { version: agreement?.version || parsed?.version || 1 })}
        </div>
        {agreement?.required_before_schedule ? (
          <div className="artifact-meta warn">{t('helperProfile.messenger.agreementRequiredBeforeSchedule')}</div>
        ) : null}
        {agreement?.body_text ? (
          <pre className="artifact-terms">{agreement.body_text.slice(0, compact ? 280 : 2000)}</pre>
        ) : null}
      </div>
      <div className="artifact-card-actions">
        {agreement?.has_attachment ? (
          <button type="button" className="artifact-btn" onClick={download}>
            <Download size={14} aria-hidden /> {t('helperProfile.messenger.agreementDownload')}
          </button>
        ) : null}
        {!isProvider && respondGate.ok ? (
          <>
            {status === 'shared' ? (
              <button type="button" className="artifact-btn" disabled={busy} onClick={() => respond('acknowledge')}>
                <Hand size={14} aria-hidden /> {t('helperProfile.messenger.agreementAcknowledge')}
              </button>
            ) : null}
            <button type="button" className="artifact-btn primary" disabled={busy} onClick={() => respond('accept')}>
              <Check size={14} aria-hidden /> {t('helperProfile.messenger.agreementAccept')}
            </button>
            <button type="button" className="artifact-btn danger" disabled={busy} onClick={() => respond('decline')}>
              <X size={14} aria-hidden /> {t('helperProfile.messenger.agreementDecline')}
            </button>
            <input
              className="artifact-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('helperProfile.messenger.agreementDeclineReason')}
            />
          </>
        ) : null}
        {!isProvider && respondGate.reason === 'verify_required' ? (
          <button type="button" className="artifact-btn" onClick={() => onRequestVerify?.()}>
            {t('helperProfile.messenger.agreementVerifyToRespond')}
          </button>
        ) : null}
      </div>
      {error ? <p className="artifact-error">{error}</p> : null}
    </div>
  );
}
