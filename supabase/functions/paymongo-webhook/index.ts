// eslint-disable-next-line import/no-unresolved
// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2';

declare const Deno: any;

const encoder = new TextEncoder();
const MAX_SIGNATURE_AGE_SECONDS = 10 * 60;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function signatureParts(value: string) {
  return Object.fromEntries(
    value.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }),
  ) as Record<string, string>;
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function eventDetails(payload: any) {
  const envelope = payload?.data || {};

  if (typeof envelope?.type === 'string' && envelope?.data) {
    return {
      eventId: String(envelope.id || ''),
      eventType: envelope.type,
      livemode: envelope.livemode,
      resource: envelope.data,
    };
  }

  const attributes = envelope?.attributes || {};
  return {
    eventId: String(envelope.id || ''),
    eventType: String(attributes.type || ''),
    livemode: attributes.livemode,
    resource: attributes.data,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const webhookSecret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Webhook configuration is incomplete.' }, 503);
  }

  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get('paymongo-signature') ||
    request.headers.get('x-paymongo-signature') ||
    '';
  const parts = signatureParts(signatureHeader);
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) {
    return jsonResponse({ error: 'Invalid webhook signature.' }, 401);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_SIGNATURE_AGE_SECONDS) {
    return jsonResponse({ error: 'Expired webhook signature.' }, 401);
  }

  const expected = await hmacHex(webhookSecret, `${parts.t}.${rawBody}`);
  const matchedLive = timingSafeEqual(expected, parts.li || '');
  const matchedTest = timingSafeEqual(expected, parts.te || '');
  if (!matchedLive && !matchedTest) {
    return jsonResponse({ error: 'Invalid webhook signature.' }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400);
  }

  const details = eventDetails(payload);
  if (details.eventType !== 'checkout_session.payment.paid') {
    return jsonResponse({ ignored: true });
  }

  const checkout = details.resource || {};
  const attributes = checkout.attributes || {};
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  const paidPayment = payments.find((payment: any) => payment?.attributes?.status === 'paid');
  const checkoutId = String(checkout.id || '');
  const providerPaymentId = String(paidPayment?.id || '');
  const paymentAttributes = paidPayment?.attributes || {};
  const referenceNumber = String(attributes.reference_number || '');
  const livemode = Boolean(attributes.livemode ?? details.livemode ?? matchedLive);
  const purpose = String(attributes.metadata?.purpose || 'shop_subscription');

  if (!checkoutId.startsWith('cs_') || !providerPaymentId.startsWith('pay_')) {
    return jsonResponse({ error: 'Webhook does not contain a completed checkout payment.' }, 422);
  }
  if ((livemode && !matchedLive) || (!livemode && !matchedTest)) {
    return jsonResponse({ error: 'Webhook mode does not match its signature.' }, 401);
  }

  const eventId = details.eventId || `${details.eventType}:${checkoutId}:${providerPaymentId}`;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpcName = purpose === 'funeral_service_payment'
    ? 'complete_paymongo_service_payment'
    : 'complete_paymongo_shop_payment';
  const { data: paymentId, error } = await admin.rpc(rpcName, {
    p_event_id: eventId,
    p_checkout_id: checkoutId,
    p_reference_number: referenceNumber,
    p_provider_payment_id: providerPaymentId,
    p_payment_method: String(paymentAttributes.source?.type || ''),
    p_amount_cents: Number(paymentAttributes.amount) || 0,
    p_livemode: livemode,
    p_payer_name: paymentAttributes.billing?.name || null,
  });
  if (error) {
    console.error('Unable to complete PayMongo payment:', error.code || 'unknown');
    return jsonResponse({ error: 'Unable to reconcile the payment.' }, 500);
  }

  return jsonResponse({ received: true, paymentId });
});
