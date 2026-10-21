import { supabase } from "./supabaseClient";

export type PayoutVerifyResult = {
  shopId: string;
  payoutChannelCode: string;
  payoutAccountName: string;
  payoutVerified: boolean;
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
 * Admin saves a shop's payout account details. The legacy function name is
 * retained for callers that have not yet migrated to the automatic-ready flow.
 * No Xendit sub-account is created — this just confirms the bank/GCash info.
 */
export async function verifyShopPayout(
  shopId: string,
  payoutChannelCode: string,
  payoutAccountName: string,
  payoutAccountNumber: string,
): Promise<PayoutVerifyResult> {
  // Verification must go through the server so the legacy shop fields and the
  // per-channel receiver row used by customer checkout are updated together.
  const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
    body: {
      shopId,
      action: "save",
      payoutChannelCode,
      payoutAccountName,
      payoutAccountNumber,
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

/**
 * Shop owner saves payout details. Approved shops become checkout-ready immediately.
 */
export async function updateShopPayout(
  shopId: string,
  payoutChannelCode: string,
  payoutAccountName: string,
  payoutAccountNumber: string,
): Promise<PayoutVerifyResult> {
  const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
    body: {
      shopId,
      action: "update",
      payoutChannelCode,
      payoutAccountName,
      payoutAccountNumber,
    },
  });

  if (error) throw new Error(await getSafeErrorMessage(error));

  if (!data || data.shopId !== shopId || data.payoutVerified !== true) {
    throw new Error(DEFAULT_ERROR);
  }

  return data as PayoutVerifyResult;
}
