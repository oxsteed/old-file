import { setNavigationAccount } from '../utils/navigationMemory';
import { setDraftAccount } from '../utils/jobDraftStore';
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { authAPI, clearStoredSession } from '../api/auth';
import api from '../api/axios';
import { setDisplayDeviceStaffSession } from '../api/food';
import { useLanguage } from './LanguageContext';
import { isTransientRefreshFailure } from '../api/authRefreshPolicy';
import { advanceAuthEpoch, currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { broadcastAuthSession, subscribeAuthSession } from '../api/authSessionSync';

export const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

function normalizeUserPayload(data) {
  if (!data) return null;
  return data.user ?? data;
}

function isOnboardingComplete(user) {
  return (
    user?.onboarding_step === 'active' ||
    user?.onboarding_completed === true ||
    user?.onboarding_status === 'onboarding_complete'
  );
}

function getMembershipTier(user) {
  return user?.membership_tier || user?.membershipTier || user?.plan || null;
}

export function AuthProvider({ children }) {
  const sessionEpoch = useRef(0);
  const identity = useRef(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [sessionRecovering, setSessionRecovering] = useState(false);
  const { syncLanguageFromServer } = useLanguage();
  const captureEpoch = useCallback(() => ({ local: sessionEpoch.current, transport: currentAuthEpoch() }), []);
  const isCurrentEpoch = useCallback(epoch => epoch.local === sessionEpoch.current && isCurrentAuthEpoch(epoch.transport), []);

  const persistUser = useCallback((nextUser, { broadcast = true } = {}) => {
    const nextId = nextUser?.id == null ? null : String(nextUser.id);
    const identityChanged = nextId !== identity.current;
    if (identityChanged) {
      sessionEpoch.current++;
      advanceAuthEpoch();
    }
    identity.current = nextId;
    setDraftAccount(nextId);
    setNavigationAccount(nextId);
    setUser(nextUser || null);
    setSessionRecovering(false);
    if (broadcast && identityChanged && nextId) {
      broadcastAuthSession({ type: 'session-established', accountId: nextId, reason: 'account-hydrated' });
    }
    return nextUser || null;
  }, []);

  const clearAuthState = useCallback(({ broadcast = false, reason = 'session-cleared' } = {}) => {
    const hadIdentity = identity.current != null;
    sessionEpoch.current++;
    advanceAuthEpoch();
    identity.current = null;
    setDraftAccount(null);
    setNavigationAccount(null);
    setUser(null);
    setSessionRecovering(false);
    if (broadcast && hadIdentity) broadcastAuthSession({ type: 'session-cleared', reason });
  }, []);

  // Kitchen displays authorize with the pairing token only when no staff
  // user session is active; keep the food API's device-auth helper in sync.
  useEffect(() => {
    setDisplayDeviceStaffSession(Boolean(user));
  }, [user]);

  // The axios interceptor clears storage on a dead session; mirror that into
  // React state so the login page stops bouncing back to the dashboard.
  useEffect(() => {
    const onSessionExpired = () => clearAuthState();
    window.addEventListener('oxsteed:session-expired', onSessionExpired);
    return () => window.removeEventListener('oxsteed:session-expired', onSessionExpired);
  }, [clearAuthState]);

  const fetchMe = useCallback(async ({ broadcast = true } = {}) => {
    const epoch = captureEpoch();
    const res = await api.get('/auth/me', { withCredentials: true, timeout: 10000 });
    if (!isCurrentEpoch(epoch)) return null;
    const fullUser = normalizeUserPayload(res.data);
    syncLanguageFromServer?.(fullUser?.preferred_language);
    persistUser(fullUser, { broadcast });
    return fullUser;
  }, [persistUser, syncLanguageFromServer, captureEpoch, isCurrentEpoch]);

  const handleVerificationFailure = useCallback((error, epoch) => {
    // An older request must not clear or recover a newer login/logout.
    if (!isCurrentEpoch(epoch)) return;
    if (!isTransientRefreshFailure(error)) {
      clearStoredSession({ reason: 'verification-failed' });
      clearAuthState();
    }
    else if (identity.current === null) setSessionRecovering(true);
  }, [clearAuthState, isCurrentEpoch]);

  const handleExternalSession = useCallback(async (event) => {
    if (event.type === 'session-cleared') {
      clearStoredSession({ broadcast: false, reason: 'external-session-cleared' });
      clearAuthState();
      return;
    }

    // A login, account switch, or role handoff in another tab invalidates all
    // in-memory private views before re-verification. The cookie is shared by
    // tabs, but the profile and drafts must never be trusted across identities.
    clearStoredSession({ broadcast: false, reason: 'external-session-established' });
    clearAuthState();
    setSessionRecovering(true);
    try {
      await fetchMe({ broadcast: false });
    } catch (error) {
      const epoch = captureEpoch();
      handleVerificationFailure(error, epoch);
    }
  }, [clearAuthState, fetchMe, handleVerificationFailure, captureEpoch]);

  useEffect(() => subscribeAuthSession(event => { void handleExternalSession(event); }), [handleExternalSession]);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      const epoch = captureEpoch();
      try {
        await fetchMe();
      } catch (err) {
        handleVerificationFailure(err, epoch);
      } finally {
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, [fetchMe, handleVerificationFailure, captureEpoch]);

  const login = useCallback(async (credentials) => {
    const { data } = await authAPI.login(credentials);

    if (data?.requiresTwoFactor) {
      clearStoredSession();
      clearAuthState();
      return data;
    }

    const epoch = captureEpoch();
    try {
      const fullUser = await fetchMe();
      return { ...(data ?? {}), user: fullUser };
    } catch (err) {
      if (isCurrentEpoch(epoch)) clearAuthState();
      throw err;
    }
  }, [fetchMe, clearAuthState, captureEpoch, isCurrentEpoch]);

  const completeTwoFactor = useCallback(async (payload) => {
    const { data } = await authAPI.loginWith2FA(payload);
    const epoch = captureEpoch();
    try {
      const fullUser = await fetchMe();
      return { ...(data ?? {}), user: fullUser };
    } catch (err) {
      if (isCurrentEpoch(epoch)) {
        clearStoredSession();
        clearAuthState();
      }
      throw err;
    }
  }, [fetchMe, clearAuthState, captureEpoch, isCurrentEpoch]);

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      // The session cookie is shared by every tab. Broadcast the local
      // logout after the server-side attempt so sibling tabs clear private
      // views immediately instead of waiting for a refresh or expiry.
      clearAuthState({ broadcast: true, reason: 'logout' });
    }
  }, [clearAuthState]);

  const requestOTP = useCallback(async (data) => {
    return authAPI.requestOTP(data);
  }, []);

  const verifyOTP = useCallback(async (data) => {
    const response = await authAPI.verifyOTP(data);
    const epoch = captureEpoch();
    try {
      const fullUser = await fetchMe();
      return {
        ...response,
        data: {
          ...response.data,
          user: fullUser,
        },
      };
    } catch (err) {
      if (isCurrentEpoch(epoch)) clearAuthState();
      throw err;
    }
  }, [fetchMe, clearAuthState, captureEpoch, isCurrentEpoch]);

  const refreshUser = useCallback(async () => {
    const epoch = captureEpoch();
    try {
      return await fetchMe();
    } catch (err) {
      handleVerificationFailure(err, epoch);
      throw err;
    }
  }, [fetchMe, handleVerificationFailure, captureEpoch]);

  const refreshSession = useCallback(async () => {
    const epoch = captureEpoch();
    try {
      await authAPI.refresh();
      if (!isCurrentEpoch(epoch)) return null;
      return await fetchMe();
    } catch (err) {
      handleVerificationFailure(err, epoch);
      throw err;
    }
  }, [fetchMe, handleVerificationFailure, captureEpoch, isCurrentEpoch]);

  // Unified mode + role switcher. Accepts a mode string (see
  // server/utils/modeRole.js for the catalog). Legacy 'helper' / 'customer'
  // string still works — server normalizes them.
  const switchRole = useCallback(async (targetMode) => {
    const { data } = await api.post(
      '/auth/switch-role',
      { mode: targetMode, target_role: targetMode },
      { withCredentials: true }
    );

    // Backend may return fresh tokens when mode/role actually changed.
    // Tokens travel via httpOnly cookies; nothing is persisted to localStorage
    // (XSS vector).

    const updatedUser = normalizeUserPayload(data);

    if (updatedUser) {
      persistUser(updatedUser);
      return updatedUser;
    }

    return await fetchMe();
  }, [persistUser, fetchMe]);

  const onboardingComplete = isOnboardingComplete(user);
  const isHelper = ['helper', 'helper_pro', 'broker'].includes(user?.role);
  const isCustomer = user?.role === 'customer';
  const membershipTier = getMembershipTier(user);
  const needsOnboarding = isHelper && !onboardingComplete;
  const isRestrictedHelper = isHelper && !onboardingComplete;

  const canBrowseJobs = true;
  const canBid = isHelper && onboardingComplete;
  const canApplyToJobs = canBid;
  const canReceivePayouts = isHelper && onboardingComplete;
  const canAppearInSearch = isHelper && onboardingComplete;

  const value = useMemo(() => ({
    user,
    loading,
    initialized,
    sessionRecovering,
    isAuthenticated: !!user,
    isHelper,
    isCustomer,
    membershipTier,
    isOnboardingComplete: onboardingComplete,
    needsOnboarding,
    isRestrictedHelper,
    canBrowseJobs,
    canBid,
    canApplyToJobs,
    canReceivePayouts,
    canAppearInSearch,
    login,
    completeTwoFactor,
    logout,
    requestOTP,
    verifyOTP,
    refreshUser,
    refreshSession,
    switchRole,
    clearAuthState,
    setUser: persistUser,
  }), [
    user,
    loading,
    initialized,
    sessionRecovering,
    isHelper,
    isCustomer,
    membershipTier,
    onboardingComplete,
    needsOnboarding,
    isRestrictedHelper,
    canBrowseJobs,
    canBid,
    canApplyToJobs,
    canReceivePayouts,
    canAppearInSearch,
    login,
    completeTwoFactor,
    logout,
    requestOTP,
    verifyOTP,
    refreshUser,
    refreshSession,
    switchRole,
    clearAuthState,
    persistUser,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
