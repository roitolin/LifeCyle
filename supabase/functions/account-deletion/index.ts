// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  consumeUserRateLimit,
  readJsonBody,
  RequestBodyError,
} from '../_shared/security.ts';

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function response(request: Request, body: unknown, status = 200) {
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return response(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization.startsWith('Bearer ')) {
    return response(request, { error: 'Unauthorized.' }, 401);
  }

  const token = authorization.slice('Bearer '.length);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return response(request, { error: 'Unauthorized.' }, 401);

  let confirmation = '';
  let deletionRequestId = '';
  try {
    const body = await readJsonBody<{ confirmation?: unknown; deletionRequestId?: unknown }>(request, 8 * 1024);
    confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim() : '';
    deletionRequestId = typeof body?.deletionRequestId === 'string' ? body.deletionRequestId.trim() : '';
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return response(request, { error: 'Invalid request body.' }, status);
  }
  if (!deletionRequestId && confirmation !== 'DELETE') {
    return response(request, { error: 'Type DELETE exactly to confirm account deletion.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rateLimit = await consumeUserRateLimit(
    admin,
    'account-deletion',
    callerData.user.id,
    5,
    15 * 60,
  );
  if (rateLimit.unavailable) {
    return response(request, { error: 'Security checks are temporarily unavailable.' }, 503);
  }
  if (!rateLimit.allowed) {
    return response(request, {
      error: 'Too many deletion attempts. Please wait before trying again.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }, 429);
  }

  let userId = callerData.user.id;
  let email = callerData.user.email || null;
  let isSelfDeletion = true;

  // Keep the legacy admin path only for already-approved historical requests.
  // New clients always use self-deletion and never create approval requests.
  if (deletionRequestId) {
    const { data: callerProfile } = await admin
      .from('users')
      .select('role')
      .eq('id', callerData.user.id)
      .maybeSingle();
    if (!['admin', 'super_admin'].includes(String(callerProfile?.role || ''))) {
      return response(request, { error: 'Only a root administrator can process a historical deletion request.' }, 403);
    }

    const { data: deletionRequest, error: deletionError } = await admin
      .from('account_deletion_requests')
      .select('id,user_id,status,email_snapshot')
      .eq('id', deletionRequestId)
      .maybeSingle();
    if (deletionError || !deletionRequest) {
      return response(request, { error: 'Deletion request not found.' }, 404);
    }
    if (deletionRequest.status !== 'approved' || !deletionRequest.user_id) {
      return response(request, { error: 'The historical deletion request is not eligible.' }, 409);
    }

    userId = deletionRequest.user_id as string;
    email = deletionRequest.email_snapshot || null;
    isSelfDeletion = false;
  }

  const [activeServices, activeRefunds, pendingShopPayments] = await Promise.all([
    admin
      .from('funeral_service_requests')
      .select('id', { count: 'exact', head: true })
      .or(`requesterId.eq.${userId},shopId.eq.${userId}`)
      .not('status', 'in', '(completed,declined_by_shop,cancelled_by_requester)'),
    admin
      .from('service_refund_requests')
      .select('id', { count: 'exact', head: true })
      .or(`requester_id.eq.${userId},shop_id.eq.${userId}`)
      .in('status', ['pending', 'approved']),
    admin
      .from('shop_payments')
      .select('id', { count: 'exact', head: true })
      .eq('shopId', userId)
      .eq('status', 'pending'),
  ]);

  const blockerQueryError = activeServices.error || activeRefunds.error || pendingShopPayments.error;
  if (blockerQueryError) {
    return response(request, {
      error: 'Account safety checks could not be completed. Nothing was deleted.',
      details: blockerQueryError.message,
    }, 500);
  }

  const blockers = {
    activeServices: activeServices.count || 0,
    activeRefunds: activeRefunds.count || 0,
    pendingShopPayments: pendingShopPayments.count || 0,
  };
  if (Object.values(blockers).some((count) => count > 0)) {
    return response(request, {
      error: 'Resolve active services, refunds, and pending shop payments before deleting this account.',
      blockers,
    }, 409);
  }

  if (isSelfDeletion) {
    const { error: signOutError } = await admin.auth.admin.signOut(token, 'global');
    if (signOutError) {
      return response(request, {
        error: 'Your sessions could not be secured. Nothing was deleted.',
      }, 500);
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId, false);
  if (deleteError) return response(request, { error: deleteError.message }, 500);

  if (!isSelfDeletion) {
    const { error: completionError } = await admin
      .from('account_deletion_requests')
      .update({
        status: 'completed',
        admin_note: 'Identity and eligible account data were permanently removed.',
        resolved_by: callerData.user.id,
      })
      .eq('id', deletionRequestId)
      .eq('status', 'approved');
    if (completionError) {
      return response(request, {
        error: 'The account was deleted, but the historical request status could not be finalized.',
      }, 500);
    }
  }

  return response(request, { deleted: true, email });
});
