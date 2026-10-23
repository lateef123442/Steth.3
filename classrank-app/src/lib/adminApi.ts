import { supabase } from "./supabase";
import { AdminStats, InviteCode, AdminUserResult, Role } from "../types";

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc("admin_platform_stats");
  if (error) throw error;
  return data as AdminStats;
}

export async function createDepartment(name: string, faculty: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_create_department", { p_name: name, p_faculty: faculty });
  if (error) throw error;
  return data as string;
}

export async function createInviteCode(departmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_create_invite_code", { p_department_id: departmentId });
  if (error) throw error;
  return data as string;
}

export async function listInviteCodes(departmentId?: string): Promise<InviteCode[]> {
  const { data, error } = await supabase.rpc("admin_list_invite_codes", {
    p_department_id: departmentId ?? null,
  });
  if (error) throw error;
  return (data as InviteCode[]) ?? [];
}

export async function searchUsers(query: string, limit = 20, offset = 0): Promise<AdminUserResult[]> {
  const { data, error } = await supabase.rpc("admin_search_users", {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data as AdminUserResult[]) ?? [];
}

export async function setUserRole(targetId: string, newRole: Role): Promise<void> {
  const { error } = await supabase.rpc("admin_set_role", { p_target_id: targetId, p_new_role: newRole });
  if (error) throw error;
}

export async function addStudyYear(year: number): Promise<void> {
  const { error } = await supabase.rpc("admin_add_year", { p_year: year });
  if (error) throw error;
}

export async function removeStudyYear(year: number): Promise<void> {
  const { error } = await supabase.rpc("admin_remove_year", { p_year: year });
  if (error) throw error;
}

// ── free / paid switch (supabase/038_free_or_paid_switch.sql) ──
export interface PaywallInfo { paywall_enabled: boolean; students_total: number; students_without_pro: number; updated_at?: string | null }

export async function fetchPaywallInfo(): Promise<PaywallInfo> {
  const { data, error } = await supabase.rpc("admin_get_paywall");
  if (error) throw error;
  return data as PaywallInfo;
}

/** true = paid (students need Pro), false = free for everyone. */
export async function setPaywallEnabled(enabled: boolean): Promise<PaywallInfo> {
  const { data, error } = await supabase.rpc("admin_set_paywall", { p_enabled: enabled });
  if (error) throw error;
  return data as PaywallInfo;
}

