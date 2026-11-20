import React, { useCallback, useEffect, useState } from "react";
import { View, Text, RefreshControl } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { Bar, Card, Empty, Muted, Tag, YearTag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen } from "../../components/responsive";
import { fetchMyCourses, MyCourse } from "../../lib/courseApi";
import { daysUntil } from "../../lib/studyStore";
import { useApp } from "../../context/AppContext";
import StaggerIn from "../../components/animated/StaggerIn";
import CourseThumb from "../../components/CourseThumb";

/** Home for a student's courses: everything their department + year teaches, with progress per course. */
export default function CoursesScreen({ navigation }: any) {
  const { profile } = useApp();
  const [courses, setCourses] = useState<MyCourse[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCourses(await fetchMyCourses()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load your courses."); setCourses((c) => c ?? []); }
  }, []);
  useEffect(() => { load(); return navigation.addListener("focus", load); }, [load, navigation]);

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={s.h1}>My courses</Text>
      <Muted style={{ marginTop: 4 }}>Your department and year courses appear here automatically. You do not need a course code.</Muted>
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
                <CourseThumb path={c.thumbnail_path} height={110} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
                  <Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{c.code}</Text>
                  <YearTag year={c.year} />
                </View>
                <Text style={{ color: colors.text, marginTop: 2 }} numberOfLines={2}>{c.title}</Text>
                <Muted style={{ marginTop: 4 }}>{c.department} · {c.teacher_name}</Muted>
                {c.shared_with_me && <View style={{ marginTop: 6, flexDirection: "row" }}><Tag label="Shared with you" color={colors.violet} /></View>}
                <View style={{ marginTop: spacing.md }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Muted>{c.topic_count === 0 ? "No topics yet" : done ? "All topics finished" : `${c.topics_done} of ${c.topic_count} topics finished`}</Muted>
                    {done && <Tag label="Tests unlocked" color={colors.success} />}
                  </View>
                  <Bar value={c.topic_count ? c.topics_done / c.topic_count : 0} color={done ? colors.success : colors.teal} />
                </View>
                {c.next_exam ? <Muted style={{ marginTop: 6 }}>Next exam in {Math.max(0, daysUntil(c.next_exam))} days</Muted> : null}
              </Card>
            </StaggerIn>
          );
        })}
      </Grid>


    </Screen>
  );
}
