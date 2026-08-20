import { supabase } from '@/services/supabaseClient';

type AdminAuditAction =
  | 'shop_approved'
  | 'shop_rejected'
  | 'shop_data_deleted'
  | 'user_disabled'
  | 'user_enabled'
  | 'user_deleted'
  | 'request_deleted'
  | 'request_escalated'
  | 'broadcast_created'
  | 'broadcast_resolved'
  | 'report_status_updated'
  | 'block_deactivated'
  | 'screen_viewed'
  | 'other_sessions_signed_out';

type AdminAuditLogPayload = {
  adminId?: string | null;
  action: AdminAuditAction | string;
  targetType: 'user' | 'request' | 'broadcast' | 'report' | 'block' | 'screen' | 'security' | 'system' | string;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, any>;
};

export const logAdminAction = async (payload: AdminAuditLogPayload) => {
  if (!payload.adminId) return;

  try {
    const { error } = await supabase.from('admin_audit_logs').insert({
      adminId: payload.adminId,
      action: payload.action,
      targetType: payload.targetType,
      targetId: payload.targetId || null,
      summary: payload.summary,
      metadata: payload.metadata || {},
    });
    if (error) throw error;
  } catch (error) {
    console.error('Failed to write admin activity log:', error);
  }
};
