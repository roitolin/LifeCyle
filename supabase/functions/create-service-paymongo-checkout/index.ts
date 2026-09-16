// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const CREATE_URL = 'https://api.paymongo.com/v2/checkout_sessions';
const RETRIEVE_URL = 'https://api.paymongo.com/v1/checkout_sessions';

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function configuredMethods() {
  return [...new Set(
    (Deno.env.get('PAYMONGO_PAYMENT_METHODS') || 'qrph')
      .split(',')
      .map((method) => method.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function safeWebUrl(request: Request, value: string) {
  try {
    const url = new URL(value);
    const origin = request.headers.get('origin');
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    return Boolean(origin) && url.origin === origin && (url.protocol === 'https:' || local);
  } catch {
    return false;
  }
}

function returnUrls(request: Request, platform: string, requested: string, requestId: string) {
  if (platform === 'mobile') {
    return {
      success: `lifecycle://paymongo-service-payment?status=success&requestId=${encodeURIComponent(requestId)}`,
      cancel: `lifecycle://paymongo-service-payment?status=cancelled&requestId=${encodeURIComponent(requestId)}`,
    };
  }
  if (!safeWebUrl(request, requested)) throw new Error('The checkout return URL is not allowed.');
  const success = new URL(requested);
  success.searchParams.set('paymongo', 'success');
  success.searchParams.set('requestId', requestId);
  const cancel = new URL(requested);
  cancel.searchParams.set('paymongo', 'cancelled');
  cancel.searchParams.set('requestId', requestId);
  return { success: success.toString(), cancel: cancel.toString() };
}

async function paymongo(secretKey: string, url: string, init?: RequestInit) {
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

function paidPayment(attributes: any) {
  const payments = Array.isArray(attributes?.payments) ? attributes.payments : [];
  return payments.find((payment: any) => payment?.attributes?.status === 'paid') || null;
}

async function reconcile(admin: any, requestRow: any, checkout: any) {
  const attributes = checkout?.attributes || {};
  const payment = paidPayment(attributes);
  if (!payment) return false;
  const paymentAttributes = payment.attributes || {};
  const { error } = await admin.rpc('complete_paymongo_service_payment', {
    p_event_id: `reconcile:${checkout.id}:${payment.id}`,
    p_checkout_id: checkout.id,
    p_reference_number: attributes.reference_number || requestRow.paymentReferenceNumber || '',
    p_provider_payment_id: payment.id || '',
    p_payment_method: paymentAttributes.source?.type || '',
    p_amount_cents: Number(paymentAttributes.amount) || 0,
    p_livemode: Boolean(attributes.livemode),
    p_payer_name: paymentAttributes.billing?.name || null,
  });
  if (error) throw error;
  return true;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
  if (!supabaseUrl || !serviceRoleKey || !secretKey) {
    return jsonResponse(request, { error: 'Payment service configuration is incomplete.' }, 503);
  }
  if (!secretKey.startsWith('sk_test_')) {
    return jsonResponse(request, { error: 'LifeCycle customer payments are locked to PayMongo test mode.' }, 503);
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return jsonResponse(request, { error: 'Sign in before starting payment.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) return jsonResponse(request, { error: 'Your session is invalid or expired.' }, 401);

  let input: { requestId?: string; platform?: string; returnUrl?: string };
  try {
    input = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid checkout request.' }, 400);
  }
  const requestId = String(input.requestId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return jsonResponse(request, { error: 'A valid service request is required.' }, 400);
  }

  const { data: serviceRequest, error: requestError } = await admin
    .from('funeral_service_requests')
    .select('id, requesterId, shopId, shopName, productName, paymentAmount, status, paymentReferenceNumber, paymentProvider, providerCheckoutId, providerCheckoutUrl, providerStatus, providerLivemode, providerCheckoutCreatedAt')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) return jsonResponse(request, { error: 'Unable to load the service request.' }, 500);
  if (!serviceRequest || serviceRequest.requesterId !== userData.user.id) {
    return jsonResponse(request, { error: 'This service request is not available to your account.' }, 403);
  }
  if (serviceRequest.status === 'payment_verified') {
    return jsonResponse(request, { paid: true, requestId });
  }
  if (serviceRequest.status !== 'awaiting_payment') {
    return jsonResponse(request, { error: 'This service request is not awaiting payment.' }, 409);
  }

  const amount = Number(serviceRequest.paymentAmount) || 0;
  const amountCents = Math.round(amount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 100) {
    return jsonResponse(request, { error: 'The funeral shop has not set a valid service amount.' }, 409);
  }

  let redirects: { success: string; cancel: string };
  try {
    redirects = returnUrls(request, String(input.platform || ''), String(input.returnUrl || ''), requestId);
  } catch (error) {
    return jsonResponse(request, { error: error instanceof Error ? error.message : 'Invalid return URL.' }, 400);
  }

  if (serviceRequest.providerCheckoutId && serviceRequest.providerCheckoutUrl) {
    const existingResponse = await paymongo(
      secretKey,
      `${RETRIEVE_URL}/${encodeURIComponent(serviceRequest.providerCheckoutId)}`,
    );
    if (existingResponse.ok) {
      const existing = (await existingResponse.json())?.data;
      if (await reconcile(admin, serviceRequest, existing)) {
        return jsonResponse(request, { paid: true, requestId });
      }
      if (existing?.attributes?.status === 'active') {
        return jsonResponse(request, {
          checkoutUrl: serviceRequest.providerCheckoutUrl,
          requestId,
          livemode: serviceRequest.providerLivemode,
          reused: true,
        });
      }
    }
    const { error: clearError } = await admin.from('funeral_service_requests').update({
      providerCheckoutId: null,
      providerCheckoutUrl: null,
      providerStatus: 'expired',
    }).eq('id', requestId).eq('status', 'awaiting_payment');
    if (clearError) return jsonResponse(request, { error: 'Unable to reset the expired checkout.' }, 500);
  }

  const creatingSince = serviceRequest.providerCheckoutCreatedAt
    ? new Date(serviceRequest.providerCheckoutCreatedAt).getTime()
    : 0;
  if (serviceRequest.providerStatus === 'creating' && Date.now() - creatingSince < 120000) {
    return jsonResponse(request, { error: 'Checkout is being prepared. Try again in a moment.' }, 409);
  }

  const referenceNumber = `SR${requestId.replace(/-/g, '').slice(0, 28)}`.toUpperCase();
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('funeral_service_requests')
    .update({
      paymentProvider: 'paymongo',
      paymentReferenceNumber: referenceNumber,
      providerStatus: 'creating',
      providerLivemode: secretKey.startsWith('sk_live_'),
      providerCheckoutCreatedAt: now,
      updatedAt: now,
    })
    .eq('id', requestId)
    .eq('status', 'awaiting_payment')
    .or('providerStatus.is.null,providerStatus.neq.creating')
    .select('id')
    .maybeSingle();
  if (claimError || !claimed) return jsonResponse(request, { error: 'Unable to prepare this checkout.' }, 409);

  const checkoutBody = {
    data: {
      attributes: {
        line_items: [{
          name: String(serviceRequest.productName || 'Funeral service').slice(0, 120),
          description: `Payment to ${String(serviceRequest.shopName || 'funeral shop').slice(0, 100)}`,
          amount: amountCents,
          currency: 'PHP',
          quantity: 1,
        }],
        payment_method_types: configuredMethods(),
        success_url: redirects.success,
        cancel_url: redirects.cancel,
        reference_number: referenceNumber,
        description: 'LifeCycle funeral service payment',
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        metadata: {
          purpose: 'funeral_service_payment',
          request_id: requestId,
          shop_id: serviceRequest.shopId,
          requester_id: userData.user.id,
        },
      },
    },
  };

  const checkoutResponse = await paymongo(secretKey, CREATE_URL, {
    method: 'POST',
    headers: { 'Idempotency-Key': `lifecycle-service-${requestId}-${Date.now()}` },
    body: JSON.stringify(checkoutBody),
  });
  const responseJson = await checkoutResponse.json().catch(() => null);
  if (!checkoutResponse.ok) {
    await admin.from('funeral_service_requests').update({
      providerStatus: 'failed',
      providerCheckoutCreatedAt: null,
    }).eq('id', requestId).eq('status', 'awaiting_payment');
    return jsonResponse(request, {
      error: 'PayMongo checkout is temporarily unavailable.',
      code: responseJson?.errors?.[0]?.code || 'checkout_failed',
    }, 502);
  }

  const checkout = responseJson?.data;
  const checkoutId = String(checkout?.id || '');
  const attributes = checkout?.attributes || {};
  const checkoutUrl = String(attributes.checkout_url || '');
  if (!checkoutId.startsWith('cs_') || !checkoutUrl.startsWith('https://checkout.paymongo.com/')) {
    await admin.from('funeral_service_requests').update({
      providerStatus: 'failed',
      providerCheckoutCreatedAt: null,
    }).eq('id', requestId).eq('status', 'awaiting_payment');
    return jsonResponse(request, { error: 'PayMongo returned an invalid checkout response.' }, 502);
  }

  const { error: saveError } = await admin.from('funeral_service_requests').update({
    providerCheckoutId: checkoutId,
    providerCheckoutUrl: checkoutUrl,
    providerStatus: attributes.status || 'active',
    providerLivemode: Boolean(attributes.livemode),
    providerCheckoutCreatedAt: now,
    updatedAt: new Date().toISOString(),
  }).eq('id', requestId).eq('status', 'awaiting_payment');
  if (saveError) return jsonResponse(request, { error: 'Checkout was created but could not be saved.' }, 500);

  return jsonResponse(request, {
    checkoutUrl,
    requestId,
    livemode: Boolean(attributes.livemode),
    reused: false,
  });
});
