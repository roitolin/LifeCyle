// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const PAYMONGO_CREATE_URL = 'https://api.paymongo.com/v2/checkout_sessions';
const PAYMONGO_RETRIEVE_URL = 'https://api.paymongo.com/v1/checkout_sessions';
const SHOP_PAYMENT_SETTING_KEY = 'payment_qr_code';
const CHECKOUT_DESCRIPTION = 'LifeCycle shop registration and renewal';

type CheckoutRequest = {
  platform?: 'mobile' | 'web';
  returnUrl?: string;
};

type PendingPayment = {
  id: string;
  paymentProvider: string | null;
  providerCheckoutId: string | null;
  providerCheckoutUrl: string | null;
  providerStatus: string | null;
  providerLivemode: boolean | null;
  referenceNumber: string;
  amount: number | string;
  createdAt: string;
};

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

function basicAuth(secretKey: string) {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

function isSafeWebReturnUrl(request: Request, value: string) {
  try {
    const parsed = new URL(value);
    const requestOrigin = request.headers.get('origin');
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    const secure = parsed.protocol === 'https:' || localHttp;
    return secure && Boolean(requestOrigin) && parsed.origin === requestOrigin;
  } catch {
    return false;
  }
}

function returnUrls(request: Request, payload: CheckoutRequest) {
  if (payload.platform === 'mobile') {
    return {
      successUrl: 'lifecycle://paymongo-payment?status=success',
      cancelUrl: 'lifecycle://paymongo-payment?status=cancelled',
    };
  }

  const requested = payload.returnUrl?.trim() || '';
  if (!isSafeWebReturnUrl(request, requested)) {
    throw new Error('The web checkout return URL is not allowed.');
  }

  const success = new URL(requested);
  success.searchParams.set('paymongo', 'success');
  const cancelled = new URL(requested);
  cancelled.searchParams.set('paymongo', 'cancelled');
  return { successUrl: success.toString(), cancelUrl: cancelled.toString() };
}

function configuredPaymentMethods() {
  const configured = (Deno.env.get('PAYMONGO_PAYMENT_METHODS') || 'card,gcash,qrph')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(configured)];
}

async function paymongoRequest(secretKey: string, url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuth(secretKey),
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
}

function paidPaymentFromCheckout(attributes: any) {
  const payments = Array.isArray(attributes?.payments) ? attributes.payments : [];
  return payments.find((payment: any) => payment?.attributes?.status === 'paid') || null;
}

async function rejectStaleCheckout(admin: any, paymentId: string, reason: string, providerStatus: string) {
  const { error } = await admin
    .from('shop_payments')
    .update({ status: 'rejected', providerStatus, rejectionReason: reason })
    .eq('id', paymentId)
    .eq('status', 'pending');
  if (error) throw error;
}

