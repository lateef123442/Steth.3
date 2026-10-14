import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Back, Bar, Btn, Card, Empty, Label, Muted, Tag, YearTag, s, ListSkeleton } from "../../components/study/ui";
import { Screen, useLayout } from "../../components/responsive";
import { fetchCourseContent, fetchCourseExams, fetchCourseRanking, fetchDailyQuiz, ExamSummary, CourseRanking, DailyQuiz, KIND_LABEL } from "../../lib/courseApi";
import { fmtWhen } from "../../lib/examTime";
import { CourseBundle } from "../../lib/studyCourseSync";
import { importCourseBundle, daysUntil } from "../../lib/studyStore";

/** One course for a student: topics to study in order, daily quiz, practical/test/exam (locked until the course is finished) and class ranking. */
export default function CourseDetailScreen({ navigation, route }: any) {
  const { courseId } = route.params as { courseId: string };
  const { isWide } = useLayout();
  const [bundle, setBundle] = useState<CourseBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timed, setTimed] = useState<ExamSummary[]>([]);
  const [rank, setRank] = useState<CourseRanking | null>(null);
  const [daily, setDaily] = useState<DailyQuiz | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await fetchCourseContent(courseId);
      setBundle(b); setError(null);
      importCourseBundle(b); // keeps this course's study room (and the AI companion's notes) current
    } catch (e: any) { setError(e?.message ?? "Couldn't load this course."); }
    // optional pieces: an older database just shows nothing for them
    fetchCourseExams(courseId).then(setTimed).catch(() => setTimed([]));
    fetchCourseRanking(courseId).then(setRank).catch(() => setRank(null));
    fetchDailyQuiz(courseId).then(setDaily).catch(() => setDaily(null));
  }, [courseId]);
  useEffect(() => { load(); return navigation.addListener("focus", load); }, [load, navigation]);

  if (error && !bundle) return <Screen><Back onPress={() => navigation.goBack()} /><Text style={s.h1}>Course unavailable</Text><Muted style={{ marginTop: 8 }}>{error}</Muted><Btn label="Try again" onPress={load} /></Screen>;
  if (!bundle) return <Screen><Back onPress={() => navigation.goBack()} /><ListSkeleton rows={4} /></Screen>;

  const topics = bundle.topics ?? [];
  const prog = bundle.progress ?? { read_material_ids: [], completed_topic_ids: [], course_complete: false };
  const reads = new Set(prog.read_material_ids), doneSet = new Set(prog.completed_topic_ids);
  const doneCount = topics.filter((t) => doneSet.has(t.id)).length;
  const next = topics.find((t) => !doneSet.has(t.id));
  const complete = prog.course_complete;
  const news = bundle.events.filter((e) => e.kind === "announcement");
  const c = bundle.course;

  const open = (t: { id: string }) => navigation.navigate("CourseTopic", { courseId, topicId: t.id });
  const startAssessment = (x: ExamSummary) => Alert.alert(`Start ${KIND_LABEL[x.kind].toLowerCase()}?`, `You'll have ${x.duration_minutes} minutes and one attempt. Your first score is the one that counts. The clock starts now.`, [{ text: "Not now", style: "cancel" }, { text: "Start", onPress: () => navigation.navigate("Exam", { examId: x.id }) }]);

  const topicsCol = (
    <View style={{ flex: 1 }}>
      <Label>TOPICS</Label>
      {topics.length === 0 && <Empty icon="🧩" title="No topics yet" body="Your teacher hasn't added topics to this course. Check back soon." />}
      {topics.map((t, i) => {
        const mats = bundle.materials.filter((m) => m.topic_id === t.id);
        const r = mats.filter((m) => reads.has(m.id)).length;
        const done = doneSet.has(t.id);
        const status = done ? "Finished" : r > 0 ? `${r}/${mats.length} opened` : "Not started";
        const color = done ? colors.success : r > 0 ? colors.ember : colors.textFaint;
        return (
          <Card key={t.id} onPress={() => open(t)} style={{ marginTop: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: done ? colors.successTint : colors.tealTint }}>
                <Text style={{ color: done ? colors.success : colors.tealDeep, fontWeight: "700" }}>{done ? "✓" : i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.h3} numberOfLines={2}>{t.title}</Text>
                <Muted>{mats.length} resource{mats.length === 1 ? "" : "s"}</Muted>
              </View>
              <Tag label={status} color={color} />
            </View>
          </Card>
        );
      })}
      <Label>ANNOUNCEMENTS</Label>
      {news.length === 0 && <Muted>Nothing yet.</Muted>}
      {news.map((n) => <Card key={n.id}><Text style={s.h3}>{n.title}</Text>{!!n.body && <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{n.body}</Text>}</Card>)}
    </View>
  );

  const sideCol = (
    <View style={{ flex: 1 }}>
      <Label>DAILY QUIZ</Label>
      <Card onPress={() => navigation.navigate("CourseDaily", { courseId, code: c.code })}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={s.h3}>Today's questions</Text>
          {daily && daily.questions.length > 0 && <Tag label={`${daily.questions.length} ready`} color={colors.teal} />}
        </View>
        <Muted style={{ marginTop: 4 }}>
          {!daily ? "Tap to open." : daily.questions.length > 0 ? "Quick questions from the topics you've started. Your first answer counts for the ranking."
            : daily.answered_today >= daily.daily_limit ? "You're done for today. Come back tomorrow."
            : daily.pending_total > 0 ? "Open more resources to unlock more questions." : "Your teacher hasn't added daily questions yet."}
        </Muted>
      </Card>

      <Label>PRACTICALS, TESTS & EXAMS</Label>
      {!complete && topics.length > 0 && <Muted style={{ marginBottom: spacing.sm }}>Tests and exams unlock when you finish all {topics.length} topics ({doneCount} done).</Muted>}
      {timed.length === 0 && <Muted>None scheduled yet.</Muted>}
      {timed.map((x) => {
        const a = x.my_attempt, done = !!a?.submitted;
        const label = done ? "Submitted" : x.locked ? "Locked" : x.status === "open" ? (a ? "Resume" : "Open now") : x.status === "upcoming" ? "Upcoming" : "Closed";
        const tone = done ? colors.success : x.locked ? colors.textFaint : x.status === "open" ? colors.danger : colors.violet;
        return (
          <Card key={x.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
              <Text style={[s.h3, { flex: 1 }]}>{KIND_LABEL[x.kind]}: {x.title}</Text><Tag label={label} color={tone} />
            </View>
            <Muted>{x.question_count} questions · {x.duration_minutes} min · one attempt</Muted>
            <Muted>Opens {fmtWhen(x.starts_at)} · closes {fmtWhen(x.ends_at)}</Muted>
            {done && a?.total ? <Muted>Your score: {a.correct}/{a.total}</Muted> : null}
            {x.locked && !done && <Muted style={{ color: colors.danger }}>🔒 Finish every topic to unlock this.</Muted>}
            {x.status === "open" && !done && !x.locked && <Btn label={a ? "Resume" : "Start"} onPress={() => startAssessment(x)} />}
            {(done || x.status === "closed") && <Btn ghost label="Review answers" onPress={() => navigation.navigate("Exam", { examId: x.id, mode: "review" })} />}
          </Card>
        );
      })}

      <Label>CLASS RANKING</Label>
      {!rank || rank.top.length === 0 ? <Muted>Rankings appear once classmates answer daily questions or take a test.</Muted> : (
        <Card>
          {rank.me && <Text style={[s.h3, { color: colors.violet }]}>You: #{rank.me.rank} of {rank.size} · {rank.me.points} pts</Text>}
          {rank.top.slice(0, 5).map((r) => (
            <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
              <Text style={type.body}>{r.rank}. {r.name}</Text><Muted>{r.points} pts</Muted>
            </View>
          ))}
          <Muted style={{ marginTop: 8 }}>Ranked by your first answers in daily quizzes and your first score in each practical, test and exam.</Muted>
        </Card>
      )}
    </View>
  );

  return (
    <Screen wide>
      <Back onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
        <Text style={s.h1}>{c.code}</Text>
        {c.year != null && <YearTag year={c.year} />}
      </View>
      <Muted>{c.title}{c.department ? ` · ${c.department}` : ""}</Muted>

      <Card style={{ marginTop: spacing.lg, backgroundColor: complete ? colors.successTint : colors.tealTint, borderWidth: 0 }}>
        <Text style={s.h3}>{topics.length === 0 ? "Getting started" : complete ? "Course finished 🎉" : `${doneCount} of ${topics.length} topics finished`}</Text>
        {topics.length > 0 && <View style={{ marginVertical: spacing.sm }}><Bar value={doneCount / topics.length} color={complete ? colors.success : colors.teal} /></View>}
        <Muted>{complete ? "Your tests and exams are unlocked. Revise any topic whenever you like." : next ? `Next up: ${next.title}` : "Your teacher is still setting this course up."}</Muted>
        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
          {next && <View style={{ flexGrow: 1, minWidth: 150 }}><Btn label={doneCount === 0 ? "Start learning" : "Continue"} onPress={() => open(next)} /></View>}
          <View style={{ flexGrow: 1, minWidth: 150 }}><Btn ghost label="🤖 Ask the AI guide" onPress={() => navigation.navigate("Companion", { prompt: `I'm studying ${c.code} ${c.title}${next ? `, currently on "${next.title}"` : ""}. Guide me: what should I focus on, and quiz me when I'm ready.` })} /></View>
        </View>
      </Card>

      {isWide ? <View style={{ flexDirection: "row", gap: spacing.xxl }}>{topicsCol}{sideCol}</View> : <>{topicsCol}{sideCol}</>}
    </Screen>
  );
}
