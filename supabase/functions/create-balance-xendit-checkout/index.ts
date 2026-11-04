// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';
import { consumeUserRateLimit } from '../_shared/security.ts';
import { SHOP_CHECKOUT_CHANNELS, availableShopCheckoutChannels, matchesAllowedPaymentChannels } from '../_shared/shopCheckoutChannels.ts';

const CREATE_SESSION_URL = 'https://api.xendit.co/sessions';
const MAX_BODY_BYTES = 16 * 1024;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;

const PAYMENT_METHODS = [
  // ANY lets the customer choose among this shop's configured channels.
  { accountChannel: 'ANY', providerChannel: null },
  ...SHOP_CHECKOUT_CHANNELS,
] as const;

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
    headers: {
      ...corsHeaders(request),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function apiKeyOnlyFetch(secretKey: string) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (secretKey.startsWith('sb_secret_')) {
      const headers = new Headers(request.headers);
      if (headers.get('authorization') === `Bearer ${secretKey}`) {
        headers.delete('authorization');
        return fetch(new Request(request, { headers }));
      }
    }
    return fetch(request);
  };
}

function basicAuth(secretKey: string) {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

function isObviouslyLiveKey(secretKey: string) {
  const key = secretKey.trim().toLowerCase();
  return key.startsWith('xnd_production_') || key.startsWith('sk_live_') || /^(?:live|production)[_-]/.test(key);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validProviderId(value: string) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function firstRpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function amountDetails(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(String(value || '').trim());
  const cents = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(cents) || cents < 100 || cents > 100_000_000_000) {
    return null;
  }
  return { amount: cents / 100, cents };
}

function isTestCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'checkout-staging.xendit.co' || host === 'dev.xen.to');
  } catch {
    return false;
  }
}

async function readJson(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error('body_too_large');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error('body_too_large');
  return JSON.parse(raw);
}

async function getSession(secretKey: string, checkoutId: string) {
  return fetch(`${CREATE_SESSION_URL}/${encodeURIComponent(checkoutId)}`, {
    method: 'GET',
    headers: { Authorization: basicAuth(secretKey), Accept: 'application/json' },
  });
}

async function cancelSession(secretKey: string, checkoutId: string) {
  return fetch(`${CREATE_SESSION_URL}/${encodeURIComponent(checkoutId)}/cancel`, {
    method: 'POST',
    headers: { Authorization: basicAuth(secretKey), Accept: 'application/json' },
  });
}

async function releaseFailedClaim(
  admin: any,
  paymentId: string,
  checkoutClaimId: string,
  reason: string,
) {
  const { error } = await admin.rpc('release_xendit_balance_checkout', {
    p_payment_id: paymentId,
    p_checkout_claim_id: checkoutClaimId,
    p_reason: reason,
  });
  if (error) {
    console.error('Unable to release failed Xendit balance claim:', error.code || 'unknown');
  }
}

