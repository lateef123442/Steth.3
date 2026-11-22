import { supabase } from "./supabase";
import { safeFileName } from "./fileRules";

const BUCKET = "study-materials";
export const MAX_STUDY_FILE_BYTES = 50 * 1024 * 1024;

export interface StudyMaterial {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

export async function fetchMyStudyMaterials(): Promise<StudyMaterial[]> {
  const { data, error } = await supabase.from("study_materials")
    .select("id,file_name,storage_path,mime_type,file_size,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StudyMaterial[];
}

export async function uploadStudyMaterial(file: { uri: string; name: string; size?: number | null; mimeType?: string | null }): Promise<StudyMaterial> {
  if (!file.name?.trim()) throw new Error("Choose a file with a name.");
  if (file.size != null && file.size <= 0) throw new Error("That file is empty.");
  if (file.size != null && file.size > MAX_STUDY_FILE_BYTES) throw new Error("That file is larger than the 50 MB study-material limit.");
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error("Sign in again to upload a study file.");
  const bytes = await (await fetch(file.uri)).arrayBuffer();
  if (!bytes.byteLength) throw new Error("That file is empty.");
  if (bytes.byteLength > MAX_STUDY_FILE_BYTES) throw new Error("That file is larger than the 50 MB study-material limit.");
  const safeName = safeFileName(file.name);
  const path = `${auth.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${safeName}`;
  const mime = file.mimeType || "application/octet-stream";
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await supabase.from("study_materials").insert({
    owner_id: auth.user.id, file_name: file.name.slice(0, 240), storage_path: path,
    mime_type: mime.slice(0, 160), file_size: bytes.byteLength,
  }).select("id,file_name,storage_path,mime_type,file_size,created_at").single();
  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error ?? new Error("The upload finished but couldn't be saved to your study materials.");
  }
  return data as StudyMaterial;
}

export async function studyMaterialUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 1800);
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't open this study file.");
  return data.signedUrl;
}

export async function deleteStudyMaterial(material: StudyMaterial): Promise<void> {
  const { error } = await supabase.from("study_materials").delete().eq("id", material.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([material.storage_path]).catch(() => {});
}
