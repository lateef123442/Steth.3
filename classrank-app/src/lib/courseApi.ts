import { supabase } from "./supabase";
import { notifyAnnouncement } from "./pushNotify";
import { CourseBundle, QuestionPurpose, reportableAnswers } from "./studyCourseSync";
import { getStudyData, QuizAttempt } from "./studyStore";
import { uid } from "./studyTypes";
import { secondsLeft } from "./examTime";
import { mimeFor, storagePath, validateFile, MAX_FILE_BYTES } from "./fileRules";

export interface MyCourse { id: string; code: string; title: string; year: number; department: string; teacher_name: string; member_count: number; next_exam: string | null; topic_count: number; topics_done: number }
export interface StaffCourse { id: string; code: string; title: string; year: number; join_code: string; department: string; teacher_name: string; member_count: number; question_count: number; material_count: number; topic_count: number }
export interface CourseStats {
  member_count: number; active_7d: number; answers_total: number; accuracy: number | null;
  hardest: { question_id: string; question: string; topic: string; attempts: number; pct_correct: number }[];
  topics: { topic: string; attempts: number; pct_correct: number }[];
  students: { name: string; answers: number; accuracy: number }[];
}

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

// ── student ──
export const joinCourse = (code: string) => call<{ course_id: string; code: string; title: string }>("join_course", { p_code: code });
export const leaveCourse = (courseId: string) => call<void>("leave_course", { p_course_id: courseId });
export const fetchMyCourses = async () => (await call<MyCourse[]>("my_courses")) ?? [];
export interface Announcement { id: string; title: string; body: string; created_at: string; course_id: string; course_code: string }
export const fetchRecentAnnouncements = async () => (await call<Announcement[]>("my_recent_announcements", { p_days: 14 })) ?? [];
export const fetchCourseContent = (courseId: string) => call<CourseBundle>("get_course_content", { p_course_id: courseId });

/**
 * Fire-and-forget: tells each course's teacher how the student did on that course's questions
 * (aggregated server-side into "hardest questions" etc). Never blocks or fails the quiz.
 */
export async function reportAttemptToCourses(attempt: QuizAttempt): Promise<void> {
  try {
    for (const { courseId, answers } of reportableAnswers(getStudyData(), attempt)) {
      await call<number>("report_course_answers", { p_course_id: courseId, p_answers: answers.slice(0, 60) });
    }
  } catch (e) {
    console.log("[courseApi] report skipped:", e);
  }
}

// ── teacher / admin ──
export const createCourse = (departmentId: string, code: string, title: string, year: number) =>
  call<{ id: string; join_code: string }>("create_course", { p_department_id: departmentId, p_code: code, p_title: title, p_year: year });
export const fetchStaffCourses = async () => (await call<StaffCourse[]>("staff_list_courses")) ?? [];
export const deleteCourse = (courseId: string) => call<void>("staff_delete_course", { p_course_id: courseId });
export const fetchCourseStats = (courseId: string) => call<CourseStats>("teacher_course_stats", { p_course_id: courseId });
export const upsertMaterial = (m: { id?: string | null; courseId: string; topic: string; title: string; kind: "note" | "link" | "video"; body: string }) =>
  call<string>("staff_upsert_material", { p_id: m.id ?? null, p_course_id: m.courseId, p_topic: m.topic, p_title: m.title, p_kind: m.kind, p_body: m.body });
export const upsertCourseQuestion = (q: { id?: string | null; courseId: string; topic: string; question: string; options: string[]; correctIndex: number; explanation: string }) =>
  call<string>("staff_upsert_course_question", { p_id: q.id ?? null, p_course_id: q.courseId, p_topic: q.topic, p_question: q.question, p_options: q.options, p_correct_index: q.correctIndex, p_explanation: q.explanation });
