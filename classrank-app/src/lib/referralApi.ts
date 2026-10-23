import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { ReferralStats } from "../types";

export async function fetchReferralStats(): Promise<ReferralStats> {
  const { data, error } = await supabase.rpc("get_my_referral_stats");
  if (error) throw error;
  return data as ReferralStats;
}

export interface RedeemReferralResult { ok: boolean; error?: string; pro_expires_at?: string; days?: number }

/** Uses a friend's invite code. The reward is 7 days of Pro for both people, and an account can only ever do this once. */
export async function redeemReferralCode(code: string): Promise<RedeemReferralResult> {
  const { data, error } = await supabase.rpc("redeem_referral_code", { p_code: code });
  if (error) {
    if (/redeem_referral_code/i.test(error.message) && /could not find|schema cache/i.test(error.message)) {
      return { ok: false, error: "Invite codes aren't available yet. Please try again later." };
    }
    return { ok: false, error: error.message };
  }
  return data as RedeemReferralResult;
}

// ── a code that arrived through an invite link, kept until the person signs up or redeems it ──
const PENDING_KEY = "steth.pendingReferral";
const clean = (code: string) => code.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
export async function savePendingReferral(code: string) { const c = clean(code); if (c) await AsyncStorage.setItem(PENDING_KEY, c); }
export async function peekPendingReferral(): Promise<string> { try { return (await AsyncStorage.getItem(PENDING_KEY)) ?? ""; } catch { return ""; } }
export async function clearPendingReferral() { try { await AsyncStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }
