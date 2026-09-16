// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const XENDIT_ACCOUNTS_URL = 'https://api.xendit.co/v3/accounts';
const XENDIT_LIST_ACCOUNTS_URL = 'https://api.xendit.co/v2/accounts';
const ADMIN_ROLES = new Set(['admin', 'super_admin', 'funeral_admin']);
const ELIGIBLE_SHOP_STATUSES = new Set(['verified', 'live', 'offline']);
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

function isEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validAccountId(value: string) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function firstRpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
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

async function xenditRequest(secretKey: string, url: string, init?: RequestInit) {
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

type ListedAccount = {
  id?: unknown;
  email?: unknown;
  status?: unknown;
};

async function findExistingAccount(secretKey: string, email: string) {
  const url = new URL(XENDIT_LIST_ACCOUNTS_URL);
  url.searchParams.set('email', email);
  url.searchParams.set('limit', '10');

  const result = await xenditRequest(secretKey, url.toString());
  if (!result.ok) return null;

  const payload = await result.json().catch(() => null);
  const exactMatches = (Array.isArray(payload?.data) ? payload.data : [])
    .filter((account: ListedAccount) =>
      String(account?.email || '').toLowerCase() === email.toLowerCase() &&
      validAccountId(String(account?.id || ''))
    );

  if (exactMatches.length !== 1) return null;
  return {
    id: String(exactMatches[0].id),
    status: String(exactMatches[0].status || 'LIVE').toUpperCase(),
    createdAt: null as string | null,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const xenditSecretKey = Deno.env.get('XENDIT_SECRET_KEY')?.trim();
  if (!supabaseUrl || !serviceRoleKey || !xenditSecretKey) {
    return jsonResponse(request, { error: 'Xendit test configuration is incomplete.' }, 503);
  }
  if (isObviouslyLiveKey(xenditSecretKey)) {
    return jsonResponse(request, { error: 'LifeCycle Xendit accounts are locked to test mode.' }, 503);
  }

  const accessToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return jsonResponse(request, { error: 'Administrator sign-in is required.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return jsonResponse(request, { error: 'Your session is invalid or expired.' }, 401);
  }

  const { data: actor, error: actorError } = await admin
    .from('users')
    .select('role, disabled, adminStatus')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (actorError) return jsonResponse(request, { error: 'Unable to authorize this request.' }, 500);
  if (!actor || !ADMIN_ROLES.has(String(actor.role)) || actor.disabled || actor.adminStatus !== 'active') {
    return jsonResponse(request, { error: 'Only an active administrator can provision shop payments.' }, 403);
  }

  let input: { shopId?: unknown };
  try {
    input = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid provisioning request.' }, status);
  }
  const shopId = String(input?.shopId || '').trim().toLowerCase();
  if (!isUuid(shopId)) return jsonResponse(request, { error: 'A valid funeral shop is required.' }, 400);

  const [{ data: shopProfile, error: shopProfileError }, { data: ownerProfile, error: ownerProfileError }] =
    await Promise.all([
      admin.from('funeral_shops').select('id, status').eq('id', shopId).maybeSingle(),
      admin.from('users').select('id, role, disabled').eq('id', shopId).maybeSingle(),
    ]);
  if (shopProfileError || ownerProfileError) {
    return jsonResponse(request, { error: 'Unable to load the funeral shop.' }, 500);
  }
  if (!shopProfile || !ownerProfile || ownerProfile.role !== 'funeral' || ownerProfile.disabled) {
    return jsonResponse(request, { error: 'This funeral shop account is not available.' }, 404);
  }
  if (!ELIGIBLE_SHOP_STATUSES.has(String(shopProfile.status || '').toLowerCase())) {
    return jsonResponse(request, { error: 'Verify the funeral shop before provisioning Xendit.' }, 409);
  }

  const { data: claimData, error: claimError } = await admin.rpc('claim_xendit_shop_provisioning', {
    p_shop_id: shopId,
  });
  if (claimError) {
    const unavailable = claimError.code === 'P0001' || claimError.code === '23514';
    return jsonResponse(
      request,
      { error: unavailable ? 'Verify the funeral shop before provisioning Xendit.' : 'Unable to prepare Xendit provisioning.' },
      unavailable ? 409 : 500,
    );
  }

  const claim = firstRpcRow<any>(claimData);
  if (!claim || claim.shopId !== shopId) {
    return jsonResponse(request, { error: 'Unable to prepare Xendit provisioning.' }, 500);
  }

  const existingId = String(claim.xenditAccountId || '').trim();
  if (!claim.shouldProvision && validAccountId(existingId)) {
    return jsonResponse(request, {
      shopId,
      xenditAccountId: existingId,
      xenditAccountStatus: 'LIVE',
      provisioningStatus: String(claim.provisioningStatus || 'provisioned'),
      reused: true,
      testMode: true,
    });
  }

  if (!claim.shouldProvision) {
    return jsonResponse(request, { error: 'This Xendit account is already being provisioned.' }, 409);
  }

  const ownerEmail = String(claim.email || '').trim().toLowerCase();
  const shopName = String(claim.shopName || '').trim().slice(0, 120);
  const attemptId = String(claim.provisioningAttemptId || '').trim();
  if (!isUuid(attemptId)) {
    return jsonResponse(request, { error: 'Unable to reserve Xendit provisioning.' }, 500);
  }
  if (!isEmail(ownerEmail) || shopName.length < 2) {
    await admin.rpc('finish_xendit_shop_provisioning', {
      p_shop_id: shopId,
      p_attempt_id: attemptId,
      p_xendit_account_id: null,
      p_error: 'invalid_verified_shop_identity',
    });
    return jsonResponse(request, { error: 'The verified shop name or owner email is invalid.' }, 409);
  }

  const recovered = await findExistingAccount(xenditSecretKey, ownerEmail).catch(() => null);
  let account = recovered;
  if (!account) {
    const xenditResponse = await xenditRequest(xenditSecretKey, XENDIT_ACCOUNTS_URL, {
      method: 'POST',
      body: JSON.stringify({
        name: shopName,
        email: ownerEmail,
        identity: {
          country_of_incorporation: 'PH',
          entity_type: 'CORPORATION',
        },
      }),
    }).catch(() => null);

    const responseJson = xenditResponse ? await xenditResponse.json().catch(() => null) : null;
    if (!xenditResponse?.ok) {
      const code = String(responseJson?.error_code || 'account_creation_failed').slice(0, 80);
      await admin.rpc('finish_xendit_shop_provisioning', {
        p_shop_id: shopId,
        p_attempt_id: attemptId,
        p_xendit_account_id: null,
        p_error: code,
      });
      console.error('Xendit shop account provisioning failed:', code);
      return jsonResponse(request, { error: 'Xendit could not create the test shop account.', code }, 502);
    }

    const accountId = String(responseJson?.id || '').trim();
    const accountStatus = String(responseJson?.status || '').trim().toUpperCase();
    if (!validAccountId(accountId) || accountStatus !== 'LIVE') {
      await admin.rpc('finish_xendit_shop_provisioning', {
        p_shop_id: shopId,
        p_attempt_id: attemptId,
        p_xendit_account_id: null,
        p_error: 'invalid_test_account_response',
      });
      return jsonResponse(request, { error: 'Xendit returned an invalid test account.' }, 502);
    }
    account = {
      id: accountId,
      status: accountStatus,
      createdAt: typeof responseJson?.created_at === 'string' ? responseJson.created_at : null,
    };
  }

  if (!account || !validAccountId(account.id) || account.status !== 'LIVE') {
    await admin.rpc('finish_xendit_shop_provisioning', {
      p_shop_id: shopId,
      p_attempt_id: attemptId,
      p_xendit_account_id: null,
      p_error: 'existing_test_account_not_live',
    });
    return jsonResponse(request, { error: 'The matching Xendit test account is not active.' }, 409);
  }

  const { data: finishData, error: finishError } = await admin.rpc('finish_xendit_shop_provisioning', {
    p_shop_id: shopId,
    p_attempt_id: attemptId,
    p_xendit_account_id: account.id,
    p_error: null,
  });
  const finished = firstRpcRow<any>(finishData);
  if (finishError || !finished || String(finished.xenditAccountId || '') !== account.id) {
    console.error('Unable to persist the Xendit shop account mapping.');
    return jsonResponse(request, { error: 'The Xendit account was created but could not be linked safely.' }, 500);
  }

  return jsonResponse(request, {
    shopId,
    xenditAccountId: String(finished.xenditAccountId),
    xenditAccountStatus: String(account.status),
    provisioningStatus: String(finished.provisioningStatus || 'provisioned'),
    reused: Boolean(recovered),
    testMode: true,
  });
});
