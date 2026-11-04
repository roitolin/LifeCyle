import { supabase } from "./supabaseClient";

export type PayoutVerifyResult = {
  shopId: string;
  payoutChannelCode: string;
  payoutAccountName: string;
  payoutVerified: true;
  testMode: true;
};

const DEFAULT_ERROR =
  "Payout account setup could not be completed. Check the configuration and try again.";

const getSafeErrorMessage = async (error: unknown): Promise<string> => {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.json !== "function") return DEFAULT_ERROR;

  try {
    const body = (await context.json()) as { error?: unknown };
    if (typeof body.error !== "string") return DEFAULT_ERROR;

    const message = body.error.trim();
    if (!message || message.length > 300) return DEFAULT_ERROR;

    // Never display anything that resembles a provider or authorization secret.
    if (/secret|api[ _-]?key|authorization|bearer|xnd_/i.test(message)) {
      return DEFAULT_ERROR;
    }

    return message;
  } catch {
    return DEFAULT_ERROR;
  }
};

/**
 * Approve an owner-submitted receiver for test checkout.
 * This does not create or verify a live payment account.
 */
export async function verifyShopPayout(
  shopId: string,
  payoutAccountId: string,
): Promise<PayoutVerifyResult> {
  // The server updates the shop summary and receiver atomically.
  const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
    body: {
      shopId,
      action: "save",
      payoutAccountId,
    },
  });

  if (error) throw new Error(await getSafeErrorMessage(error));

  if (
    !data ||
    data.shopId !== shopId ||
    data.payoutVerified !== true ||
    data.testMode !== true
  ) {
    throw new Error(DEFAULT_ERROR);
  }

  return data as PayoutVerifyResult;
}
