import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type UserProfile = Record<string, any>;

const readOwnProfile = async (userId: string): Promise<UserProfile | null> => {
  const { data, error } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as UserProfile | null) ?? null;
};

/**
 * Returns the authenticated user's profile, creating a least-privileged one
 * when an older auth account has no matching public.users row.
 */
export const ensureOwnUserProfile = async (user: User): Promise<UserProfile> => {
  const existingProfile = await readOwnProfile(user.id);
  if (existingProfile) return existingProfile;

  // The SECURITY DEFINER function reads auth.uid() on the server, so the client
  // cannot choose another id or assign itself an elevated role.
  const { data: repaired, error: repairError } = await supabase.rpc("ensure_my_user_profile");
  if (repairError) throw repairError;
  if (!repaired) throw new Error("The account profile could not be created.");

  const repairedProfile = await readOwnProfile(user.id);
  if (!repairedProfile) throw new Error("The account profile could not be loaded after repair.");
  return repairedProfile;
};
