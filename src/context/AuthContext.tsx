import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../services/supabaseClient";
import { ensureOwnUserProfile } from "../services/userProfile";
import { recordAdminLoginActivity } from "../utils/adminLoginActivity";
import { unregisterCurrentDevicePushToken } from '@/services/pushNotifications';
import {
  forgetRememberedAccount,
  getRememberedAccountSession,
  rememberAccountSession,
} from '@/services/deviceAccounts';

import { recordAccountLoginActivity } from '../utils/accountLoginActivity';
import { recordAccountActivity } from '../utils/accountActivity';
import {
  markCurrentAccountSessionSignedOut,
  registerCurrentAccountSession,
  verifyCurrentAccountSession,
} from '../utils/accountSessions';

type Role = "super_admin" | "admin" | "funeral_admin" | "user" | null;
type BanNotice = { reason: string; banEndsLabel: string } | null;
const TERMS_ACCEPTANCE_VERSION = '2026-04-02';

function termsAcceptanceStorageKey(userId: string) {
  return '@lifecycle/terms-accepted:' + TERMS_ACCEPTANCE_VERSION + ':' + userId;
}

type AppUser = User & {
  uid: string;
  displayName: string | null;
  emailVerified: boolean;
};

interface AuthContextType {
  user: AppUser | null;
  role: Role;
  termsAccepted: boolean;
  banNotice: BanNotice;
  loading: boolean;
  acceptTerms: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  clearBanNotice: () => void;
  logout: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  logoutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  termsAccepted: false,
  banNotice: null,
  loading: true,
  acceptTerms: async () => {},
  refreshUserProfile: async () => {},
  clearBanNotice: () => {},
  logout: async () => {},
  switchAccount: async () => {},
  logoutEverywhere: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [banNotice, setBanNotice] = useState<BanNotice>(null);
  const [loading, setLoading] = useState(true);
  const acceptedTermsUserIdRef = useRef<string | null>(null);
  const syncedProfileUserIdRef = useRef<string | null>(null);

