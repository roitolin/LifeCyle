// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization.startsWith('Bearer ')) {
    return response({ error: 'Unauthorized.' }, 401);
  }

  const token = authorization.slice('Bearer '.length);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return response({ error: 'Unauthorized.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerProfile } = await admin
    .from('users')
    .select('role')
    .eq('id', callerData.user.id)
    .maybeSingle();
  if (!['admin', 'super_admin'].includes(String(callerProfile?.role || ''))) {
    return response({ error: 'Only a root administrator can permanently delete accounts.' }, 403);
  }

  let deletionRequestId = '';
  try {
    const body = await request.json();
    deletionRequestId = String(body?.deletionRequestId || '').trim();
  } catch {
    return response({ error: 'Invalid request body.' }, 400);
  }
  if (!deletionRequestId) return response({ error: 'Deletion request ID is required.' }, 400);

  const { data: deletionRequest, error: deletionError } = await admin
    .from('account_deletion_requests')
    .select('id,user_id,status,email_snapshot')
    .eq('id', deletionRequestId)
    .maybeSingle();
  if (deletionError || !deletionRequest) return response({ error: 'Deletion request not found.' }, 404);
  if (deletionRequest.status !== 'approved') {
    return response({ error: 'The deletion request must be approved first.' }, 409);
  }
  if (!deletionRequest.user_id) {
    return response({ error: 'This account was already removed.' }, 409);
  }

  const userId = deletionRequest.user_id as string;
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
    return response({
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
    return response({
      error: 'Resolve active services, refunds, and pending shop payments before deleting this account.',
      blockers,
    }, 409);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId, false);
  if (deleteError) return response({ error: deleteError.message }, 500);

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
    return response({
      error: 'The account was deleted, but the request status could not be finalized.',
      details: completionError.message,
    }, 500);
  }

  return response({ deleted: true, email: deletionRequest.email_snapshot });
});
