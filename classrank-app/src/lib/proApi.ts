import * as ImagePicker from "expo-image-picker";
import { Linking } from "react-native";
import { supabase } from "./supabase";
import type { Profile } from "../types";

// Manual (bank-transfer) Pro access — see supabase/028_pro_codes.sql.
export const PRO_PRICE_NAIRA = 999;
export const PRO_BANK = { bank: "Zenith Bank", accountNumber: "2051395038", accountName: "" /* add the account name if you want it shown */ };
export const ADMIN_WHATSAPP_INTL = "2349049348938"; // 09049348938

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

/** True while the student's Pro access hasn't run out. (`is_pro` alone can be stale once a code's time is up.) */
export const hasActivePro = (p: Pick<Profile, "is_pro" | "pro_expires_at"> | null | undefined, now = Date.now()) =>
  !!p && p.is_pro && !!p.pro_expires_at && new Date(p.pro_expires_at).getTime() > now;

export const daysLeft = (iso: string | null | undefined, now = Date.now()) =>
  iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000)) : 0;

/** Codes are 13 letters/digits; people type them with spaces or dashes, so strip those. */
export const cleanCode = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 13);

export const openWhatsApp = async (text: string) => {
  const url = `https://wa.me/${ADMIN_WHATSAPP_INTL}?text=${encodeURIComponent(text)}`;
  try { await Linking.openURL(url); return true; } catch { return false; }
};

// ── student ──
export type RedeemResult = { ok: true; pro_expires_at: string; duration_days: number } | { ok: false; error: string };
export const redeemProCode = (code: string) => call<RedeemResult>("redeem_pro_code", { p_code: code });

export interface MyPaymentRequest { id: string; status: "pending" | "approved" | "rejected"; created_at: string; admin_note: string | null }
export const fetchMyPaymentRequests = async () => (await call<MyPaymentRequest[]>("my_payment_requests")) ?? [];

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Lets the student pick their payment screenshot, uploads it to their private folder and files it for the admin. Returns false if cancelled. */
export async function uploadReceipt(userId: string): Promise<boolean> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
  if (r.canceled || !r.assets?.[0]) return false;
  const a = r.assets[0];
  const mime = a.mimeType && EXT[a.mimeType] ? a.mimeType : "image/jpeg";
  const buf = await (await fetch(a.uri)).arrayBuffer();
  if (buf.byteLength === 0) throw new Error("That picture is empty.");
  if (buf.byteLength > 5 * 1024 * 1024) throw new Error("That picture is too large (5 MB limit). Take a smaller screenshot.");
  const path = `${userId}/receipt-${Date.now()}.${EXT[mime]}`;
  const up = await supabase.storage.from("receipts").upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  try { await call<string>("submit_payment_request", { p_path: path }); }
  catch (e) { await supabase.storage.from("receipts").remove([path]).catch(() => {}); throw e; }
  return true;
}

// ── admin ──
export type ProDuration = 7 | 30;
export const DURATION_LABEL: Record<ProDuration, string> = { 7: "7 days", 30: "1 month" };
export interface ProCode { id: string; code: string; duration_days: ProDuration; created_at: string; used: boolean; used_at: string | null; used_by: string | null; used_by_name: string | null }
export interface PaymentRequest {
  id: string; user_id: string; name: string; email: string | null; department: string | null; year: number | null;
  receipt_path: string; status: "pending" | "approved" | "rejected"; created_at: string; admin_note: string | null; code: string | null; duration_days: ProDuration | null;
}
export const generateProCodes = (days: ProDuration, count = 1) => call<{ id: string; code: string; duration_days: ProDuration }[]>("admin_generate_pro_codes", { p_duration_days: days, p_count: count });
export const fetchProCodes = async (status: "all" | "unused" | "used" = "all") => (await call<ProCode[]>("admin_list_pro_codes", { p_status: status, p_limit: 200 })) ?? [];
export const revokeProCode = (id: string) => call<void>("admin_revoke_pro_code", { p_id: id });
export const fetchPaymentRequests = async (status: "pending" | "approved" | "rejected" | "all" = "pending") => (await call<PaymentRequest[]>("admin_list_payment_requests", { p_status: status, p_limit: 100 })) ?? [];
export const approvePaymentRequest = (id: string, days: ProDuration) => call<{ id: string; code: string; duration_days: ProDuration }>("admin_approve_payment_request", { p_id: id, p_duration_days: days });
export const rejectPaymentRequest = (id: string, note?: string) => call<void>("admin_reject_payment_request", { p_id: id, p_note: note ?? null });
export const receiptUrl = async (path: string) => (await supabase.storage.from("receipts").createSignedUrl(path, 300)).data?.signedUrl ?? null;

/** Live updates for the admin: fires when a receipt arrives or is handled. */
export function subscribePaymentRequests(onChange: () => void) {
  const ch = supabase.channel(`payreq:${Math.random().toString(36).slice(2, 10)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "pro_payment_requests" }, onChange).subscribe();
  return () => { supabase.removeChannel(ch); };
}
