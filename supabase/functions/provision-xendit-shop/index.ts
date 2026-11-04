// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';
import { consumeUserRateLimit } from '../_shared/security.ts';

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'funeral_admin']);
const PAYOUT_READY_SHOP_STATUSES = new Set(['verified', 'live', 'offline']);
const MAX_BODY_BYTES = 16 * 1024;
const PAYOUT_CHANGE_TTL_MS = 10 * 60 * 1000;
const PAYOUT_CHANGE_RESEND_SECONDS = 60;
const PAYOUT_CHANGE_MAX_ATTEMPTS = 5;

const VALID_PAYOUT_CHANNELS = new Set([
  'PH_GCASH', 'PH_MAYA',
  'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK',
  'PH_LANDBANK', 'PH_PNB', 'PH_RCBC', 'PH_CHINABANK',
  'PH_SECURITYBANK',
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
    headers: {
      ...corsHeaders(request),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
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

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return 'your account email';
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, localPart.length - visible.length)))}@${domain}`;
}

function createEmailAuthClient(supabaseUrl: string, anonKey: string) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function verifyPayoutChangeCode(
  emailAuth: any,
  email: string,
  code: string,
) {
  // Supabase's OTP template uses `type: email`. Older hosted projects that
  // still classify the custom magic_link template may require magiclink.
  // Try the documented OTP type first, then the legacy classification.
  const first = await emailAuth.auth.verifyOtp({ email, token: code, type: 'email' });
  if (!first.error) return first;
  const fallback = await emailAuth.auth.verifyOtp({ email, token: code, type: 'magiclink' });
  return fallback.error ? first : fallback;
}

async function getShopEmail(
  admin: any,
  shopId: string,
) {
  const { data, error } = await admin.auth.admin.getUserById(shopId);
  const email = String(data.user?.email || '').trim().toLowerCase();
  if (error || !email || !data.user?.email_confirmed_at) return null;
  return email;
}

async function sendPayoutChangeCode(
  supabaseUrl: string,
  anonKey: string,
  email: string,
) {
  const emailAuth = createEmailAuthClient(supabaseUrl, anonKey);
  return emailAuth.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
}

/**
 * Save and manage a shop's payout account details.
 * Owners submit test receiver details for administrator review. Only approved
 * receiver rows are eligible for checkout.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
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
    payoutAccountId?: unknown;
    active?: unknown;
    action?: unknown;
    challengeId?: unknown;
    code?: unknown;
  };
  try {
    input = await readJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 400;
    return jsonResponse(request, { error: 'Invalid request.' }, status);
  }

  const action = String(input?.action || 'verify').trim().toLowerCase();
  const shopId = String(input?.shopId || '').trim().toLowerCase();
  if (action !== 'list-all' && !isUuid(shopId)) return jsonResponse(request, { error: 'A valid funeral shop is required.' }, 400);
  const sensitiveAction = ['update', 'confirm-update', 'resend-update-code'].includes(action);
  const rateLimit = await consumeUserRateLimit(
    admin,
    sensitiveAction ? 'shop-payout-verification' : 'shop-payout-management',
    userData.user.id,
    sensitiveAction ? 10 : 100,
    sensitiveAction ? 10 * 60 : 5 * 60,
  );
  if (rateLimit.unavailable) {
    return jsonResponse(request, { error: 'Security checks are temporarily unavailable.' }, 503);
  }

  if (!rateLimit.allowed) {
    return jsonResponse(request, {
      error: 'Too many payout-account requests. Please wait before trying again.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }, 429);
  }

  if (action === 'list-all' || action === 'list') {
    if (!isAdmin) return jsonResponse(request, { error: 'Only an active administrator can review test receivers.' }, 403);
    let accountQuery = admin
      .from('funeral_shop_payout_accounts')
      .select('id, "shopId", "channelCode", "accountName", "accountNumber", active, "verifiedByAdmin", "verifiedAt", "createdAt", "updatedAt"')
      .order('createdAt', { ascending: true });
    if (action === 'list') accountQuery = accountQuery.eq('shopId', shopId);
    const { data: accounts, error } = await accountQuery;
    if (error) return jsonResponse(request, { error: 'Unable to load receiver accounts.' }, 500);
    return jsonResponse(request, { shopId, accounts });
  }

  // Admin approval of an owner-submitted test receiver.
  if (action === 'save' || action === 'verify') {
    if (!actor || !ADMIN_ROLES.has(String(actor.role)) || actor.disabled) {
      return jsonResponse(request, { error: 'Only an active administrator can manage another shop\'s payout account.' }, 403);
    }

    const accountId = String(input?.payoutAccountId || '').trim().toLowerCase();
    if (!isUuid(accountId)) return jsonResponse(request, { error: 'Select an owner-submitted test receiver to review.' }, 400);
    const { data: approved, error: approvalError } = await admin.rpc('approve_test_payout_receiver', {
      p_shop_id: shopId,
      p_account_id: accountId,
    });
    if (approvalError || !approved) {
      console.error('Unable to approve test receiver:', approvalError?.code || 'empty_result');
      const reason = String(approvalError?.message || '');
      return jsonResponse(request, { error: reason.includes('shop_not_ready')
        ? 'Approve the funeral shop before reviewing payout accounts.'
        : reason.includes('receiver_already_reviewed')
          ? 'This test receiver was already reviewed. Refresh the list.'
          : reason.includes('receiver_not_found')
            ? 'This test receiver was not found. Refresh the list.'
            : 'Unable to approve the test receiver.' }, 409);
    }
    return jsonResponse(request, approved);
  }

  // New details await test review. Editing an existing receiver also requires
  // a one-time code sent to the shop owner's confirmed account email.
  if (action === 'update') {
    if (userData.user.id !== shopId && !isAdmin) {
      return jsonResponse(request, { error: 'Only the shop owner can update payout details.' }, 403);
    }

    const { data: shop, error: shopError } = await admin
      .from('funeral_shops')
      .select('id, status')
      .eq('id', shopId)
      .maybeSingle();
    if (shopError) return jsonResponse(request, { error: 'Unable to load the funeral shop.' }, 500);
    if (!shop) return jsonResponse(request, { error: 'Funeral shop not found.' }, 404);
    if (!PAYOUT_READY_SHOP_STATUSES.has(String(shop.status || '').toLowerCase())) {
      return jsonResponse(request, { error: 'Your funeral shop must be approved before payout accounts can be activated.' }, 409);
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

    const { data: existingAccount, error: existingAccountError } = await admin
      .from('funeral_shop_payout_accounts')
      .select('id, accountName, accountNumber, verifiedByAdmin')
      .eq('shopId', shopId)
      .eq('channelCode', channelCode)
      .maybeSingle();
    if (existingAccountError) {
      console.error('Unable to inspect existing receiver account:', existingAccountError.code || 'unknown');
      return jsonResponse(request, { error: 'Unable to check the current payout details.' }, 500);
    }

    const receiverChanged = existingAccount && (
      String(existingAccount.accountName || '').trim() !== accountName ||
      String(existingAccount.accountNumber || '').trim() !== accountNumber
    );

    if (existingAccount && !receiverChanged) {
      return jsonResponse(request, {
        shopId,
        unchanged: true,
        payoutVerified: existingAccount.verifiedByAdmin === true,
        reviewPending: existingAccount.verifiedByAdmin !== true,
        testMode: true,
      });
    }

    if (receiverChanged) {
      if (!anonKey) return jsonResponse(request, { error: 'Email verification is temporarily unavailable.' }, 503);
      const email = await getShopEmail(admin, shopId);
      if (!email) {
        return jsonResponse(request, { error: 'A confirmed account email is required before payout details can be changed.' }, 409);
      }

      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + PAYOUT_CHANGE_TTL_MS).toISOString();
      const { error: cleanupError } = await admin
        .from('payout_account_change_challenges')
        .delete()
        .eq('shopId', shopId)
        .eq('channelCode', channelCode);
      if (cleanupError) {
        console.error('Unable to replace prior payout verification:', cleanupError.code || 'unknown');
        return jsonResponse(request, { error: 'Unable to start email verification.' }, 500);
      }

      const { data: challenge, error: challengeError } = await admin
        .from('payout_account_change_challenges')
        .insert({
          shopId,
          channelCode,
          accountName,
          accountNumber,
          expiresAt,
          lastSentAt: createdAt.toISOString(),
        })
        .select('id')
        .single();
      if (challengeError || !challenge) {
        console.error('Unable to create payout verification:', challengeError?.code || 'unknown');
        return jsonResponse(request, { error: 'Unable to start email verification.' }, 500);
      }

      const { error: emailError } = await sendPayoutChangeCode(supabaseUrl, anonKey, email);
      if (emailError) {
        await admin
          .from('payout_account_change_challenges')
          .delete()
          .eq('id', challenge.id);
        console.error('Unable to send payout verification email:', emailError.code || 'unknown');
        const rateLimited = String(emailError.message || '').toLowerCase().includes('rate limit');
        return jsonResponse(request, {
          error: rateLimited
            ? 'Please wait a minute before requesting another verification code.'
            : 'Unable to send the verification email. Please try again.',
        }, rateLimited ? 429 : 502);
      }

      return jsonResponse(request, {
        shopId,
        verificationRequired: true,
        challengeId: challenge.id,
        maskedEmail: maskEmail(email),
        expiresAt,
        resendAfterSeconds: PAYOUT_CHANGE_RESEND_SECONDS,
      });
    }

    const submittedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from('funeral_shops')
      .update({
        payoutChannelCode: channelCode,
        payoutAccountName: accountName,
        payoutAccountNumber: accountNumber,
        payoutVerifiedByAdmin: false,
        payoutVerifiedAt: null,
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('Unable to update shop payout:', updateError.code || 'unknown');
      return jsonResponse(request, { error: 'Unable to save the payout details.' }, 500);
    }

    const { error: accountError } = await admin
      .from('funeral_shop_payout_accounts')
      .upsert({
        shopId,
        channelCode,
        accountName,
        accountNumber,
        active: false,
        verifiedByAdmin: false,
        verifiedAt: null,
        updatedAt: submittedAt,
      }, { onConflict: 'shopId,channelCode' });
    if (accountError) {
      console.error('Unable to save receiver account:', accountError.code || 'unknown');
      return jsonResponse(request, { error: 'Unable to save the receiver account.' }, 500);
    }

    return jsonResponse(request, {
      shopId,
      payoutChannelCode: channelCode,
      payoutAccountName: accountName,
      payoutVerified: false,
      reviewPending: true,
      testMode: true,
    });
  }

  if (action === 'confirm-update') {
    if (userData.user.id !== shopId && !isAdmin) {
      return jsonResponse(request, { error: 'Only the shop owner can confirm this payout change.' }, 403);
    }
    if (!anonKey) return jsonResponse(request, { error: 'Email verification is temporarily unavailable.' }, 503);

    const challengeId = String(input?.challengeId || '').trim().toLowerCase();
    const code = String(input?.code || '').replace(/\D/g, '');
    if (!isUuid(challengeId) || !/^\d{6}$/.test(code)) {
      return jsonResponse(request, { error: 'Enter the complete 6-digit verification code.' }, 400);
    }

    const { data: challenge, error: challengeError } = await admin
      .from('payout_account_change_challenges')
      .select('id, status, "failedAttempts", "expiresAt", "channelCode", "accountName", "accountNumber"')
      .eq('id', challengeId)
      .eq('shopId', shopId)
      .maybeSingle();
    if (challengeError) return jsonResponse(request, { error: 'Unable to load the pending payout change.' }, 500);
    if (!challenge || challenge.status !== 'pending') {
      return jsonResponse(request, { error: 'This payout verification request is no longer active.' }, 409);
    }
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      await admin.from('payout_account_change_challenges').delete().eq('id', challengeId);
      return jsonResponse(request, { error: 'This verification code expired. Save the payout change again for a new code.' }, 410);
    }
    if (Number(challenge.failedAttempts) >= PAYOUT_CHANGE_MAX_ATTEMPTS) {
      await admin.from('payout_account_change_challenges').delete().eq('id', challengeId);
      return jsonResponse(request, { error: 'Too many incorrect attempts. Save the payout change again for a new code.' }, 429);
    }

    const email = await getShopEmail(admin, shopId);
    if (!email) {
      return jsonResponse(request, { error: 'A confirmed account email is required before payout details can be changed.' }, 409);
    }
    const emailAuth = createEmailAuthClient(supabaseUrl, anonKey);
    const { data: verified, error: verificationError } = await verifyPayoutChangeCode(emailAuth, email, code);
    const verifiedEmail = String(verified.user?.email || '').trim().toLowerCase();
    if (verificationError || verifiedEmail !== email) {
      console.error('Unable to verify payout change code:', {
        code: verificationError?.code || 'user_mismatch',
        message: verificationError?.message || 'verified email did not match challenge email',
        challengeId,
        shopId,
      });
      const nextAttempts = Math.min(PAYOUT_CHANGE_MAX_ATTEMPTS, Number(challenge.failedAttempts) + 1);
      if (nextAttempts >= PAYOUT_CHANGE_MAX_ATTEMPTS) {
        await admin.from('payout_account_change_challenges').delete().eq('id', challengeId);
      } else {
        await admin
          .from('payout_account_change_challenges')
          .update({ failedAttempts: nextAttempts })
          .eq('id', challengeId)
          .eq('status', 'pending');
      }
      return jsonResponse(request, {
        error: nextAttempts >= PAYOUT_CHANGE_MAX_ATTEMPTS
          ? 'Too many incorrect attempts. Save the payout change again for a new code.'
          : 'That code is incorrect or expired. Check the email and try again.',
      }, nextAttempts >= PAYOUT_CHANGE_MAX_ATTEMPTS ? 429 : 400);
    }

    const { data: applied, error: applyError } = await admin
      .rpc('apply_payout_account_change', {
        p_challenge_id: challengeId,
        p_shop_id: shopId,
      })
      .single();
    if (applyError || !applied) {
      const rawFailure = `${applyError?.code || ''} ${applyError?.message || ''}`.toLowerCase();
      const failureCode = rawFailure.includes('payout_change_not_found')
        ? 'verification_request_missing'
        : rawFailure.includes('payout_change_not_pending')
          ? 'verification_request_used'
          : rawFailure.includes('payout_change_expired')
            ? 'verification_request_expired'
            : rawFailure.includes('payout_change_attempts_exceeded')
              ? 'verification_attempts_exceeded'
              : rawFailure.includes('payout_account_not_found')
                ? 'receiver_account_missing'
                : rawFailure.includes('funeral_shop_not_found')
                  ? 'shop_missing'
                  : rawFailure.includes('only an administrator')
                    ? 'payout_protection_rejected'
                    : rawFailure.includes('schema cache') || rawFailure.includes('could not find the function')
                      ? 'database_schema_not_refreshed'
                      : 'database_save_failed';
      console.error('Unable to apply verified payout change:', {
        code: applyError?.code || 'empty_rpc_result',
        message: applyError?.message || 'RPC returned no row',
        failureCode,
        challengeId,
        shopId,
      });

      // Complete the same server-side write directly when the API schema cache
      // is behind the deployed RPC. This is still protected by the verified
      // challenge, the authenticated shop owner, and the service-role client.
      const fallbackAt = new Date().toISOString();
      const { data: fallbackAccount, error: fallbackAccountError } = await admin
        .from('funeral_shop_payout_accounts')
        .upsert({
          shopId,
          channelCode: challenge.channelCode,
          accountName: challenge.accountName,
          accountNumber: challenge.accountNumber,
          active: false,
          verifiedByAdmin: false,
          verifiedAt: null,
          updatedAt: fallbackAt,
        }, { onConflict: 'shopId,channelCode' })
        .select('id')
        .maybeSingle();
      const { data: fallbackShop, error: fallbackShopError } = await admin
        .from('funeral_shops')
        .update({
          payoutChannelCode: challenge.channelCode,
          payoutAccountName: challenge.accountName,
          payoutAccountNumber: challenge.accountNumber,
          payoutVerifiedByAdmin: false,
          payoutVerifiedAt: null,
        })
        .eq('id', shopId)
        .select('id')
        .maybeSingle();
      if (!fallbackAccountError && fallbackAccount && !fallbackShopError && fallbackShop) {
        const { error: fallbackChallengeError } = await admin
          .from('payout_account_change_challenges')
          .update({ status: 'consumed', consumedAt: fallbackAt })
          .eq('id', challengeId)
          .eq('status', 'pending');
        if (!fallbackChallengeError) {
          return jsonResponse(request, {
            shopId,
            payoutChannelCode: challenge.channelCode,
            payoutAccountName: challenge.accountName,
            payoutVerified: false,
            reviewPending: true,
            testMode: true,
          });
        }
      }
      console.error('Fallback payout update also failed:', {
        accountCode: fallbackAccountError?.code || 'none',
        accountMessage: fallbackAccountError?.message || 'none',
        shopCode: fallbackShopError?.code || 'none',
        shopMessage: fallbackShopError?.message || 'none',
      });
      return jsonResponse(request, {
        error: `The email was verified, but the payout change could not be saved (${failureCode}). Please resend the code and try again.`,
      }, 500);
    }

    await admin.from('payout_account_change_challenges').delete().eq('id', challengeId);
    return jsonResponse(request, { ...applied, reviewPending: true, testMode: true });
  }

  if (action === 'resend-update-code') {
    if (userData.user.id !== shopId && !isAdmin) {
      return jsonResponse(request, { error: 'Only the shop owner can resend this verification code.' }, 403);
    }
    if (!anonKey) return jsonResponse(request, { error: 'Email verification is temporarily unavailable.' }, 503);

    const challengeId = String(input?.challengeId || '').trim().toLowerCase();
    if (!isUuid(challengeId)) return jsonResponse(request, { error: 'A valid payout verification request is required.' }, 400);

    const { data: challenge, error: challengeError } = await admin
      .from('payout_account_change_challenges')
      .select('id, status, "lastSentAt"')
      .eq('id', challengeId)
      .eq('shopId', shopId)
      .maybeSingle();
    if (challengeError) return jsonResponse(request, { error: 'Unable to load the pending payout change.' }, 500);
    if (!challenge || challenge.status !== 'pending') {
      return jsonResponse(request, { error: 'This payout verification request is no longer active.' }, 409);
    }

    const secondsSinceSend = Math.floor((Date.now() - new Date(challenge.lastSentAt).getTime()) / 1000);
    if (secondsSinceSend < PAYOUT_CHANGE_RESEND_SECONDS) {
      return jsonResponse(request, {
        error: `Please wait ${PAYOUT_CHANGE_RESEND_SECONDS - Math.max(0, secondsSinceSend)} seconds before requesting another code.`,
      }, 429);
    }

    const email = await getShopEmail(admin, shopId);
    if (!email) {
      return jsonResponse(request, { error: 'A confirmed account email is required before payout details can be changed.' }, 409);
    }
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + PAYOUT_CHANGE_TTL_MS).toISOString();
    const { error: emailError } = await sendPayoutChangeCode(supabaseUrl, anonKey, email);
    if (emailError) {
      console.error('Unable to resend payout verification email:', emailError.code || 'unknown');
      const rateLimited = String(emailError.message || '').toLowerCase().includes('rate limit');
      return jsonResponse(request, {
        error: rateLimited
          ? 'Please wait a minute before requesting another verification code.'
          : 'Unable to resend the verification email. Please try again.',
      }, rateLimited ? 429 : 502);
    }

    const { error: updateError } = await admin
      .from('payout_account_change_challenges')
      .update({
        lastSentAt: sentAt.toISOString(),
        expiresAt,
        failedAttempts: 0,
      })
      .eq('id', challengeId)
      .eq('status', 'pending');
    if (updateError) {
      console.error('Unable to refresh payout verification:', updateError.code || 'unknown');
      return jsonResponse(request, { error: 'The code was sent, but its verification window could not be refreshed.' }, 500);
    }

    return jsonResponse(request, {
      shopId,
      verificationRequired: true,
      challengeId,
      maskedEmail: maskEmail(email),
      expiresAt,
      resendAfterSeconds: PAYOUT_CHANGE_RESEND_SECONDS,
    });
  }

  if (action === 'set-active') {
    if (userData.user.id !== shopId && !isAdmin) {
      return jsonResponse(request, { error: 'Only the shop owner can change this receiver account.' }, 403);
    }
    const channelCode = String(input?.payoutChannelCode || '').trim().toUpperCase();
    if (!VALID_PAYOUT_CHANNELS.has(channelCode) || typeof input?.active !== 'boolean') {
      return jsonResponse(request, { error: 'A valid receiver account and status are required.' }, 400);
    }

    const { data: shop, error: shopError } = await admin
      .from('funeral_shops')
      .select('id, status')
      .eq('id', shopId)
      .maybeSingle();
    if (shopError) return jsonResponse(request, { error: 'Unable to load the funeral shop.' }, 500);
    if (!shop) return jsonResponse(request, { error: 'Funeral shop not found.' }, 404);
    if (input.active && !PAYOUT_READY_SHOP_STATUSES.has(String(shop.status || '').toLowerCase())) {
      return jsonResponse(request, { error: 'Your funeral shop must be approved before payout accounts can be activated.' }, 409);
    }

    const changedAt = new Date().toISOString();
    let accountUpdate = admin
      .from('funeral_shop_payout_accounts')
      .update({ active: input.active, updatedAt: changedAt })
      .eq('shopId', shopId)
      .eq('channelCode', channelCode);
    if (input.active) accountUpdate = accountUpdate.eq('verifiedByAdmin', true);
    const { data: account, error: accountError } = await accountUpdate
      .select('channelCode, active, verifiedByAdmin')
      .maybeSingle();
    if (accountError) {
      console.error('Unable to change receiver account status:', accountError.code || 'unknown');
      return jsonResponse(request, { error: 'Unable to change the receiver account status.' }, 500);
    }
    if (!account) return jsonResponse(request, { error: input.active
      ? 'This test receiver must be reviewed before it can be enabled.'
      : 'Receiver account not found.' }, input.active ? 409 : 404);

    const { data: readyAccount, error: readyError } = await admin
      .from('funeral_shop_payout_accounts')
      .select('channelCode, accountName, accountNumber, verifiedAt')
      .eq('shopId', shopId)
      .eq('active', true)
      .eq('verifiedByAdmin', true)
      .order('updatedAt', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readyError) {
      console.error('Unable to synchronize shop payout readiness:', readyError.code || 'unknown');
      return jsonResponse(request, { error: 'The receiver changed, but shop payout readiness could not be synchronized.' }, 500);
    }

    const { error: syncError } = await admin
      .from('funeral_shops')
      .update(readyAccount ? {
        payoutChannelCode: readyAccount.channelCode,
        payoutAccountName: readyAccount.accountName,
        payoutAccountNumber: readyAccount.accountNumber,
        payoutVerifiedByAdmin: true,
        payoutVerifiedAt: readyAccount.verifiedAt || changedAt,
      } : {
        payoutVerifiedByAdmin: false,
        payoutVerifiedAt: null,
      })
      .eq('id', shopId);
    if (syncError) {
      console.error('Unable to synchronize legacy payout fields:', syncError.code || 'unknown');
      return jsonResponse(request, { error: 'The receiver changed, but shop payout readiness could not be synchronized.' }, 500);
    }

    return jsonResponse(request, { shopId, ...account });
  }

  if (action === 'disable-all') {
    if (!isAdmin) {
      return jsonResponse(request, { error: 'Only an active administrator can disable every payout method.' }, 403);
    }
    const changedAt = new Date().toISOString();
    const { error: accountsError } = await admin
      .from('funeral_shop_payout_accounts')
      .update({ active: false, updatedAt: changedAt })
      .eq('shopId', shopId);
    if (accountsError) return jsonResponse(request, { error: 'Unable to disable the payout methods.' }, 500);

    const { error: shopError } = await admin
      .from('funeral_shops')
      .update({ payoutVerifiedByAdmin: false, payoutVerifiedAt: null })
      .eq('id', shopId);
    if (shopError) return jsonResponse(request, { error: 'Payout methods were disabled, but the shop summary could not be synchronized.' }, 500);

    return jsonResponse(request, { shopId, disabled: true });
  }

  return jsonResponse(request, { error: 'Invalid payout account action.' }, 400);
});
