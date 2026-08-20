import { supabase } from "@/services/supabaseClient";
import { createAdminNotification } from "./createAdminNotification";
import { generateId } from "./generateId";

export type BlockState = {
  blockedByMe: boolean;
  blockedMe: boolean;
  blockedEitherWay: boolean;
};

export const getBlockStateBetweenUsers = async (currentUserId: string, otherUserId: string): Promise<BlockState> => {
  const [blockedByMeRes, blockedMeRes] = await Promise.all([
    supabase
      .from("user_blocks")
      .select("*")
      .eq("blockerId", currentUserId)
      .eq("blockedId", otherUserId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_blocks")
      .select("*")
      .eq("blockerId", otherUserId)
      .eq("blockedId", currentUserId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (blockedByMeRes.error) throw blockedByMeRes.error;
  if (blockedMeRes.error) throw blockedMeRes.error;

  const blockedByMe = !!blockedByMeRes.data && blockedByMeRes.data.active !== false;
  const blockedMe = !!blockedMeRes.data && blockedMeRes.data.active !== false;

  return {
    blockedByMe,
    blockedMe,
    blockedEitherWay: blockedByMe || blockedMe,
  };
};

export const blockUser = async (blockerId: string, blockedId: string) => {
  if (blockerId === blockedId) {
    throw new Error("You cannot block your own account.");
  }

  const { data: blockedUser, error: blockedUserError } = await supabase
    .from("users")
    .select("role")
    .eq("id", blockedId)
    .single();
  if (blockedUserError) throw blockedUserError;

  const blockedUserRole = String(blockedUser?.role || "").toLowerCase();
  if (["admin", "super_admin", "funeral_admin"].includes(blockedUserRole)) {
    throw new Error("You cannot block admin accounts.");
  }

  const { error } = await supabase
    .from("user_blocks")
    .upsert({
      blockerId,
      blockedId,
    }, { onConflict: "blockerId,blockedId" });

  if (error) throw error;
};

export const unblockUser = async (blockerId: string, blockedId: string) => {
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blockerId", blockerId)
    .eq("blockedId", blockedId);
  if (error) throw error;
};

export const reportUserAbuse = async (payload: {
  reporterId: string;
  targetUserId: string;
  reporterName?: string | null;
  targetName?: string | null;
  reason: string;
  details?: string;
  evidenceURL?: string | null;
  source?: string;
  requestId?: string;
  conversationId?: string;
}) => {
  const reportId = generateId();
  const { error } = await supabase.from("abuse_reports").insert({
    id: reportId,
    reporterId: payload.reporterId,
    targetUserId: payload.targetUserId,
    reporterName: payload.reporterName || null,
    targetName: payload.targetName || null,
    reason: payload.reason,
    details: payload.details || null,
    evidenceURL: payload.evidenceURL || null,
    source: payload.source || "app",
    requestId: payload.requestId || null,
    conversationId: payload.conversationId || null,
    status: "open",
  });

  if (error) throw error;

  await createAdminNotification(
    "abuse_report",
    "New Abuse Report",
    `A user submitted an abuse report: ${payload.reason}`,
    {
      reportId,
      reporterId: payload.reporterId,
      targetUserId: payload.targetUserId,
      source: payload.source || "app",
    }
  );

  return reportId;
};

