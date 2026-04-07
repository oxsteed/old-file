import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authAPI } from '../api/auth';
import api from '../api/axios';

export const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const USER_KEY = 'user';

function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
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
  const [user, setUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const persistTokens = useCallback((payload) => {
    if (!payload) return;

    if (payload.accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, payload.accessToken);
    }

    if (payload.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
    }
  }, []);

  const persistUser = useCallback((nextUser) => {
    if (!nextUser) {
      localStorage.removeItem(USER_KEY);
      setUser(null);
      return null;
    }

    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    return nextUser;
  }, []);

  const persistSession = useCallback((payload) => {
    if (!payload) return null;

    persistTokens(payload);
    const normalizedUser = normalizeUserPayload(payload);
    if (normalizedUser) {
      persistUser(normalizedUser);
    }
    return normalizedUser;
  }, [persistTokens, persistUser]);

  const clearAuthState = useCallback(() => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const fetchMe = useCallback(async () => {
    const res = await api.get('/auth/me');
    const fullUser = normalizeUserPayload(res.data);
    if (fullUser) {
      persistUser(fullUser);
    }
    return fullUser;
  }, [persistUser]);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      const token = localStorage.getItem(ACCESS_TOKEN_KEY);

      if (!token) {
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }
        return;
      }

      try {
        await fetchMe();
      } catch (err) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          // Session is definitively invalid — clear it
          clearAuthState();
        } else {
          // Network error or server unavailable — keep stored user, don't sign out
          console.warn('Could not verify session (network issue?):', err?.message);
        }
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
  }, [clearAuthState, fetchMe]);

  const login = useCallback(async (credentials) => {
    const { data } = await authAPI.login(credentials);
    persistSession(data);

    try {
      const fullUser = await fetchMe();
      return { ...data, user: fullUser || normalizeUserPayload(data) };
    } catch (err) {
      console.warn('Could not fetch full profile after login:', err?.response?.status || err?.message);
      return { ...data, user: normalizeUserPayload(data) };
    }
  }, [fetchMe, persistSession]);

  const register = useCallback(async (userData) => {
    const { data } = await authAPI.register(userData);
    persistSession(data);

    try {
      const fullUser = await fetchMe();
      return { ...data, user: fullUser || normalizeUserPayload(data) };
    } catch (err) {
      console.warn('Could not fetch full profile after register:', err?.response?.status || err?.message);
      return { ...data, user: normalizeUserPayload(data) };
    }
  }, [fetchMe, persistSession]);

  const logout = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        await authAPI.logout(refreshToken);
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      clearAuthState();
    }
  }, [clearAuthState]);

  const requestOTP = useCallback(async (data) => {
    return authAPI.requestOTP(data);
  }, []);

  const verifyOTP = useCallback(async (data) => {
    const response = await authAPI.verifyOTP(data);
    persistSession(response.data);

    try {
      const fullUser = await fetchMe();
      return {
        ...response,
        data: {
          ...response.data,
          user: fullUser || normalizeUserPayload(response.data),
        },
      };
    } catch (err) {
      console.warn('Could not fetch full profile after OTP verification:', err?.response?.status || err?.message);
      return response;
    }
  }, [fetchMe, persistSession]);

  const refreshUser = useCallback(async () => {
    try {
      const fullUser = await fetchMe();
      return fullUser;
    } catch (err) {
      console.error('refreshUser error:', err);
      throw err;
    }
  }, [fetchMe]);

  const refreshSession = useCallback(async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      clearAuthState();
      return null;
    }

    try {
      const response = await authAPI.refresh(refreshToken);
      persistSession(response.data);
      const fullUser = await fetchMe().catch(() => normalizeUserPayload(response.data));
      return fullUser;
    } catch (err) {
      clearAuthState();
      throw err;
    }
  }, [clearAuthState, fetchMe, persistSession]);

  const onboardingComplete = isOnboardingComplete(user);
  const isHelper = user?.role === 'helper';
  const isCustomer = user?.role === 'customer';
  const membershipTier = getMembershipTier(user);
  const needsOnboarding = isHelper && !onboardingComplete;
  const canBrowseJobs = true;
  const canBid = isHelper && onboardingComplete;
  const canApplyToJobs = canBid;
  const canReceivePayouts = isHelper && onboardingComplete;
  const canAppearInSearch = isHelper && onboardingComplete;
  const isRestrictedHelper = isHelper && !onboardingComplete;

  const value = useMemo(() => ({
    user,
    loading,
    initialized,
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
    register,
    logout,
    requestOTP,
    verifyOTP,
    refreshUser,
    refreshSession,
    clearAuthState,
    setUser: persistUser,
  }), [
    user,
    loading,
    initialized,
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
    register,
    logout,
    requestOTP,
    verifyOTP,
    refreshUser,
    refreshSession,
    clearAuthState,
    persistUser,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
