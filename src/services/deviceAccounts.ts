import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { supabase } from '@/services/supabaseClient';

export type RememberedAccount = {
  id: string;
  email: string;
  fullName: string;
  photoURL: string | null;
  lastUsedAt: string;
};

export type RememberedAccountSession = {
  accessToken: string;
  refreshToken: string;
};

type AccountProfile = Record<string, unknown> | null | undefined;
type TokenKind = 'access' | 'refresh';

const REMEMBERED_ACCOUNTS_KEY = '@lifecycle/remembered-accounts';
const MAX_REMEMBERED_ACCOUNTS = 6;
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let secureStoreAvailablePromise: Promise<boolean> | null = null;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function secureTokenKey(accountId: string, kind: TokenKind) {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return 'lifecycle.account.' + safeAccountId + '.' + kind;
}

async function isSecureStoreAvailable() {
  if (Platform.OS === 'web') return false;
  secureStoreAvailablePromise ??= SecureStore.isAvailableAsync().catch(() => false);
  return secureStoreAvailablePromise;
}

function normalizeAccount(value: unknown): RememberedAccount | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RememberedAccount>;
  if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.email)) return null;

  return {
    id: candidate.id.trim(),
    email: candidate.email.trim(),
    fullName: isNonEmptyString(candidate.fullName)
      ? candidate.fullName.trim()
      : candidate.email.trim().split('@')[0],
    photoURL: isNonEmptyString(candidate.photoURL) ? candidate.photoURL.trim() : null,
    lastUsedAt: isNonEmptyString(candidate.lastUsedAt)
      ? candidate.lastUsedAt
      : new Date(0).toISOString(),
  };
}

async function writeRememberedAccounts(accounts: RememberedAccount[]) {
  await AsyncStorage.setItem(
    REMEMBERED_ACCOUNTS_KEY,
    JSON.stringify(accounts.slice(0, MAX_REMEMBERED_ACCOUNTS))
  );
}

export async function getRememberedAccounts(): Promise<RememberedAccount[]> {
  const stored = await AsyncStorage.getItem(REMEMBERED_ACCOUNTS_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeAccount)
      .filter((account): account is RememberedAccount => Boolean(account))
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  } catch {
    return [];
  }
}

export async function rememberAccountSession(
  session: Session,
  profile?: AccountProfile
) {
  if (!(await isSecureStoreAvailable())) return;

  const accountId = session.user.id.trim();
  const email = String(session.user.email || '').trim();
  if (!accountId || !email || !session.access_token || !session.refresh_token) return;

  const accessKey = secureTokenKey(accountId, 'access');
  const refreshKey = secureTokenKey(accountId, 'refresh');
  try {
    await Promise.all([
      SecureStore.setItemAsync(accessKey, session.access_token, secureStoreOptions),
      SecureStore.setItemAsync(refreshKey, session.refresh_token, secureStoreOptions),
    ]);
  } catch (error) {
    await Promise.allSettled([
      SecureStore.deleteItemAsync(accessKey, secureStoreOptions),
      SecureStore.deleteItemAsync(refreshKey, secureStoreOptions),
    ]);
    throw error;
  }

  const existing = await getRememberedAccounts();
  const existingAccount = existing.find((item) => item.id === accountId);
  const metadata = session.user.user_metadata || {};
  const fullName = String(
    profile?.fullName ||
      metadata.fullName ||
      metadata.name ||
      existingAccount?.fullName ||
      email.split('@')[0]
  ).trim();
  const photoURL = String(
    profile?.photoURL ||
      metadata.photoURL ||
      metadata.avatar_url ||
      existingAccount?.photoURL ||
      ''
  ).trim();
  const account: RememberedAccount = {
    id: accountId,
    email,
    fullName: fullName || email.split('@')[0],
    photoURL: photoURL || null,
    lastUsedAt: new Date().toISOString(),
  };

  await writeRememberedAccounts([
    account,
    ...existing.filter((item) => item.id !== accountId),
  ]);
}

export async function rememberCurrentAccountSession(profile?: AccountProfile) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) return;
  await rememberAccountSession(data.session, profile);
}

export async function getRememberedAccountSession(
  accountId: string
): Promise<RememberedAccountSession | null> {
  if (!(await isSecureStoreAvailable())) return null;

  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(secureTokenKey(accountId, 'access'), secureStoreOptions),
    SecureStore.getItemAsync(secureTokenKey(accountId, 'refresh'), secureStoreOptions),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function forgetRememberedAccount(accountId: string) {
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) return;

  if (await isSecureStoreAvailable()) {
    await Promise.allSettled([
      SecureStore.deleteItemAsync(
        secureTokenKey(normalizedAccountId, 'access'),
        secureStoreOptions
      ),
      SecureStore.deleteItemAsync(
        secureTokenKey(normalizedAccountId, 'refresh'),
        secureStoreOptions
      ),
    ]);
  }

  const existing = await getRememberedAccounts();
  await writeRememberedAccounts(
    existing.filter((account) => account.id !== normalizedAccountId)
  );
}
