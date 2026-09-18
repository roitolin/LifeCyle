// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'funeral_admin']);
const ELIGIBLE_SHOP_STATUSES = new Set(['verified', 'live', 'offline', 'pending']);
const MAX_BODY_BYTES = 16 * 1024;

const VALID_PAYOUT_CHANNELS = new Set([
  'PH_GCASH', 'PH_MAYA',
  'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK',
  'PH_LANDBANK', 'PH_PNB', 'PH_RCBC', 'PH_CHINABANK',
  'PH_SECURITYBANK', 'PH_EASTWESTBANK',
]);

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

/**
 * Verify/update a shop's payout account details.
 *
 * When called by an admin, this sets payoutVerifiedByAdmin = true.
 * When called by a shop owner, this only updates the payout details
 * (admin verification is still required before the shop can receive orders).
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, { error: 'Server configuration is incomplete.' }, 503);
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return jsonResponse(request, { error: 'Sign in before managing shop payouts.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return jsonResponse(request, { error: 'Your session is invalid or expired.' }, 401);
  }

  const { data: actor, error: actorError } = await admin
    .from('users')
    .select('role, disabled')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (actorError) {
    console.error('Actor lookup error in provision-xendit-shop:', actorError);
    return jsonResponse(request, { error: 'Unable to authorize this request.' }, 500);
  }

  const isAdmin = actor && ADMIN_ROLES.has(String(actor.role)) && !actor.disabled;

  let input: {
    shopId?: unknown;
    payoutChannelCode?: unknown;
    payoutAccountName?: unknown;
    payoutAccountNumber?: unknown;
    action?: unknown;
  };
  try {
    input = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid request.' }, status);
  }

  const shopId = String(input?.shopId || '').trim().toLowerCase();
  if (!isUuid(shopId)) return jsonResponse(request, { error: 'A valid funeral shop is required.' }, 400);

  const action = String(input?.action || 'verify').trim().toLowerCase();

  // Verify action: admin confirms the shop's payout details
  if (action === 'verify') {
    if (!actor || !ADMIN_ROLES.has(String(actor.role)) || actor.disabled) {
      return jsonResponse(request, { error: 'Only an active administrator can verify payout accounts.' }, 403);
    }

    const { data: shop, error: shopError } = await admin
      .from('funeral_shops')
      .select('id, status, payoutChannelCode, payoutAccountName, payoutAccountNumber, payoutVerifiedByAdmin')
      .eq('id', shopId)
      .maybeSingle();
    if (shopError) return jsonResponse(request, { error: 'Unable to load the funeral shop.' }, 500);
    if (!shop) return jsonResponse(request, { error: 'Funeral shop not found.' }, 404);
    if (!ELIGIBLE_SHOP_STATUSES.has(String(shop.status || '').toLowerCase())) {
      return jsonResponse(request, { error: 'Verify the funeral shop before setting up payouts.' }, 409);
    }

    // If admin provides new payout details, update them
    const channelCode = String(input?.payoutChannelCode || shop.payoutChannelCode || '').trim().toUpperCase();
    const accountName = String(input?.payoutAccountName || shop.payoutAccountName || '').trim();
    const accountNumber = String(input?.payoutAccountNumber || shop.payoutAccountNumber || '').trim();

    if (!VALID_PAYOUT_CHANNELS.has(channelCode)) {
      return jsonResponse(request, { error: 'Select a valid payout channel (e.g. GCash, BDO, BPI).' }, 400);
    }
    if (!accountName || accountName.length < 2 || accountName.length > 120) {
      return jsonResponse(request, { error: 'A valid account holder name is required.' }, 400);
    }
    if (!accountNumber || accountNumber.length < 4 || accountNumber.length > 30) {
      return jsonResponse(request, { error: 'A valid account number is required.' }, 400);
    }

    const { error: updateError } = await admin
      .from('funeral_shops')
      .update({
        payoutChannelCode: channelCode,
        payoutAccountName: accountName,
        payoutAccountNumber: accountNumber,
        payoutVerifiedByAdmin: true,
        payoutVerifiedAt: new Date().toISOString(),
        // Also mark the legacy xendit provisioning as 'provisioned' for backward compatibility
        xenditProvisioningStatus: 'provisioned',
        xenditProvisioningError: null,
        xenditProvisioningUpdatedAt: new Date().toISOString(),
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('Unable to verify shop payout:', updateError.code || 'unknown');
      return jsonResponse(request, { error: 'Unable to save the payout verification.' }, 500);
    }

    return jsonResponse(request, {
      shopId,
      payoutChannelCode: channelCode,
      payoutAccountName: accountName,
      payoutVerified: true,
      testMode: true,
    });
  }

  // Update action: shop owner submits their own payout details (not verified yet)
  if (action === 'update') {
    if (userData.user.id !== shopId && !isAdmin) {
      return jsonResponse(request, { error: 'Only the shop owner can update payout details.' }, 403);
    }

    const channelCode = String(input?.payoutChannelCode || '').trim().toUpperCase();
    const accountName = String(input?.payoutAccountName || '').trim();
    const accountNumber = String(input?.payoutAccountNumber || '').trim();

    if (!VALID_PAYOUT_CHANNELS.has(channelCode)) {
      return jsonResponse(request, { error: 'Select a valid payout channel (e.g. GCash, BDO, BPI).' }, 400);
    }
    if (!accountName || accountName.length < 2 || accountName.length > 120) {
      return jsonResponse(request, { error: 'A valid account holder name is required.' }, 400);
    }
    if (!accountNumber || accountNumber.length < 4 || accountNumber.length > 30) {
      return jsonResponse(request, { error: 'A valid account number is required.' }, 400);
    }

    const { error: updateError } = await admin
      .from('funeral_shops')
      .update({
        payoutChannelCode: channelCode,
        payoutAccountName: accountName,
        payoutAccountNumber: accountNumber,
        // Reset verification when details change
        payoutVerifiedByAdmin: false,
        payoutVerifiedAt: null,
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('Unable to update shop payout:', updateError.code || 'unknown');
      return jsonResponse(request, { error: 'Unable to save the payout details.' }, 500);
    }

    return jsonResponse(request, {
      shopId,
      payoutChannelCode: channelCode,
      payoutAccountName: accountName,
      payoutVerified: false,
      testMode: true,
    });
  }

  return jsonResponse(request, { error: 'Invalid action. Use "verify" or "update".' }, 400);
});