async function reconcilePaidCheckout(admin: any, payment: PendingPayment, checkout: any) {
  const attributes = checkout?.attributes || {};
  const paidPayment = paidPaymentFromCheckout(attributes);
  if (!paidPayment) return false;

  const paymentAttributes = paidPayment.attributes || {};
  const { error } = await admin.rpc('complete_paymongo_shop_payment', {
    p_event_id: `reconcile:${checkout.id}:${paidPayment.id}`,
    p_checkout_id: checkout.id,
    p_reference_number: attributes.reference_number || payment.referenceNumber,
    p_provider_payment_id: paidPayment.id || '',
    p_payment_method: paymentAttributes.source?.type || '',
    p_amount_cents: Number(paymentAttributes.amount) || 0,
    p_livemode: Boolean(attributes.livemode),
    p_payer_name: paymentAttributes.billing?.name || null,
  });
  if (error) throw error;
  return true;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return jsonResponse(request, { error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const paymongoSecretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
  if (!supabaseUrl || !serviceRoleKey || !paymongoSecretKey) {
    return jsonResponse(request, { error: 'Payment service configuration is incomplete.' }, 503);
  }
  if (!paymongoSecretKey.startsWith('sk_test_')) {
    return jsonResponse(request, { error: 'LifeCycle shop payments are locked to PayMongo test mode.' }, 503);
  }

  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) {
    return jsonResponse(request, { error: 'You must be signed in to start checkout.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  const user = userData.user;
  if (userError || !user) {
    return jsonResponse(request, { error: 'Your session is invalid or expired.' }, 401);
  }

  let payload: CheckoutRequest;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid checkout request.' }, 400);
  }

  let redirects: { successUrl: string; cancelUrl: string };
  try {
    redirects = returnUrls(request, payload);
  } catch (error) {
    return jsonResponse(request, { error: error instanceof Error ? error.message : 'Invalid return URL.' }, 400);
  }

  const [shopResult, ownerResult, settingResult] = await Promise.all([
    admin.from('funeral_shops').select('id, shopName, status').eq('id', user.id).maybeSingle(),
    admin.from('users').select('fullName, email').eq('id', user.id).maybeSingle(),
    admin.from('settings').select('value').eq('key', SHOP_PAYMENT_SETTING_KEY).maybeSingle(),
  ]);
  if (shopResult.error || ownerResult.error || settingResult.error) {
    return jsonResponse(request, { error: 'Unable to load the payment configuration.' }, 500);
  }

  const shop = shopResult.data;
  if (!shop || !['verified', 'live', 'offline'].includes(String(shop.status || ''))) {
    return jsonResponse(request, { error: 'Your shop must be verified before payment.' }, 403);
  }

  const setting = (settingResult.data?.value || {}) as { feeAmount?: number };
  const feeAmount = Number(setting.feeAmount) || 0;
  const amountCents = Math.round(feeAmount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 100) {
    return jsonResponse(request, { error: 'The registration fee has not been configured.' }, 409);
  }

  const { data: pendingRows, error: pendingError } = await admin
    .from('shop_payments')
    .select('id, paymentProvider, providerCheckoutId, providerCheckoutUrl, providerStatus, providerLivemode, referenceNumber, amount, createdAt')
    .eq('shopId', user.id)
    .eq('status', 'pending')
    .order('createdAt', { ascending: false })
    .limit(1);
  if (pendingError) {
    return jsonResponse(request, { error: 'Unable to check your current payment.' }, 500);
  }

  const pending = (pendingRows?.[0] || null) as PendingPayment | null;
  if (pending && pending.paymentProvider !== 'paymongo') {
    return jsonResponse(request, { error: 'Your existing payment proof is still awaiting admin review.' }, 409);
  }

  if (pending?.providerCheckoutId && pending.providerCheckoutUrl) {
    const existingResponse = await paymongoRequest(
      paymongoSecretKey,
      `${PAYMONGO_RETRIEVE_URL}/${encodeURIComponent(pending.providerCheckoutId)}`,
    );
    if (existingResponse.ok) {
      const existingJson = await existingResponse.json();
      const checkout = existingJson?.data;
      const reconciled = await reconcilePaidCheckout(admin, pending, checkout);
      if (reconciled) {
        return jsonResponse(request, { paid: true, paymentId: pending.id });
      }
      if (checkout?.attributes?.status === 'active') {
        return jsonResponse(request, {
          checkoutUrl: pending.providerCheckoutUrl,
          paymentId: pending.id,
          referenceNumber: pending.referenceNumber,
          livemode: pending.providerLivemode,
          reused: true,
        });
      }
      await rejectStaleCheckout(admin, pending.id, 'The PayMongo checkout expired. Start a new payment.', 'expired');
    } else if (existingResponse.status === 404) {
      await rejectStaleCheckout(admin, pending.id, 'The PayMongo checkout is no longer available. Start a new payment.', 'not_found');
    } else {
      return jsonResponse(request, { error: 'Unable to resume PayMongo checkout. Please try again.' }, 502);
    }
  } else if (pending) {
    const ageMs = Date.now() - new Date(pending.createdAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < 2 * 60 * 1000) {
      return jsonResponse(request, { error: 'Your checkout is still being prepared. Please try again in a moment.' }, 409);
    }
    await rejectStaleCheckout(admin, pending.id, 'Checkout preparation did not finish. Start a new payment.', 'failed');
  }

  const paymentId = crypto.randomUUID();
  const referenceNumber = `LC${paymentId.replace(/-/g, '').slice(0, 24)}`.toUpperCase();
  const payerName = String(ownerResult.data?.fullName || shop.shopName || user.email || 'LifeCycle seller').trim();
  const livemode = paymongoSecretKey.startsWith('sk_live_');

  const { error: insertError } = await admin.from('shop_payments').insert({
    id: paymentId,
    shopId: user.id,
    payerName,
    gcashName: '',
    gcashNumber: '',
    referenceNumber,
    amount: feeAmount,
    proofImageUrl: '',
    status: 'pending',
    paymentProvider: 'paymongo',
    providerStatus: 'creating',
    providerLivemode: livemode,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return jsonResponse(request, { error: 'A checkout is already being prepared. Please try again in a moment.' }, 409);
    }
    return jsonResponse(request, { error: 'Unable to prepare the payment record.' }, 500);
  }

  const checkoutBody = {
    data: {
      attributes: {
        line_items: [{
          name: 'LifeCycle shop registration / renewal',
          description: 'One month of storefront access after activation',
          amount: amountCents,
          currency: 'PHP',
          quantity: 1,
        }],
        payment_method_types: configuredPaymentMethods(),
        success_url: redirects.successUrl,
        cancel_url: redirects.cancelUrl,
        reference_number: referenceNumber,
        description: CHECKOUT_DESCRIPTION,
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        metadata: {
          purpose: 'shop_subscription',
          shop_id: user.id,
          lifecycle_payment_id: paymentId,
        },
      },
    },
  };

  const paymongoResponse = await paymongoRequest(paymongoSecretKey, PAYMONGO_CREATE_URL, {
    method: 'POST',
    headers: { 'Idempotency-Key': `lifecycle-shop-payment-${paymentId}` },
    body: JSON.stringify(checkoutBody),
  });
  const paymongoJson = await paymongoResponse.json().catch(() => null);
  if (!paymongoResponse.ok) {
    await rejectStaleCheckout(admin, paymentId, 'PayMongo could not create the checkout. Please try again.', 'failed');
    const errorCode = paymongoJson?.errors?.[0]?.code || 'checkout_failed';
    return jsonResponse(request, { error: 'PayMongo checkout is temporarily unavailable.', code: errorCode }, 502);
  }

  const checkout = paymongoJson?.data;
  const checkoutId = String(checkout?.id || '');
  const attributes = checkout?.attributes || {};
  const checkoutUrl = String(attributes.checkout_url || '');
  if (!checkoutId.startsWith('cs_') || !checkoutUrl.startsWith('https://checkout.paymongo.com/')) {
    await rejectStaleCheckout(admin, paymentId, 'PayMongo returned an invalid checkout response. Please try again.', 'failed');
    return jsonResponse(request, { error: 'PayMongo returned an invalid checkout response.' }, 502);
  }

  const { error: updateError } = await admin
    .from('shop_payments')
    .update({
      providerCheckoutId: checkoutId,
      providerCheckoutUrl: checkoutUrl,
      providerStatus: attributes.status || 'active',
      providerLivemode: Boolean(attributes.livemode),
    })
    .eq('id', paymentId)
    .eq('status', 'pending');
  if (updateError) {
    return jsonResponse(request, { error: 'Checkout was created but could not be saved. Contact support before retrying.' }, 500);
  }

  return jsonResponse(request, {
    checkoutUrl,
    paymentId,
    referenceNumber,
    livemode: Boolean(attributes.livemode),
    reused: false,
  });
});
