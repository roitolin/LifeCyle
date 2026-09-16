// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const CREATE_SESSION_URL = 'https://api.xendit.co/sessions';
const SHOP_PAYMENT_SETTING_KEY = 'payment_qr_code';
const MAX_BODY_BYTES = 16 * 1024;

type CheckoutRequest = {
  platform?: 'mobile' | 'web';
  returnUrl?: string;
  action?: 'create' | 'sync';
  paymentMethod?: 'all' | 'gcash' | 'ewallets' | 'cards' | 'qrph' | 'bank_transfer';
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
  providerChannelSelection: string | null;
};

const PAYMENT_CHANNELS: Record<string, string[] | null> = {
  all: null,
  gcash: ['GCASH'],
  ewallets: ['GRABPAY', 'SHOPEEPAY'],
  cards: ['CARDS'],
  qrph: ['QRPH'],
  bank_transfer: ['BANK_TRANSFER'],
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

function isObviouslyLiveKey(secretKey: string) {
  const key = secretKey.trim().toLowerCase();
  return key.startsWith('xnd_production_') ||
    key.startsWith('sk_live_') ||
    /^(?:live|production)[_-]/.test(key);
}

function validProviderId(value: string) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function checkoutFailure(errorCode: string, responseStatus: number) {
  const code = errorCode.trim().toUpperCase();
  if (responseStatus === 401 || code === 'INVALID_CREDENTIALS') {
    return {
      code: code || 'INVALID_CREDENTIALS',
      message: 'The Xendit Test API key is invalid or expired. Ask an administrator to update the Xendit secret.',
    };
  }
  if (responseStatus === 403 || code === 'REQUEST_FORBIDDEN_ERROR') {
    return {
      code: code || 'REQUEST_FORBIDDEN_ERROR',
      message: 'The Xendit Test API key does not have permission to create Payment Sessions.',
    };
  }
  if (code === 'INVALID_PAYMENT_CHANNEL') {
    return {
      code,
      message: 'No Xendit test payment channel is available for this checkout.',
    };
  }
  if (code === 'API_VALIDATION_ERROR' || code === 'MISSING_CUSTOMER') {
    return {
      code,
      message: 'Xendit rejected the checkout settings. Ask an administrator to review the Test Mode configuration.',
    };
  }
  return {
    code: code || 'CHECKOUT_FAILED',
    message: 'Xendit Test Mode checkout is temporarily unavailable.',
  };
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

function safeWebReturnUrl(request: Request, value: string) {
  try {
    const parsed = new URL(value);
    const requestOrigin = request.headers.get('origin');
    return parsed.protocol === 'https:' && Boolean(requestOrigin) && parsed.origin === requestOrigin;
  } catch {
    return false;
  }
}

function webReturnUrls(request: Request, payload: CheckoutRequest) {
  if (payload.platform !== 'web') return {};
  const requested = payload.returnUrl?.trim() || '';
  if (!safeWebReturnUrl(request, requested)) return {};

  const success = new URL(requested);
  success.searchParams.set('xendit', 'success');
  const cancelled = new URL(requested);
  cancelled.searchParams.set('xendit', 'cancelled');
  return {
    success_return_url: success.toString(),
    cancel_return_url: cancelled.toString(),
  };
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

function recentlyAuthenticatedWithPassword(accessToken: string, maxAgeSeconds = 5 * 60) {
  try {
    const payloadPart = accessToken.split('.')[1];
    if (!payloadPart) return false;
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded)) as {
      amr?: { method?: string; timestamp?: number }[];
    };
    const latestPasswordAuth = (claims.amr || [])
      .filter((entry) => entry?.method === 'password' && Number.isFinite(entry.timestamp))
      .reduce((latest, entry) => Math.max(latest, Number(entry.timestamp)), 0);
    const ageSeconds = Math.floor(Date.now() / 1000) - latestPasswordAuth;
    return latestPasswordAuth > 0 && ageSeconds >= 0 && ageSeconds <= maxAgeSeconds;
  } catch {
    return false;
  }
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

async function getXenditSession(secretKey: string, checkoutId: string) {
  return fetch(`${CREATE_SESSION_URL}/${encodeURIComponent(checkoutId)}`, {
    method: 'GET',
    headers: {
      Authorization: basicAuth(secretKey),
      Accept: 'application/json',
    },
  });
}

async function rejectPending(
  admin: any,
  paymentId: string,
  reason: string,
  providerStatus: string,
) {
  const { error } = await admin
    .from('shop_payments')
    .update({
      status: 'rejected',
      providerStatus,
      rejectionReason: reason,
      verifiedAt: null,
      expiresAt: null,
    })
    .eq('id', paymentId)
    .eq('status', 'pending');
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const xenditSecretKey = Deno.env.get('XENDIT_SECRET_KEY')?.trim() || '';
  const masterBusinessId = Deno.env.get('XENDIT_MASTER_BUSINESS_ID')?.trim() || '';
  if (!supabaseUrl || !serviceRoleKey || !xenditSecretKey || !validProviderId(masterBusinessId)) {
    return jsonResponse(request, { error: 'Xendit shop payment configuration is incomplete.' }, 503);
  }
  if (isObviouslyLiveKey(xenditSecretKey)) {
    return jsonResponse(request, { error: 'LifeCycle shop payments are locked to Xendit Test Mode.' }, 503);
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return jsonResponse(request, { error: 'You must be signed in to start checkout.' }, 401);

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
    payload = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid checkout request.' }, status);
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
  if (!shop || !['verified', 'live', 'offline'].includes(String(shop.status || '').toLowerCase())) {
    return jsonResponse(request, { error: 'Your shop must be verified before payment.' }, 403);
  }

  const selectedPaymentMethod = String(payload.paymentMethod || 'all').trim().toLowerCase();
  if (!(selectedPaymentMethod in PAYMENT_CHANNELS)) {
    return jsonResponse(request, { error: 'Choose a supported Xendit Test payment method.' }, 400);
  }
  if (selectedPaymentMethod === 'gcash' && (!user.phone || !user.phone_confirmed_at)) {
    return jsonResponse(request, { error: 'Verify the shop-owner mobile number before using GCash.' }, 403);
  }
  if (selectedPaymentMethod === 'gcash' && !recentlyAuthenticatedWithPassword(accessToken)) {
    return jsonResponse(request, { error: 'Confirm your LifeCycle password again before using GCash.' }, 401);
  }
  const allowedPaymentChannels = PAYMENT_CHANNELS[selectedPaymentMethod];

  const setting = (settingResult.data?.value || {}) as { feeAmount?: number };
  const feeAmount = Number(setting.feeAmount) || 0;
  const feeCents = Math.round(feeAmount * 100);
  if (!Number.isSafeInteger(feeCents) || feeCents < 100) {
    return jsonResponse(request, { error: 'The registration fee has not been configured.' }, 409);
  }
  const authoritativeFee = feeCents / 100;

  let pendingQuery = admin
    .from('shop_payments')
    .select('id, paymentProvider, providerCheckoutId, providerCheckoutUrl, providerStatus, providerLivemode, referenceNumber, amount, createdAt, providerChannelSelection')
    .eq('shopId', user.id)
    .eq('status', 'pending')
    .order('createdAt', { ascending: false });
  if (payload.action === 'sync') {
    pendingQuery = pendingQuery.eq('paymentProvider', 'xendit');
  }
  const { data: pendingRows, error: pendingError } = await pendingQuery.limit(1);
  if (pendingError) {
    return jsonResponse(request, { error: 'Unable to check your current payment.' }, 500);
  }

  const pending = (pendingRows?.[0] || null) as PendingPayment | null;
  if (payload.action === 'sync') {
    if (!pending) {
      return jsonResponse(request, { synced: true, paid: false, status: 'none' });
    }

    const checkoutId = String(pending.providerCheckoutId || '').trim();
    if (!validProviderId(checkoutId) || !checkoutId.startsWith('ps-') || pending.providerLivemode !== false) {
      return jsonResponse(request, { synced: false, paid: false, status: 'preparing' });
    }

    const sessionResponse = await getXenditSession(xenditSecretKey, checkoutId).catch(() => null);
    const session = sessionResponse ? await sessionResponse.json().catch(() => null) : null;
    if (!sessionResponse?.ok) {
      const failure = checkoutFailure(
        String(session?.error_code || (sessionResponse ? 'session_lookup_failed' : 'network_error')).slice(0, 80),
        sessionResponse?.status || 0,
      );
      console.error('Xendit shop session synchronization failed:', sessionResponse?.status || 0, failure.code);
      return jsonResponse(request, { error: failure.message, code: failure.code }, 502);
    }

    const status = String(session?.status || '').toUpperCase();
    const sessionAmountCents = Math.round(Number(session?.amount) * 100);
    const pendingAmountCents = Math.round(Number(pending.amount) * 100);
    const validSession = String(session?.payment_session_id || '') === checkoutId &&
      String(session?.reference_id || '') === pending.referenceNumber &&
      String(session?.currency || '') === 'PHP' &&
      String(session?.business_id || '') === masterBusinessId &&
      Number.isSafeInteger(sessionAmountCents) &&
      sessionAmountCents === pendingAmountCents &&
      ['ACTIVE', 'COMPLETED', 'EXPIRED'].includes(status);
    if (!validSession) {
      return jsonResponse(request, { error: 'Xendit returned an invalid Test Mode payment status.' }, 502);
    }

    if (status === 'ACTIVE') {
      return jsonResponse(request, { synced: true, paid: false, status: 'pending' });
    }

    const providerPaymentId = status === 'COMPLETED'
      ? String(session?.payment_id || '').trim()
      : '';
    if (status === 'COMPLETED' && !validProviderId(providerPaymentId)) {
      return jsonResponse(request, { error: 'Xendit has not attached a completed payment to this Session yet.' }, 409);
    }

    const eventKind = status === 'COMPLETED' ? 'payment_completed' : 'payment_expired';
    const eventId = status === 'COMPLETED'
      ? `xendit:session-sync:${checkoutId}:${providerPaymentId}`
      : `xendit:session-sync:${checkoutId}:expired`;
    const { data: syncData, error: syncError } = await admin.rpc('reconcile_xendit_shop_payment_event', {
      p_event_id: eventId,
      p_event_type: 'payment_session.status_sync',
      p_event_kind: eventKind,
      p_checkout_id: checkoutId,
      p_reference_number: pending.referenceNumber,
      p_provider_payment_id: providerPaymentId || null,
      p_payment_method: null,
      p_business_id: masterBusinessId,
      p_currency: 'PHP',
      p_amount: status === 'COMPLETED' ? Number(session.amount) : null,
      p_livemode: false,
      p_payer_name: null,
      p_payload: {
        event: 'payment_session.status_sync',
        status,
        paymentSessionId: checkoutId,
        paymentId: providerPaymentId || null,
        referenceId: pending.referenceNumber,
        businessId: masterBusinessId,
        currency: 'PHP',
        amount: Number(session.amount),
      },
    });
    if (syncError) {
      console.error('Unable to reconcile the Xendit shop Session:', syncError.code || 'unknown');
      return jsonResponse(request, { error: 'Unable to verify the completed Xendit payment.' }, 500);
    }
    const syncResult = Array.isArray(syncData) ? syncData[0] : syncData;
    return jsonResponse(request, {
      synced: true,
      paid: syncResult?.status === 'verified',
      paymentId: pending.id,
      status: syncResult?.status || (status === 'EXPIRED' ? 'pending' : 'verified'),
      providerStatus: syncResult?.providerStatus || null,
      testMode: true,
      livemode: false,
    });
  }

  if (pending?.paymentProvider === 'manual') {
    return jsonResponse(request, { error: 'Your existing payment proof is still awaiting admin review.' }, 409);
  }

  if (pending?.paymentProvider === 'xendit') {
    const createdAt = new Date(pending.createdAt).getTime();
    const ageMs = Date.now() - createdAt;
    const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 30 * 60 * 1000;
    const active = !['expired', 'failed', 'not_found'].includes(String(pending.providerStatus || '').toLowerCase());
    if (
      fresh &&
      active &&
      String(pending.providerChannelSelection || 'all') === selectedPaymentMethod &&
      validProviderId(String(pending.providerCheckoutId || '')) &&
      isTestCheckoutUrl(String(pending.providerCheckoutUrl || '')) &&
      pending.providerLivemode === false
    ) {
      return jsonResponse(request, {
        checkoutUrl: pending.providerCheckoutUrl,
        paymentId: pending.id,
        referenceNumber: pending.referenceNumber,
        reused: true,
        testMode: true,
        livemode: false,
      });
    }
    if (fresh && !pending.providerCheckoutId && !pending.providerCheckoutUrl) {
      return jsonResponse(request, { error: 'Your Xendit checkout is still being prepared. Try again in a moment.' }, 409);
    }
    await rejectPending(admin, pending.id, 'The Xendit checkout expired. Start a new payment.', 'expired');
  } else if (pending?.paymentProvider === 'paymongo') {
    await rejectPending(admin, pending.id, 'PayMongo checkout was retired. Start a new Xendit payment.', 'provider_retired');
  }

  const paymentId = crypto.randomUUID();
  const referenceNumber = `XS${paymentId.replace(/-/g, '').slice(0, 24)}`.toUpperCase();
  const payerName = String(ownerResult.data?.fullName || shop.shopName || user.email || 'LifeCycle seller')
    .trim()
    .slice(0, 200);

  const { error: insertError } = await admin.from('shop_payments').insert({
    id: paymentId,
    shopId: user.id,
    payerName,
    gcashName: '',
    gcashNumber: '',
    referenceNumber,
    amount: authoritativeFee,
    proofImageUrl: '',
    status: 'pending',
    paymentProvider: 'xendit',
    providerStatus: 'creating',
    providerLivemode: false,
    providerBusinessId: masterBusinessId,
    providerCurrency: 'PHP',
    providerChannelSelection: selectedPaymentMethod,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return jsonResponse(request, { error: 'A checkout is already being prepared. Try again in a moment.' }, 409);
    }
    return jsonResponse(request, { error: 'Unable to prepare the payment record.' }, 500);
  }

  const returnUrls = webReturnUrls(request, payload);
  const sessionBody = {
    reference_id: referenceNumber,
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount: authoritativeFee,
    currency: 'PHP',
    country: 'PH',
    capture_method: 'AUTOMATIC',
    allow_save_payment_method: 'DISABLED',
    locale: 'en',
    description: 'LifeCycle shop registration and renewal',
    metadata: {
      purpose: 'shop_subscription',
      shop_id: user.id,
      lifecycle_payment_id: paymentId,
      selected_payment_method: selectedPaymentMethod,
    },
    ...(allowedPaymentChannels ? { allowed_payment_channels: allowedPaymentChannels } : {}),
    ...returnUrls,
  };

  const xenditResponse = await xenditRequest(xenditSecretKey, {
    method: 'POST',
    body: JSON.stringify(sessionBody),
  }).catch(() => null);
  const responseJson = xenditResponse ? await xenditResponse.json().catch(() => null) : null;
  if (!xenditResponse?.ok) {
    const failure = checkoutFailure(
      String(responseJson?.error_code || (xenditResponse ? 'checkout_failed' : 'network_error')).slice(0, 80),
      xenditResponse?.status || 0,
    );
    await rejectPending(admin, paymentId, failure.message, 'failed');
    console.error('Xendit shop checkout creation failed:', xenditResponse?.status || 0, failure.code);
    return jsonResponse(request, { error: failure.message, code: failure.code }, 502);
  }

  const checkoutId = String(responseJson?.payment_session_id || '').trim();
  const checkoutUrl = String(responseJson?.payment_link_url || '').trim();
  const responseAmount = Number(responseJson?.amount);
  const responseBusinessId = String(responseJson?.business_id || '').trim();
  const validResponse = validProviderId(checkoutId) &&
    checkoutId.startsWith('ps-') &&
    isTestCheckoutUrl(checkoutUrl) &&
    String(responseJson?.status || '').toUpperCase() === 'ACTIVE' &&
    String(responseJson?.reference_id || '') === referenceNumber &&
    String(responseJson?.currency || '') === 'PHP' &&
    Math.round(responseAmount * 100) === feeCents &&
    responseBusinessId === masterBusinessId;
  if (!validResponse) {
    await rejectPending(admin, paymentId, 'Xendit returned an invalid checkout response. Try again.', 'failed');
    return jsonResponse(request, { error: 'Xendit returned an invalid Test Mode checkout.' }, 502);
  }

  const { data: stored, error: updateError } = await admin
    .from('shop_payments')
    .update({
      providerCheckoutId: checkoutId,
      providerCheckoutUrl: checkoutUrl,
      providerStatus: 'checkout_created',
      providerCheckoutCreatedAt: new Date().toISOString(),
    })
    .eq('id', paymentId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (updateError || !stored) {
    console.error('Unable to persist Xendit shop checkout:', updateError?.code || 'not_updated');
    return jsonResponse(request, { error: 'Checkout was created but could not be saved safely.' }, 500);
  }

  return jsonResponse(request, {
    checkoutUrl,
    paymentId,
    referenceNumber,
    reused: false,
    testMode: true,
    livemode: false,
  });
});