export const postCourseEvent = async (e: { courseId: string; kind: "announcement" | "exam"; title: string; body: string; eventDate?: string | null }) => {
  const id = await call<string>("staff_post_event", { p_course_id: e.courseId, p_kind: e.kind, p_title: e.title, p_body: e.body, p_event_date: e.eventDate ?? null });
  notifyAnnouncement(id); // push to enrolled students (no-op if nobody has push enabled)
  return id;
};
export const deleteCourseContent = (kind: "material" | "question" | "event", id: string) => call<void>("staff_delete_course_content", { p_kind: kind, p_id: id });

// ── timed exams (supabase/021_exams_and_trusted_stats.sql) ──
export type AssessmentKind = "practical" | "test" | "exam";
export const KIND_LABEL: Record<AssessmentKind, string> = { practical: "Practical", test: "Test", exam: "Exam" };
export interface ExamSummary {
  id: string; title: string; kind: AssessmentKind; locked?: boolean; starts_at: string; ends_at: string; duration_minutes: number; question_count: number;
  status: "upcoming" | "open" | "closed";
  my_attempt: { started_at: string; submitted: boolean; correct: number | null; total: number | null } | null;
  submitted_count?: number; // staff only
}
export interface ExamSession { exam_id: string; title: string; kind?: AssessmentKind; server_now: string; started_at: string; deadline: string; questions: { q: string; options: string[] }[] }
export interface ExamReviewItem { q: string; options: string[]; correct: number; explanation: string; picked: number | null }
export interface ExamResults {
  title: string; kind?: AssessmentKind; total: number;
  students: { name: string; submitted: boolean; started: boolean; correct: number; seconds: number | null }[];
  questions: { q: string; attempts: number; pct_correct: number | null }[];
}
export const fetchCourseExams = async (courseId: string) => (await call<ExamSummary[]>("list_course_exams", { p_course_id: courseId })) ?? [];
export const startExam = (examId: string) => call<ExamSession>("start_course_exam", { p_exam_id: examId });
export const submitExam = (examId: string, answers: (number | null)[]) => call<{ correct: number; total: number; points_earned?: number }>("submit_course_exam", { p_exam_id: examId, p_answers: answers });
export const reviewExam = async (examId: string) => (await call<ExamReviewItem[]>("review_course_exam", { p_exam_id: examId })) ?? [];
export const examSecondsLeft = (s: ExamSession, receivedAtMs: number) => secondsLeft(s.deadline, s.server_now, receivedAtMs);

export const scheduleExam = async (e: { courseId: string; kind: AssessmentKind; title: string; questionIds: string[]; startsAt: Date; endsAt: Date; durationMinutes: number }) => {
  const r = await call<{ exam_id: string; event_id: string }>("staff_create_exam", {
    p_course_id: e.courseId, p_title: e.title, p_question_ids: e.questionIds,
    p_starts_at: e.startsAt.toISOString(), p_ends_at: e.endsAt.toISOString(), p_duration_minutes: e.durationMinutes, p_kind: e.kind,
  });
  notifyAnnouncement(r.event_id); // same push path as announcements / exam dates
  return r;
};
export const deleteExam = (examId: string) => call<void>("staff_delete_exam", { p_exam_id: examId });
export const fetchExamResults = (examId: string) => call<ExamResults>("staff_exam_results", { p_exam_id: examId });

// ── file attachments (supabase/022_material_files.sql) ──
const BUCKET = "course-files";
/** Uploads to the private bucket, then registers it so students can see it. Removes the upload if registering fails. */
export async function uploadMaterialFile(f: { courseId: string; uri: string; name: string; size?: number | null; topicId: string | null; title: string }): Promise<string> {
  const bad = validateFile(f.name, f.size);
  if (bad) throw new Error(bad);
  const mime = mimeFor(f.name)!;
  const buf = await (await fetch(f.uri)).arrayBuffer();
  if (buf.byteLength === 0) throw new Error("That file is empty.");
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error("That file is too large (10 MB limit).");
  const path = storagePath(f.courseId, uid(), f.name);
  const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  try {
    return await call<string>("staff_add_file_to_topic", { p_course_id: f.courseId, p_topic_id: f.topicId, p_title: f.title, p_path: path, p_file_name: f.name });
  } catch (e) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw e;
  }
}
/** Short-lived link (5 minutes); the bucket itself is never public. */
export async function materialFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't open this file.");
  return data.signedUrl;
}
/** Best effort: the database row is the source of truth, so a failed cleanup just leaves an orphan. */
export const removeMaterialFile = (path: string) => supabase.storage.from(BUCKET).remove([path]).then(() => {}, () => {});

