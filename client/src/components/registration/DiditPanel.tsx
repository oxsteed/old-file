// client/src/components/registration/DiditPanel.tsx
// Step 2: Mandatory Didit identity verification.
// - Creates a session via /api/didit/session
// - Launches Didit SDK
// - Polls /api/didit/status until verified, failed, or duplicate
// - Duplicate = "You already have an account" → links to login

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ChevronLeft, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';

interface Props {
  onVerified: () => void;   // called when Didit confirms identity is unique
  onBack: () => void;
}

const STEPS = [
  { title: 'Select your ID type', hint: 'Passport, driver\'s license, or national ID' },
  { title: 'Capture your document', hint: 'Use your camera — front and back if needed' },
  { title: 'Take a selfie', hint: 'Live face match against your document photo' },
];

type DiditStatus = 'idle' | 'launching' | 'pending' | 'verified' | 'failed' | 'duplicate';

export default function DiditPanel({ onVerified, onBack }: Props) {
  const [status, setStatus] = useState<DiditStatus>('idle');
  const [duplicateHint, setDuplicateHint] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Clean up polling on unmount ────────────────────────
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Launch Didit ───────────────────────────────────────
  const handleStart = async () => {
    setStatus('launching');
    try {
      // 1. Create a verification session on our backend
      const { data } = await api.post('/didit/session');
      const sessionId = data.sessionId;

      // 2. Launch Didit SDK
      // TODO: Replace with actual Didit SDK call:
      // await didit.init({
      //   sessionToken: sessionId,
      //   onComplete: () => startPolling(),
      //   onError: (err) => { setStatus('failed'); toast.error('Verification failed'); },
      // });

      // Placeholder: simulate SDK launch, then start polling
      setTimeout(() => {
        setStatus('pending');
        startPolling();
      }, 2000);

    } catch (err: any) {
      setStatus('failed');
      toast.error(err.response?.data?.error || 'Could not start verification');
    }
  };

  // ── Poll for verification result ───────────────────────
  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/didit/status');

        if (data.status === 'verified') {
          clearInterval(pollRef.current!);
          setStatus('verified');
          toast.success('Identity verified!');
          setTimeout(() => onVerified(), 1000);
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current!);
          setStatus('failed');
        } else if (data.status === 'duplicate') {
          clearInterval(pollRef.current!);
          setStatus('duplicate');
          setDuplicateHint(data.existing_email_hint || '');
        }
        // 'pending' → keep polling
      } catch {
        // Network hiccup — keep polling
      }
    }, 3000);

    // Stop polling after 5 minutes
    setTimeout(() => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        if (status === 'pending') setStatus('failed');
      }
    }, 5 * 60 * 1000);
  };

  // ── Retry after failure ────────────────────────────────
  const handleRetry = () => {
    setStatus('idle');
    setDuplicateHint('');
  };

  return (
    <div className="flex flex-col items-center gap-5 px-6 py-8 text-center">

      {/* ── DUPLICATE IDENTITY SCREEN ────────────────── */}
      {status === 'duplicate' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle size={32} className="text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-white">Account Already Exists</h2>
          <p className="text-sm text-gray-400 max-w-[32ch] leading-relaxed">
            This identity is already linked to an existing OxSteed account
            {duplicateHint && <> (<span className="text-white font-medium">{duplicateHint}</span>)</>}.
          </p>
          <p className="text-xs text-gray-500 leading-relaxed max-w-[36ch]">
            Each person can only have one account. If you run multiple businesses,
            you can add them all from your dashboard after signing in.
          </p>
          <Link
            to="/login"
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors text-center"
          >
            Sign In to Your Account
          </Link>
          <button
            type="button"
            onClick={handleRetry}
            className="text-xs text-gray-400 hover:text-white transition-colors underline"
          >
            Try with a different ID
          </button>
        </div>
      )}

      {/* ── FAILED SCREEN ────────────────────────────── */}
      {status === 'failed' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertTriangle size={32} className="text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-white">Verification Failed</h2>
          <p className="text-sm text-gray-400 max-w-[32ch] leading-relaxed">
            We couldn't verify your identity. Please try again with a clear photo of your ID and good lighting.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* ── VERIFIED SCREEN ──────────────────────────── */}
      {status === 'verified' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-500">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white">Identity Verified</h2>
          <p className="text-sm text-gray-400">Redirecting to your dashboard…</p>
        </div>
      )}

      {/* ── PENDING (waiting for Didit callback) ─────── */}
      {status === 'pending' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-orange-500 animate-spin">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-.08-8.93" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white">Verifying…</h2>
          <p className="text-sm text-gray-400 max-w-[30ch]">
            Waiting for Didit to confirm your identity. This usually takes a few seconds.
          </p>
        </div>
      )}

      {/* ── DEFAULT / LAUNCHING SCREEN ───────────────── */}
      {(status === 'idle' || status === 'launching') && (
        <>
          {/* Icon */}
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M12 6v6l4 2" />
                <path d="M8 12a4 4 0 1 0 8 0" />
              </svg>
            </div>
            <div className="absolute -bottom-1 -right-1 w-[26px] h-[26px] rounded-full bg-gray-900 border-2 border-gray-900 flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-orange-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>

          {/* Didit wordmark */}
          <span className="text-xl font-bold text-white tracking-tight">didit</span>

          {/* Copy */}
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-white" style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}>
              Verify your identity
            </h2>
            <p className="text-xs text-gray-400 mt-2 max-w-[34ch] mx-auto leading-relaxed">
              Quick, secure identity check powered by Didit. Takes about 2 minutes. Required to keep OxSteed safe for everyone.
            </p>
          </div>

          {/* Instruction steps */}
          <div className="flex flex-col gap-3 w-full text-left">
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

          {/* One-account policy notice */}
          <div className="flex items-start gap-2 text-xs text-gray-500 text-left max-w-[36ch]">
            <Shield size={14} className="text-orange-500 shrink-0 mt-0.5" />
            <span>
              Each person can have only one account. If you run multiple businesses, you can add them from your dashboard.
            </span>
          </div>

          {/* Action */}
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
                  Launching Didit…
                </>
              ) : (
                <>
                  <Shield size={16} />
                  Start Verification
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded px-3 py-2 transition-colors mx-auto"
            >
              <ChevronLeft size={14} />
              Back to profile
            </button>
          </div>
        </>
      )}
    </div>
  );
}
