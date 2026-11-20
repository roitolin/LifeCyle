// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';
import { consumeUserRateLimit } from '../_shared/security.ts';
import { xenditPayoutChannelCode } from '../_shared/xenditPayoutChannels.ts';

const XENDIT_PAYOUTS_URL = 'https://api.xendit.co/v2/payouts';
const MAX_BODY_BYTES = 8 * 1024;
const BANK_PAYOUT_CHANNEL_CODES = [
  'PH_BDO',
  'PH_BPI',
  'PH_UBP',
  'PH_METROBANK',
  'PH_LANDBANK',
  'PH_PNB',
  'PH_RCBC',
  'PH_CHINABANK',
  'PH_SECURITYBANK',
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

function firstRpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function errorCode(value: unknown) {
  if (typeof value === 'object' && value !== null && 'error_code' in value) {
    const code = String((value as { error_code?: unknown }).error_code || '').trim();
    if (code) return code.slice(0, 80);
  }
  return 'payout_request_failed';
}

function generateNumericReferenceNo() {
  const nowStr = String(Date.now());
  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += String(Math.floor(Math.random() * 10));
  }
  return `7${nowStr}${suffix}`.slice(0, 19);
}

async function readJson(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error('body_too_large');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error('body_too_large');
  return JSON.parse(raw);
}

function computeSaleShopShare(sale: any): number {
  const explicitNet = Number(sale.payoutAmount ?? sale.shopNetAmount ?? 0);
  if (Number.isFinite(explicitNet) && explicitNet > 0) {
    return Math.round(explicitNet * 100) / 100;
  }
  const gross = Number(
    sale.paymentAmount ||
    (sale.paymentOption === 'downpayment' ? sale.downpaymentAmountSnapshot : (sale.productFullPrice ?? sale.productPrice)) ||
    0
  );
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  const commission = Math.round(gross * 30) / 100;
  return Math.max(0, Math.round((gross - commission) * 100) / 100);
}

