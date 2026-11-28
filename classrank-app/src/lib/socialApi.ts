import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

// Friends, private chat, group chat and profile pictures (supabase/026_social_chat_avatars.sql).
export interface Person { id: string; name: string; department: string | null; year: number | null; avatar_path: string | null }
export type Relation = "none" | "friend" | "sent" | "received";
export interface PersonResult extends Person { university: string; relation: Relation }
export interface Friends { friends: Person[]; incoming: Person[]; outgoing: Person[] }
export interface Conversation extends Person { last_body: string; last_at: string; last_mine: boolean; unread: number }
export interface ChatMessage { id: string; sender_id: string; recipient_id?: string; sender_name?: string; avatar_path?: string | null; body: string; created_at: string }
export interface GroupMember extends Person { role: string; is_owner: boolean; group_role?: "member" | "admin" }

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

// ── friends ──
export const searchPeople = async (q: string) => (await call<PersonResult[]>("search_people", { p_query: q, p_limit: 20 })) ?? [];
export const sendFriendRequest = async (userId: string) => {
  const result = await call<"friend" | "sent">("send_friend_request", { p_user: userId });
  try { await supabase.functions.invoke("notify", { body: result === "sent" ? { kind: "friend_request", targetUserId: userId } : { kind: "friend_request_accepted", requesterId: userId } }); } catch { /* database notification remains available */ }
  return result;
};
export const respondFriendRequest = async (userId: string, accept: boolean) => {
  await call<void>("respond_friend_request", { p_user: userId, p_accept: accept });
  if (accept) {
    try { await supabase.functions.invoke("notify", { body: { kind: "friend_request_accepted", requesterId: userId } }); } catch { /* database notification remains available */ }
  }
};
export const removeFriend = (userId: string) => call<void>("remove_friend", { p_user: userId });
export const fetchFriends = async () => (await call<Friends>("my_friends")) ?? { friends: [], incoming: [], outgoing: [] };

// ── private messages ──
export const fetchConversations = async () => (await call<Conversation[]>("my_conversations")) ?? [];
export const fetchConversation = async (withId: string, before?: string) => (await call<ChatMessage[]>("list_conversation", { p_with: withId, p_before: before ?? null, p_limit: 40 })) ?? [];
export const sendDirect = async (to: string, body: string) => {
  const message = await call<ChatMessage>("send_direct_message", { p_to: to, p_body: body });
  try { await supabase.functions.invoke("notify", { body: { kind: "direct_message", messageId: message.id } }); } catch { /* in-app notification is already stored by the database trigger */ }
  return message;
};
export const markRead = async (withId: string) => {
  await call<void>("mark_conversation_read", { p_with: withId });
  await call<void>("mark_direct_message_notifications_read", { p_sender_id: withId }).catch(() => {});
};

// Every subscription gets its own uniquely-named channel. Supabase reuses a channel with the same name, so two screens
// listening at once (Friends list + an open chat) would otherwise share one, throw on the second `.on()`, and the first
// screen to close would kill the other's live updates.
const uid = () => Math.random().toString(36).slice(2, 10);
/** Calls `onStatus(true)` each time the live connection is (re)established, so callers can re-fetch anything missed. */
const watch = (onReconnect?: () => void) => {
  let first = true;
  return (status: string) => {
    if (status !== "SUBSCRIBED") return;
    if (first) { first = false; return; }
    onReconnect?.();
  };
};

/** Live feed of messages I receive AND messages I send from another device. Returns an unsubscribe function. */
export function subscribeDirect(myId: string, onMessage: (m: ChatMessage) => void, onReconnect?: () => void) {
  const handle = (p: any) => onMessage({ id: p.new.id, sender_id: p.new.sender_id, recipient_id: p.new.recipient_id, body: p.new.body, created_at: p.new.created_at });
  const ch = supabase.channel(`dm:${myId}:${uid()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${myId}` }, handle)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `sender_id=eq.${myId}` }, handle)
    .subscribe(watch(onReconnect));
  return () => { supabase.removeChannel(ch); };
}

