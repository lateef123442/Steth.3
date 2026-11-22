import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, TextInput, Alert, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/tokens";
import PressableScale from "../components/animated/PressableScale";
import { Back, Btn, Card, Chip, Label, Muted, s } from "../components/study/ui";
import {
  useStudy, addSession, setSessionStatus, rescheduleSession, removeSession, applySchedule,
  generateSchedule, missedSessions, subjectName, topicName, daysUntil, dateStr, addDaysStr, fmtTime12, PlannedSession,
} from "../lib/studyStore";
import { WRAP } from "../components/responsive";
import { syncMyCoursesToStudy } from "../lib/courseApi";

const MINUTES = [10, 20, 30, 45];
const localDateString = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (value?: string) => { if (!value) return new Date(); const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const parseTime = (value: string) => { const [h, m] = value.split(":").map(Number); const d = new Date(); d.setHours(h || 0, m || 0, 0, 0); return d; };
const formatTime = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const dayLabel = (d: string) => (d === dateStr() ? "Today" : d === addDaysStr(1) ? "Tomorrow" : new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }));

export default function PlannerScreen({ navigation }: any) {
  const { data, ready } = useStudy();
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncCourses = useCallback(async () => {
    try {
      const result = await syncMyCoursesToStudy();
      setSyncError(result.failedCourseIds.length ? `${result.failedCourseIds.length} course(s) could not refresh. Try again.` : null);
    } catch (error: any) {
      setSyncError(error?.message ?? "Could not load assigned courses.");
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    void syncCourses();
    const unsubscribe = navigation.addListener("focus", syncCourses);
    return unsubscribe;
  }, [ready, syncCourses, navigation]);
  const [pickId, setPickId] = useState<string | null>(null);
  const [mins, setMins] = useState(20);
  const [customMins, setCustomMins] = useState("20");
  const [offset, setOffset] = useState(0);
  const [sessionDate, setSessionDate] = useState<Date>(new Date());
  const [sessionTime, setSessionTime] = useState<Date>(() => parseTime(data.prefs.preferredTime));
  const [sessionPicker, setSessionPicker] = useState<"date" | "time" | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const chosen = pickId ?? data.subjects[0]?.id;
  const missed = missedSessions(data);
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(i));
  const upcoming = (d: string) => data.sessions.filter((x) => x.date === d).sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));

  const suggest = () => {
    const plan = generateSchedule(data, 7);
    if (!plan.length) return Alert.alert("Nothing to suggest", data.subjects.length ? "Your next 7 days are already full for your daily study time." : "Wait for your teacher to assign courses.");
    const preview = plan.slice(0, 6).map((p) => `${dayLabel(p.date)} ${fmtTime12(p.time)} · ${subjectName(data, p.subjectId)}${p.topicId ? ` (${topicName(data, p.topicId)})` : ""}, ${p.minutes} min`).join("\n");
    Alert.alert(`Suggested week · ${plan.length} sessions`, `${preview}${plan.length > 6 ? `\n…and ${plan.length - 6} more` : ""}\n\nBased on your exams, weak areas, missed sessions and ${data.prefs.dailyMinutes} min/day.`, [
      { text: "Not now", style: "cancel" }, { text: "Add to planner", onPress: () => applySchedule(plan) },
    ]);
  };


  const Session = ({ x }: { x: PlannedSession }) => (
    <Card style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ flex: 1 }}>
        <Text style={[s.h3, x.status !== "planned" && { opacity: 0.5 }]}>{subjectName(data, x.subjectId)} · {x.minutes} min</Text>
        <Muted>{x.time ? `${fmtTime12(x.time)} · ` : ""}{x.topicId ? `${topicName(data, x.topicId)} · ` : ""}{x.status === "planned" ? "Planned" : x.status === "done" ? "Completed" : "Skipped"}</Muted>
      </View>
      {x.status === "planned" ? (
        <View style={{ gap: 6 }}>
          <View style={s.row}>
            <Chip label="Done" on onPress={() => setSessionStatus(x.id, "done")} />
            <Chip label="Edit date & time" on={false} onPress={() => { setSessionDate(parseDate(x.date)); setSessionTime(parseTime(x.time ?? data.prefs.preferredTime)); setEditingSessionId(x.id); setSessionPicker("date"); }} />
          </View>
          <View style={s.row}>
            <Chip label="Skip" on={false} onPress={() => setSessionStatus(x.id, "skipped")} />
            <Chip label="Remove session" on={false} onPress={() => removeSession(x.id)} />
          </View>
        </View>
      ) : (
        <Chip label="Undo" on={false} onPress={() => setSessionStatus(x.id, "planned")} />
      )}
    </Card>
  );

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }} keyboardShouldPersistTaps="handled">
        <Back onPress={() => navigation.goBack()} />
        <Text style={s.h1}>Study planner</Text>
        <Btn ghost label="Suggest my week" onPress={suggest} disabled={!data.subjects.length} />
        {!!syncError && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{syncError}</Muted>}

        <Label>YOUR COURSES</Label>
        {data.subjects.length === 0 ? (
          <Muted>No courses have been assigned yet. Courses published by your teachers will appear here automatically.</Muted>
        ) : data.subjects.map((x) => (
          <Card key={x.id}>
            <PressableScale onPress={() => navigation.navigate("Subject", { subjectId: x.id })}>
              <Text style={s.h3}>{x.name}</Text>
              {x.examDate && <Muted>{daysUntil(x.examDate) >= 0 ? `Exam in ${daysUntil(x.examDate)} days` : "Exam passed"} · {x.examDate}</Muted>}
              <Muted>{x.courseId ? "Assigned by your teacher · fixed" : "Saved course · fixed"}</Muted>
            </PressableScale>
          </Card>
        ))}

        {missed.length > 0 && (
          <>
            <Label>MISSED</Label>
            {missed.map((x) => (
              <Card key={x.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.emberTint }}>
                <View style={{ flex: 1 }}><Text style={s.h3}>{subjectName(data, x.subjectId)} · {x.minutes} min</Text><Muted>{dayLabel(x.date)}</Muted></View>
                <Chip label="Move to today" on onPress={() => rescheduleSession(x.id, dateStr(), data.prefs.preferredTime)} />
              </Card>
            ))}
          </>
        )}

        {days.map((d) => {
          const list = upcoming(d);
          if (d !== dateStr() && !list.length) return null;
          return (
            <View key={d}>
              <Label>{dayLabel(d).toUpperCase()}</Label>
              {list.length === 0 && <Muted>No sessions planned yet.</Muted>}
              {list.map((x) => <Session key={x.id} x={x} />)}
            </View>
          );
        })}

        {data.subjects.length > 0 && (
          <>
            <Label>ADD A SESSION</Label>
            <View style={s.row}>{days.slice(0, 4).map((d, i) => <Chip key={d} label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayLabel(d).split(",")[0]} on={offset === i} onPress={() => { setOffset(i); setSessionDate(parseDate(d)); }} />)}</View>
            <View style={[s.row, { marginTop: spacing.sm }]}>{data.subjects.map((x) => <Chip key={x.id} label={x.name} on={chosen === x.id} onPress={() => setPickId(x.id)} />)}</View>
            <View style={[s.row, { marginTop: spacing.sm }]}>{MINUTES.map((m) => <Chip key={m} label={`${m} min`} on={mins === m} onPress={() => { setMins(m); setCustomMins(String(m)); }} />)}</View>
            <TextInput style={s.input} value={customMins} onChangeText={setCustomMins} placeholder="Session length in minutes" placeholderTextColor={colors.textFaint} keyboardType="number-pad" />
            <View style={s.row}>
              <Chip label={`Date · ${localDateString(sessionDate)}`} on={false} onPress={() => setSessionPicker("date")} />
              <Chip label={`Time · ${fmtTime12(formatTime(sessionTime))}`} on={false} onPress={() => setSessionPicker("time")} />
            </View>
            {editingSessionId ? (
              <View style={s.row}>
                <Btn label="Save date & time" onPress={() => { rescheduleSession(editingSessionId, localDateString(sessionDate), formatTime(sessionTime)); setEditingSessionId(null); setSessionPicker(null); }} />
                <Btn ghost label="Cancel edit" onPress={() => { setEditingSessionId(null); setSessionPicker(null); }} />
              </View>
            ) : (
              <Btn label="Add session" onPress={() => {
                const duration = Number(customMins);
                if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return Alert.alert("Session length", "Enter a whole number from 1 to 1440 minutes.");
                if (!chosen) return;
                addSession(chosen, duration, localDateString(sessionDate), formatTime(sessionTime));
              }} />
            )}
            {sessionPicker && <>
              <DateTimePicker value={sessionPicker === "date" ? sessionDate : sessionTime} mode={sessionPicker} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(event, value) => {
                if (event.type === "dismissed") { setSessionPicker(null); return; }
                if (value) { if (sessionPicker === "date") setSessionDate(value); else setSessionTime(value); }
                if (Platform.OS !== "ios") setSessionPicker(null);
              }} />
              {Platform.OS === "ios" && <Chip label="Done" on={false} onPress={() => setSessionPicker(null)} />}
            </>}

          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
