import { supabase } from "./supabaseClient";

export type XenditShopProvisionResult = {
  shopId: string;
  xenditAccountId: string;
  xenditAccountStatus?: string | null;
  provisioningStatus?: string | null;
  reused?: boolean;
  testMode: true;
};

const DEFAULT_ERROR =
  "Xendit test account setup could not be completed. Check the server configuration, then try again.";

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
 * Requests server-side Xendit Test Mode provisioning for an approved shop.
 * Provider credentials remain in Supabase Edge Function secrets.
 */
export async function provisionXenditShop(
  shopId: string,
): Promise<XenditShopProvisionResult> {
  const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
    body: { shopId },
  });

  if (error) throw new Error(await getSafeErrorMessage(error));

  if (
    !data ||
    data.shopId !== shopId ||
    typeof data.xenditAccountId !== "string" ||
    data.testMode !== true
  ) {
    throw new Error(DEFAULT_ERROR);
  }

  return data as XenditShopProvisionResult;
}
