import { useEffect, useCallback, useState } from 'react';

/**
 * Guest Session Management Hook
 * Handles temporary guest session tracking for unauthenticated users
 * Stores session ID in localStorage for persistence across sessions
 */

export function useGuestSession() {
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize guest session on mount
  useEffect(() => {
    const initializeSession = async () => {
      try {
        // Check if guest session exists in localStorage
        let sessionId = localStorage.getItem('guest_session_id');

        // If not, create a new one
        if (!sessionId) {
          sessionId = crypto.randomUUID();
          localStorage.setItem('guest_session_id', sessionId);
        }

        setGuestSessionId(sessionId);

        // Optional: Register session on backend (for analytics/tracking)
        try {
          await fetch('/api/guests/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
        } catch {
          // Silently fail if backend not available (offline-first)
        }
      } finally {
        setIsLoading(false);
      }
    };

    initializeSession();
  }, []);

  /**
   * Track guest action (view, message attempt, booking attempt)
   * Stored in sessionStorage for session lifetime + optional backend sync
   */
  const trackAction = useCallback(
    (action: string, data: Record<string, any> = {}) => {
      if (!guestSessionId) return;

      // Store locally
      const actions = JSON.parse(sessionStorage.getItem('guest_actions') || '[]');
      actions.push({
        action,
        data,
        timestamp: new Date().toISOString(),
      });
      sessionStorage.setItem('guest_actions', JSON.stringify(actions));

      // Optional: sync to backend
      try {
        fetch(`/api/guests/sessions/${guestSessionId}/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data }),
        }).catch(() => {}); // Silently fail if offline
      } catch {}
    },
    [guestSessionId],
  );

  /**
   * Verify guest email/phone for gated contact
   * Sends OTP and stores verification state
   */
  const verifyContact = useCallback(
    async (email: string, phone?: string) => {
      if (!guestSessionId) throw new Error('No guest session');

      const response = await fetch(`/api/guests/sessions/${guestSessionId}/contact-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone }),
      });

      if (!response.ok) {
        throw new Error('Verification failed');
      }

      const result = await response.json();
      return result; // { verificationId, expiresAt }
    },
    [guestSessionId],
  );

  /**
   * Submit OTP code for verification
   */
  const submitOtp = useCallback(
    async (verificationId: string, code: string) => {
      if (!guestSessionId) throw new Error('No guest session');

      const response = await fetch(
        `/api/guests/sessions/${guestSessionId}/contact-verify/${verificationId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        },
      );

      if (!response.ok) {
        throw new Error('OTP verification failed');
      }

      const result = await response.json();
      // Store verified email in session
      if (result.verified) {
        sessionStorage.setItem('guest_verified_email', result.email);
      }
      return result; // { verified: true, email }
    },
    [guestSessionId],
  );

  /**
   * Get verified guest email (if any)
   */
  const getVerifiedEmail = useCallback(() => {
    return sessionStorage.getItem('guest_verified_email');
  }, []);

  /**
   * Check if guest has verified their contact
   */
  const isVerified = useCallback(() => {
    return !!sessionStorage.getItem('guest_verified_email');
  }, []);

  /**
   * Clear guest session and verification
   */
  const clearSession = useCallback(() => {
    sessionStorage.removeItem('guest_actions');
    sessionStorage.removeItem('guest_verified_email');
    localStorage.removeItem('guest_session_id');
    setGuestSessionId(null);
  }, []);

  return {
    guestSessionId,
    isLoading,
    trackAction,
    verifyContact,
    submitOtp,
    getVerifiedEmail,
    isVerified,
    clearSession,
  };
}