function isPaidSaleRow(sale: any): boolean {
  const status = String(sale.status || '').toLowerCase();
  const provider = String(sale.paymentProvider || '').toLowerCase();
  const isSettled = ['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status);
  const isWaitingForSplit = status === 'paid_waiting_for_split' && Boolean(sale.providerPaymentCompletedAt);
  const hasVerifiedTimestamp = Boolean(sale.paymentVerifiedAt);
  if (!isSettled && !isWaitingForSplit && !hasVerifiedTimestamp && !sale.providerPaymentCompletedAt) return false;
  if (provider === 'xendit' || Boolean(sale.providerPaymentCompletedAt) || Number(sale.shopNetAmount || 0) > 0) {
    return computeSaleShopShare(sale) > 0;
  }
  return isSettled && computeSaleShopShare(sale) > 0;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const xenditSecretKey = Deno.env.get('XENDIT_SECRET_KEY')?.trim() || '';
  if (!supabaseUrl || !serviceRoleKey || !xenditSecretKey) {
    return jsonResponse(request, { error: 'Shop withdrawals are not configured.' }, 503);
  }
  if (isObviouslyLiveKey(xenditSecretKey)) {
    return jsonResponse(request, { error: 'Test withdrawals are disabled for live Xendit keys.' }, 503);
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return jsonResponse(request, { error: 'Sign in before withdrawing shop earnings.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return jsonResponse(request, { error: 'Your session is invalid or expired.' }, 401);
  }

  const { data: actor, error: actorError } = await admin
    .from('users')
    .select('disabled')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (actorError) {
    console.error('Unable to authorize shop withdrawal:', actorError.code || 'unknown');
    return jsonResponse(request, { error: 'Unable to authorize this withdrawal.' }, 500);
  }
  if (!actor || actor.disabled) {
    return jsonResponse(request, { error: 'This account cannot request shop withdrawals.' }, 403);
  }

  let input: { requestId?: unknown; amount?: unknown; payoutChannelCode?: unknown };
  try {
    input = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid withdrawal request.' }, status);
  }

  const requestedPayoutChannelCode = input?.payoutChannelCode == null
    ? ''
    : String(input.payoutChannelCode).trim().toUpperCase();
  if (requestedPayoutChannelCode && !BANK_PAYOUT_CHANNEL_CODES.includes(requestedPayoutChannelCode as typeof BANK_PAYOUT_CHANNEL_CODES[number])) {
    return jsonResponse(request, { error: 'Shop withdrawals can only be sent to a supported bank account.' }, 400);
  }

  const rateLimit = await consumeUserRateLimit(admin, 'shop-manual-withdrawal', userData.user.id, 10, 5 * 60);
  if (rateLimit.unavailable) {
    return jsonResponse(request, { error: 'Security checks are temporarily unavailable.' }, 503);
  }
  if (!rateLimit.allowed) {
    return jsonResponse(request, {
      error: 'Too many withdrawal requests. Please wait before trying again.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }, 429);
  }

  const payoutChannelCodes = requestedPayoutChannelCode
    ? [requestedPayoutChannelCode]
    : [...BANK_PAYOUT_CHANNEL_CODES];
  const { data: bankReceiver, error: bankReceiverError } = await admin
    .from('funeral_shop_payout_accounts')
    .select('channelCode, accountName, accountNumber')
    .eq('shopId', userData.user.id)
    .eq('active', true)
    .eq('verifiedByAdmin', true)
    .in('channelCode', payoutChannelCodes)
    .order('verifiedAt', { ascending: false, nullsFirst: false })
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bankReceiverError) {
    console.error('Unable to load shop bank withdrawal method:', bankReceiverError.code || 'unknown');
    return jsonResponse(request, { error: 'Unable to load your bank payout method.' }, 500);
  }
  if (!bankReceiver) {
    return jsonResponse(request, { error: 'Add an active bank payout method and have an administrator verify it first.' }, 409);
  }
  const payoutChannelCode = String(bankReceiver.channelCode || '').trim().toUpperCase();

  const rawRequestedAmount = input?.amount != null ? Number(input.amount) : NaN;
  const isCustomAmountMode = Number.isFinite(rawRequestedAmount) && rawRequestedAmount > 0;

  if (isCustomAmountMode) {
    const requestedAmount = Math.round(rawRequestedAmount * 100) / 100;
    if (requestedAmount <= 0) {
      return jsonResponse(request, { error: 'Enter a withdrawal amount greater than 0.' }, 400);
    }

    const [salesRes, withdrawalsRes] = await Promise.all([
      admin
        .from('funeral_service_requests')
        .select('id, status, "paymentOption", "paymentAmount", "downpaymentAmountSnapshot", "productPrice", "productFullPrice", "paymentVerifiedAt", "paymentProvider", "providerPaymentCompletedAt", "payoutStatus", "payoutId", "shopNetAmount", "payoutAmount"')
        .eq('shopId', userData.user.id),
      admin
        .from('shop_withdrawals')
        .select('id, amount, status, "payoutId"')
        .eq('shopId', userData.user.id),
    ]);

    if (salesRes.error || withdrawalsRes.error) {
      return jsonResponse(request, { error: 'Unable to calculate your available withdrawal balance.' }, 500);
    }

    const paidSales = (salesRes.data || []).filter(isPaidSaleRow);
    const totalEarned = paidSales.reduce((sum, sale) => sum + computeSaleShopShare(sale), 0);

    const activeWithdrawals = (withdrawalsRes.data || []).filter(
      (w: any) => !['failed', 'cancelled', 'reversed'].includes(String(w.status || '').toLowerCase())
    );
    const recordedPayoutIds = new Set(activeWithdrawals.map((w: any) => w.payoutId).filter(Boolean));
    const legacyWithdrawn = paidSales
      .filter((s: any) => s.payoutId && !recordedPayoutIds.has(s.payoutId) && !['failed', 'cancelled', 'reversed'].includes(String(s.payoutStatus || '').toLowerCase()))
      .reduce((sum, s) => sum + computeSaleShopShare(s), 0);

    const totalWithdrawn = activeWithdrawals.reduce((sum: number, w: any) => sum + (Number(w.amount) || 0), 0) + legacyWithdrawn;
    const availableBalance = Math.max(0, Math.round((totalEarned - totalWithdrawn) * 100) / 100);

    if (requestedAmount > availableBalance + 0.009) {
      return jsonResponse(request, {
        error: `Entered amount exceeds your available withdrawal balance of ₱${availableBalance.toFixed(2)}.`,
      }, 409);
    }

    const payoutReferenceId = `lifecycle-withdrawal-${crypto.randomUUID()}`;
    const referenceNo = generateNumericReferenceNo();
    const nowIso = new Date().toISOString();

    const { data: withdrawalRow, error: insertError } = await admin
      .from('shop_withdrawals')
      .insert({
        shopId: userData.user.id,
        amount: requestedAmount,
        channelCode: payoutChannelCode,
        accountName: bankReceiver.accountName,
        accountNumber: bankReceiver.accountNumber,
        referenceNo,
        payoutReferenceId,
        status: 'in_progress',
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .select('id, "referenceNo"')
      .single();

    if (insertError || !withdrawalRow) {
      console.error('Unable to create shop withdrawal record:', insertError);
      return jsonResponse(request, { error: 'Unable to record your withdrawal request.' }, 500);
    }

    let providerResponse: Response | null = null;
    let providerBody: any = null;
    try {
      providerResponse = await fetch(XENDIT_PAYOUTS_URL, {
        method: 'POST',
        headers: {
          Authorization: basicAuth(xenditSecretKey),
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-key': payoutReferenceId,
        },
        body: JSON.stringify({
          reference_id: payoutReferenceId,
          channel_code: xenditPayoutChannelCode(payoutChannelCode),
          channel_properties: {
            account_holder_name: bankReceiver.accountName,
            account_number: bankReceiver.accountNumber,
          },
          amount: requestedAmount,
          currency: 'PHP',
          description: `LifeCycle shop withdrawal (${referenceNo})`.slice(0, 200),
          metadata: {
            purpose: 'lifecycle_shop_payout',
            withdrawal_id: withdrawalRow.id,
            reference_no: referenceNo,
          },
        }),
      });
      providerBody = await providerResponse.json().catch(() => null);
    } catch (error) {
      console.error('Xendit custom withdrawal request failed:', error instanceof Error ? error.name : 'unknown');
    }

    if (!providerResponse?.ok || !providerBody?.id) {
      const failureCode = errorCode(providerBody);
      await admin
        .from('shop_withdrawals')
        .update({
          status: 'failed',
          failureCode,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', withdrawalRow.id);
      return jsonResponse(request, {
        error: 'Xendit did not confirm the withdrawal. Your available balance remains unchanged.',
        payoutFailureCode: failureCode,
      }, 502);
    }

    const completedAt = new Date().toISOString();
    await admin
      .from('shop_withdrawals')
      .update({
        payoutId: String(providerBody.id).slice(0, 255),
        status: 'transferred',
        completedAt,
        updatedAt: completedAt,
      })
      .eq('id', withdrawalRow.id);

    return jsonResponse(request, {
      accepted: true,
      alreadyInitiated: false,
      payoutStatus: 'transferred',
      payoutId: String(providerBody.id).slice(0, 255),
      referenceNo,
      payoutAmount: requestedAmount,
    });
  }

  const requestId = String(input?.requestId || '').trim().toLowerCase();
  if (!isUuid(requestId)) return jsonResponse(request, { error: 'Enter a valid withdrawal amount.' }, 400);

  const { data: sale, error: saleError } = await admin
    .from('funeral_service_requests')
    .select('id, "shopId", status, "paymentOption", "paymentAmount", "downpaymentAmountSnapshot", "productPrice", "productFullPrice", "paymentVerifiedAt", "paymentProvider", "providerPaymentCompletedAt", "payoutStatus", "payoutId", "shopNetAmount", "payoutAmount"')
    .eq('id', requestId)
    .eq('shopId', userData.user.id)
    .maybeSingle();
  if (saleError) {
    console.error('Unable to load shop sale for withdrawal:', saleError.code || 'unknown');
    return jsonResponse(request, { error: 'Unable to load this sale.' }, 500);
  }
  if (!sale) return jsonResponse(request, { error: 'This sale was not found for your shop.' }, 404);
  if (!isPaidSaleRow(sale)) {
    return jsonResponse(request, { error: 'Only paid service sales are available to withdraw.' }, 409);
  }

  const resolvedShopShare = computeSaleShopShare(sale);
  const existingPayoutStatus = String(sale.payoutStatus || '').toLowerCase();
  if (sale.payoutId || existingPayoutStatus === 'succeeded') {
    return jsonResponse(request, {
      accepted: true,
      alreadyInitiated: true,
      payoutStatus: existingPayoutStatus || 'pending',
      payoutId: sale.payoutId || null,
      payoutAmount: resolvedShopShare,
    });
  }

  const payoutReferenceId = `lifecycle-payout-${requestId}`;
  const referenceNo = generateNumericReferenceNo();
  const { data: payoutData, error: payoutError } = await admin.rpc('initiate_shop_payout', {
    p_request_id: requestId,
    p_payout_reference_id: payoutReferenceId,
    p_payout_channel_code: payoutChannelCode,
  });
  let payoutInfo = firstRpcRow<any>(payoutData);
  if (payoutError || !payoutInfo) {
    const providerPayoutChannel = xenditPayoutChannelCode(payoutChannelCode);
    await admin
      .from('funeral_service_requests')
      .update({
        payoutStatus: 'pending',
        shopNetAmount: resolvedShopShare,
        payoutAmount: resolvedShopShare,
        payoutChannelCode: providerPayoutChannel,
        payoutReferenceId,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', requestId);
    payoutInfo = {
      requestId,
      alreadyInitiated: false,
      payoutAmount: resolvedShopShare,
      payoutChannelCode: providerPayoutChannel,
      payoutAccountName: bankReceiver.accountName,
      payoutAccountNumber: bankReceiver.accountNumber,
      payoutReferenceId,
      currency: 'PHP',
    };
  }

  const payoutAmount = Number(payoutInfo.payoutAmount);
  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    return jsonResponse(request, { error: 'This sale has no withdrawable shop share.' }, 409);
  }

  let providerResponse: Response | null = null;
  let providerBody: any = null;
  try {
    providerResponse = await fetch(XENDIT_PAYOUTS_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(xenditSecretKey),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-key': payoutReferenceId,
      },
      body: JSON.stringify({
        reference_id: payoutReferenceId,
        channel_code: xenditPayoutChannelCode(String(payoutInfo.payoutChannelCode || '')),
        channel_properties: {
          account_holder_name: payoutInfo.payoutAccountName,
          account_number: payoutInfo.payoutAccountNumber,
        },
        amount: payoutAmount,
        currency: 'PHP',
        description: `LifeCycle shop withdrawal for order ${requestId}`.slice(0, 200),
        metadata: {
          purpose: 'lifecycle_shop_payout',
          request_id: requestId,
          commission_percent: '30',
        },
      }),
    });
    providerBody = await providerResponse.json().catch(() => null);
  } catch (error) {
    console.error('Xendit withdrawal request failed:', error instanceof Error ? error.name : 'unknown');
  }

  if (!providerResponse?.ok || !providerBody?.id) {
    const failureCode = errorCode(providerBody);
    await admin
      .from('funeral_service_requests')
      .update({
        payoutStatus: 'failed',
        payoutFailureCode: failureCode,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('payoutStatus', 'pending')
      .is('payoutId', null);
    return jsonResponse(request, {
      error: 'Xendit did not confirm the withdrawal. The sale remains recorded; check its payout status before trying again.',
      payoutFailureCode: failureCode,
    }, 502);
  }

  const completedAt = new Date().toISOString();
  const payoutIdStr = String(providerBody.id).slice(0, 255);
  await admin
    .from('funeral_service_requests')
    .update({
      payoutId: payoutIdStr,
      payoutStatus: 'succeeded',
      payoutCompletedAt: completedAt,
      updatedAt: completedAt,
    })
    .eq('id', requestId);

  await admin
    .from('shop_withdrawals')
    .upsert({
      shopId: userData.user.id,
      amount: payoutAmount,
      channelCode: payoutChannelCode,
      accountName: bankReceiver.accountName,
      accountNumber: bankReceiver.accountNumber,
      referenceNo,
      payoutReferenceId,
      payoutId: payoutIdStr,
      status: 'transferred',
      createdAt: completedAt,
      completedAt,
      updatedAt: completedAt,
    }, { onConflict: 'payoutReferenceId' });

  return jsonResponse(request, {
    accepted: true,
    alreadyInitiated: false,
    payoutStatus: 'transferred',
    payoutId: payoutIdStr,
    referenceNo,
    payoutAmount,
  });
});
