// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const CREATE_SESSION_URL = 'https://api.xendit.co/sessions';
const XENDIT_PAYOUTS_URL = 'https://api.xendit.co/v2/payouts';
const MAX_BODY_BYTES = 16 * 1024;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;

const SHOP_PAYMENT_METHODS = [
  { accountChannel: 'PH_GCASH', providerChannel: 'GCASH', label: 'GCash', type: 'wallet' },
  { accountChannel: 'PH_MAYA', providerChannel: 'PAYMAYA', label: 'Maya', type: 'wallet' },
  { accountChannel: 'PH_BDO', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · BDO', type: 'bank' },
  { accountChannel: 'PH_BPI', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · BPI', type: 'bank' },
  { accountChannel: 'PH_UBP', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · UnionBank', type: 'bank' },
  { accountChannel: 'PH_METROBANK', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · Metrobank', type: 'bank' },
  { accountChannel: 'PH_LANDBANK', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · Landbank', type: 'bank' },
  { accountChannel: 'PH_PNB', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · PNB', type: 'bank' },
  { accountChannel: 'PH_RCBC', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · RCBC', type: 'bank' },
  { accountChannel: 'PH_CHINABANK', providerChannel: 'BANK_TRANSFER', label: 'Bank transfer · China Bank', type: 'bank' },
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

async function getXenditSession(secretKey: string, checkoutId: string) {
  return fetch(`${CREATE_SESSION_URL}/${encodeURIComponent(checkoutId)}`, {
    method: 'GET',
    headers: {
      Authorization: basicAuth(secretKey),
      Accept: 'application/json',
    },
  });
}

async function resetExpiredCheckout(admin: any, requestId: string, checkoutId: string) {
  const { data, error } = await admin.rpc('reset_expired_xendit_service_checkout', {
    p_request_id: requestId,
    p_checkout_id: checkoutId,
  });
  if (error) {
    console.error('Unable to reset expired Xendit checkout:', error.code || 'unknown');
    return false;
  }
  return data === true;
}

async function syncAndReconcileSession(
  admin: any,
  xenditSecretKey: string,
  checkoutId: string,
  requestId: string,
  serviceRequest: any,
  claim?: any
): Promise<{ paid: boolean; status: string; paymentId?: string; paymentMethod?: string; reset?: boolean }> {
  const sessionResponse = await getXenditSession(xenditSecretKey, checkoutId).catch(() => null);
  const session = sessionResponse ? await sessionResponse.json().catch(() => null) : null;
  const sessionStatus = String(session?.status || '').toUpperCase();

  if (sessionStatus === 'COMPLETED') {
    const paymentId = String(session?.payment_id || '').trim();
    const sessionAmount = Number(session?.amount);
    const paymentMethod = String(
      session?.payment_method ||
      session?.payment_channel ||
      session?.channel_code ||
      'gcash'
    ).toLowerCase();

    const referenceId = String(claim?.referenceId || serviceRequest.providerReferenceId || session?.reference_id || '').trim();
    const grossAmount = sessionAmount || Number(claim?.amount || serviceRequest.paymentAmount);

    const { data: syncData, error: syncError } = await admin.rpc('reconcile_xendit_service_event', {
      p_event_id: `xendit:sync:${checkoutId}:${paymentId || 'completed'}`,
      p_event_type: 'payment_session.status_sync',
      p_event_kind: 'payment_completed',
      p_checkout_id: checkoutId,
      p_reference_id: referenceId,
      p_provider_payment_id: paymentId || null,
      p_provider_split_payment_id: null,
      p_split_rule_id: null,
      p_shop_account_id: String(serviceRequest.shopId || ''),
      p_destination_account_id: null,
      p_currency: 'PHP',
      p_gross_amount: grossAmount,
      p_split_amount: null,
      p_livemode: false,
      p_payload: session || {},
      p_payment_method: paymentMethod,
    });

    if (syncError) {
      console.error('Unable to reconcile completed Xendit session:', syncError);
    }

    // Auto-trigger 70% shop payout if configured
    const shopNetAmount = Number(claim?.shopNetAmount || serviceRequest.shopNetAmount || (grossAmount * 0.7));
    if (requestId && shopNetAmount > 0) {
      try {
        const payoutRefId = `lifecycle-payout-${requestId}`;
        const { data: payoutData } = await admin.rpc('initiate_shop_payout', {
          p_request_id: requestId,
          p_payout_reference_id: payoutRefId,
        });
        const payoutInfo = firstRpcRow<any>(payoutData);
        if (payoutInfo && !payoutInfo.alreadyInitiated && payoutInfo.payoutAmount > 0) {
          const payoutBody = {
            reference_id: payoutRefId,
            channel_code: payoutInfo.payoutChannelCode,
            channel_properties: {
              account_holder_name: payoutInfo.payoutAccountName,
              account_number: payoutInfo.payoutAccountNumber,
            },
            amount: payoutInfo.payoutAmount,
            currency: 'PHP',
            description: `LifeCycle shop payout (70%) for order ${requestId}`.slice(0, 200),
            metadata: {
              purpose: 'lifecycle_shop_payout',
              request_id: requestId,
              commission_percent: '30',
            },
          };
          fetch(XENDIT_PAYOUTS_URL, {
            method: 'POST',
            headers: {
              Authorization: basicAuth(xenditSecretKey),
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'Idempotency-key': payoutRefId,
            },
            body: JSON.stringify(payoutBody),
          }).catch((err) => console.error('Auto-payout dispatch error:', err));
        }
      } catch (payoutErr) {
        console.error('Error initiating payout in sync:', payoutErr);
      }
    }

    return {
      paid: true,
      status: 'payment_verified',
      paymentId,
      paymentMethod,
      reset: false,
    };
  }

  if (sessionStatus === 'EXPIRED' || sessionStatus === 'CANCELED') {
    const referenceId = String(claim?.referenceId || serviceRequest.providerReferenceId || session?.reference_id || '').trim();
    const { error: reconcileError } = await admin.rpc('reconcile_xendit_service_event', {
      p_event_id: `xendit:sync:${checkoutId}:expired`,
      p_event_type: 'payment_session.status_sync',
      p_event_kind: 'payment_expired',
      p_checkout_id: checkoutId,
      p_reference_id: referenceId,
      p_provider_payment_id: null,
      p_provider_split_payment_id: null,
      p_split_rule_id: null,
      p_shop_account_id: String(serviceRequest.shopId || ''),
      p_destination_account_id: null,
      p_currency: 'PHP',
      p_gross_amount: null,
      p_split_amount: null,
      p_livemode: false,
      p_payload: session || {},
    });
    if (reconcileError) {
      console.error('Unable to reconcile expired Xendit session:', reconcileError.code || 'unknown');
    }
    const reset = await resetExpiredCheckout(admin, requestId, checkoutId);
    return {
      paid: false,
      status: 'expired',
      reset,
    };
  }

  return {
    paid: false,
    status: sessionStatus || 'pending',
    reset: false,
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
    return jsonResponse(request, { error: 'Payment checkout is temporarily unavailable. Please contact support.' }, 503);
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

  let input: { requestId?: unknown; action?: unknown; paymentMethod?: unknown };
  try {
    input = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid checkout request.' }, status);
  }
  const requestId = String(input?.requestId || '').trim().toLowerCase();
  const action = String(input?.action || '').trim().toLowerCase();
  const isSyncAction = action === 'sync';
  const isMethodsAction = action === 'methods';
  const requestedPaymentMethod = String(input?.paymentMethod || '').trim().toUpperCase();
  if (!isUuid(requestId)) return jsonResponse(request, { error: 'A valid service request is required.' }, 400);

  const { data: serviceRequest, error: requestError } = await admin
    .from('funeral_service_requests')
    .select('id, requesterId, shopId, productName, status, providerStatus, providerCheckoutId, providerCheckoutUrl, providerReferenceId, paymentAmount, shopNetAmount, commissionAmount, payoutChannelCode')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) return jsonResponse(request, { error: 'Unable to load the service request.' }, 500);

  const isOwner = serviceRequest?.requesterId === userData.user.id;
  const isShopOwner = serviceRequest?.shopId === userData.user.id;
  if (!serviceRequest || (!isOwner && !isShopOwner)) {
    return jsonResponse(request, { error: 'This service request is not available to your account.' }, 403);
  }

  const { data: receiverAccounts, error: receiverError } = await admin
    .from('funeral_shop_payout_accounts')
    .select('channelCode')
    .eq('shopId', serviceRequest.shopId)
    .eq('active', true)
    .eq('verifiedByAdmin', true);
  if (receiverError) {
    console.error('Unable to load shop receiver accounts:', receiverError.code || 'unknown');
    return jsonResponse(request, { error: 'Unable to load this shop’s payment methods.' }, 500);
  }

  const configuredChannels = new Set((receiverAccounts || []).map((row: any) => String(row.channelCode || '').toUpperCase()));
  const availableMethods = SHOP_PAYMENT_METHODS.filter(method => configuredChannels.has(method.accountChannel));

  if (isMethodsAction) {
    const selectedMethod = String(serviceRequest.payoutChannelCode || '').trim().toUpperCase();
    return jsonResponse(request, {
      requestId,
      selectedMethod: configuredChannels.has(selectedMethod) ? selectedMethod : null,
      methods: availableMethods.map(method => ({
        code: method.accountChannel,
        label: method.label,
        type: method.type,
      })),
    });
  }

  if (serviceRequest.status === 'payment_verified') {
    return jsonResponse(request, { paid: true, status: 'payment_verified', requestId, testMode: true, livemode: false });
  }

  // Active sync on any existing checkout session ID
  const existingProviderCheckoutId = String(serviceRequest.providerCheckoutId || '').trim();
  const savedPaymentMethod = String(serviceRequest.payoutChannelCode || '').trim().toUpperCase();
  if (validProviderId(existingProviderCheckoutId) && existingProviderCheckoutId.startsWith('ps-')) {
    if (!isSyncAction && requestedPaymentMethod && savedPaymentMethod && requestedPaymentMethod !== savedPaymentMethod) {
      return jsonResponse(request, { error: 'This checkout is already locked to another payment method.' }, 409);
    }
    const syncRes = await syncAndReconcileSession(
      admin,
      xenditSecretKey,
      existingProviderCheckoutId,
      requestId,
      serviceRequest
    );
    if (syncRes.paid) {
      return jsonResponse(request, {
        paid: true,
        status: 'payment_verified',
        requestId,
        testMode: true,
        livemode: false,
      });
    }
    if (syncRes.status === 'expired' && !syncRes.reset) {
      return jsonResponse(request, { error: 'The expired checkout could not be refreshed. Please try again.' }, 500);
    }
    if (isSyncAction) {
      return jsonResponse(request, {
        paid: false,
        status: syncRes.status,
        requestId,
        testMode: true,
        livemode: false,
      });
    }
  } else if (isSyncAction) {
    return jsonResponse(request, {
      paid: false,
      status: serviceRequest.status,
      requestId,
      testMode: true,
      livemode: false,
    });
  }

  if (serviceRequest.status !== 'awaiting_payment') {
    return jsonResponse(request, { error: 'This service request is not awaiting payment.' }, 409);
  }

  const selectedMethod = availableMethods.find(method => method.accountChannel === requestedPaymentMethod);
  if (!selectedMethod) {
    return jsonResponse(request, {
      error: availableMethods.length === 0
        ? 'This shop has not configured an active payment receiver account yet.'
        : 'Choose one of the payment methods configured by this shop.',
    }, 409);
  }

  // Direct payout model: claim checkout
  const idempotencyKey = `lifecycle-service-${requestId}`;
  const { data: claimData, error: claimError } = await admin.rpc('claim_xendit_service_checkout', {
    p_request_id: requestId,
    p_idempotency_key: idempotencyKey,
    p_currency: 'PHP',
    p_livemode: false,
  });
  if (claimError) {
    console.error('Unable to claim Xendit service checkout:', claimError.code || 'unknown');
    return jsonResponse(request, { error: claimError.message || 'Unable to prepare this checkout.' }, 409);
  }

  let claim = firstRpcRow<any>(claimData);
  if (!claim || claim.requestId !== requestId) {
    return jsonResponse(request, { error: 'Unable to prepare this checkout.' }, 500);
  }

  const existingCheckoutId = String(claim.checkoutId || '').trim();
  const existingCheckoutUrl = String(claim.checkoutUrl || '').trim();
  if (!claim.shouldCreate && validProviderId(existingCheckoutId) && isTestCheckoutUrl(existingCheckoutUrl)) {
    // Check if user completed the payment before giving back the URL
    const syncResult = await syncAndReconcileSession(
      admin,
      xenditSecretKey,
      existingCheckoutId,
      requestId,
      serviceRequest,
      claim
    );
    if (syncResult.paid) {
      return jsonResponse(request, {
        paid: true,
        status: 'payment_verified',
        requestId,
        testMode: true,
        livemode: false,
      });
    }
    if (syncResult.status === 'expired') {
      if (!syncResult.reset) {
        return jsonResponse(request, { error: 'The expired checkout could not be refreshed. Please try again.' }, 500);
      }
      const { data: retryClaimData, error: retryClaimError } = await admin.rpc('claim_xendit_service_checkout', {
        p_request_id: requestId,
        p_idempotency_key: idempotencyKey,
        p_currency: 'PHP',
        p_livemode: false,
      });
      if (retryClaimError) {
        console.error('Unable to reclaim expired Xendit checkout:', retryClaimError.code || 'unknown');
        return jsonResponse(request, { error: 'Unable to prepare a fresh checkout.' }, 409);
      }
      claim = firstRpcRow<any>(retryClaimData);
    } else {
      return jsonResponse(request, {
        checkoutUrl: existingCheckoutUrl,
        paymentSessionId: existingCheckoutId,
        requestId,
        reused: true,
        paid: false,
        status: syncResult.status,
        testMode: true,
        livemode: false,
        paymentMethod: savedPaymentMethod || undefined,
      });
    }
  }
  if (!claim || claim.requestId !== requestId) {
    return jsonResponse(request, { error: 'Unable to prepare a fresh checkout.' }, 500);
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

  const { error: receiverSnapshotError } = await admin
    .from('funeral_service_requests')
    .update({ payoutChannelCode: selectedMethod.accountChannel, updatedAt: new Date().toISOString() })
    .eq('id', requestId)
    .eq('shopId', serviceRequest.shopId);
  if (receiverSnapshotError) {
    console.error('Unable to save receiver account snapshot:', receiverSnapshotError.code || 'unknown');
    return jsonResponse(request, { error: 'Unable to lock the selected payment receiver.' }, 500);
  }

  const productName = String(serviceRequest.productName || 'Casket').trim().slice(0, 80);
  // Direct checkout: no for-user-id or with-split-rule headers
  // Payment goes directly to admin's Xendit account
  const checkoutBody = {
    reference_id: referenceId,
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount: gross.amount,
    currency: 'PHP',
    country: 'PH',
    capture_method: 'AUTOMATIC',
    allowed_payment_channels: [selectedMethod.providerChannel],
    expires_at: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
    locale: 'en',
    description: `LifeCycle casket payment - ${productName}`.slice(0, 200),
    metadata: {
      purpose: 'lifecycle_casket_payment',
      request_id: requestId,
      shop_id: String(serviceRequest.shopId),
      receiver_channel: selectedMethod.accountChannel,
      commission_percent: '30',
    },
  };

  const xenditResponse = await xenditRequest(xenditSecretKey, {
    method: 'POST',
    // No for-user-id or with-split-rule headers — payment goes to admin account
    body: JSON.stringify(checkoutBody),
  }).catch(() => null);
  const responseJson = xenditResponse ? await xenditResponse.json().catch(() => null) : null;
  if (!xenditResponse?.ok) {
    const code = String(responseJson?.error_code || 'checkout_failed').slice(0, 80);
    console.error('Xendit service checkout creation failed:', code);
    return jsonResponse(request, { error: 'Payment checkout is temporarily unavailable.', code }, 502);
  }

  const paymentSessionId = String(responseJson?.payment_session_id || '').trim();
  const paymentLinkUrl = String(responseJson?.payment_link_url || '').trim();
  const responseAmount = amountDetails(responseJson?.amount);
  const validResponse = validProviderId(paymentSessionId) &&
    paymentSessionId.startsWith('ps-') &&
    isTestCheckoutUrl(paymentLinkUrl) &&
    String(responseJson?.status || '').toUpperCase() === 'ACTIVE' &&
    responseJson?.reference_id === referenceId &&
    responseJson?.currency === 'PHP' &&
    responseAmount?.cents === gross.cents;
  if (!validResponse) {
    return jsonResponse(request, { error: 'The payment provider returned an invalid checkout response.' }, 502);
  }

  const { data: storedData, error: storeError } = await admin.rpc('store_xendit_service_checkout', {
    p_request_id: requestId,
    p_checkout_claim_id: checkoutClaimId,
    p_idempotency_key: idempotencyKey,
    p_payment_session_id: paymentSessionId,
    p_payment_link_url: paymentLinkUrl,
    p_shop_account_id: '', // No sub-account in direct payout model
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
    paymentMethod: selectedMethod.accountChannel,
  });
});
