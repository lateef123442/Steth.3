import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";
import { FeedComment, FeedPost } from "../types";

export type FeedScope = "department" | "campus";

export async function fetchFeed(scope: FeedScope, departmentId: string, limit = 30, offset = 0): Promise<FeedPost[]> {
  let query = supabase
    .from("feed_posts")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // "Campus" shows every public post regardless of department; "Department"
  // shows this student's own department feed (which, per the RLS policy,
  // already includes public posts from elsewhere too — but we filter
  // client-side to keep the department tab feeling like a department feed,
  // not a mixed one).
  query = scope === "campus" ? query.eq("is_public", true) : query.eq("department_id", departmentId);

  const { data, error } = await query;
  if (error) throw error;
  return (data as FeedPost[]) ?? [];
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
  const { data, error } = await supabase.rpc("create_post_comment", {
    p_post_id: postId,
    p_content: content.trim(),
  });
  if (error) throw error;
  return data as FeedComment;
}
