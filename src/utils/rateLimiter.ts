import { supabase } from "@/services/supabaseClient";

export type RateLimitAction =
  | "chat_message"
  | "support_message"
  | "abuse_report"
  | "create_request";

type RateLimitPolicy = {
  max: number;
  windowMs: number;
};

const RATE_LIMIT_POLICIES: Record<RateLimitAction, RateLimitPolicy> = {
  chat_message: { max: 12, windowMs: 60_000 },
  support_message: { max: 3, windowMs: 5 * 60_000 },
  abuse_report: { max: 3, windowMs: 10 * 60_000 },
  create_request: { max: 4, windowMs: 60 * 60_000 },
};

export class RateLimitExceededError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Too many requests. Please try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const sanitizeScope = (value?: string): string => {
  const trimmed = String(value || "global").trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9_-]/g, "-").slice(0, 64) || "global";
};

const makeRateLimitDocId = (userId: string, action: RateLimitAction, scope?: string): string => {
  return `${userId}_${action}_${sanitizeScope(scope)}`;
};

export const consumeRateLimit = async (
  db: any, // kept for signature compatibility if it's passed around, but unused now
  userId: string,
  action: RateLimitAction,
  scope?: string
) => {
  const policy = RATE_LIMIT_POLICIES[action];
  const now = Date.now();
  const docId = makeRateLimitDocId(userId, action, scope);

  const { data: limitData } = await supabase
    .from("rate_limits")
    .select("count, resetAtMs")
    .eq("id", docId)
    .single();

  const existingCount = Number(limitData?.count || 0);
  const resetAtMs = Number(limitData?.resetAtMs || 0);

  if (!limitData) {
    await supabase.from("rate_limits").insert({
      id: docId,
      userId,
      action,
      scope: sanitizeScope(scope),
      count: 1,
      resetAtMs: now + policy.windowMs,
      windowMs: policy.windowMs,
      max: policy.max,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (now >= resetAtMs) {
    await supabase.from("rate_limits").update({
      count: 1,
      resetAtMs: now + policy.windowMs,
      updatedAt: new Date().toISOString(),
    }).eq("id", docId);
    return;
  }

  if (existingCount >= policy.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
    throw new RateLimitExceededError(retryAfterSeconds);
  }

  await supabase.from("rate_limits").update({
    count: existingCount + 1,
    updatedAt: new Date().toISOString(),
  }).eq("id", docId);
};


export const isRateLimitError = (error: unknown): error is RateLimitExceededError => {
  return error instanceof RateLimitExceededError;
};