async function reconcileSession(
  admin: any,
  secretKey: string,
  payment: {
    paymentId: string;
    requestId: string;
    referenceId: string;
    checkoutId: string;
    amount: number;
    paymentMethod?: string;
  },
) {
  const response = await getSession(secretKey, payment.checkoutId).catch(() => null);
  const session = response ? await response.json().catch(() => null) : null;
  const status = String(session?.status || '').toUpperCase();

  if (status === 'COMPLETED') {
    const providerPaymentId = String(session?.payment_id || '').trim();
    const sessionAmount = amountDetails(session?.amount);
    const sessionReference = String(session?.reference_id || '').trim().toLowerCase();
    if (!providerPaymentId || !validProviderId(providerPaymentId) || sessionReference !== payment.referenceId || sessionAmount?.cents !== Math.round(payment.amount * 100)) {
      throw new Error('The completed payment could not be verified safely.');
    }
    const { data, error } = await admin.rpc('reconcile_xendit_balance_event', {
      p_event_id: `xendit:balance-sync:${payment.checkoutId}:${providerPaymentId}`,
      p_event_kind: 'payment_completed',
      p_checkout_id: payment.checkoutId,
      p_reference_id: payment.referenceId,
      p_provider_payment_id: providerPaymentId,
      p_currency: 'PHP',
      p_amount: sessionAmount.amount,
      p_livemode: false,
      p_payment_method: String(session?.payment_channel || session?.channel_code || payment.paymentMethod || ''),
    });
    if (error) throw error;
    return { paid: true, status: 'verified', providerStatus: 'completed', result: firstRpcRow<any>(data) };
  }

  if (status === 'EXPIRED' || status === 'CANCELED') {
    const { data, error } = await admin.rpc('reconcile_xendit_balance_event', {
      p_event_id: `xendit:balance-sync:${payment.checkoutId}:expired`,
      p_event_kind: 'payment_expired',
      p_checkout_id: payment.checkoutId,
      p_reference_id: payment.referenceId,
      p_provider_payment_id: null,
      p_currency: 'PHP',
      p_amount: null,
      p_livemode: false,
      p_payment_method: payment.paymentMethod || null,
    });
    if (error) throw error;
    return { paid: false, status: 'rejected', providerStatus: 'expired', result: firstRpcRow<any>(data) };
  }

  const recoveredCheckoutUrl = String(session?.payment_link_url || '').trim();
  return {
    paid: false,
    status: 'submitted',
    providerStatus: status.toLowerCase() || 'active',
    checkoutUrl: isTestCheckoutUrl(recoveredCheckoutUrl) ? recoveredCheckoutUrl : undefined,
    allowedPaymentChannels: response?.ok ? session?.allowed_payment_channels : undefined,
  };
}

