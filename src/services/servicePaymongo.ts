import { supabase } from './supabaseClient';

export type ServiceCheckoutResult = {
  checkoutUrl?: string;
  requestId: string;
  livemode?: boolean;
  reused?: boolean;
  paid?: boolean;
};

export async function createServicePayMongoCheckout(requestId: string): Promise<ServiceCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-service-paymongo-checkout', {
    body: { requestId, platform: 'mobile' },
  });
  if (error) {
    let message = error.message || 'Unable to start PayMongo checkout.';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // Use the safe fallback.
      }
    }
    throw new Error(message);
  }
  if (!data?.paid && typeof data?.checkoutUrl !== 'string') {
    throw new Error('PayMongo did not return a checkout link.');
  }
  return data as ServiceCheckoutResult;
}
