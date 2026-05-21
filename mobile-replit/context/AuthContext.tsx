import React, { createContext, useContext, useEffect, useState } from "react";

import { User, getMe, login as apiLogin, logout as apiLogout, register as apiRegister, switchRole as apiSwitchRole } from "@/lib/api/auth";
import { tokenStore } from "@/lib/api/client";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchRole: (role: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = async () => {
    try {
      const token = await tokenStore.getAccessToken();
      if (!token) return;
      const me = await getMe();
      setUser(me);
    } catch {
      await tokenStore.clearTokens();
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  const login = async (email: string, password: string) => {
    const { user: u } = await apiLogin({ email, password });
    setUser(u);
  };

  const register = async (name: string, email: string, password: string) => {
    const { user: u } = await apiRegister({ name, email, password });
    setUser(u);
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const switchRole = async (role: string) => {
    await apiSwitchRole(role);
    const me = await getMe();
    setUser(me);
  };

  const refresh = async () => {
    try {
      const me = await getMe();
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        switchRole,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
