import { supabase } from './supabaseClient';

export type XenditShopCheckoutResult = {
  checkoutUrl?: string;
  paymentId: string;
  referenceNumber?: string;
  testMode?: boolean;
  livemode?: boolean;
  reused?: boolean;
  paid?: boolean;
};

export type XenditShopSyncResult = {
  synced: boolean;
  paid: boolean;
  paymentId?: string;
  status?: string;
  providerStatus?: string | null;
  testMode?: boolean;
  livemode?: boolean;
};

export type XenditShopPaymentMethod = 'all' | 'gcash' | 'ewallets' | 'cards' | 'qrph' | 'bank_transfer';

const readFunctionError = async (error: unknown) => {
  const fallback = 'Unable to start Xendit checkout.';
  if (!(error instanceof Error)) return fallback;
  const context = (error as Error & { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
    } catch {
      // Keep the safe fallback when the response body is unavailable.
    }
  }
  return error.message || fallback;
};

export async function createXenditShopCheckout(paymentMethod: XenditShopPaymentMethod = 'all'): Promise<XenditShopCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-xendit-shop-checkout', {
    body: { platform: 'mobile', paymentMethod },
  });

  if (error) throw new Error(await readFunctionError(error));
  if (!data?.paid && typeof data?.checkoutUrl !== 'string') {
    throw new Error('Xendit did not return a checkout link.');
  }
  if (!data?.paid && data?.testMode !== true && data?.livemode !== false) {
    throw new Error('Checkout was blocked because LifeCycle only allows Xendit test payments.');
  }
  return data as XenditShopCheckoutResult;
}

export async function syncXenditShopPayment(): Promise<XenditShopSyncResult> {
  const { data, error } = await supabase.functions.invoke('create-xendit-shop-checkout', {
    body: { platform: 'mobile', action: 'sync' },
  });
  if (error) throw new Error(await readFunctionError(error));
  return data as XenditShopSyncResult;
}
