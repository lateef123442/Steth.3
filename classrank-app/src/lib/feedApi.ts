import * as ImagePicker from "expo-image-picker";
import { DeviceEventEmitter } from "react-native";
import { supabase } from "./supabase";
import { FeedComment, FeedPost, PublicProfile } from "../types";

export type FeedScope = "for_you" | "department" | "campus" | "trending";


/** Number of feed posts the signed-in user has not seen yet. The read cursor is stored per profile in Supabase. */
export async function fetchMyUnreadFeedPostCount(): Promise<number> {
  const { data, error } = await supabase.rpc("my_unread_feed_post_count");
  if (error) throw error;
  return Number(data) || 0;
}

/** Mark the current feed as seen and notify the tab badge in this app session. */
export async function markFeedPostsRead(): Promise<void> {
  const { error } = await supabase.rpc("mark_feed_posts_read");
  if (error) throw error;
  DeviceEventEmitter.emit("steth:feed-read");
}

export function subscribeFeedUnreadChanges(onChange: () => void) {
  const channel = supabase.channel(`feed-unread:${Math.random().toString(36).slice(2, 10)}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

/** A blended, chronological feed: department posts plus posts shared campus-wide. */
export async function fetchFeed(scope: FeedScope, departmentId: string, limit = 25, offset = 0): Promise<FeedPost[]> {
  let query = supabase
    .from("feed_posts")
    .select("*");

  if (scope === "department") {
    query = query.eq("department_id", departmentId).order("created_at", { ascending: false });
  } else if (scope === "campus") {
    query = query.eq("is_public", true).order("created_at", { ascending: false });
  } else {
    // For You mixes the student's department with campus-wide posts.
    query = query.or(`department_id.eq.${departmentId},is_public.eq.true`);
    if (scope === "trending") {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", weekAgo)
        .order("like_count", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }
  }

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return (data as FeedPost[]) ?? [];
}

export async function fetchProfilePosts(userId: string, limit = 30): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from("feed_posts")
    .select("*")
    .eq("author_id", userId)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);
  if (error) throw error;
  return (data as FeedPost[]) ?? [];
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc("get_public_profile", { p_user_id: userId });
  if (error) throw error;
  return (data as PublicProfile | null) ?? null;
}

/** Live inserts and engagement changes refresh the visible feed; reconnects also re-fetch missed activity. */
export function subscribeFeedChanges(onChange: () => void) {
  let firstSubscription = true;
  const channel = supabase.channel(`feed-live:${Math.random().toString(36).slice(2, 10)}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => onChange())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "posts" }, () => onChange())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "post_comments" }, () => onChange())
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (firstSubscription) { firstSubscription = false; return; }
      onChange();
    });
  return () => { void supabase.removeChannel(channel); };
}

export async function pickFeedImage(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow Steth access to your photos to attach an image.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.82 });
  return result.canceled || !result.assets?.[0] ? null : result.assets[0].uri;
}

export function feedImageUrl(path?: string | null): string | null {
  return path ? supabase.storage.from("post-images").getPublicUrl(path).data.publicUrl : null;
}

export async function createPost(content: string, isPublic: boolean, imageUri?: string | null): Promise<string> {
  let imagePath: string | null = null;
  if (imageUri) {
    const asset = await (await fetch(imageUri)).arrayBuffer();
    if (!asset.byteLength) throw new Error("The selected image is empty. Please choose another image.");
    if (asset.byteLength > 5 * 1024 * 1024) throw new Error("Please choose an image smaller than 5 MB.");
    const path = `${(await supabase.auth.getUser()).data.user?.id}/${Date.now()}.jpg`;
    const upload = await supabase.storage.from("post-images").upload(path, asset, { contentType: "image/jpeg", upsert: false });
    if (upload.error) throw upload.error;
    imagePath = path;
  }
  const { data, error } = await supabase.rpc("create_post", { p_content: content.trim(), p_is_public: isPublic, p_image_path: imagePath });
  if (error) {
    if (imagePath) await supabase.storage.from("post-images").remove([imagePath]);
    throw error;
  }
  return data as string;
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; like_count: number }> {
  const { data, error } = await supabase.rpc("toggle_post_like", { p_post_id: postId });
  if (error) throw error;
  return data as { liked: boolean; like_count: number };
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_post", { p_post_id: postId });
  if (error) throw error;
}

export async function fetchMyLikedPostIds(postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const { data, error } = await supabase.rpc("get_my_liked_post_ids", { p_post_ids: postIds });
  if (error) throw error;
  return new Set((data as string[]) ?? []);
}

export async function fetchPostComments(postId: string): Promise<FeedComment[]> {
  const { data, error } = await supabase
    .from("feed_post_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as FeedComment[]) ?? [];
}

export async function createPostComment(postId: string, content: string): Promise<FeedComment> {
  const { data, error } = await supabase.rpc("create_post_comment", { p_post_id: postId, p_content: content.trim() });
  if (error) throw error;
  return data as FeedComment;
}
