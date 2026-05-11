import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authAPI, clearStoredSession } from '../api/auth';
import api from '../api/axios';

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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const persistUser = useCallback((nextUser) => {
    setUser(nextUser || null);
    return nextUser || null;
  }, []);

  const clearAuthState = useCallback(() => {
    setUser(null);
  }, []);

  const fetchMe = useCallback(async () => {
    const res = await api.get('/auth/me', { withCredentials: true });
    const fullUser = normalizeUserPayload(res.data);
    persistUser(fullUser);
    return fullUser;
  }, [persistUser]);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        await fetchMe();
      } catch (err) {
        const status = err?.response?.status;

        if (status === 401 || status === 403) {
          clearAuthState();
        } else {
          console.warn('Could not verify session:', err?.message);
          clearAuthState();
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
  }, [fetchMe, clearAuthState]);

  const login = useCallback(async (credentials) => {
    const { data } = await authAPI.login(credentials);

    if (data?.requiresTwoFactor) {
      clearStoredSession();
      clearAuthState();
      return data;
    }

    try {
      const fullUser = await fetchMe();
      return { ...(data ?? {}), user: fullUser };
    } catch (err) {
      clearAuthState();
      throw err;
    }
  }, [fetchMe, clearAuthState]);

  const register = useCallback(async (userData) => {
    const { data } = await authAPI.register(userData);

    try {
      const fullUser = await fetchMe();
      return { ...(data ?? {}), user: fullUser };
    } catch (err) {
      clearAuthState();
      throw err;
    }
  }, [fetchMe, clearAuthState]);

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
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
      clearAuthState();
      throw err;
    }
  }, [fetchMe, clearAuthState]);

  const refreshUser = useCallback(async () => {
    try {
      return await fetchMe();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        clearAuthState();
      }
      throw err;
    }
  }, [fetchMe, clearAuthState]);

  const refreshSession = useCallback(async () => {
    try {
      const response = await authAPI.refresh();
      const fullUser = await fetchMe();
      return fullUser || normalizeUserPayload(response.data);
    } catch (err) {
      clearAuthState();
      throw err;
    }
  }, [fetchMe, clearAuthState]);

  const switchRole = useCallback(async (targetRole) => {
    const { data } = await api.post(
      '/auth/switch-role',
      { target_role: targetRole },
      { withCredentials: true }
    );

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
    switchRole,
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
