// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BODY_BYTES = 256 * 1024;
const encoder = new TextEncoder();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

function validShopPaymentReference(value: string) {
  return /^XS[A-Z0-9]{24}$/.test(value);
}

function normalizedReference(value: unknown) {
  const raw = stringValue(value, 64);
  if (isUuid(raw)) return raw.toLowerCase();
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function firstRpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function stringValue(value: unknown, maxLength = 255) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function amountValue(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(String(value || '').trim());
  const cents = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000_000) {
    return null;
  }
  return cents / 100;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function secureTokenEqual(received: string, expected: string) {
  const [left, right] = await Promise.all([digest(received), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0 && received.length === expected.length;
}

async function readBody(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > MAX_BODY_BYTES) throw new Error('body_too_large');
  return JSON.parse(raw);
}

type NormalizedEvent = {
  eventId: string;
  eventType: string;
  eventKind: 'payment_completed' | 'payment_expired' | 'split_completed' | 'split_failed';
  checkoutId: string | null;
  referenceId: string;
  paymentId: string | null;
  splitPaymentId: string | null;
  splitRuleId: string | null;
  shopAccountId: string;
  destinationAccountId: string | null;
  currency: string;
  grossAmount: number | null;
  splitAmount: number | null;
  payload: Record<string, unknown>;
};

function normalizeEvent(
  payload: any,
  configuredSplitRuleId: string,
  configuredMasterBusinessId: string,
): NormalizedEvent | null {
  const eventType = stringValue(payload?.event, 80).toLowerCase();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const created = stringValue(payload?.created, 50);

  if (eventType === 'payment_session.completed' || eventType === 'payment_session.expired') {
    const status = stringValue(data.status, 40).toUpperCase();
    const expectedStatus = eventType === 'payment_session.completed' ? 'COMPLETED' : 'EXPIRED';
    const checkoutId = stringValue(data.payment_session_id, 128);
    const referenceId = normalizedReference(data.reference_id);
    const paymentId = stringValue(data.payment_id, 128) || null;
    const shopAccountId = stringValue(data.business_id || payload?.business_id, 128);
    const currency = stringValue(data.currency, 3).toUpperCase();
    const grossAmount = amountValue(data.amount);
    if (status !== expectedStatus || !validProviderId(checkoutId) || !checkoutId.startsWith('ps-') ||
      (!isUuid(referenceId) && !validShopPaymentReference(referenceId)) ||
      !validProviderId(shopAccountId) || currency !== 'PHP') {
      return null;
    }
    if (eventType === 'payment_session.completed' && (!paymentId || !validProviderId(paymentId) || !grossAmount)) {
      return null;
    }
    return {
      eventId: `xendit:${eventType}:${checkoutId}:${paymentId || 'none'}`,
      eventType,
      eventKind: eventType === 'payment_session.completed' ? 'payment_completed' : 'payment_expired',
      checkoutId,
      referenceId,
      paymentId,
      splitPaymentId: null,
      splitRuleId: null,
      shopAccountId,
      destinationAccountId: null,
      currency,
      grossAmount,
      splitAmount: null,
      payload: {
        event: eventType,
        created,
        status,
        businessId: shopAccountId,
        paymentSessionId: checkoutId,
        paymentId,
        referenceId,
        currency,
        amount: grossAmount,
        channelCode: stringValue(data.channel_code, 80) || null,
      },
    };
  }

  if (eventType === 'payment.capture') {
    const status = stringValue(data.status, 40).toUpperCase();
    const referenceId = normalizedReference(data.reference_id);
    const paymentId = stringValue(data.payment_id, 128);
    const checkoutId = stringValue(data.payment_session_id, 128) || null;
    const shopAccountId = stringValue(data.business_id || payload?.business_id, 128);
    const currency = stringValue(data.currency, 3).toUpperCase();
    const grossAmount = amountValue(data.request_amount);
    const captures = Array.isArray(data.captures) ? data.captures : [];
    const captureId = stringValue(captures[0]?.capture_id, 128) || paymentId;
    if (status !== 'SUCCEEDED' ||
      (!isUuid(referenceId) && !validShopPaymentReference(referenceId)) ||
      !validProviderId(paymentId) ||
      !validProviderId(captureId) || !validProviderId(shopAccountId) || currency !== 'PHP' || !grossAmount ||
      (checkoutId !== null && (!validProviderId(checkoutId) || !checkoutId.startsWith('ps-')))) {
      return null;
    }
    return {
      eventId: `xendit:${eventType}:${paymentId}:${captureId}`,
      eventType,
      eventKind: 'payment_completed',
      checkoutId,
      referenceId,
      paymentId,
      splitPaymentId: null,
      splitRuleId: null,
      shopAccountId,
      destinationAccountId: null,
      currency,
      grossAmount,
      splitAmount: null,
      payload: {
        event: eventType,
        created,
        status,
        businessId: shopAccountId,
        paymentSessionId: checkoutId,
        paymentId,
        captureId,
        referenceId,
        currency,
        amount: grossAmount,
        channelCode: stringValue(data.channel_code, 80) || null,
      },
    };
  }

  if (eventType === 'payment.succeeded') {
    const status = stringValue(data.status, 40).toUpperCase();
    const referenceId = normalizedReference(data.reference_id);
    const paymentId = stringValue(data.id || data.payment_id, 128);
    const checkoutId = stringValue(data.payment_session_id, 128) || null;
    const shopAccountId = stringValue(data.business_id || payload?.business_id, 128);
    const currency = stringValue(data.currency, 3).toUpperCase();
    const grossAmount = amountValue(data.amount);
    if (status !== 'SUCCEEDED' ||
      (!isUuid(referenceId) && !validShopPaymentReference(referenceId)) ||
      !validProviderId(paymentId) ||
      !validProviderId(shopAccountId) || currency !== 'PHP' || !grossAmount ||
      (checkoutId !== null && (!validProviderId(checkoutId) || !checkoutId.startsWith('ps-')))) {
      return null;
    }
    return {
      eventId: `xendit:${eventType}:${paymentId}`,
      eventType,
      eventKind: 'payment_completed',
      checkoutId,
      referenceId,
      paymentId,
      splitPaymentId: null,
      splitRuleId: null,
      shopAccountId,
      destinationAccountId: null,
      currency,
      grossAmount,
      splitAmount: null,
      payload: {
        event: eventType,
        created,
        status,
        businessId: shopAccountId,
        paymentSessionId: checkoutId,
        paymentId,
        referenceId,
        currency,
        amount: grossAmount,
        channelCode: stringValue(data.channel_code, 80) || null,
      },
    };
  }

  if (eventType === 'split.payment') {
    const status = stringValue(data.status, 40).toUpperCase();
    const splitPaymentId = stringValue(data.id, 128);
    const splitRuleId = stringValue(data.split_rule_id, 160);
    const routeReferenceId = stringValue(data.reference_id, 160);
    const referenceId = normalizedReference(data.payment_reference_id);
    const paymentId = stringValue(data.payment_id, 128);
    const shopAccountId = stringValue(data.source_account_id, 128);
    const destinationAccountId = stringValue(data.destination_account_id, 128);
    const currency = stringValue(data.currency, 3).toUpperCase();
    const splitAmount = amountValue(data.amount);
    if (!validSplitRuleId(configuredSplitRuleId) ||
      !['COMPLETED', 'FAILED'].includes(status) || !validProviderId(splitPaymentId) ||
      splitRuleId !== configuredSplitRuleId || routeReferenceId !== 'lifecycle_admin_commission' ||
      !isUuid(referenceId) || !validProviderId(paymentId) || !validProviderId(shopAccountId) ||
      destinationAccountId !== configuredMasterBusinessId || currency !== 'PHP' || !splitAmount) {
      return null;
    }
    const failureCode = status === 'FAILED' ? stringValue(data.failure_code, 100) || 'UNKNOWN' : null;
    return {
      eventId: `xendit:${eventType}:${splitPaymentId}:${status}`,
      eventType,
      eventKind: status === 'COMPLETED' ? 'split_completed' : 'split_failed',
      checkoutId: null,
      referenceId,
      paymentId,
      splitPaymentId,
      splitRuleId,
      shopAccountId,
      destinationAccountId,
      currency,
      grossAmount: null,
      splitAmount,
      payload: {
        event: eventType,
        created,
        status,
        splitPaymentId,
        splitRuleId,
        routeReferenceId,
        paymentId,
        referenceId,
        sourceAccountId: shopAccountId,
        destinationAccountId,
        currency,
        amount: splitAmount,
        failureCode,
      },
    };
  }

  return null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookToken = Deno.env.get('XENDIT_WEBHOOK_TOKEN') || '';
  const xenditSecretKey = Deno.env.get('XENDIT_SECRET_KEY')?.trim() || '';
  const splitRuleId = Deno.env.get('XENDIT_SPLIT_RULE_ID')?.trim() || '';
  const masterBusinessId = Deno.env.get('XENDIT_MASTER_BUSINESS_ID')?.trim() || '';
  if (!supabaseUrl || !serviceRoleKey || !webhookToken || !xenditSecretKey ||
    !validProviderId(masterBusinessId)) {
    return jsonResponse({ error: 'Xendit webhook configuration is incomplete.' }, 503);
  }
  if (isObviouslyLiveKey(xenditSecretKey)) {
    return jsonResponse({ error: 'LifeCycle Xendit webhooks are locked to test mode.' }, 503);
  }

  const callbackToken = request.headers.get('x-callback-token') || '';
  if (!callbackToken || !(await secureTokenEqual(callbackToken, webhookToken))) {
    return jsonResponse({ error: 'Invalid webhook token.' }, 401);
  }

  let payload: any;
  try {
    payload = await readBody(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse({ error: 'Invalid webhook payload.' }, status);
  }

  const eventType = stringValue(payload?.event, 80).toLowerCase();
  const supported = new Set([
    'payment_session.completed',
    'payment_session.expired',
    'payment.capture',
    'payment.succeeded',
    'split.payment',
  ]);
  if (!supported.has(eventType)) return jsonResponse({ ignored: true });

  const event = normalizeEvent(payload, splitRuleId, masterBusinessId);
  if (!event) return jsonResponse({ ignored: true });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const isShopPaymentEvent =
    event.shopAccountId === masterBusinessId &&
    validShopPaymentReference(event.referenceId) &&
    (event.eventKind === 'payment_completed' || event.eventKind === 'payment_expired');
  const isServicePaymentEvent =
    event.shopAccountId !== masterBusinessId &&
    isUuid(event.referenceId);
  if (!isShopPaymentEvent && !isServicePaymentEvent) {
    return jsonResponse({ ignored: true });
  }

  // General payment webhooks may omit the Payment Session ID. Resolve it only
  // from the server-owned reference saved when the checkout was created.
  if (event.eventKind === 'payment_completed' && !event.checkoutId) {
    const lookup = isShopPaymentEvent
      ? admin
        .from('shop_payments')
        .select('providerCheckoutId')
        .eq('paymentProvider', 'xendit')
        .eq('referenceNumber', event.referenceId)
        .maybeSingle()
      : admin
        .from('funeral_service_requests')
        .select('providerCheckoutId')
        .eq('paymentProvider', 'xendit')
        .eq('providerReferenceId', event.referenceId)
        .maybeSingle();
    const { data: requestRow, error: requestError } = await lookup;
    if (requestError) {
      console.error('Unable to resolve Xendit payment session:', requestError.code || 'unknown');
      return jsonResponse({ error: 'Unable to reconcile the Xendit event.' }, 500);
    }
    const resolvedCheckoutId = stringValue(requestRow?.providerCheckoutId, 128);
    if (!resolvedCheckoutId) return jsonResponse({ ignored: true });
    if (!validProviderId(resolvedCheckoutId) || !resolvedCheckoutId.startsWith('ps-')) {
      return jsonResponse({ error: 'Unable to reconcile the Xendit event.' }, 500);
    }
    event.checkoutId = resolvedCheckoutId;
    event.payload.paymentSessionId = resolvedCheckoutId;
  }

  if (isShopPaymentEvent) {
    const { data, error } = await admin.rpc('reconcile_xendit_shop_payment_event', {
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_event_kind: event.eventKind,
      p_checkout_id: event.checkoutId,
      p_reference_number: event.referenceId,
      p_provider_payment_id: event.paymentId,
      p_payment_method: String(event.payload.channelCode || ''),
      p_business_id: event.shopAccountId,
      p_currency: event.currency,
      p_amount: event.grossAmount,
      p_livemode: false,
      p_payer_name: null,
      p_payload: event.payload,
    });
    if (error) {
      console.error('Unable to reconcile Xendit shop payment:', error.code || 'unknown');
      return jsonResponse({ error: 'Unable to reconcile the Xendit shop payment.' }, 500);
    }
    const result = firstRpcRow<any>(data);
    return jsonResponse({
      received: true,
      paymentId: result?.paymentId || null,
      status: result?.status || null,
      providerStatus: result?.providerStatus || null,
      duplicate: Boolean(result?.duplicate),
    });
  }

  if (!validSplitRuleId(splitRuleId)) {
    return jsonResponse({ error: 'Xendit service split configuration is incomplete.' }, 503);
  }

  const { data, error } = await admin.rpc('reconcile_xendit_service_event', {
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_event_kind: event.eventKind,
    p_checkout_id: event.checkoutId,
    p_reference_id: event.referenceId,
    p_provider_payment_id: event.paymentId,
    p_provider_split_payment_id: event.splitPaymentId,
    p_split_rule_id: event.splitRuleId,
    p_shop_account_id: event.shopAccountId,
    p_destination_account_id: event.destinationAccountId,
    p_currency: event.currency,
    p_gross_amount: event.grossAmount,
    p_split_amount: event.splitAmount,
    p_livemode: false,
    p_payload: event.payload,
  });
  if (error) {
    console.error('Unable to reconcile Xendit webhook:', error.code || 'unknown');
    return jsonResponse({ error: 'Unable to reconcile the Xendit event.' }, 500);
  }

  const result = firstRpcRow<any>(data);
  return jsonResponse({
    received: true,
    requestId: result?.requestId || null,
    status: result?.status || null,
    providerStatus: result?.providerStatus || null,
    commissionStatus: result?.commissionStatus || null,
    duplicate: Boolean(result?.duplicate),
  });
});
