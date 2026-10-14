import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Btn, Card, Chip, Label, Muted, Tag, s } from "../../components/study/ui";
import { fetchCourseExams, scheduleExam, deleteExam, fetchExamResults, ExamSummary, ExamResults, AssessmentKind, KIND_LABEL } from "../../lib/courseApi";
import { parseLocalDateTime, validateExamSchedule, fmtWhen, fmtClock } from "../../lib/examTime";
import { CourseBundle } from "../../lib/studyCourseSync";

/** Teacher/admin tab: schedule a timed practical, test or exam from the course's assessment question bank, and see server-graded results. */
export default function TeacherExamsPanel({ courseId, questions, onChanged }: { courseId: string; questions: CourseBundle["questions"]; onChanged?: () => void }) {
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ id: string; data: ExamResults } | null>(null);
  const [kind, setKind] = useState<AssessmentKind>("test");
  const [title, setTitle] = useState(""), [sDate, setSDate] = useState(""), [sTime, setSTime] = useState("09:00");
  const [eDate, setEDate] = useState(""), [eTime, setETime] = useState("17:00"), [dur, setDur] = useState("60");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try { setExams(await fetchCourseExams(courseId)); setUnavailable(false); }
    catch { setExams([]); setUnavailable(true); } // migration 021 not applied yet
  }, [courseId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const input = (v: string, set: (x: string) => void, ph: string, extra: any = {}) =>
    <TextInput style={[s.input, extra]} value={v} onChangeText={set} placeholder={ph} placeholderTextColor={colors.textFaint} autoCapitalize="none" />;

  const create = async () => {
    const starts = parseLocalDateTime(sDate, sTime), ends = parseLocalDateTime(eDate, eTime), duration = parseInt(dur, 10);
    const err = validateExamSchedule({ title, starts, ends, duration, questionCount: picked.size });
    if (err) return Alert.alert("Check the exam", err);
    setBusy(true);
    try {
      // keep the teacher's ordering = order in the course list
      const ids = questions.filter((q) => picked.has(q.id)).map((q) => q.id);
      await scheduleExam({ courseId, kind, title: title.trim(), questionIds: ids, startsAt: starts!, endsAt: ends!, durationMinutes: duration });
      setTitle(""); setPicked(new Set()); await load(); onChanged?.();
      Alert.alert(`${KIND_LABEL[kind]} scheduled`, kind === "practical" ? "Enrolled students were notified. They can start it as soon as it opens." : "Enrolled students were notified. It stays locked for each student until they finish every topic in the course.");
    } catch (e: any) { Alert.alert("Couldn't schedule", e?.message ?? "Try again."); }
    finally { setBusy(false); }
  };

  const remove = (x: ExamSummary) =>
    Alert.alert("Delete this exam?", "All submitted results for it are deleted too.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteExam(x.id); if (open?.id === x.id) setOpen(null); await load(); onChanged?.(); }
        catch (e: any) { Alert.alert("Couldn't delete", e?.message ?? "Try again."); }
      } },
    ]);

  const showResults = async (x: ExamSummary) => {
    if (open?.id === x.id) return setOpen(null);
    try { setOpen({ id: x.id, data: await fetchExamResults(x.id) }); }
    catch (e: any) { Alert.alert("Couldn't load results", e?.message ?? "Try again."); }
  };

  if (unavailable) return <Muted>Assessments aren't available yet. Apply database migrations 021 and 025 first.</Muted>;

  return (
    <>
      {exams === null && <Muted>Loading…</Muted>}
      {exams?.length === 0 && <Muted>Nothing scheduled yet. Build your question bank, then schedule a practical, test or exam below.</Muted>}
      {exams?.map((x) => (
        <Card key={x.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[s.h3, { flex: 1 }]}>{KIND_LABEL[x.kind ?? "exam"]}: {x.title}</Text>
            <Tag label={x.status} color={x.status === "open" ? colors.danger : x.status === "upcoming" ? colors.violet : colors.textFaint} />
          </View>
          <Muted>{x.question_count} questions · {x.duration_minutes} min · {x.submitted_count ?? 0} submitted</Muted>
          <Muted>Opens {fmtWhen(x.starts_at)} · closes {fmtWhen(x.ends_at)}</Muted>
          <View style={{ flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm }}>
            <PressableScale onPress={() => showResults(x)}><Text style={[s.muted, { color: colors.tealDeep }]}>{open?.id === x.id ? "Hide results" : "Results"}</Text></PressableScale>
            <PressableScale onPress={() => remove(x)}><Text style={s.muted}>Delete</Text></PressableScale>
          </View>
          {open?.id === x.id && (
            <View style={{ marginTop: spacing.md }}>
              <Muted>Students not yet submitted count as 0 and are marked.</Muted>
              {open.data.students.length === 0 && <Muted>Nobody is enrolled.</Muted>}
              {open.data.students.map((st, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={s.muted}>{st.name}</Text>
                  <Text style={s.muted}>{st.submitted ? `${st.correct}/${open.data.total}${st.seconds != null ? ` · ${fmtClock(st.seconds)}` : ""}` : st.started ? "started, not submitted" : "not started"}</Text>
                </View>
              ))}
              <Label>PER QUESTION</Label>
              {open.data.questions.map((q, i) => (
                <View key={i} style={{ marginTop: 4 }}>
                  <Text style={s.muted} numberOfLines={2}>{i + 1}. {q.q}</Text>
                  <Text style={[s.muted, { color: q.pct_correct == null ? colors.textFaint : q.pct_correct >= 60 ? colors.success : colors.danger }]}>{q.pct_correct == null ? "no submissions" : `${q.pct_correct}% correct (${q.attempts})`}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      ))}

      <Label>SCHEDULE A PRACTICAL, TEST OR EXAM</Label>
      {questions.length < 3 ? <Muted>Add at least 3 questions to the test / exam question bank first.</Muted> : (
        <>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>{(["practical", "test", "exam"] as AssessmentKind[]).map((k) => <Chip key={k} label={KIND_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />)}</View>
          <Muted style={{ marginTop: spacing.sm }}>{kind === "practical" ? "Open to every student in the class once the window opens." : "Locked until a student has finished every topic in the course."}</Muted>
          {input(title, setTitle, `${KIND_LABEL[kind]} title (e.g. ${kind === "exam" ? "First semester exam" : kind === "test" ? "Mid-semester test" : "Lab practical 1"})`, { autoCapitalize: "sentences" })}
          <Muted style={{ marginTop: spacing.sm }}>Opens (your local time)</Muted>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>{input(sDate, setSDate, "YYYY-MM-DD", { flex: 2 })}{input(sTime, setSTime, "HH:MM", { flex: 1 })}</View>
          <Muted style={{ marginTop: spacing.sm }}>Closes (hard stop: unsubmitted attempts end here for everyone)</Muted>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>{input(eDate, setEDate, "YYYY-MM-DD", { flex: 2 })}{input(eTime, setETime, "HH:MM", { flex: 1 })}</View>
          <Muted style={{ marginTop: spacing.sm }}>Minutes each student gets once they start</Muted>
          {input(dur, setDur, "60", { keyboardType: "number-pad" })}
          <Muted style={{ marginTop: spacing.md }}>Questions ({picked.size} selected)</Muted>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <Chip label="Select all" on={false} onPress={() => setPicked(new Set(questions.slice(0, 60).map((q) => q.id)))} />
            <Chip label="Clear" on={false} onPress={() => setPicked(new Set())} />
          </View>
          {questions.map((q) => (
            <PressableScale key={q.id} onPress={() => toggle(q.id)}>
              <Card style={{ borderColor: picked.has(q.id) ? colors.teal : colors.border, backgroundColor: picked.has(q.id) ? colors.tealTint : colors.card }}>
                <Text style={s.muted} numberOfLines={2}>{picked.has(q.id) ? "☑ " : "☐ "}{q.question}</Text>
                {!!q.topic && <Muted>{q.topic}</Muted>}
              </Card>
            </PressableScale>
          ))}
          <Btn label={busy ? "Scheduling…" : `Schedule ${KIND_LABEL[kind].toLowerCase()}`} disabled={busy} onPress={create} />
        </>
      )}
    </>
  );
}
