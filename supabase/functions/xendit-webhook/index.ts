// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const XENDIT_PAYOUTS_URL = 'https://api.xendit.co/v2/payouts';
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

function basicAuth(secretKey: string) {
  return `Basic ${btoa(`${secretKey}:`)}`;
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
  eventKind: 'payment_completed' | 'payment_expired' | 'payout_succeeded' | 'payout_failed';
  checkoutId: string | null;
  referenceId: string;
  paymentId: string | null;
  payoutId: string | null;
  shopAccountId: string;
  currency: string;
  grossAmount: number | null;
  payoutAmount: number | null;
  payoutFailureCode: string | null;
  payload: Record<string, unknown>;
};

function normalizeEvent(payload: any): NormalizedEvent | null {
  const eventType = stringValue(payload?.event, 80).toLowerCase();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const created = stringValue(payload?.created, 50);

  // ── Payment session events ──
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
      payoutId: null,
      shopAccountId,
      currency,
      grossAmount,
      payoutAmount: null,
      payoutFailureCode: null,
      payload: {
        event: eventType, created, status,
        businessId: shopAccountId, paymentSessionId: checkoutId,
        paymentId, referenceId, currency, amount: grossAmount,
        channelCode: stringValue(data.channel_code, 80) || null,
      },
    };
  }

  // ── Payment capture events ──
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
      checkoutId, referenceId, paymentId,
      payoutId: null, shopAccountId, currency, grossAmount,
      payoutAmount: null, payoutFailureCode: null,
      payload: {
        event: eventType, created, status,
        businessId: shopAccountId, paymentSessionId: checkoutId,
        paymentId, captureId, referenceId, currency, amount: grossAmount,
        channelCode: stringValue(data.channel_code, 80) || null,
      },
    };
  }

  // ── Payment succeeded events ──
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
      checkoutId, referenceId, paymentId,
      payoutId: null, shopAccountId, currency, grossAmount,
      payoutAmount: null, payoutFailureCode: null,
      payload: {
        event: eventType, created, status,
        businessId: shopAccountId, paymentSessionId: checkoutId,
        paymentId, referenceId, currency, amount: grossAmount,
        channelCode: stringValue(data.channel_code, 80) || null,
      },
    };
  }

  // ── Payout events (new — for 70% shop payout confirmation) ──
  if (eventType === 'payout.succeeded' || eventType === 'payout.failed') {
    const payoutId = stringValue(data.id, 128);
    const referenceId = stringValue(data.reference_id, 255);
    const payoutStatus = stringValue(data.status, 40).toUpperCase();
    const currency = stringValue(data.currency, 3).toUpperCase();
    const payoutAmount = amountValue(data.amount);
    const failureCode = stringValue(data.failure_code, 100) || null;
    const shopAccountId = stringValue(data.business_id || payload?.business_id, 128);

    if (!payoutId || !referenceId || currency !== 'PHP') return null;
    if (eventType === 'payout.succeeded' && payoutStatus !== 'SUCCEEDED') return null;
    if (eventType === 'payout.failed' && payoutStatus !== 'FAILED') return null;

    return {
      eventId: `xendit:${eventType}:${payoutId}`,
      eventType,
      eventKind: eventType === 'payout.succeeded' ? 'payout_succeeded' : 'payout_failed',
      checkoutId: null,
      referenceId,
      paymentId: null,
      payoutId,
      shopAccountId,
      currency,
      grossAmount: null,
      payoutAmount,
      payoutFailureCode: failureCode,
      payload: {
        event: eventType, created,
        payoutId, referenceId, status: payoutStatus,
        currency, amount: payoutAmount, failureCode,
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
  // No longer need XENDIT_SPLIT_RULE_ID or XENDIT_MASTER_BUSINESS_ID
  if (!supabaseUrl || !serviceRoleKey || !webhookToken || !xenditSecretKey) {
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
    'payout.succeeded',
    'payout.failed',
  ]);
  if (!supported.has(eventType)) return jsonResponse({ ignored: true });

  const event = normalizeEvent(payload);
  if (!event) return jsonResponse({ ignored: true });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Handle payout webhook events ──
  if (event.eventKind === 'payout_succeeded' || event.eventKind === 'payout_failed') {
    const { data, error } = await admin.rpc('reconcile_payout_event', {
      p_event_id: event.eventId,
      p_payout_id: event.payoutId,
      p_reference_id: event.referenceId,
      p_status: event.eventKind === 'payout_succeeded' ? 'succeeded' : 'failed',
      p_failure_code: event.payoutFailureCode,
      p_payload: event.payload,
    });
    if (error) {
      console.error('Unable to reconcile payout event:', error.code || 'unknown');
      return jsonResponse({ error: 'Unable to reconcile the payout event.' }, 500);
    }
    const result = firstRpcRow<any>(data);
    return jsonResponse({
      received: true,
      requestId: result?.requestId || null,
      payoutStatus: result?.payoutStatus || null,
      duplicate: Boolean(result?.duplicate),
    });
  }

  // ── Handle shop payment events ──
  const isShopPaymentEvent =
    validShopPaymentReference(event.referenceId) &&
    (event.eventKind === 'payment_completed' || event.eventKind === 'payment_expired');
  const isServicePaymentEvent = isUuid(event.referenceId);

  if (!isShopPaymentEvent && !isServicePaymentEvent) {
    return jsonResponse({ ignored: true });
  }

  // Resolve checkout ID from reference if missing
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

  // ── Service payment events (casket orders) ──
  const { data, error } = await admin.rpc('reconcile_xendit_service_event', {
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_event_kind: event.eventKind,
    p_checkout_id: event.checkoutId,
    p_reference_id: event.referenceId,
    p_provider_payment_id: event.paymentId,
    p_provider_split_payment_id: null,
    p_split_rule_id: null,
    p_shop_account_id: event.shopAccountId,
    p_destination_account_id: null,
    p_currency: event.currency,
    p_gross_amount: event.grossAmount,
    p_split_amount: null,
    p_livemode: false,
    p_payload: event.payload,
  });
  if (error) {
    console.error('Unable to reconcile Xendit webhook:', error.code || 'unknown');
    return jsonResponse({ error: 'Unable to reconcile the Xendit event.' }, 500);
  }

  const result = firstRpcRow<any>(data);
  const responsePayload: Record<string, unknown> = {
    received: true,
    requestId: result?.requestId || null,
    status: result?.status || null,
    providerStatus: result?.providerStatus || null,
    commissionStatus: result?.commissionStatus || null,
    duplicate: Boolean(result?.duplicate),
  };

  // ── After payment_completed: trigger payout of 70% to shop ──
  if (event.eventKind === 'payment_completed' && !result?.duplicate && result?.status === 'payment_verified') {
    const requestId = result?.requestId;
    const shopNetAmount = result?.shopNetAmount;
    if (requestId && shopNetAmount && shopNetAmount > 0) {
      try {
        const payoutRefId = `lifecycle-payout-${requestId}`;
        const { data: payoutData, error: payoutError } = await admin.rpc('initiate_shop_payout', {
          p_request_id: requestId,
          p_payout_reference_id: payoutRefId,
        });
        const payoutInfo = firstRpcRow<any>(payoutData);

        if (payoutError) {
          console.error('Unable to initiate shop payout:', payoutError.code || 'unknown');
        } else if (payoutInfo && !payoutInfo.alreadyInitiated && payoutInfo.payoutAmount > 0) {
          // Call Xendit Payouts API to send 70% to shop
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

          const payoutResponse = await fetch(XENDIT_PAYOUTS_URL, {
            method: 'POST',
            headers: {
              Authorization: basicAuth(xenditSecretKey),
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'Idempotency-key': payoutRefId,
            },
            body: JSON.stringify(payoutBody),
          }).catch(() => null);

          const payoutJson = payoutResponse ? await payoutResponse.json().catch(() => null) : null;
          if (payoutResponse?.ok && payoutJson?.id) {
            responsePayload.payoutInitiated = true;
            responsePayload.payoutId = payoutJson.id;
            console.log('Shop payout initiated:', payoutJson.id, 'Amount:', payoutInfo.payoutAmount);
          } else {
            const payoutErrorCode = String(payoutJson?.error_code || 'payout_failed').slice(0, 80);
            console.error('Xendit payout creation failed:', payoutErrorCode);
            responsePayload.payoutInitiated = false;
            responsePayload.payoutError = payoutErrorCode;

            // Mark failure on the service request
            await admin
              .from('funeral_service_requests')
              .update({
                payoutStatus: 'failed',
                payoutFailureCode: payoutErrorCode,
                updatedAt: new Date().toISOString(),
              })
              .eq('id', requestId);

            const formattedPayout = Number(payoutInfo.payoutAmount).toLocaleString('en-PH', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });

            // 1. Notify Admins immediately
            const { data: admins } = await admin
              .from('users')
              .select('id')
              .in('role', ['admin', 'super_admin', 'funeral_admin']);

            if (admins && admins.length > 0) {
              await admin.from('notifications').insert(
                admins.map((adm: any) => ({
                  userId: adm.id,
                  type: 'admin_payout_failed',
                  title: `ALERT: Shop Payout Failed (₱${formattedPayout})`,
                  body: `70% payout for order #${requestId.slice(0, 8)} failed to dispatch via Xendit (${payoutErrorCode}). Please check admin balance or shop details.`,
                  data: {
                    requestId,
                    payoutError: payoutErrorCode,
                    amount: payoutInfo.payoutAmount,
                  },
                  read: false,
                }))
              );
            }

            // 2. Notify Shop
            const { data: reqData } = await admin
              .from('funeral_service_requests')
              .select('shopId')
              .eq('id', requestId)
              .maybeSingle();

            if (reqData?.shopId) {
              await admin.from('notifications').insert({
                userId: reqData.shopId,
                type: 'shop_payout_failed',
                title: `Payout Issue: ₱${formattedPayout}`,
                body: `Your 70% payout of ₱${formattedPayout} for order #${requestId.slice(0, 8)} encountered an issue (${payoutErrorCode}). An administrator will review your account.`,
                data: {
                  requestId,
                  payoutError: payoutErrorCode,
                  amount: payoutInfo.payoutAmount,
                },
                read: false,
              });
            }
          }
        }
      } catch (payoutErr) {
        console.error('Payout initiation error:', payoutErr);
        responsePayload.payoutInitiated = false;
      }
    }
  }

  return jsonResponse(responsePayload);
});