async function resolveLockedCheckout(
  admin: any,
  secretKey: string,
  requestId: string,
  userId: string,
  configuredChannels: readonly string[],
) {
  const { data: paymentRow, error } = await admin
    .from('funeral_balance_payments')
    .select('id,request_id,amount,status,receiver_channel,provider_reference_id,provider_checkout_id,provider_checkout_url,provider_status,provider_payment_method')
    .eq('request_id', requestId)
    .eq('submitted_by', userId)
    .neq('status', 'rejected')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!paymentRow) return { retry: false, response: null };
  if (paymentRow.status === 'verified') {
    return {
      retry: false,
      response: {
        paid: true,
        status: 'verified',
        requestId,
        paymentId: paymentRow.id,
        testMode: true,
        livemode: false,
      },
    };
  }

  const checkoutId = String(paymentRow.provider_checkout_id || '');
  const checkoutUrl = String(paymentRow.provider_checkout_url || '');
  const referenceId = String(paymentRow.provider_reference_id || '').toLowerCase();
  if (!validProviderId(checkoutId) || !checkoutId.startsWith('ps-') || !isUuid(referenceId)) {
    const savedMethod = String(paymentRow.provider_payment_method || paymentRow.receiver_channel || '').toUpperCase();
    const retryMethod = PAYMENT_METHODS.find((method) => method.accountChannel === savedMethod);
    return {
      retry: paymentRow.status === 'submitted' && paymentRow.provider_status === 'creating' && Boolean(retryMethod),
      paymentMethod: retryMethod?.accountChannel,
      response: null,
    };
  }

  const synced = await reconcileSession(admin, secretKey, {
    paymentId: paymentRow.id,
    requestId,
    referenceId,
    checkoutId,
    amount: Number(paymentRow.amount),
    paymentMethod: paymentRow.provider_payment_method || paymentRow.receiver_channel,
  });
  if (synced.providerStatus === 'expired') {
    return {
      retry: true,
      paymentMethod: paymentRow.provider_payment_method || paymentRow.receiver_channel,
      response: null,
    };
  }
  if (synced.paid) {
    return {
      retry: false,
      response: { ...synced, requestId, paymentId: paymentRow.id, testMode: true, livemode: false },
    };
  }

  const savedMethod = PAYMENT_METHODS.find((method) => method.accountChannel ===
    String(paymentRow.provider_payment_method || paymentRow.receiver_channel || '').toUpperCase());
  const expectedChannels = savedMethod?.providerChannel ? [savedMethod.providerChannel] : configuredChannels;
  const savedMethodStillConfigured = !savedMethod?.providerChannel || configuredChannels.includes(savedMethod.providerChannel);
  if (!savedMethodStillConfigured || !matchesAllowedPaymentChannels(synced.allowedPaymentChannels, expectedChannels)) {
    if (synced.providerStatus !== 'active') {
      return { retry: false, response: { error: 'Unable to verify the saved checkout methods. Please try again.' } };
    }
    const canceled = await cancelSession(secretKey, checkoutId).catch(() => null);
    if (!canceled?.ok) {
      return { retry: false, response: { error: 'Unable to refresh the saved checkout methods. Please try again.' } };
    }
    const refreshed = await reconcileSession(admin, secretKey, {
      paymentId: paymentRow.id, requestId, referenceId, checkoutId,
      amount: Number(paymentRow.amount), paymentMethod: paymentRow.provider_payment_method,
    });
    if (refreshed.providerStatus !== 'expired') {
      return { retry: false, response: { error: 'Unable to refresh the saved checkout methods. Please try again.' } };
    }
    return { retry: true, paymentMethod: paymentRow.provider_payment_method || paymentRow.receiver_channel, response: null };
  }

  const reusableCheckoutUrl = isTestCheckoutUrl(checkoutUrl) ? checkoutUrl : synced.checkoutUrl;
  if (!reusableCheckoutUrl) {
    return {
      retry: false,
      response: { error: 'We could not restore the saved secure checkout. Refresh the payment details and try again.' },
    };
  }

  return {
    retry: false,
    response: {
      checkoutUrl: reusableCheckoutUrl,
      paymentSessionId: checkoutId,
      paymentId: paymentRow.id,
      requestId,
      reused: true,
      paid: false,
      testMode: true,
      livemode: false,
      paymentMethod: paymentRow.provider_payment_method || paymentRow.receiver_channel,
    },
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const xenditSecretKey = Deno.env.get('XENDIT_SECRET_KEY')?.trim();
  if (!supabaseUrl || !serviceRoleKey || !xenditSecretKey) {
    return jsonResponse(request, { error: 'Payment checkout configuration is incomplete.' }, 503);
  }
  if (isObviouslyLiveKey(xenditSecretKey)) {
    return jsonResponse(request, { error: 'Only the configured Xendit test checkout is available.' }, 503);
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return jsonResponse(request, { error: 'Sign in before starting payment.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: apiKeyOnlyFetch(serviceRoleKey) },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) return jsonResponse(request, { error: 'Your session is invalid or expired.' }, 401);

  let input: { requestId?: unknown; action?: unknown; paymentMethod?: unknown };
  try {
    input = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid checkout request.' }, status);
  }

  const requestId = String(input.requestId || '').trim().toLowerCase();
  const action = String(input.action || '').trim().toLowerCase();
  const isSync = action === 'sync';
  const requestedMethod = String(input.paymentMethod || '').trim().toUpperCase() || 'ANY';
  if (!isUuid(requestId)) return jsonResponse(request, { error: 'A valid service request is required.' }, 400);

  const rateLimit = await consumeUserRateLimit(
    admin,
    isSync ? 'balance-xendit-sync' : 'balance-xendit-checkout',
    userData.user.id,
    isSync ? 30 : 8,
    5 * 60,
  );
  if (rateLimit.unavailable) return jsonResponse(request, { error: 'Security checks are temporarily unavailable.' }, 503);
  if (!rateLimit.allowed) {
    return jsonResponse(request, { error: 'Too many payment requests. Please wait before trying again.', retryAfterSeconds: rateLimit.retryAfterSeconds }, 429);
  }

  const { data: serviceRequest, error: requestError } = await admin
    .from('funeral_service_requests')
    .select('id,requesterId,shopId,shopName,productName,paymentOption,paymentVerifiedAt,remainingBalance,status')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) return jsonResponse(request, { error: 'Unable to load the service request.' }, 500);
  if (!serviceRequest || serviceRequest.requesterId !== userData.user.id) {
    return jsonResponse(request, { error: 'This service request is not available to your account.' }, 403);
  }

  if (isSync) {
    const { data: paymentRow, error: paymentError } = await admin
      .from('funeral_balance_payments')
      .select('id,request_id,amount,status,provider_reference_id,provider_checkout_id,provider_status,provider_payment_method')
      .eq('request_id', requestId)
      .not('provider_reference_id', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentError) return jsonResponse(request, { error: 'Unable to load the balance checkout.' }, 500);
    if (!paymentRow) return jsonResponse(request, { paid: false, status: 'unpaid', requestId, testMode: true, livemode: false });
    if (paymentRow.status === 'verified') {
      return jsonResponse(request, { paid: true, status: 'verified', requestId, paymentId: paymentRow.id, testMode: true, livemode: false });
    }
    const checkoutId = String(paymentRow.provider_checkout_id || '');
    const referenceId = String(paymentRow.provider_reference_id || '');
    if (!validProviderId(checkoutId) || !checkoutId.startsWith('ps-') || !isUuid(referenceId)) {
      return jsonResponse(request, { paid: false, status: paymentRow.status, providerStatus: paymentRow.provider_status, requestId, testMode: true, livemode: false });
    }
    try {
      const result = await reconcileSession(admin, xenditSecretKey, {
        paymentId: paymentRow.id,
        requestId,
        referenceId,
        checkoutId,
        amount: Number(paymentRow.amount),
        paymentMethod: paymentRow.provider_payment_method,
      });
      return jsonResponse(request, { ...result, requestId, paymentId: paymentRow.id, testMode: true, livemode: false });
    } catch (error) {
      console.error('Unable to synchronize Xendit balance checkout:', error);
      return jsonResponse(request, { error: 'Unable to verify the payment status right now.' }, 502);
    }
  }

  const { data: receiverAccounts, error: receiverError } = await admin
    .from('funeral_shop_payout_accounts')
    .select('channelCode')
    .eq('shopId', serviceRequest.shopId)
    .eq('active', true)
    .eq('verifiedByAdmin', true);
  if (receiverError) return jsonResponse(request, { error: 'Unable to load this shop’s payment methods.' }, 500);
  const availableMethods = availableShopCheckoutChannels((receiverAccounts || []).map((row: any) => String(row.channelCode || '')));
  const configuredProviderChannels = availableMethods.map((method) => method.providerChannel);
  if (configuredProviderChannels.length === 0) {
    return jsonResponse(request, { error: 'This shop has not configured an active payment receiver account yet.' }, 409);
  }

  let selectedMethod = PAYMENT_METHODS.find((method) => method.accountChannel === requestedMethod);
  if (!selectedMethod) return jsonResponse(request, { error: 'Choose an available payment method.' }, 409);
  if (selectedMethod.accountChannel !== 'ANY' && !availableMethods.some((method) => method.accountChannel === selectedMethod.accountChannel)) {
    return jsonResponse(request, { error: 'Choose one of the payment methods configured by this shop.' }, 409);
  }

  let { data: claimData, error: claimError } = await admin.rpc('claim_xendit_balance_checkout', {
    p_request_id: requestId,
    p_user_id: userData.user.id,
    p_payment_method: selectedMethod.accountChannel,
  });
  if (claimError && String(claimError.message || '').includes('locked to another payment method')) {
    try {
      const locked = await resolveLockedCheckout(admin, xenditSecretKey, requestId, userData.user.id, configuredProviderChannels);
      if (locked.response) {
        const hasRecoverableError = typeof (locked.response as any).error === 'string';
        return jsonResponse(request, locked.response, hasRecoverableError ? 409 : 200);
      }
      if (locked.retry) {
        const savedMethod = PAYMENT_METHODS.find((method) => method.accountChannel === locked.paymentMethod);
        if (!savedMethod) {
          return jsonResponse(request, { error: 'An earlier checkout is still active. Refresh the payment details and continue with the saved channel.' }, 409);
        }
        selectedMethod = savedMethod;
        if (selectedMethod.accountChannel !== 'ANY' && !availableMethods.some((method) => method.accountChannel === selectedMethod.accountChannel)) {
          return jsonResponse(request, { error: 'The saved payment method is no longer configured by this shop.' }, 409);
        }
        const retry = await admin.rpc('claim_xendit_balance_checkout', {
          p_request_id: requestId,
          p_user_id: userData.user.id,
          p_payment_method: selectedMethod.accountChannel,
        });
        claimData = retry.data;
        claimError = retry.error;
      } else {
        return jsonResponse(request, { error: 'An earlier checkout is still active. Refresh the payment details and continue with the saved channel.' }, 409);
      }
    } catch (error) {
      console.error('Unable to resume locked Xendit balance checkout:', error);
      return jsonResponse(request, { error: 'Unable to refresh the balance checkout.' }, 502);
    }
  }
  if (claimError) return jsonResponse(request, { error: claimError.message || 'Unable to prepare this checkout.' }, 409);
  let claim = firstRpcRow<any>(claimData);
  if (!claim || claim.requestId !== requestId) return jsonResponse(request, { error: 'Unable to prepare this checkout.' }, 500);
  if (claim.paid) return jsonResponse(request, { paid: true, status: 'verified', requestId, testMode: true, livemode: false });

  const existingCheckoutId = String(claim.checkoutId || '');
  const existingCheckoutUrl = String(claim.checkoutUrl || '');
  if (validProviderId(existingCheckoutId) && existingCheckoutId.startsWith('ps-') && isTestCheckoutUrl(existingCheckoutUrl)) {
    try {
      const synced = await reconcileSession(admin, xenditSecretKey, {
        paymentId: claim.paymentId,
        requestId,
        referenceId: String(claim.referenceId).toLowerCase(),
        checkoutId: existingCheckoutId,
        amount: Number(claim.amount),
        paymentMethod: selectedMethod.accountChannel,
      });
      if (synced.paid) return jsonResponse(request, { ...synced, requestId, paymentId: claim.paymentId, testMode: true, livemode: false });
      if (synced.providerStatus !== 'expired') {
        const expectedChannels = selectedMethod.providerChannel
          ? [selectedMethod.providerChannel]
          : configuredProviderChannels;
        if (!matchesAllowedPaymentChannels(synced.allowedPaymentChannels, expectedChannels)) {
          if (synced.providerStatus !== 'active') {
            return jsonResponse(request, { error: 'Unable to verify the saved checkout methods. Please try again.' }, 502);
          }
          const canceled = await cancelSession(xenditSecretKey, existingCheckoutId).catch(() => null);
          if (!canceled?.ok) {
            return jsonResponse(request, { error: 'Unable to refresh the saved checkout methods. Please try again.' }, 502);
          }
          const refreshed = await reconcileSession(admin, xenditSecretKey, {
            paymentId: claim.paymentId,
            requestId,
            referenceId: String(claim.referenceId).toLowerCase(),
            checkoutId: existingCheckoutId,
            amount: Number(claim.amount),
            paymentMethod: selectedMethod.accountChannel,
          });
          if (refreshed.providerStatus !== 'expired') {
            return jsonResponse(request, { error: 'Unable to refresh the saved checkout methods. Please try again.' }, 502);
          }
        } else {
          return jsonResponse(request, {
            checkoutUrl: existingCheckoutUrl,
            paymentSessionId: existingCheckoutId,
            paymentId: claim.paymentId,
            requestId,
            reused: true,
            paid: false,
            testMode: true,
            livemode: false,
            paymentMethod: selectedMethod.accountChannel,
          });
        }
      }
      const retry = await admin.rpc('claim_xendit_balance_checkout', {
        p_request_id: requestId,
        p_user_id: userData.user.id,
        p_payment_method: selectedMethod.accountChannel,
      });
      if (retry.error) throw retry.error;
      claim = firstRpcRow<any>(retry.data);
    } catch (error) {
      console.error('Unable to reuse Xendit balance checkout:', error);
      return jsonResponse(request, { error: 'Unable to refresh the balance checkout.' }, 502);
    }
  }

  if (!claim?.shouldCreate || claim.inProgress) {
    return jsonResponse(request, { error: 'Checkout is being prepared. Try again in a moment.' }, 409);
  }
  const amount = amountDetails(claim.amount);
  const referenceId = String(claim.referenceId || '').toLowerCase();
  const paymentId = String(claim.paymentId || '');
  const checkoutClaimId = String(claim.checkoutClaimId || '');
  const idempotencyKey = String(claim.idempotencyKey || '');
  if (!amount || !isUuid(referenceId) || !isUuid(paymentId) || !isUuid(checkoutClaimId) || idempotencyKey !== `lifecycle-balance-${referenceId}`) {
    return jsonResponse(request, { error: 'The authoritative remaining balance is invalid.' }, 409);
  }

  const productName = String(serviceRequest.productName || 'Funeral service').trim().slice(0, 80);
  const checkoutBody: Record<string, unknown> = {
    reference_id: referenceId,
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount: amount.amount,
    currency: 'PHP',
    country: 'PH',
    capture_method: 'AUTOMATIC',
    expires_at: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
    locale: 'en',
    description: `LifeCycle remaining balance - ${productName}`.slice(0, 200),
    metadata: {
      purpose: 'lifecycle_remaining_balance',
      request_id: requestId,
      balance_payment_id: paymentId,
      shop_id: String(serviceRequest.shopId),
      receiver_channel: selectedMethod.accountChannel,
    },
  };
  checkoutBody.allowed_payment_channels = selectedMethod.providerChannel
    ? [selectedMethod.providerChannel]
    : configuredProviderChannels;

  const xenditResponse = await fetch(CREATE_SESSION_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(xenditSecretKey),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(checkoutBody),
  }).catch(() => null);
  const responseJson = xenditResponse ? await xenditResponse.json().catch(() => null) : null;
  if (!xenditResponse?.ok) {
    const code = String(responseJson?.error_code || 'checkout_failed').slice(0, 80);
    console.error('Xendit balance checkout creation failed:', code);
    await releaseFailedClaim(
      admin,
      paymentId,
      checkoutClaimId,
      code === 'INVALID_PAYMENT_CHANNEL'
        ? 'The selected Xendit test channel was unavailable.'
        : 'Xendit could not create the test checkout.',
    );
    return jsonResponse(request, { error: 'Payment checkout is temporarily unavailable.', code }, 502);
  }

  const paymentSessionId = String(responseJson?.payment_session_id || '').trim();
  const paymentLinkUrl = String(responseJson?.payment_link_url || '').trim();
  const responseAmount = amountDetails(responseJson?.amount);
  const validResponse = validProviderId(paymentSessionId)
    && paymentSessionId.startsWith('ps-')
    && isTestCheckoutUrl(paymentLinkUrl)
    && String(responseJson?.status || '').toUpperCase() === 'ACTIVE'
    && String(responseJson?.reference_id || '').toLowerCase() === referenceId
    && responseJson?.currency === 'PHP'
    && responseAmount?.cents === amount.cents;
  if (!validResponse) {
    await releaseFailedClaim(
      admin,
      paymentId,
      checkoutClaimId,
      'Xendit returned an invalid test checkout response.',
    );
    return jsonResponse(request, { error: 'The payment provider returned an invalid checkout response.' }, 502);
  }

  const { data: storedData, error: storeError } = await admin.rpc('store_xendit_balance_checkout', {
    p_payment_id: paymentId,
    p_checkout_claim_id: checkoutClaimId,
    p_payment_session_id: paymentSessionId,
    p_payment_link_url: paymentLinkUrl,
    p_amount: amount.amount,
  });
  const stored = firstRpcRow<any>(storedData);
  if (storeError || !stored || stored.checkoutId !== paymentSessionId || stored.checkoutUrl !== paymentLinkUrl) {
    return jsonResponse(request, { error: 'Checkout was created but could not be saved safely.' }, 500);
  }

  return jsonResponse(request, {
    checkoutUrl: paymentLinkUrl,
    paymentSessionId,
    paymentId,
    requestId,
    reused: false,
    paid: false,
    testMode: true,
    livemode: false,
    paymentMethod: selectedMethod.accountChannel,
  });
});