/** Live unread-inbox changes, including read receipts when a conversation is opened. */
export function subscribeUnreadMessages(myId: string, onChange: () => void) {
  const ch = supabase.channel(`dm-unread:${myId}:${uid()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${myId}` }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${myId}` }, onChange)
    .subscribe(watch(onChange));
  return () => { supabase.removeChannel(ch); };
}

/** Friend requests / acceptances / removals as they happen. */
export function subscribeFriendships(myId: string, onChange: () => void, onReconnect?: () => void) {
  const ch = supabase.channel(`friends:${myId}:${uid()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `addressee=eq.${myId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `requester=eq.${myId}` }, onChange)
    .subscribe(watch(onReconnect));
  return () => { supabase.removeChannel(ch); };
}

// ── group chat ──
export const fetchGroupMessages = async (groupId: string, before?: string) =>
  ((await call<{ id: string; author_id: string; author_name: string; avatar_path: string | null; body: string; created_at: string }[]>("list_group_messages", { p_group_id: groupId, p_before: before ?? null, p_limit: 40 })) ?? [])
    .map((m): ChatMessage => ({ id: m.id, sender_id: m.author_id, sender_name: m.author_name, avatar_path: m.avatar_path, body: m.body, created_at: m.created_at }));
export const sendGroupMsg = async (groupId: string, body: string) => {
  const r = await call<{ id: string; author_id: string; body: string; created_at: string }>("send_group_message", { p_group_id: groupId, p_body: body });
  try { await supabase.functions.invoke("notify", { body: { kind: "group_message", messageId: r.id } }); } catch { /* in-app notification is already stored by the database trigger */ }
  return { id: r.id, sender_id: r.author_id, body: r.body, created_at: r.created_at } as ChatMessage;
};
export function subscribeGroup(groupId: string, onMessage: (m: ChatMessage) => void, onReconnect?: () => void) {
  const ch = supabase.channel(`group:${groupId}:${uid()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
      (p: any) => onMessage({ id: p.new.id, sender_id: p.new.author_id, body: p.new.body, created_at: p.new.created_at }))
    .subscribe(watch(onReconnect));
  return () => { supabase.removeChannel(ch); };
}
export const fetchGroupMembers = async (groupId: string) => (await call<GroupMember[]>("group_members_list", { p_group_id: groupId })) ?? [];
export const addGroupMember = (groupId: string, userId: string) => call<void>("add_group_member", { p_group_id: groupId, p_user: userId });
export const createYearGroup = (departmentId: string, name: string, description: string, year: number) =>
  call<{ id: string; join_code: string; students_added: number }>("create_year_group", { p_department_id: departmentId, p_name: name, p_description: description, p_year: year });

// ── blocking and reporting (supabase/027) ──
export type ReportReason = "harassment" | "spam" | "inappropriate" | "hate" | "threat" | "other";
export const REPORT_REASONS: { k: ReportReason; label: string }[] = [
  { k: "harassment", label: "Bullying or harassment" }, { k: "threat", label: "Threats" }, { k: "hate", label: "Hate speech" },
  { k: "inappropriate", label: "Inappropriate content" }, { k: "spam", label: "Spam" }, { k: "other", label: "Something else" },
];
export const blockUser = (userId: string) => call<void>("block_user", { p_user: userId });
export const unblockUser = (userId: string) => call<void>("unblock_user", { p_user: userId });
export const fetchBlocks = async () => (await call<Person[]>("my_blocks")) ?? [];
export const reportUser = (x: { userId: string; context: "direct" | "group" | "profile"; messageId?: string | null; reason: ReportReason; details?: string }) =>
  call<string>("report_user", { p_user: x.userId, p_context: x.context, p_message_id: x.messageId ?? null, p_reason: x.reason, p_details: x.details ?? "" });

// ── profile pictures ──
export const avatarUrl = (path?: string | null) => (path ? supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl : null);

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Lets the user pick and crop a photo, uploads it to their own folder and sets it as their picture. Returns the new path, or null if cancelled. */
export async function changeAvatar(userId: string, oldPath?: string | null): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Steth needs permission to access your photos. Allow photo access in your phone settings, then try again.");
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const mime = a.mimeType && EXT[a.mimeType] ? a.mimeType : "image/jpeg";
  const buf = await (await fetch(a.uri)).arrayBuffer();
  if (buf.byteLength === 0) throw new Error("That picture is empty.");
  if (buf.byteLength > 2 * 1024 * 1024) throw new Error("That picture is too large (2 MB limit). Pick a smaller one.");
  const path = `${userId}/avatar-${Date.now()}.${EXT[mime]}`;
  const up = await supabase.storage.from("avatars").upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  try { await call<string>("set_my_avatar", { p_path: path }); }
  catch (e) { await supabase.storage.from("avatars").remove([path]).catch(() => {}); throw e; }
  if (oldPath) supabase.storage.from("avatars").remove([oldPath]).catch(() => {}); // best effort
  return path;
}
export const removeAvatar = async (oldPath?: string | null) => {
  await call<string | null>("set_my_avatar", { p_path: null });
  if (oldPath) supabase.storage.from("avatars").remove([oldPath]).catch(() => {});
};

/** Choose a square group picture. The selected asset can be held until a new group has been created. */
export async function chooseGroupAvatar() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Steth needs permission to access your photos. Allow photo access in your phone settings, then try again.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
  return result.canceled ? null : result.assets?.[0] ?? null;
}

/** Upload a group photo and register it through the membership-checked RPC. */
export async function uploadGroupAvatar(groupId: string, oldPath: string | null, asset: ImagePicker.ImagePickerAsset) {
  const mime = asset.mimeType && EXT[asset.mimeType] ? asset.mimeType : "image/jpeg";
  const buffer = await (await fetch(asset.uri)).arrayBuffer();
  if (!buffer.byteLength) throw new Error("That picture is empty.");
  if (buffer.byteLength > 2 * 1024 * 1024) throw new Error("That picture is too large (2 MB limit). Pick a smaller one.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again and retry.");
  const path = `${groupId}/${user.id}/group-${Date.now()}.${EXT[mime]}`;
  const uploaded = await supabase.storage.from("group-avatars").upload(path, buffer, { contentType: mime, upsert: false });
  if (uploaded.error) throw uploaded.error;
  try { await call<string>("set_group_avatar", { p_group_id: groupId, p_path: path }); }
  catch (error) { await supabase.storage.from("group-avatars").remove([path]).catch(() => {}); throw error; }
  if (oldPath) supabase.storage.from("group-avatars").remove([oldPath]).catch(() => {});
  return path;
}
export const groupAvatarUrl = (path?: string | null) => path ? supabase.storage.from("group-avatars").getPublicUrl(path).data.publicUrl : null;
