/** Shared server-side authorization helpers. */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function assertAdmin(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin access required");
}

export async function getViewerScope(supabase: SupabaseClient, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  const { data: profile } = await supabase
    .from("profiles")
    .select("sublabel_id, email, full_name")
    .eq("id", userId)
    .maybeSingle();
  return {
    isAdmin: Boolean(isAdmin),
    sublabelId: (profile?.sublabel_id as string | null) ?? null,
    email: (profile?.email as string | null) ?? null,
    fullName: (profile?.full_name as string | null) ?? null,
  };
}
