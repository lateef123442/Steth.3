import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, RefreshControl } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { Bar, Btn, Card, Empty, Field, Label, Muted, Tag, YearTag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen } from "../../components/responsive";
import { fetchMyCourses, joinCourse, MyCourse } from "../../lib/courseApi";
import { daysUntil } from "../../lib/studyStore";
import { useApp } from "../../context/AppContext";
import StaggerIn from "../../components/animated/StaggerIn";

/** Home for a student's courses: everything their department + year teaches, with progress per course. */
export default function CoursesScreen({ navigation }: any) {
  const { profile } = useApp();
  const [courses, setCourses] = useState<MyCourse[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCourses(await fetchMyCourses()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load your courses."); setCourses((c) => c ?? []); }
  }, []);
  useEffect(() => { load(); return navigation.addListener("focus", load); }, [load, navigation]);

  const join = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const j = await joinCourse(code);
      setCode(""); setShowJoin(false); await load();
      Alert.alert(`Added ${j.code}`, "This course is now in your list.", [{ text: "Open", onPress: () => navigation.navigate("Course", { courseId: j.course_id }) }, { text: "OK" }]);
    } catch (e: any) { Alert.alert("Couldn't join", e?.message ?? "Check the code and try again."); } finally { setBusy(false); }
  };

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={s.h1}>My courses</Text>
      {!!profile?.department && <Muted>{profile.department}{profile.year ? ` · Year ${profile.year}` : ""}</Muted>}

      {courses === null && <ListSkeleton rows={4} />}
      {error && <Muted style={{ marginTop: spacing.sm, color: colors.danger }}>{error}</Muted>}
      {courses?.length === 0 && !error && (
        <Empty icon="🎓" title="No courses for your year yet" body={`When a teacher creates a course for ${profile?.department ?? "your department"}${profile?.year ? ` Year ${profile.year}` : ""}, it shows up here automatically.`} />
      )}

      <Grid>
        {courses?.map((c, i) => {
          const done = c.topic_count > 0 && c.topics_done >= c.topic_count;
          return (
            <StaggerIn key={c.id} index={i}>
              <Card onPress={() => navigation.navigate("Course", { courseId: c.id })} style={{ marginTop: spacing.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
                  <Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{c.code}</Text>
                  <YearTag year={c.year} />
                </View>
                <Text style={{ color: colors.text, marginTop: 2 }} numberOfLines={2}>{c.title}</Text>
                <Muted style={{ marginTop: 4 }}>{c.department} · {c.teacher_name}</Muted>
                <View style={{ marginTop: spacing.md }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Muted>{c.topic_count === 0 ? "No topics yet" : done ? "All topics finished" : `${c.topics_done} of ${c.topic_count} topics finished`}</Muted>
                    {done && <Tag label="Tests unlocked" color={colors.success} />}
                  </View>
                  <Bar value={c.topic_count ? c.topics_done / c.topic_count : 0} color={done ? colors.success : colors.teal} />
                </View>
                {c.next_exam ? <Muted style={{ marginTop: 6 }}>📝 Next exam in {Math.max(0, daysUntil(c.next_exam))} days</Muted> : null}
              </Card>
            </StaggerIn>
          );
        })}
      </Grid>

      <View style={{ maxWidth: 560 }}>
        <Label>COURSE FROM ANOTHER DEPARTMENT OR YEAR?</Label>
        {!showJoin ? <Btn ghost label="Join with a code" onPress={() => setShowJoin(true)} /> : (
          <>
            <Field value={code} onChangeText={setCode} placeholder="Course code from the teacher" autoCapitalize="characters" autoCorrect={false} />
            <Muted style={{ marginTop: 6 }}>Your answers to its practice questions are shared with the teacher as class statistics.</Muted>
            <Btn label={busy ? "Joining…" : "Join course"} onPress={join} disabled={busy || !code.trim()} />
          </>
        )}
      </View>
    </Screen>
  );
}
