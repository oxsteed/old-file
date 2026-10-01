// client/src/components/registration/DiditPanel.tsx
// Step 2: Mandatory Didit identity verification.

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ChevronLeft, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

interface Props {
  onVerified: () => void;
  onBack: () => void;
}

type DiditStatus = 'idle' | 'launching' | 'pending' | 'verified' | 'failed' | 'duplicate' | 'unavailable';

export default function DiditPanel({ onVerified, onBack }: Props) {
  const [status, setStatus] = useState<DiditStatus>('idle');
  const [duplicateHint, setDuplicateHint] = useState('');
  const [skipping, setSkipping] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { refreshUser } = useAuth();
  const { t } = useTranslation();

  const STEPS = [
    { title: t('didit.step1Title'), hint: t('didit.step1Hint') },
    { title: t('didit.step2Title'), hint: t('didit.step2Hint') },
    { title: t('didit.step3Title'), hint: t('didit.step3Hint') },
  ];

  useEffect(() => {
    const checkReturning = async () => {
      try {
        const { data } = await api.get('/didit/status');
        if (data.status === 'verified') {
          setStatus('verified');
          toast.success(t('didit.verifiedToast'));
          try { await refreshUser(); } catch { /* non-blocking */ }
          setTimeout(() => onVerified(), 1000);
        } else if (data.status === 'failed') {
          setStatus('failed');
        } else if (data?.status === 'duplicate') {
          setStatus('duplicate');
          setDuplicateHint(data?.existing_email_hint ?? '');
        } else if (data.status === 'pending' && data.hasSession) {
          setStatus('pending');
          startPolling();
        }
      } catch {
        // No session yet, show idle
      }
    };
    checkReturning();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleStart = async () => {
    setStatus('launching');
    try {
      const { data } = await api.post('/didit/session');
      if (data.verificationUrl) {
        window.location.href = data.verificationUrl;
      } else {
        setStatus('pending');
        startPolling();
      }
    } catch (err: any) {
      if (err.response?.data?.error === 'verification_unavailable') {
        setStatus('unavailable');
      } else {
        setStatus('failed');
        toast.error(err.response?.data?.error || t('didit.errorStart'));
      }
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    try {
      await api.post('/didit/skip');
      await refreshUser();
      toast.success(t('didit.skipToast'));
      onVerified();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('didit.errorSkip'));
      setSkipping(false);
    }
  };

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/didit/status');
        if (data.status === 'verified') {
          clearInterval(pollRef.current!);
          setStatus('verified');
          toast.success(t('didit.verifiedToast'));
          try { await refreshUser(); } catch { /* non-blocking */ }
          setTimeout(() => onVerified(), 1000);
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current!);
          setStatus('failed');
        } else if (data?.status === 'duplicate') {
          clearInterval(pollRef.current!);
          setStatus('duplicate');
          setDuplicateHint(data?.existing_email_hint ?? '');
        }
      } catch {
        // Network hiccup - keep polling
      }
    }, 3000);

    setTimeout(() => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        if (status === 'pending') setStatus('failed');
      }
    }, 5 * 60 * 1000);
  };

  const handleRetry = () => {
    setStatus('idle');
    setDuplicateHint('');
  };

  return (
    <div className="flex flex-col items-center gap-5 px-6 py-8 text-center">
      {status === 'duplicate' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle size={32} className="text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-white">{t('didit.duplicateTitle')}</h2>
          <p className="text-sm text-gray-400 max-w-[32ch] leading-relaxed">
            {t('didit.duplicateSubtitle')}
            {duplicateHint && <> (<span className="text-white font-medium">{duplicateHint}</span>)</>}.
          </p>
          <p className="text-xs text-gray-500 leading-relaxed max-w-[36ch]">
            {t('didit.duplicateNote')}
          </p>
          <Link
            to="/login"
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors text-center"
          >
            {t('didit.signIn')}
          </Link>
          <button type="button" onClick={handleRetry} className="text-xs text-gray-400 hover:text-white transition-colors underline">
            {t('didit.differentId')}
          </button>
        </div>
      )}

      {status === 'failed' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertTriangle size={32} className="text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-white">{t('didit.failedTitle')}</h2>
          <p className="text-sm text-gray-400 max-w-[32ch] leading-relaxed">
            {t('didit.failedSubtitle')}
          </p>
          <button type="button" onClick={handleRetry} className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors">
            {t('didit.tryAgain')}
          </button>
        </div>
      )}

      {status === 'verified' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-500">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white">{t('didit.verifiedTitle')}</h2>
          <p className="text-sm text-gray-400">{t('didit.verifiedSubtitle')}</p>
        </div>
      )}

      {status === 'unavailable' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-gray-700/40 flex items-center justify-center">
            <Shield size={32} className="text-gray-400" />
          </div>
          <h2 className="text-xl font-bold text-white">{t('didit.unavailableTitle')}</h2>
          <p className="text-sm text-gray-400 max-w-[34ch] leading-relaxed">
            {t('didit.unavailableSubtitle')}
          </p>
          <p className="text-xs text-gray-500 max-w-[36ch] leading-relaxed">
            {t('didit.unavailableNote')}
          </p>
          <button
            type="button"
            onClick={handleSkip}
            disabled={skipping}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {skipping ? t('didit.continuing') : t('didit.continueButton')}
          </button>
          <button type="button" onClick={onBack} className="text-xs text-gray-400 hover:text-white transition-colors underline">
            {t('didit.goBack')}
          </button>
        </div>
      )}

      {status === 'pending' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-orange-500 animate-spin">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-.08-8.93" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white">{t('didit.pendingTitle')}</h2>
          <p className="text-sm text-gray-400 max-w-[30ch]">
            {t('didit.pendingSubtitle')}
          </p>
        </div>
      )}

      {(status === 'idle' || status === 'launching') && (
        <>
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M12 6v6l4 2" />
                <path d="M8 12a4 4 0 1 0 8 0" />
              </svg>
            </div>
            <div className="absolute -bottom-1 -end-1 w-[26px] h-[26px] rounded-full bg-gray-900 border-2 border-gray-900 flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-orange-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
          <span className="text-xl font-bold text-white tracking-tight">didit</span>
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-white" style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}>
              {t('didit.title')}
            </h2>
            <p className="text-xs text-gray-400 mt-2 max-w-[34ch] mx-auto leading-relaxed">
              {t('didit.subtitle')}
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full text-start">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700/60">
                <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-px">
                  <span className="text-xs font-semibold text-white">{s.title}</span>
                  <span className="text-xs text-gray-400">{s.hint}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-500 text-start max-w-[36ch]">
            <Shield size={14} className="text-orange-500 shrink-0 mt-0.5" />
            <span>{t('didit.notice')}</span>
          </div>
          <div className="w-full flex flex-col gap-3">
            <button
              type="button"
              onClick={handleStart}
              disabled={status === 'launching'}
              className="w-full flex items-center justify-center gap-2 py-3 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'launching' ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-.08-8.93" />
                  </svg>
                  {t('didit.launching')}
                </>
              ) : (
                <>
                  <Shield size={16} />
                  {t('didit.startButton')}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={skipping}
              className="w-full py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-gray-600 rounded-lg hover:bg-gray-800/60 transition-colors disabled:opacity-50"
            >
              {skipping ? t('didit.continuing') : t('didit.verifyLater')}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded px-3 py-2 transition-colors mx-auto"
            >
              <ChevronLeft size={14} />
              {t('didit.backToProfile')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