  const toDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "object" && value !== null && "toDate" in value) {
      const converted = (value as { toDate?: () => Date }).toDate?.();
      return converted && !Number.isNaN(converted.getTime()) ? converted : null;
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const clearBanNotice = () => setBanNotice(null);

  const toAppUser = (supabaseUser: User): AppUser =>
    Object.assign(supabaseUser, {
      uid: supabaseUser.id,
      displayName:
        typeof supabaseUser.user_metadata?.fullName === "string"
          ? supabaseUser.user_metadata.fullName
          : typeof supabaseUser.user_metadata?.name === "string"
            ? supabaseUser.user_metadata.name
            : null,
      emailVerified: Boolean(supabaseUser.email_confirmed_at),
    });

  const handleSupabaseAuthUrl = useCallback(async (url: string | null) => {
    if (!url) return;

    try {
      const parsedUrl = new URL(url);
      const params = new URLSearchParams(parsedUrl.search);

      if (parsedUrl.hash) {
        const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ""));
        hashParams.forEach((value, key) => params.set(key, value));
      }

      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.warn("Supabase verification link could not be exchanged:", error.message);
        }
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          console.warn("Supabase verification session could not be restored:", error.message);
        }
      }
    } catch (error) {
      console.warn("Supabase auth link could not be parsed:", error);
    }
  }, []);

  const handleUserProfile = useCallback(async (supabaseUser: User, data: Record<string, any>) => {
    const disabled = Boolean(data?.disabled);
    const bannedUntil = toDate(data?.bannedUntil);
    const hasValidBanEnd = bannedUntil !== null;

    if (disabled && hasValidBanEnd && bannedUntil.getTime() <= Date.now()) {
      try {
        await supabase
          .from("users")
          .update({
          disabled: false,
          banReason: null,
          bannedBy: null,
          bannedAt: null,
          bannedUntil: null,
          })
          .eq("id", supabaseUser.id);
      } catch {
        // Best effort only; do not block access refresh if this cleanup fails.
      }
    }

    if (disabled && (!hasValidBanEnd || bannedUntil.getTime() > Date.now())) {
      setBanNotice({
        reason: String(data?.banReason || "").trim() || "No reason provided by admin.",
        banEndsLabel: hasValidBanEnd ? bannedUntil.toLocaleString(undefined, { hour12: true }) : "No end date (permanent)",
      });
      setRole(null);
      acceptedTermsUserIdRef.current = null;
      setTermsAccepted(false);
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore auth race errors on forced sign-out.
      }
      return;
    }

    setRole((data.role ?? null) as Role);
    const hasTermsAcceptedField = Object.prototype.hasOwnProperty.call(data, "termsAccepted");
    const acceptedInCurrentSession = acceptedTermsUserIdRef.current === supabaseUser.id;
    const acceptedInProfile = hasTermsAcceptedField ? Boolean(data.termsAccepted) : true;
    let acceptedOnDevice = false;
    try {
      acceptedOnDevice = Boolean(
        await AsyncStorage.getItem(termsAcceptanceStorageKey(supabaseUser.id))
      );
      if (acceptedInProfile && !acceptedOnDevice) {
        await AsyncStorage.setItem(
          termsAcceptanceStorageKey(supabaseUser.id),
          String(data.termsAcceptedAt || new Date().toISOString())
        );
        acceptedOnDevice = true;
      }
    } catch (error) {
      console.warn('Local terms acceptance could not be read:', error);
    }
    setTermsAccepted(
      acceptedInCurrentSession || acceptedInProfile || acceptedOnDevice
    );
  }, []);

  const acceptTerms = async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    const supabaseUser = sessionData.session?.user;
    if (!supabaseUser) throw new Error("Your login session has expired. Please sign in again.");

    const acceptedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("users")
      .update({
        termsAccepted: true,
        termsAcceptedAt: acceptedAt,
        updatedAt: acceptedAt,
      })
      .eq("id", supabaseUser.id)
      .select("termsAccepted, termsAcceptedAt")
      .single();

    if (error) throw error;
    if (data?.termsAccepted !== true) {
      throw new Error("Your acceptance could not be confirmed. Please try again.");
    }

    // Keep a confirmed acceptance sticky for this signed-in account. This
    // prevents an older profile request started during login from restoring
    // the pre-acceptance value after this update finishes.
    acceptedTermsUserIdRef.current = supabaseUser.id;
    try {
      await AsyncStorage.setItem(
        termsAcceptanceStorageKey(supabaseUser.id),
        acceptedAt
      );
    } catch (storageError) {
      console.warn('Terms acceptance could not be cached on this device:', storageError);
    }
    setTermsAccepted(true);
  };

  const refreshUserProfile = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const supabaseUser = sessionData.session?.user;
    if (!supabaseUser) {
      setRole(null);
      acceptedTermsUserIdRef.current = null;
      setTermsAccepted(false);
      return;
    }

    try {
      const data = await ensureOwnUserProfile(supabaseUser);
      await handleUserProfile(supabaseUser, data);
    } catch (error) {
      const dbError = error as any;
      if (dbError?.code !== "permission-denied") {
        console.warn("User profile could not be loaded.");
      }
      setRole(null);
      if (acceptedTermsUserIdRef.current !== supabaseUser.id) setTermsAccepted(false);
    }
  };

  useEffect(() => {
    let unsubscribeAuth = () => {};

    try {
      const syncUser = async (session: Session | null) => {
        setLoading(true);
        const supabaseUser = session?.user ?? null;

        if (supabaseUser) {
          setUser(toAppUser(supabaseUser));
          try {
            await registerCurrentAccountSession(session);
          } catch (error) {
            const sessionError = error as { message?: string };
            console.warn(
              "Account session could not be registered:",
              sessionError.message ?? "Unknown error",
            );
          }
          try {
            const data = await ensureOwnUserProfile(supabaseUser);
            await handleUserProfile(supabaseUser, data);
            if (session && !Boolean(data?.disabled)) {
              syncedProfileUserIdRef.current = supabaseUser.id;
              try {
                await rememberAccountSession(session, data);
              } catch (error) {
                console.warn('Account could not be saved to the device switcher:', error);
              }
            }
          } catch (error) {
            const profileError = error as { message?: string };
            console.warn("User profile could not be loaded:", profileError.message ?? "Unknown error");
            setRole(null);
            if (syncedProfileUserIdRef.current === supabaseUser.id) {
              syncedProfileUserIdRef.current = null;
            }
            if (acceptedTermsUserIdRef.current !== supabaseUser.id) setTermsAccepted(false);
            setLoading(false);
            return;
          }
          setLoading(false);
          return;
        }

        setUser(null);
        setRole(null);
        syncedProfileUserIdRef.current = null;
        acceptedTermsUserIdRef.current = null;
        setTermsAccepted(false);
        setLoading(false);
      };

      void supabase.auth
        .getSession()
        .then(({ data }) => syncUser(data.session))
        .catch((error: { message?: string }) => {
          console.warn("Saved login session could not be restored:", error.message ?? "Unknown error");
          setUser(null);
          setRole(null);
          syncedProfileUserIdRef.current = null;
          acceptedTermsUserIdRef.current = null;
          setTermsAccepted(false);
          setLoading(false);
        });
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        // Supabase can emit SIGNED_IN more than once for the same active user,
        // and refreshes access tokens in the background. The already resolved
        // agreement state remains valid for both events, so avoid reopening the
        // profile-loading gate and causing an unnecessary full-screen flicker.
        if (
          session?.user.id &&
          syncedProfileUserIdRef.current === session.user.id &&
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
        ) {
          setUser(toAppUser(session.user));
          return;
        }
        void syncUser(session);
      });
      unsubscribeAuth = () => listener.subscription.unsubscribe();
    } catch {
      console.warn("Auth listener failed to initialize.");
      setUser(null);
      setRole(null);
      syncedProfileUserIdRef.current = null;
      acceptedTermsUserIdRef.current = null;
      setTermsAccepted(false);
      setLoading(false);
    }

    return () => {
      unsubscribeAuth();
    };
  }, [handleUserProfile]);

  useEffect(() => {
    void Linking.getInitialURL().then(handleSupabaseAuthUrl);
    const subscription = Linking.addEventListener("url", ({ url }) => {
      void handleSupabaseAuthUrl(url);
    });
    return () => subscription.remove();
  }, [handleSupabaseAuthUrl]);

  useEffect(() => {
    if (!user?.id) return undefined;

    let active = true;
    let checking = false;

    const verifySession = async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const health = await verifyCurrentAccountSession();
        if (active && health === 'revoked') {
          await supabase.auth.signOut({ scope: 'local' });
        }
      } finally {
        checking = false;
      }
    };

    const interval = setInterval(() => {
      void verifySession();
    }, 120_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void verifySession();
    });

    return () => {
      active = false;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [user?.id]);

  useEffect(() => {
    const updateAuthRefresh = (state: string) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };

    updateAuthRefresh(AppState.currentState);
    const subscription = AppState.addEventListener('change', updateAuthRefresh);
    return () => subscription.remove();
  }, []);

  const logout = async () => {
    const accountId = user?.id || null;
    await unregisterCurrentDevicePushToken();
    await markCurrentAccountSessionSignedOut('signed_out');
    await recordAccountLoginActivity('logout');
    if (role === "admin" || role === "super_admin" || role === "funeral_admin") {
      await recordAdminLoginActivity("logout", role);
    }
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    if (accountId) await forgetRememberedAccount(accountId);
  };

  const switchAccount = async (accountId: string) => {
    const targetAccountId = accountId.trim();
    if (!targetAccountId || targetAccountId === user?.id) return;

    const targetSession = await getRememberedAccountSession(targetAccountId);
    if (!targetSession) {
      await forgetRememberedAccount(targetAccountId);
      throw new Error('This saved account needs to sign in again.');
    }

    const { data: currentData, error: currentError } = await supabase.auth.getSession();
    if (currentError) throw currentError;
    const currentSession = currentData.session;
    if (!currentSession) throw new Error('The current account session is unavailable.');

    await rememberAccountSession(currentSession);
    await markCurrentAccountSessionSignedOut('account_switched');
    await recordAccountLoginActivity('logout');
    if (role === 'admin' || role === 'super_admin' || role === 'funeral_admin') {
      await recordAdminLoginActivity('logout', role);
    }

    const restoreCurrentAccount = async () => {
      await supabase.auth.setSession({
        access_token: currentSession.access_token,
        refresh_token: currentSession.refresh_token,
      });
    };

    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: targetSession.accessToken,
        refresh_token: targetSession.refreshToken,
      });
      if (error) throw error;
      if (data.session?.user.id !== targetAccountId) {
        throw new Error('The saved session did not match the selected account.');
      }
      await recordAccountLoginActivity('login_success');
    } catch (error) {
      await restoreCurrentAccount();
      throw error;
    }
  };

  const logoutEverywhere = async () => {
    const accountId = user?.id || null;
    await unregisterCurrentDevicePushToken();
    await recordAccountActivity('all_sessions_signed_out');
    await markCurrentAccountSessionSignedOut('all_sessions_signed_out');
    await recordAccountLoginActivity('logout');
    if (role === "admin" || role === "super_admin" || role === "funeral_admin") {
      await recordAdminLoginActivity("logout", role);
    }
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) throw error;
    if (accountId) await forgetRememberedAccount(accountId);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        termsAccepted,
        banNotice,
        loading,
        acceptTerms,
        refreshUserProfile,
        clearBanNotice,
        logout,
        switchAccount,
        logoutEverywhere,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
