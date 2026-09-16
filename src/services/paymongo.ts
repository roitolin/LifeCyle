import { supabase } from './supabaseClient';

export type PayMongoCheckoutResult = {
  checkoutUrl?: string;
  paymentId: string;
  referenceNumber?: string;
  livemode?: boolean;
  reused?: boolean;
  paid?: boolean;
};

export async function createPayMongoShopCheckout(): Promise<PayMongoCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-paymongo-checkout', {
    body: { platform: 'mobile' },
  });

  if (error) {
    let message = error.message || 'Unable to start PayMongo checkout.';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // Keep the safe fallback message when the response body is unavailable.
      }
    }
    throw new Error(message);
  }

  if (!data?.paid && typeof data?.checkoutUrl !== 'string') {
    throw new Error('PayMongo did not return a checkout link.');
  }
  return data as PayMongoCheckoutResult;
}
