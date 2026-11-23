import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, View, Text } from "react-native";
import { colors, spacing } from "../theme/tokens";
import { fetchMyCourses, fetchDailyQuiz, type MyCourse } from "../lib/courseApi";
import { Screen, Grid } from "../components/responsive";
import { Card, Empty, Muted, Tag, YearTag, s, ListSkeleton } from "../components/study/ui";
import CourseThumb from "../components/CourseThumb";
import StaggerIn from "../components/animated/StaggerIn";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/RootNavigator";

type Props = BottomTabScreenProps<MainTabParamList, "Quiz">;

/** Shows a separate daily quiz entry for every course the student can access. */
export default function QuizScreen({ navigation }: Props) {
  const [courses, setCourses] = useState<MyCourse[] | null>(null);
  const [quizAvailability, setQuizAvailability] = useState<Record<string, { questions: number; pending: number }> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setQuizAvailability(null);
    try {
      const myCourses = await fetchMyCourses();
      setCourses(myCourses);
      const availability = await Promise.all(myCourses.map(async (course) => {
        try {
          const daily = await fetchDailyQuiz(course.id);
          return [course.id, { questions: daily.questions.length, pending: daily.pending_total }] as const;
        } catch {
          return [course.id, { questions: 0, pending: 0 }] as const;
        }
      }));
      setQuizAvailability(availability.reduce<Record<string, { questions: number; pending: number }>>((map, [courseId, value]) => {
        map[courseId] = value;
        return map;
      }, {}));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load your course quizzes.");
      setCourses((current) => current ?? []);
      setQuizAvailability((current) => current ?? {});
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = navigation.addListener("focus", load);
    return unsubscribe;
  }, [load, navigation]);

  const openQuiz = (course: MyCourse) => {
    const root = navigation.getParent();
    if (root) root.navigate("CourseDaily", { courseId: course.id, code: course.code });
    else navigation.navigate("CourseDaily" as never, { courseId: course.id, code: course.code } as never);
  };

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.teal} />}>
      <Muted>Choose a course to open its daily quiz. Each course has its own questions, progress and scoring.</Muted>
      {courses !== null && quizAvailability === null && <Card style={{ marginTop: spacing.md }}><Muted>Checking today's quizzes…</Muted></Card>}
      {courses !== null && quizAvailability !== null && (() => {
        const quizCourses = courses.filter((course) => ((quizAvailability[course.id]?.questions ?? 0) + (quizAvailability[course.id]?.pending ?? 0)) > 0);
        const readyCourses = quizCourses.length;
        const readyQuestions = quizCourses.reduce((sum, course) => sum + (quizAvailability[course.id]?.questions ?? 0) + (quizAvailability[course.id]?.pending ?? 0), 0);
        return <Card style={{ marginTop: spacing.md, backgroundColor: colors.tealTint, borderWidth: 0 }}>
          <Text style={[s.h3, { color: colors.teal }]}>{readyCourses} daily {readyCourses === 1 ? "quiz" : "quizzes"} ready today</Text>
          <Muted>{readyQuestions} available {readyQuestions === 1 ? "question" : "questions"} across your courses.</Muted>
        </Card>;
      })()}
      {courses === null && <ListSkeleton rows={4} />}
      {!!error && <Muted style={{ color: colors.danger, marginTop: spacing.md }}>{error}</Muted>}
      {courses?.length === 0 && !error && <Empty icon="📝" title="No courses yet" body="Your department and year courses will appear here. Once a teacher publishes course questions, you can take their daily quizzes here." />}
      {courses !== null && quizAvailability !== null && courses.length > 0 && !courses.some((course) => ((quizAvailability[course.id]?.questions ?? 0) + (quizAvailability[course.id]?.pending ?? 0)) > 0) && !error && (
        <Empty icon="📝" title="No quizzes available yet" body="Courses will appear here when a teacher publishes quiz questions for them." />
      )}
      <Grid>
        {courses?.filter((course) => ((quizAvailability?.[course.id]?.questions ?? 0) + (quizAvailability?.[course.id]?.pending ?? 0)) > 0).map((course, index) => (
          <StaggerIn key={course.id} index={index}>
            <Card onPress={() => openQuiz(course)} style={{ marginTop: spacing.md }}>
              <CourseThumb path={course.thumbnail_path} height={104} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                <Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{course.code}</Text>
                <YearTag year={course.year} />
              </View>
              <Text style={{ color: colors.text, marginTop: 3 }} numberOfLines={2}>{course.title}</Text>
              <Muted style={{ marginTop: 4 }}>{course.department} · {course.teacher_name}</Muted>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md }}>
                <Tag
                  label={`${(quizAvailability?.[course.id]?.questions ?? 0) + (quizAvailability?.[course.id]?.pending ?? 0)} ${((quizAvailability?.[course.id]?.questions ?? 0) + (quizAvailability?.[course.id]?.pending ?? 0)) === 1 ? "question" : "questions"}`}
                  color={colors.teal}
                />
                <Text style={{ color: colors.teal, fontWeight: "700" }}>Start →</Text>
              </View>
            </Card>
          </StaggerIn>
        ))}
      </Grid>
    </Screen>
  );
}
