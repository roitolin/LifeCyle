import AsyncStorage from "@react-native-async-storage/async-storage";

type AttemptState = {
  windowStartMs: number;
  failedCount: number;
  blockedUntilMs: number;
};

const PREFIX = "auth_attempt_guard_v1";
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_IN_WINDOW = 5;
const BLOCK_MS = 10 * 60 * 1000;

const nowMs = () => Date.now();

const normalizeKeyPart = (value: string) => String(value || "").trim().toLowerCase();

const keyFor = (identifier: string) => `${PREFIX}:${normalizeKeyPart(identifier)}`;

const parseState = (raw: string | null): AttemptState | null => {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as AttemptState;
    if (
      typeof data.windowStartMs !== "number" ||
      typeof data.failedCount !== "number" ||
      typeof data.blockedUntilMs !== "number"
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
};

const saveState = async (identifier: string, state: AttemptState) => {
  await AsyncStorage.setItem(keyFor(identifier), JSON.stringify(state));
};

export const getLoginBlockState = async (identifier: string): Promise<{ blocked: boolean; retryAfterSeconds: number }> => {
  // Rate limiting has been disabled as requested
  return { blocked: false, retryAfterSeconds: 0 };
};

export const recordFailedLoginAttempt = async (identifier: string) => {
  const now = nowMs();
  const current = parseState(await AsyncStorage.getItem(keyFor(identifier)));

  if (!current || now - current.windowStartMs > WINDOW_MS) {
    await saveState(identifier, {
      windowStartMs: now,
      failedCount: 1,
      blockedUntilMs: 0,
    });
    return;
  }

  const nextFailedCount = current.failedCount + 1;
  const blockedUntilMs = nextFailedCount >= MAX_FAILED_IN_WINDOW ? now + BLOCK_MS : current.blockedUntilMs;

  await saveState(identifier, {
    windowStartMs: current.windowStartMs,
    failedCount: nextFailedCount,
    blockedUntilMs,
  });
};

export const clearLoginAttempts = async (identifier: string) => {
  await AsyncStorage.removeItem(keyFor(identifier));
};
