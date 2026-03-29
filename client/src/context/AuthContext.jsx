import { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const clearAuthState = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  const persistUser = useCallback((nextUser) => {
    setUser(nextUser);
    localStorage.setItem('user', JSON.stringify(nextUser));
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');
      const savedUser = localStorage.getItem('user');

      if (!token) {
        setLoading(false);
        return;
      }

      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser));
        } catch {
          localStorage.removeItem('user');
        }
      }

      try {
        const res = await api.get('/auth/me');
        const fullUser = res.data.user ?? res.data;
        persistUser(fullUser);
      } catch (err) {
        console.warn('Could not refresh user profile:', err?.response?.status);
        clearAuthState();
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, [clearAuthState, persistUser]);

  const login = useCallback(async (credentials) => {
    const { data } = await authAPI.login(credentials);

    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    persistUser(data.user);

    try {
      const res = await api.get('/auth/me');
      const fullUser = res.data.user ?? res.data;
      persistUser(fullUser);
      return { ...data, user: fullUser };
    } catch (err) {
      console.warn('Could not fetch full profile after login:', err?.response?.status);
      return data;
    }
  }, [persistUser]);

  const register = useCallback(async (userData) => {
    const { data } = await authAPI.register(userData);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    persistUser(data.user);
    return data;
  }, [persistUser]);

  const logout = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
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
    if (response.data.user) {
      persistUser(response.data.user);
    }
    return response;
  }, [persistUser]);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      const fullUser = res.data.user ?? res.data;
      persistUser(fullUser);
      return fullUser;
    } catch (err) {
      console.error('refreshUser error:', err);
      throw err;
    }
  }, [persistUser]);

  // Onboarding & tier computed helpers
  const isOnboardingComplete = user?.onboarding_step === 'active'
    || user?.onboarding_completed
    || user?.onboarding_status === 'onboarding_complete';
  const canBrowseJobs = true;
  const canApplyToJobs = ['active', 'premium', 'tier2'].includes(user?.membership_tier) || isOnboardingComplete;
  const canAppearInSearch = ['premium', 'tier2'].includes(user?.membership_tier) && isOnboardingComplete;

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    isOnboardingComplete,
    canBrowseJobs,
    canApplyToJobs,
    canAppearInSearch,
    login,
    register,
    logout,
    requestOTP,
    verifyOTP,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
