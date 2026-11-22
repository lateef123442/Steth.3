import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/tokens";
import { useApp } from "../context/AppContext";
import { Card, Chip, Label, Muted, Tag, s } from "../components/study/ui";
import { useStudy, questionPool, topicStats, scoreHistory, subjectName, attemptedToday, QuizMode } from "../lib/studyStore";
import StaggerIn from "../components/animated/StaggerIn";
import { WRAP } from "../components/responsive";
import { syncMyCoursesToStudy } from "../lib/courseApi";

import EmojiIcon from "../components/EmojiIcon";
const MODES: { mode: QuizMode; icon: string; title: string; blurb: (n: number) => string; need: "subject" | "topic" | "any" }[] = [
  { mode: "review", icon: "🔁", title: "Spaced Review", blurb: () => "3 to 5 questions from each topic that is due or that you are struggling with", need: "any" },
  { mode: "quick", icon: "⚡", title: "Quick Quiz", blurb: () => "A short quiz focused on your weak spots", need: "any" },
  { mode: "topic", icon: "🎯", title: "Topic Quiz", blurb: () => "Drill one topic", need: "topic" },
  { mode: "subject", icon: "📚", title: "Course Quiz", blurb: (n) => `Up to ${Math.min(n, 100)} questions across the course`, need: "subject" },
  { mode: "mock", icon: "⏱", title: "Mock Exam", blurb: (n) => `Timed, no hints until the end · up to ${Math.min(n, 100)} questions`, need: "subject" },
  { mode: "daily", icon: "🌅", title: "Daily Challenge", blurb: () => "5 mixed questions across your courses", need: "any" },
];

