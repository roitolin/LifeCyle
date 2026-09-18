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
 * Admin verifies a shop's payout account details.
 * No Xendit sub-account is created — this just confirms the bank/GCash info.
 */
export async function verifyShopPayout(
  shopId: string,
  payoutChannelCode: string,
  payoutAccountName: string,
  payoutAccountNumber: string,
): Promise<PayoutVerifyResult> {
  const updatePayload = {
    payoutChannelCode,
    payoutAccountName,
    payoutAccountNumber,
    payoutVerifiedByAdmin: true,
    payoutVerifiedAt: new Date().toISOString(),
    xenditProvisioningStatus: 'provisioned',
    xenditProvisioningError: null,
    xenditProvisioningUpdatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. Try direct Supabase update (authorized administrators have update privileges)
  const { error: directError } = await supabase
    .from('funeral_shops')
    .update(updatePayload)
    .eq('id', shopId);

  if (!directError) {
    return {
      shopId,
      payoutChannelCode,
      payoutAccountName,
      payoutVerified: true,
      testMode: true,
    };
  }

  // 2. Fallback to provision-xendit-shop edge function
  const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
    body: {
      shopId,
      action: "verify",
      payoutChannelCode,
      payoutAccountName,
      payoutAccountNumber,
    },
  });

  if (error) throw new Error(await getSafeErrorMessage(error));

  if (
    !data ||
    data.shopId !== shopId ||
    data.testMode !== true
  ) {
    throw new Error(DEFAULT_ERROR);
  }

  return data as PayoutVerifyResult;
}

/**
 * Shop owner submits/updates their own payout details (requires admin verification after).
 */
export async function updateShopPayout(
  shopId: string,
  payoutChannelCode: string,
  payoutAccountName: string,
  payoutAccountNumber: string,
): Promise<PayoutVerifyResult> {
  const updatePayload = {
    payoutChannelCode,
    payoutAccountName,
    payoutAccountNumber,
    payoutVerifiedByAdmin: false,
    payoutVerifiedAt: null,
    updatedAt: new Date().toISOString(),
  };

  // 1. Try direct Supabase update (shop owners have RLS update privileges on their own shop)
  const { error: directError } = await supabase
    .from('funeral_shops')
    .update(updatePayload)
    .eq('id', shopId);

  if (!directError) {
    return {
      shopId,
      payoutChannelCode,
      payoutAccountName,
      payoutVerified: false,
      testMode: true,
    };
  }

  // 2. Fallback to provision-xendit-shop edge function
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

  if (!data || data.shopId !== shopId) {
    throw new Error(DEFAULT_ERROR);
  }

  return data as PayoutVerifyResult;
}
