import { supabase } from './supabaseClient';

export type ServiceXenditCheckoutResult = {
  checkoutUrl?: string;
  paymentSessionId?: string;
  requestId: string;
  reused?: boolean;
  paid?: boolean;
  testMode?: boolean;
  livemode?: boolean;
};

const getFunctionErrorMessage = async (error: unknown): Promise<string> => {
  const fallback = 'Unable to start Xendit checkout.';
  if (!(error instanceof Error)) return fallback;

  const context = (error as Error & { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
      if (typeof body?.message === 'string' && body.message.trim()) return body.message;
    } catch {
      // The response body may already have been consumed. Use the safe fallback below.
    }
  }

  return error.message || fallback;
};

export async function createServiceXenditCheckout(requestId: string): Promise<ServiceXenditCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-service-xendit-checkout', {
    body: { requestId, platform: 'mobile' },
  });

  if (error) throw new Error(await getFunctionErrorMessage(error));

  // Direct payout model: no waitingForSplit state
  const isSettled = data?.paid === true;
  if (!isSettled && typeof data?.checkoutUrl !== 'string') {
    throw new Error('Xendit did not return a checkout link.');
  }

  const isTestMode = data?.testMode === true || data?.livemode === false;
  if (!isSettled && !isTestMode) {
    throw new Error('Checkout was blocked because LifeCycle only allows Xendit test payments.');
  }

  return data as ServiceXenditCheckoutResult;
}
