import { supabase } from './supabaseClient';

export type ServiceXenditCheckoutResult = {
  checkoutUrl?: string;
  paymentSessionId?: string;
  requestId: string;
  reused?: boolean;
  paid?: boolean;
  status?: string;
  testMode?: boolean;
  livemode?: boolean;
  paymentMethod?: string;
};

export type ServicePaymentMethod = {
  code: string;
  label: string;
  type: 'wallet' | 'bank';
};

export type ServicePaymentOption = 'full' | 'downpayment';

export type SelectedServicePaymentTerms = {
  id: string;
  paymentOption: ServicePaymentOption;
  paymentAmount: number | string;
  productFullPrice?: number | string | null;
  downpaymentAmountSnapshot?: number | string | null;
  downpaymentPercentageSnapshot?: number | string | null;
  remainingBalance?: number | string | null;
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

export async function getServicePaymentMethods(
  requestId: string,
): Promise<{ methods: ServicePaymentMethod[]; selectedMethod?: string }> {
  const { data, error } = await supabase.functions.invoke('create-service-xendit-checkout', {
    body: { requestId, action: 'methods', platform: 'mobile' },
  });

  if (error) throw new Error(await getFunctionErrorMessage(error));

  return {
    methods: Array.isArray(data?.methods) ? data.methods as ServicePaymentMethod[] : [],
    selectedMethod: typeof data?.selectedMethod === 'string' ? data.selectedMethod : undefined,
  };
}

export async function chooseServicePaymentOption(
  requestId: string,
  paymentOption: ServicePaymentOption,
): Promise<SelectedServicePaymentTerms> {
  const { data, error } = await supabase.rpc('choose_funeral_request_payment_option', {
    p_request_id: requestId,
    p_payment_option: paymentOption,
  });
  if (error) throw error;

  const selected = Array.isArray(data) ? data[0] : data;
  if (!selected?.id || Number(selected.paymentAmount) <= 0) {
    throw new Error('The selected payment amount could not be prepared.');
  }
  return selected as SelectedServicePaymentTerms;
}

export async function createServiceXenditCheckout(
  requestId: string,
  paymentMethod: string,
): Promise<ServiceXenditCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-service-xendit-checkout', {
    body: { requestId, paymentMethod, platform: 'mobile' },
  });

  if (error) throw new Error(await getFunctionErrorMessage(error));

  // Direct payout model: no waitingForSplit state
  const isSettled = data?.paid === true;
  if (!isSettled && typeof data?.checkoutUrl !== 'string') {
    throw new Error('Xendit did not return a checkout link.');
  }

  const isTestMode = data?.testMode === true || data?.livemode === false;
  if (!isSettled && !isTestMode) {
    throw new Error('Checkout could not be verified. Please try again or contact support.');
  }

  return data as ServiceXenditCheckoutResult;
}

export async function syncServiceXenditCheckout(requestId: string): Promise<ServiceXenditCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-service-xendit-checkout', {
    body: { requestId, action: 'sync', platform: 'mobile' },
  });

  if (error) throw new Error(await getFunctionErrorMessage(error));

  return data as ServiceXenditCheckoutResult;
}
