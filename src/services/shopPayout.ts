import { supabase } from './supabaseClient';

export type ShopPayoutRequestResult = {
  accepted: boolean;
  alreadyInitiated?: boolean;
  payoutStatus?: string | null;
  payoutId?: string | null;
  referenceNo?: string | null;
  payoutAmount?: number;
};

async function functionErrorMessage(error: unknown) {
  const fallback = 'Unable to request this withdrawal.';
  if (!(error instanceof Error)) return fallback;

  const context = (error as Error & { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
    } catch {
      // Use the fallback if the response body is unavailable.
    }
  }
  return error.message || fallback;
}

export async function requestShopSaleWithdrawal(requestId: string, payoutChannelCode?: string) {
  const { data, error } = await supabase.functions.invoke('request-shop-payout', {
    body: { requestId, ...(payoutChannelCode ? { payoutChannelCode } : {}) },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (typeof data?.error === 'string') throw new Error(data.error);
  if (data?.accepted !== true) throw new Error('Xendit did not accept the withdrawal request.');
  return data as ShopPayoutRequestResult;
}

export async function requestCustomShopWithdrawal(amount: number, payoutChannelCode?: string) {
  const { data, error } = await supabase.functions.invoke('request-shop-payout', {
    body: { amount, ...(payoutChannelCode ? { payoutChannelCode } : {}) },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (typeof data?.error === 'string') throw new Error(data.error);
  if (data?.accepted !== true) throw new Error('Xendit did not accept the withdrawal request.');
  return data as ShopPayoutRequestResult;
}
