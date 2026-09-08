'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  clearRecoverySessionMarker,
  getRecoverySessionState,
  hasPendingSupabaseAuthCallback,
  markRecoverySession,
  refreshRecoverySession,
} from '@/lib/auth/recovery-session';
import { checkAndInstallZmindAgent } from '@/lib/utils/install-zmind-agent';
import {
  clearInviteTokens,
  clearUserLocalStorage,
} from '@/lib/utils/clear-local-storage';

type AuthContextType = {
  supabase: SupabaseClient;
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isRecoverySession: boolean;
  clearRecoverySession: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current;
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecoverySession, setIsRecoverySession] = useState(false);

  const clearRecoverySession = useCallback(() => {
    clearRecoverySessionMarker();
    setIsRecoverySession(false);
  }, []);

  useEffect(() => {
    const hasPendingAuthCallback = hasPendingSupabaseAuthCallback();

    const getInitialSession = async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setIsRecoverySession(getRecoverySessionState(currentSession));
        if (!currentSession) {
          clearRecoverySessionMarker();
          clearInviteTokens();
        }
      } catch (error) {
      } finally {
        if (hasPendingAuthCallback) {
          window.setTimeout(() => {
            setIsLoading(false);
          }, 0);
        } else {
          setIsLoading(false);
        }
      }
    };

    getInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        setIsLoading(false);
        switch (event) {
          case 'SIGNED_IN':
            clearRecoverySessionMarker();
            setIsRecoverySession(false);
            if (newSession?.user) {
              void checkAndInstallZmindAgent(
                newSession.user.id,
                newSession.user.created_at,
              );
            }
            break;
          case 'PASSWORD_RECOVERY':
            if (newSession) {
              markRecoverySession(newSession);
              setIsRecoverySession(true);
            } else {
              clearRecoverySession();
            }
            break;
          case 'SIGNED_OUT':
            // Clear local storage when user is signed out (handles all logout scenarios)
            clearRecoverySession();
            clearUserLocalStorage();
            break;
          case 'TOKEN_REFRESHED':
            setIsRecoverySession(refreshRecoverySession(newSession));
            break;
          case 'USER_UPDATED':
            setIsRecoverySession(refreshRecoverySession(newSession));
            break;
          case 'MFA_CHALLENGE_VERIFIED':
            break;
          default:
            setIsRecoverySession(getRecoverySessionState(newSession));
        }
      },
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [clearRecoverySession, supabase]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      clearRecoverySession();
      // Clear local storage after successful sign out
      clearUserLocalStorage();
    } catch (error) {
      console.error('❌ Error signing out:', error);
    }
  }, [clearRecoverySession, supabase]);

  const value = useMemo(
    () => ({
      supabase,
      session,
      user,
      isLoading,
      isRecoverySession,
      clearRecoverySession,
      signOut,
    }),
    [
      supabase,
      session,
      user,
      isLoading,
      isRecoverySession,
      clearRecoverySession,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