/**
 * Removes every stored file in a course's folder. Call this BEFORE deleting the course: the storage delete policy
 * checks course staff, which stops passing once the course row is gone. Best effort; leftovers are orphans.
 */
export async function removeCourseFiles(courseId: string): Promise<void> {
  try {
    const store = supabase.storage.from(BUCKET);
    for (let guard = 0; guard < 10; guard++) { // 40 files max per course, so this is a safety cap only
      const { data, error } = await store.list(courseId, { limit: 100 });
      if (error || !data?.length) return;
      const { error: rmErr } = await store.remove(data.map((o) => `${courseId}/${o.name}`));
      if (rmErr) return;
    }
  } catch { /* best effort */ }
}

// ── department + level, topics, progress, daily quizzes (supabase/025_levels_topics_assessments.sql) ──
export const saveTopic = (x: { id?: string | null; courseId: string; title: string; summary?: string }) =>
  call<string>("staff_save_topic", { p_id: x.id ?? null, p_course_id: x.courseId, p_title: x.title, p_summary: x.summary ?? "" });
export const deleteTopic = (topicId: string) => call<void>("staff_delete_topic", { p_topic_id: topicId });
export const moveTopic = (topicId: string, direction: -1 | 1) => call<void>("staff_move_topic", { p_topic_id: topicId, p_direction: direction });
export const saveResource = (m: { id?: string | null; courseId: string; topicId: string | null; title: string; kind: "note" | "link" | "video"; body: string }) =>
  call<string>("staff_save_material", { p_id: m.id ?? null, p_course_id: m.courseId, p_topic_id: m.topicId, p_title: m.title, p_kind: m.kind, p_body: m.body });
export const saveQuestion = (q: { id?: string | null; courseId: string; topicId: string | null; purpose: QuestionPurpose; question: string; options: string[]; correctIndex: number; explanation: string }) =>
  call<string>("staff_save_question", { p_id: q.id ?? null, p_course_id: q.courseId, p_topic_id: q.topicId, p_purpose: q.purpose, p_question: q.question, p_options: q.options, p_correct_index: q.correctIndex, p_explanation: q.explanation });
export const fetchTopicProgress = (courseId: string) => call<{ topic_count: number; students: { name: string; done: number }[] }>("staff_topic_progress", { p_course_id: courseId });

export const markMaterialRead = (materialId: string) => call<void>("mark_material_read", { p_material_id: materialId });
export const completeTopic = (topicId: string) => call<{ course_complete: boolean }>("complete_topic", { p_topic_id: topicId });

export interface DailyQuestion { id: string; topic: string; question: string; options: string[] }
export interface DailyQuiz { answered_today: number; daily_limit: number; pending_total: number; questions: DailyQuestion[] }
export interface DailyAnswerResult { already_answered: boolean; is_correct: boolean; correct_index: number; explanation: string; points_earned: number; total_points?: number }
export const fetchDailyQuiz = (courseId: string) => call<DailyQuiz>("course_daily_quiz", { p_course_id: courseId });
export const answerDaily = (questionId: string, picked: number) => call<DailyAnswerResult>("submit_course_daily_answer", { p_question_id: questionId, p_picked: picked });

export interface CourseRanking { top: { id: string; name: string; points: number; rank: number }[]; me: { rank: number; points: number } | null; size: number }
export const fetchCourseRanking = (courseId: string) => call<CourseRanking>("course_leaderboard", { p_course_id: courseId });

// admin: which years a teacher covers
export const setTeacherYears = (teacherId: string, years: number[]) => call<void>("admin_set_teacher_years", { p_teacher: teacherId, p_years: years });
export const getTeacherYears = async (teacherId: string) => (await call<number[] | null>("admin_get_teacher_years", { p_teacher: teacherId })) ?? [];
