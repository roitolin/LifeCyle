// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const CREATE_SESSION_URL = 'https://api.xendit.co/sessions';
const MAX_BODY_BYTES = 16 * 1024;

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

function isObviouslyLiveKey(secretKey: string) {
  const key = secretKey.trim().toLowerCase();
  return key.startsWith('xnd_production_') ||
    key.startsWith('sk_live_') ||
    /^(?:live|production)[_-]/.test(key);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validProviderId(value: string) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function validSplitRuleId(value: string) {
  return /^splitru_[A-Za-z0-9-]{8,128}$/.test(value);
}

function firstRpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function amountDetails(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(String(value || '').trim());
  const cents = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(cents) || cents < 100 || cents > 1_000_000_000_00) {
    return null;
  }
  return { amount: cents / 100, cents };
}

function isTestCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' &&
      (host === 'checkout-staging.xendit.co' || host === 'dev.xen.to');
  } catch {
    return false;
  }
}

async function readJson(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  return JSON.parse(raw);
}

async function xenditRequest(secretKey: string, init: RequestInit) {
  return fetch(CREATE_SESSION_URL, {
    ...init,
    headers: {
      Authorization: basicAuth(secretKey),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const xenditSecretKey = Deno.env.get('XENDIT_SECRET_KEY')?.trim();
  const splitRuleId = Deno.env.get('XENDIT_SPLIT_RULE_ID')?.trim();
  const masterBusinessId = Deno.env.get('XENDIT_MASTER_BUSINESS_ID')?.trim();
  if (!supabaseUrl || !serviceRoleKey || !xenditSecretKey || !splitRuleId || !masterBusinessId) {
    return jsonResponse(request, { error: 'Xendit test checkout configuration is incomplete.' }, 503);
  }
  if (isObviouslyLiveKey(xenditSecretKey)) {
    return jsonResponse(request, { error: 'LifeCycle Xendit checkout is locked to test mode.' }, 503);
  }
  if (!validSplitRuleId(splitRuleId) || !validProviderId(masterBusinessId)) {
    return jsonResponse(request, { error: 'Xendit test checkout configuration is invalid.' }, 503);
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return jsonResponse(request, { error: 'Sign in before starting payment.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return jsonResponse(request, { error: 'Your session is invalid or expired.' }, 401);
  }

  let input: { requestId?: unknown };
  try {
    input = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid checkout request.' }, status);
  }
  const requestId = String(input?.requestId || '').trim().toLowerCase();
  if (!isUuid(requestId)) return jsonResponse(request, { error: 'A valid service request is required.' }, 400);

  const { data: serviceRequest, error: requestError } = await admin
    .from('funeral_service_requests')
    .select('id, requesterId, shopId, productName, status, providerStatus')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) return jsonResponse(request, { error: 'Unable to load the service request.' }, 500);
  if (!serviceRequest || serviceRequest.requesterId !== userData.user.id) {
    return jsonResponse(request, { error: 'This service request is not available to your account.' }, 403);
  }

  if (serviceRequest.status === 'payment_verified') {
    return jsonResponse(request, { paid: true, requestId, testMode: true, livemode: false });
  }
  if (serviceRequest.status === 'paid_waiting_for_split' || serviceRequest.providerStatus === 'paid_waiting_for_split') {
    return jsonResponse(request, { waitingForSplit: true, requestId, testMode: true, livemode: false });
  }
  if (serviceRequest.status === 'commission_failed' || serviceRequest.providerStatus === 'commission_failed') {
    return jsonResponse(request, { error: 'The commission split failed. Contact an administrator.' }, 409);
  }
  if (serviceRequest.status !== 'awaiting_payment') {
    return jsonResponse(request, { error: 'This service request is not awaiting payment.' }, 409);
  }

  const { data: shop, error: shopError } = await admin
    .from('funeral_shops')
    .select('id, xenditAccountId, xenditProvisioningStatus')
    .eq('id', serviceRequest.shopId)
    .maybeSingle();
  const shopAccountId = String(shop?.xenditAccountId || '').trim();
  if (shopError) return jsonResponse(request, { error: 'Unable to load the funeral shop payment account.' }, 500);
  if (!shop || !validProviderId(shopAccountId) || shop.xenditProvisioningStatus !== 'provisioned') {
    return jsonResponse(request, { error: 'The funeral shop is not ready for Xendit payments.' }, 409);
  }

  const idempotencyKey = `lifecycle-service-${requestId}`;
  const { data: claimData, error: claimError } = await admin.rpc('claim_xendit_service_checkout', {
    p_request_id: requestId,
    p_idempotency_key: idempotencyKey,
    p_shop_account_id: shopAccountId,
    p_split_rule_id: splitRuleId,
    p_master_business_id: masterBusinessId,
    p_currency: 'PHP',
    p_livemode: false,
  });
  if (claimError) {
    console.error('Unable to claim Xendit service checkout:', claimError.code || 'unknown');
    return jsonResponse(request, { error: 'Unable to prepare this checkout.' }, 409);
  }

  const claim = firstRpcRow<any>(claimData);
  if (!claim || claim.requestId !== requestId) {
    return jsonResponse(request, { error: 'Unable to prepare this checkout.' }, 500);
  }

  const existingCheckoutId = String(claim.checkoutId || '').trim();
  const existingCheckoutUrl = String(claim.checkoutUrl || '').trim();
  if (!claim.shouldCreate && validProviderId(existingCheckoutId) && isTestCheckoutUrl(existingCheckoutUrl)) {
    return jsonResponse(request, {
      checkoutUrl: existingCheckoutUrl,
      paymentSessionId: existingCheckoutId,
      requestId,
      reused: true,
      testMode: true,
      livemode: false,
    });
  }
  if (!claim.shouldCreate || claim.inProgress) {
    return jsonResponse(request, { error: 'Checkout is being prepared. Try again in a moment.' }, 409);
  }

  const gross = amountDetails(claim.amount);
  const commission = amountDetails(claim.commissionAmount);
  const shopNet = amountDetails(claim.shopNetAmount);
  const referenceId = String(claim.referenceId || '').trim();
  const checkoutClaimId = String(claim.checkoutClaimId || '').trim();
  const commissionRate = Number(claim.commissionRate);
  const safeClaim = gross && commission && shopNet &&
    claim.shopAccountId === shopAccountId &&
    claim.splitRuleId === splitRuleId &&
    claim.masterBusinessId === masterBusinessId &&
    claim.idempotencyKey === idempotencyKey &&
    claim.currency === 'PHP' &&
    claim.livemode === false &&
    Math.abs(commissionRate - 0.3) < 0.000001 &&
    commission.cents === Math.round(gross.cents * 0.3) &&
    shopNet.cents === gross.cents - commission.cents &&
    isUuid(referenceId) &&
    isUuid(checkoutClaimId);
  if (!safeClaim || !gross) {
    return jsonResponse(request, { error: 'The authoritative casket price or commission is invalid.' }, 409);
  }

  const productName = String(serviceRequest.productName || 'Casket').trim().slice(0, 80);
  const checkoutBody = {
    reference_id: referenceId,
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount: gross.amount,
    currency: 'PHP',
    country: 'PH',
    capture_method: 'AUTOMATIC',
    allowed_payment_channels: ['CARDS'],
    locale: 'en',
    description: `LifeCycle casket payment - ${productName}`.slice(0, 200),
    metadata: {
      purpose: 'lifecycle_casket_payment',
      request_id: requestId,
      shop_id: String(serviceRequest.shopId),
      commission_percent: '30',
    },
  };

  const xenditResponse = await xenditRequest(xenditSecretKey, {
    method: 'POST',
    headers: {
      'for-user-id': shopAccountId,
      'with-split-rule': splitRuleId,
    },
    body: JSON.stringify(checkoutBody),
  }).catch(() => null);
  const responseJson = xenditResponse ? await xenditResponse.json().catch(() => null) : null;
  if (!xenditResponse?.ok) {
    const code = String(responseJson?.error_code || 'checkout_failed').slice(0, 80);
    console.error('Xendit service checkout creation failed:', code);
    return jsonResponse(request, { error: 'Xendit test checkout is temporarily unavailable.', code }, 502);
  }

  const paymentSessionId = String(responseJson?.payment_session_id || '').trim();
  const paymentLinkUrl = String(responseJson?.payment_link_url || '').trim();
  const responseAmount = amountDetails(responseJson?.amount);
  const responseBusinessId = String(responseJson?.business_id || '').trim();
  const validResponse = validProviderId(paymentSessionId) &&
    paymentSessionId.startsWith('ps-') &&
    isTestCheckoutUrl(paymentLinkUrl) &&
    String(responseJson?.status || '').toUpperCase() === 'ACTIVE' &&
    responseJson?.reference_id === referenceId &&
    responseJson?.currency === 'PHP' &&
    responseAmount?.cents === gross.cents &&
    (!responseBusinessId || responseBusinessId === shopAccountId);
  if (!validResponse) {
    return jsonResponse(request, { error: 'Xendit returned an invalid test checkout.' }, 502);
  }

  const { data: storedData, error: storeError } = await admin.rpc('store_xendit_service_checkout', {
    p_request_id: requestId,
    p_checkout_claim_id: checkoutClaimId,
    p_idempotency_key: idempotencyKey,
    p_payment_session_id: paymentSessionId,
    p_payment_link_url: paymentLinkUrl,
    p_shop_account_id: shopAccountId,
    p_amount: gross.amount,
    p_currency: 'PHP',
    p_livemode: false,
  });
  const stored = firstRpcRow<any>(storedData);
  if (storeError || !stored || stored.checkoutId !== paymentSessionId || stored.checkoutUrl !== paymentLinkUrl) {
    console.error('Unable to persist the Xendit service checkout.');
    return jsonResponse(request, { error: 'Checkout was created but could not be saved safely.' }, 500);
  }

  return jsonResponse(request, {
    checkoutUrl: paymentLinkUrl,
    paymentSessionId,
    requestId,
    reused: false,
    testMode: true,
    livemode: false,
  });
});
