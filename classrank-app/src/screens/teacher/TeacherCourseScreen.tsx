import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Back, Btn, Card, Chip, Field, Label, Muted, Tag, YearTag, s, ListSkeleton } from "../../components/study/ui";
import { Screen, ChipRow } from "../../components/responsive";
import { fetchCourseContent, fetchCourseStats, CourseStats, postCourseEvent, deleteCourseContent, deleteCourse, fetchStaffCourses, removeCourseFiles } from "../../lib/courseApi";
import { CourseBundle } from "../../lib/studyCourseSync";
import TeacherExamsPanel from "./TeacherExamsPanel";
import TeacherTopicsPanel from "./TeacherTopicsPanel";
import TeacherInsightsPanel from "./TeacherInsightsPanel";
import QuestionManager from "./QuestionManager";

type Tab = "Topics" | "Daily quiz" | "Tests & exams" | "Overview" | "Updates";
const TABS: Tab[] = ["Topics", "Daily quiz", "Tests & exams", "Overview", "Updates"];
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime());

/** Everything a teacher manages for ONE course (its department and year are fixed when it is created). */
export default function TeacherCourseScreen({ navigation, route }: any) {
  const { courseId } = route.params as { courseId: string };
  const [tab, setTab] = useState<Tab>("Topics");
  const [bundle, setBundle] = useState<CourseBundle | null>(null);
  const [stats, setStats] = useState<CourseStats | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [eKind, setEKind] = useState<"announcement" | "exam">("announcement"), [eTitle, setETitle] = useState(""), [eBody, setEBody] = useState(""), [eDate, setEDate] = useState("");

  const load = useCallback(async () => {
    try {
      const [b, st, list] = await Promise.all([fetchCourseContent(courseId), fetchCourseStats(courseId), fetchStaffCourses()]);
      setBundle(b); setStats(st); setJoinCode(list.find((c) => c.id === courseId)?.join_code ?? ""); setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load this course."); }
  }, [courseId]);
  useEffect(() => { load(); }, [load]);

  const saveEvent = async () => {
    if (busy) return;
    if (eKind === "exam" && !isDate(eDate)) return Alert.alert("Date", "Use YYYY-MM-DD, e.g. 2026-12-05.");
    setBusy(true);
    try { await postCourseEvent({ courseId, kind: eKind, title: eTitle, body: eBody, eventDate: eKind === "exam" ? eDate : null }); setETitle(""); setEBody(""); setEDate(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't post", e?.message ?? "Try again."); } finally { setBusy(false); }
  };
  const delEvent = (id: string) => Alert.alert("Delete?", "This can't be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { try { await deleteCourseContent("event", id); await load(); } catch (e: any) { Alert.alert("Couldn't delete", e?.message ?? "Try again."); } } }]);
  const removeCourse = () => Alert.alert("Delete this course?", "Students lose access to its content. Everything they've already copied into their own study space stays with them.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete course", style: "destructive", onPress: async () => { try { await removeCourseFiles(courseId); await deleteCourse(courseId); navigation.goBack(); } catch (e: any) { Alert.alert("Couldn't delete", e?.message ?? "Try again."); } } },
  ]);

  if (error && !bundle) return <Screen><Back onPress={() => navigation.goBack()} /><Text style={s.h1}>Course unavailable</Text><Muted style={{ marginTop: 8 }}>{error}</Muted><Btn label="Try again" onPress={load} /></Screen>;
  if (!bundle || !stats) return <Screen><Back onPress={() => navigation.goBack()} /><ListSkeleton /></Screen>;

  const c = bundle.course;
  const assessmentBank = bundle.questions.filter((q) => (q.purpose ?? "practice") === "assessment");

  return (
    <Screen wide>
      <Back onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
        <Text style={s.h1}>{c.code}</Text>
        {c.year != null && <YearTag year={c.year} />}
      </View>
      <Muted>{c.title}{c.department ? ` · ${c.department}` : ""}</Muted>
      <Muted style={{ marginTop: 2 }}>Visible automatically to {c.department ?? "department"} {c.year != null ? `Year ${c.year}` : ""} students{joinCode ? ` · join code ${joinCode} (for cross-listing)` : ""}</Muted>

      <ChipRow>{TABS.map((t) => <Chip key={t} label={t} on={tab === t} onPress={() => setTab(t)} />)}</ChipRow>

      <View style={{ maxWidth: tab === "Overview" ? undefined : 760 }}>
        {tab === "Topics" && <TeacherTopicsPanel courseId={courseId} bundle={bundle} onChanged={load} />}

        {tab === "Daily quiz" && <QuestionManager courseId={courseId} bundle={bundle} purpose="daily" topics={bundle.topics ?? []} onChanged={load} />}

        {tab === "Tests & exams" && (
          <>
            <Text style={s.h2}>Practicals, tests & exams</Text>
            <Muted style={{ marginTop: 2 }}>Timed, one attempt per student, graded on the server. A student's first score is their score, and it counts towards the ranking.</Muted>
            <TeacherExamsPanel courseId={courseId} questions={assessmentBank} onChanged={load} />
            <Label>QUESTION BANK</Label>
            <QuestionManager courseId={courseId} bundle={bundle} purpose="assessment" topics={bundle.topics ?? []} onChanged={load} />
          </>
        )}

        {tab === "Overview" && <TeacherInsightsPanel courseId={courseId} stats={stats} onDelete={removeCourse} />}

        {tab === "Updates" && (
          <>
            {bundle.events.length === 0 && <Muted>Post announcements and exam dates. Exam dates feed straight into students' planners.</Muted>}
            {bundle.events.map((e) => (
              <Card key={e.id} style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}><Text style={s.h3}>{e.kind === "exam" ? "📝 " : "📣 "}{e.title}</Text><Muted>{e.event_date ?? ""}{e.body ? ` ${e.body}` : ""}</Muted></View>
                <PressableScale onPress={() => delEvent(e.id)} style={{ padding: spacing.sm }}><Text style={s.muted}>Delete</Text></PressableScale>
              </Card>
            ))}
            <Label>NEW UPDATE</Label>
            <ChipRow>{(["announcement", "exam"] as const).map((k) => <Chip key={k} label={k} on={eKind === k} onPress={() => setEKind(k)} />)}</ChipRow>
            <Field value={eTitle} onChangeText={setETitle} placeholder={eKind === "exam" ? "Exam title (e.g. Midterm)" : "Announcement title"} />
            <Field value={eBody} onChangeText={setEBody} placeholder="Details (optional)" />
            {eKind === "exam" && <Field value={eDate} onChangeText={setEDate} placeholder="Exam date YYYY-MM-DD" autoCapitalize="none" />}
            <Btn label="Post" disabled={busy || !eTitle.trim()} onPress={saveEvent} />
          </>
        )}
      </View>
    </Screen>
  );
}