export default function PracticeScreen({ navigation }: any) {
  const { hasCompletedTodaysQuiz, todaysQuestions } = useApp();
  const { data, ready } = useStudy();
  const [syncingCourses, setSyncingCourses] = useState(false);
  const [courseSyncError, setCourseSyncError] = useState<string | null>(null);
  const syncCourses = useCallback(async () => {
    setSyncingCourses(true);
    try {
      const result = await syncMyCoursesToStudy();
      setCourseSyncError(result.failedCourseIds.length ? `${result.failedCourseIds.length} course(s) could not refresh. Try again.` : null);
    } catch (error: any) {
      setCourseSyncError(error?.message ?? "Could not load assigned courses.");
    } finally {
      setSyncingCourses(false);
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    void syncCourses();
    const unsubscribe = navigation.addListener("focus", syncCourses);
    return unsubscribe;
  }, [ready, syncCourses, navigation]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const topics = topicStats(data).filter((t) => !subjectId || t.subjectId === subjectId);
  const hist = scoreHistory(data);
  const recent = hist.slice(-5);
  const trend = hist.length >= 4 ? Math.round(avg(hist.slice(-3)) - avg(hist.slice(-6, -3).length ? hist.slice(-6, -3) : hist.slice(0, -3))) : null;

  const count = (m: (typeof MODES)[number]) => questionPool(data, m.mode, subjectId ?? undefined, topicId ?? undefined).length;
  const start = (m: (typeof MODES)[number]) => navigation.navigate("PracticeSession", { mode: m.mode, subjectId: subjectId ?? undefined, topicId: topicId ?? undefined, ...(["quick", "topic", "subject", "mock"].includes(m.mode) ? { questionCount } : {}) });
  const blocked = (m: (typeof MODES)[number]) => {
    if (m.mode === "daily" && attemptedToday(data, "daily")) return "You've completed today's challenge. A fresh Daily Challenge will be available tomorrow.";
    if (m.mode === "topic" && !topicId) return "Choose a topic above to unlock Topic Quiz.";
    if (count(m) === 0) {
      if (m.mode === "review") return "No topics are due for review yet. Complete course questions first.";
      if (m.mode === "topic") return "Your teacher has not published practice questions for this topic yet.";
      return "No teacher-published practice questions are available yet. Ask your teacher to publish questions in a course.";
    }
    return null;
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }}>
        <Text style={s.h1}>Practice</Text>
        <Muted style={{ marginTop: 4 }}>Test yourself, see where you're weak, then fix it.</Muted>


        {!!courseSyncError && <Muted style={{ color: colors.danger, marginTop: spacing.md }}>{courseSyncError}</Muted>}
        {(!ready || syncingCourses) && data.subjects.length === 0 && <Muted style={{ marginTop: spacing.lg }}>Loading your teacher-assigned courses…</Muted>}
        {data.subjects.length === 0 && ready && !syncingCourses ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Text style={s.h3}>No courses assigned yet</Text><Muted>Your teachers' courses and published practice questions will appear here automatically.</Muted>
          </Card>
        ) : data.subjects.length > 0 ? (
          <>
            <Label>COURSES</Label>
            <View style={s.row}>
              <Chip label="All courses" on={!subjectId} onPress={() => { setSubjectId(null); setTopicId(null); }} />
              {data.subjects.map((x) => <Chip key={x.id} label={x.name} on={subjectId === x.id} onPress={() => { setSubjectId(x.id); setTopicId(null); }} />)}
            </View>
            {topics.length > 0 && (
              <>
                <Label>TOPICS (FOR TOPIC QUIZ)</Label>
                <View style={s.row}>{topics.map((t) => <Chip key={t.id} label={t.name} on={topicId === t.id} onPress={() => setTopicId(topicId === t.id ? null : t.id)} />)}</View>
              </>
            )}

            <Label>QUESTIONS PER SESSION</Label>
            <Muted>Choose from 5 to 100 questions. The quiz uses as many as are available.</Muted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
              <View style={s.row}>
                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map((n) => <Chip key={n} label={String(n)} on={questionCount === n} onPress={() => setQuestionCount(n)} />)}
              </View>
            </ScrollView>

            <Label>CHOOSE A MODE</Label>
            {MODES.map((m, mi) => {
              const why = blocked(m);
              const done = m.mode === "daily" && attemptedToday(data, "daily");
              const available = count(m);
              const detail = ["quick", "topic", "subject", "mock"].includes(m.mode)
                ? `Up to ${Math.min(available, questionCount)} questions${m.mode === "mock" ? " · timed, no hints until the end" : m.mode === "quick" ? " · focused on weak spots" : ""}`
                : m.blurb(available);
              const title = m.mode === "subject" ? "Course Quiz" : m.title;
              return (
                <StaggerIn key={m.mode} index={mi}><Card onPress={() => (why ? Alert.alert(done ? "Daily Challenge completed" : `${title} unavailable`, why) : start(m))} style={{ borderColor: done ? colors.success : why ? colors.danger : colors.teal }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <EmojiIcon emoji={m.icon} style={{ fontSize: 26, marginRight: spacing.md }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.h3}>{title}{done ? "  · Done" : ""}</Text>
                      <Muted>{why ?? detail}</Muted>
                      <Tag label={done ? "Completed today · new challenge tomorrow" : why ? "Not available yet · tap to learn why" : "Available · tap to start"} color={done ? colors.success : why ? colors.danger : colors.teal} />
                    </View>
                  </View>
                </Card></StaggerIn>
              );
            })}
            {data.questions.length === 0 && <Muted>No practice questions yet. Your teachers can publish course questions for practice.</Muted>}
          </>
        ) : null}

        <Label>RANKED</Label>
        <Card onPress={() => navigation.navigate("Quiz")} style={hasCompletedTodaysQuiz ? { opacity: 0.6 } : undefined}>
          <Text style={s.h3}>Department quiz{hasCompletedTodaysQuiz ? ": done" : ""}</Text>
          <Muted>{hasCompletedTodaysQuiz ? "Back tomorrow." : todaysQuestions.length ? `${todaysQuestions.length} questions · counts toward your leaderboard rank` : "No quiz published yet."}</Muted>
        </Card>

        {recent.length > 0 && (
          <>
            <Label>RECENT RESULTS</Label>
            {trend !== null && <Muted style={{ marginBottom: spacing.sm }}>{trend > 0 ? `Your last 3 quizzes averaged ${trend} points higher than the 3 before.` : trend < 0 ? `Your last 3 quizzes averaged ${-trend} points lower. Worth a review.` : "Holding steady."}</Muted>}
            {[...data.attempts].slice(-5).reverse().map((a) => {
              const p = Math.round((a.correct / Math.max(a.total, 1)) * 100);
              return (
                <Card key={a.id} style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.h3}>{a.subjectId ? subjectName(data, a.subjectId) : "Mixed courses"} · {a.mode === "subject" ? "Course Quiz" : a.mode}</Text>
                    <Muted>{a.date} · {a.correct}/{a.total}</Muted>
                  </View>
                  <Tag label={`${p}%`} color={p >= 80 ? colors.success : p >= 60 ? colors.ember : colors.danger} />
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const avg = (xs: { pct: number }[]) => (xs.length ? xs.reduce((a, x) => a + x.pct, 0) / xs.length : 0);
