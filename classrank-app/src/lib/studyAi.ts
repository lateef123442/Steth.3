import { supabase } from "./supabase";
import type { Question } from "./studyTypes";

export interface FileInfo { used: number; skipped: number }

/** Converts safe Edge Function error payloads into messages students can understand. */
export async function studyAiErrorMessage(error: unknown): Promise<string> {
  const context = (error as any)?.context;
  let payload: any = null;
  if (context && typeof context.clone === "function") {
    try { payload = await context.clone().json(); } catch { /* keep the fallback below */ }
  }
  if (payload?.error === "DAILY_LIMIT") return "You've used your 5 AI requests for today. Come back after midnight (Lagos time).";
  if (payload?.error === "PROVIDER_LIMIT") return "The free AI service is busy right now. Please try again in a little while.";
  if (payload?.error === "AI_TEMPORARILY_UNAVAILABLE" || payload?.error === "AI_NOT_CONFIGURED") return "AI Companion is temporarily unavailable. Please try again later.";
  return "I couldn't complete that AI request. Check your connection and try again.";
}

/** Asks the study-companion Edge Function for MCQs, then validates every item before it touches the question bank. */
export async function generateQuestions(opts: { subject: string; topic?: string; notes?: string; count?: number; files?: string[]; onFiles?: (i: FileInfo) => void }):
  Promise<Omit<Question, "id" | "subjectId" | "topicId">[]> {
  const { onFiles, ...rest } = opts;
  const { data, error } = await supabase.functions.invoke("study-companion", { body: { task: "questions", ...rest } });
  if (onFiles && data) onFiles({ used: Number(data.files_used) || 0, skipped: Number(data.files_skipped) || 0 });
  if (error) throw new Error(await studyAiErrorMessage(error));
  if (!Array.isArray(data?.questions)) throw new Error("No valid questions were returned.");
  const ok = (data.questions as any[]).filter((x) =>
    typeof x?.q === "string" && Array.isArray(x.options) && x.options.length === 4 && x.options.every((o: any) => typeof o === "string") &&
    Number.isInteger(x.correct) && x.correct >= 0 && x.correct <= 3);
  if (!ok.length) throw new Error("No valid questions were returned.");
  return ok.map((x) => ({ q: x.q.trim(), options: x.options.map((o: string) => o.trim()), correct: x.correct, explanation: String(x.explanation ?? "").trim(), source: "ai" as const }));
}

/** Generate a standalone CBT from a private PDF stored in the signed-in student's own folder. */
export async function generateQuestionsFromPdf(pdfPath: string, count: number): Promise<Omit<Question, "id" | "subjectId" | "topicId">[]> {
  if (!Number.isInteger(count) || count < 5 || count > 100 || count % 5 !== 0) throw new Error("Choose between 5 and 100 questions in steps of 5.");
  const { data, error } = await supabase.functions.invoke("study-companion", { body: { task: "pdf_questions", pdf_path: pdfPath, count } });
  if (error) throw new Error(await studyAiErrorMessage(error));
  if (!Array.isArray(data?.questions)) throw new Error("The PDF did not produce a valid question set. Try another PDF.");
  const valid = (data.questions as any[]).filter((x) => typeof x?.q === "string" && Array.isArray(x.options) && x.options.length === 4 && x.options.every((o: any) => typeof o === "string") && Number.isInteger(x.correct) && x.correct >= 0 && x.correct <= 3);
  if (valid.length < 5) throw new Error("The PDF did not contain enough readable material to create questions.");
  return valid.slice(0, count).map((x) => ({ q: x.q.trim(), options: x.options.map((o: string) => o.trim()), correct: x.correct, explanation: String(x.explanation ?? "").trim(), source: "ai" as const }));
}

/** Flashcards from a topic and/or the student's notes. Same validation approach as generateQuestions. */
export async function generateFlashcards(opts: { subject: string; topic?: string; notes?: string; count?: number; files?: string[]; onFiles?: (i: FileInfo) => void }): Promise<{ front: string; back: string }[]> {
  const { onFiles, ...rest } = opts;
  const { data, error } = await supabase.functions.invoke("study-companion", { body: { task: "flashcards", ...rest } });
  if (onFiles && data) onFiles({ used: Number(data.files_used) || 0, skipped: Number(data.files_skipped) || 0 });
  if (error) throw new Error(await studyAiErrorMessage(error));
  if (!Array.isArray(data?.cards)) throw new Error("No valid flashcards were returned.");
  const ok = (data.cards as any[]).filter((x) => typeof x?.front === "string" && typeof x?.back === "string" && x.front.trim() && x.back.trim());
  if (!ok.length) throw new Error("No valid flashcards were returned.");
  return ok.map((x) => ({ front: x.front.trim(), back: x.back.trim() }));
}
