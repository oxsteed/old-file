import { useState } from 'react';
import { useGuestSession } from '../hooks/useGuestSession';
import '../styles/GuestContactGate.css';

interface GuestContactGateProps {
  isOpen: boolean;
  onClose: () => void;
  helperId: string;
  helperName: string;
  onVerified: (email: string) => void;
  action: 'message' | 'book'; // Which action triggered the gate
}

type GateState = 'idle' | 'sending' | 'otp_sent' | 'verifying' | 'verified' | 'error';

export default function GuestContactGate({
  isOpen,
  onClose,
  helperId,
  helperName,
  onVerified,
  action,
}: GuestContactGateProps) {
  const { verifyContact, submitOtp, trackAction } = useGuestSession();

  const [state, setState] = useState<GateState>('idle');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setState('sending');
    setError('');

    try {
      trackAction(`contact_gate_${action}_email_sent`, { helperId, email });
      const result = await verifyContact(email, phone || undefined);
      setVerificationId(result.verificationId);
      setState('otp_sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
      setState('error');
    }
  };

  const handleSubmitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim() || !verificationId) return;

    setState('verifying');
    setError('');

    try {
      trackAction(`contact_gate_${action}_otp_verified`, { helperId });
      const result = await submitOtp(verificationId, otp);
      setState('verified');
      setTimeout(() => {
        onVerified(email);
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code');
      setState('error');
    }
  };

  const actionLabel = action === 'message' ? 'message' : 'book';
  const actionVerb = action === 'message' ? 'Message' : 'Book';

  return (
    <>
      {/* Backdrop */}
      <div className="gcg-backdrop" onClick={onClose} />

      {/* Modal */}
      <div className="gcg-modal" role="alertdialog" aria-modal="true" aria-labelledby="gcg-title">
        {/* Close button */}
        <button
          className="gcg-close"
          onClick={onClose}
          aria-label="Close"
          type="button"
        >
          ✕
        </button>

        <div className="gcg-content">
          {/* Icon */}
          <div className="gcg-icon">
            {state === 'verified' ? '✓' : '📧'}
          </div>

          {/* Title & description */}
          <h2 id="gcg-title" className="gcg-title">
            {state === 'verified'
              ? 'All set!'
              : `Connect with ${helperName}`}
          </h2>

          {state === 'verified' ? (
            <>
              <p className="gcg-description">
                Thank you! Your email has been verified. {helperName} will be notified and
                can reach out to you soon.
              </p>
            </>
          ) : (
            <>
              <p className="gcg-description">
                We'll send you a verification code to confirm your contact information before
                you can {actionLabel} this helper. This helps us keep spam out.
              </p>

              {/* Email/Phone Form */}
              {!verificationId ? (
                <form onSubmit={handleSendCode} className="gcg-form">
                  <div className="gcg-field">
                    <label htmlFor="gcg-email" className="gcg-label">
                      Email <span className="gcg-required">*</span>
                    </label>
                    <input
                      id="gcg-email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={state === 'sending'}
                      className="gcg-input"
                      autoFocus
                    />
                  </div>

                  <div className="gcg-field">
                    <label htmlFor="gcg-phone" className="gcg-label">
                      Phone <span className="gcg-optional">(optional)</span>
                    </label>
                    <input
                      id="gcg-phone"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={state === 'sending'}
                      className="gcg-input"
                    />
                  </div>

                  {error && state === 'error' && (
                    <div className="gcg-error">{error}</div>
                  )}

                  <button
                    type="submit"
                    disabled={!email.trim() || state === 'sending'}
                    className="gcg-btn gcg-btn-primary"
                  >
                    {state === 'sending' ? 'Sending code...' : 'Send verification code'}
                  </button>
                </form>
              ) : (
                /* OTP Form */
                <form onSubmit={handleSubmitOtp} className="gcg-form">
                  <div className="gcg-field">
                    <label htmlFor="gcg-otp" className="gcg-label">
                      Verification Code
                    </label>
                    <input
                      id="gcg-otp"
                      type="text"
                      placeholder="000000"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      maxLength={6}
                      disabled={state === 'verifying'}
                      className="gcg-input gcg-input-code"
                      autoFocus
                      inputMode="numeric"
                    />
                  </div>

                  {error && state === 'error' && (
                    <div className="gcg-error">{error}</div>
                  )}

                  <p className="gcg-code-hint">
                    Check your email for the 6-digit code
                  </p>

                  <button
                    type="submit"
                    disabled={otp.length !== 6 || state === 'verifying'}
                    className="gcg-btn gcg-btn-primary"
                  >
                    {state === 'verifying' ? 'Verifying...' : 'Verify code'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setState('idle'); setOtp(''); setVerificationId(null); setError(''); }}
                    disabled={state === 'verifying'}
                    className="gcg-btn gcg-btn-secondary"
                  >
                    Back
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {/* Permissions note */}
        <p className="gcg-note">
          Your email and phone are never shared. See our{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="gcg-link">
            privacy policy
          </a>
          .
        </p>
      </div>
    </>
  );
}
