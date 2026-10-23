import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, RefreshControl } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import { Btn, Card, Chip, Empty, Field, Label, Muted, Tag, YearTag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen, ChipRow } from "../../components/responsive";
import { fetchStaffCourses, createCourse, StaffCourse } from "../../lib/courseApi";
import { fetchMyTeachingDepartments } from "../../lib/supportApi";
import CourseThumb from "../../components/CourseThumb";

const ALL_YEARS = [1, 2, 3, 4, 5];

/** Teachers see their own courses; admins see every course. A course always belongs to one department AND one year. */
export default function TeacherCoursesScreen({ navigation }: any) {
  const { profile } = useApp();
  const isAdmin = profile?.role === "admin";
  const myYears = profile?.teaching_years?.length ? profile.teaching_years : ALL_YEARS;
  const [courses, setCourses] = useState<StaffCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(""), [title, setTitle] = useState("");
  const [year, setYear] = useState<number | null>(myYears.length === 1 ? myYears[0] : null);
  const [myDepts, setMyDepts] = useState<{ id: string; name: string }[]>([]);
  const [deptId, setDeptId] = useState<string | null>(profile?.department_id ?? null);
  useEffect(() => { fetchMyTeachingDepartments().then((d) => { setMyDepts(d); setDeptId((cur) => cur ?? d[0]?.id ?? null); }).catch(() => {}); }, []);
  const [filter, setFilter] = useState<number | "all">("all");
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setCourses(await fetchStaffCourses()); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load courses."); setCourses((c) => c ?? []); }
  }, []);
  useEffect(() => { load(); return navigation.addListener("focus", load); }, [load, navigation]);

  const create = async () => {
    if (!deptId || busy || year == null) return;
    setBusy(true);
    try {
      const c = await createCourse(deptId, code, title, year);
      setCode(""); setTitle(""); await load();
      Alert.alert("Course created", `Every ${myDepts.find((d) => d.id === deptId)?.name ?? profile?.department ?? ""} Year ${year} student will see it automatically. Add topics and resources next.`, [{ text: "Open course", onPress: () => navigation.navigate("TeacherCourse", { courseId: c.id }) }]);
    } catch (e: any) { Alert.alert("Couldn't create course", e?.message ?? "Try again."); } finally { setBusy(false); }
  };

  const years = Array.from(new Set((courses ?? []).map((c) => c.year))).sort();
  const shown = (courses ?? []).filter((c) => filter === "all" || c.year === filter);

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={s.h1}>{isAdmin ? "All courses" : "My courses"}</Text>
      {!isAdmin && !!profile?.department && <Muted>{profile.department} · {profile.teaching_years?.length ? `Year ${profile.teaching_years.join(", ")}` : "all years"}</Muted>}

      {years.length > 1 && (
        <ChipRow>
          <Chip label="All years" on={filter === "all"} onPress={() => setFilter("all")} />
          {years.map((y) => <Chip key={y} label={`Year ${y}`} on={filter === y} onPress={() => setFilter(y)} />)}
        </ChipRow>
      )}

      {courses === null && <ListSkeleton />}
      {error && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{error}</Muted>}
      {courses?.length === 0 && !error && <Empty icon="🎓" title="No courses yet" body={isAdmin ? "Courses created by teachers appear here." : "Create your first course below. Students in your department and year will see it right away."} />}

      <Grid>
        {shown.map((c) => (
          <Card key={c.id} style={{ marginTop: spacing.sm }} onPress={() => navigation.navigate("TeacherCourse", { courseId: c.id })}>
            <CourseThumb path={c.thumbnail_path} height={90} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
              <Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{c.code}</Text>
              <YearTag year={c.year} />
            </View>
            <Text style={{ color: colors.text, marginTop: 2 }} numberOfLines={2}>{c.title}</Text>
            <View style={[s.row, { marginTop: spacing.sm }]}>
              <Tag label={`${c.topic_count} topics`} color={colors.tealDeep} />
              <Tag label={`${c.material_count} resources`} color={colors.violet} />
              <Tag label={`${c.member_count} students`} color={colors.ember} />
              {!!c.share_count && <Tag label={`Shared · ${c.share_count}`} color={colors.tealDeep} />}
            </View>
            <Muted style={{ marginTop: 6 }}>{c.department}{isAdmin ? ` · ${c.teacher_name}` : ""}</Muted>
          </Card>
        ))}
      </Grid>

      {!!deptId && (
        <View style={{ maxWidth: 560 }}>
          <Label>NEW COURSE</Label>
          {myDepts.length > 1 ? (
            <>
              <Muted style={{ fontWeight: "600", marginTop: spacing.sm }}>Department</Muted>
              <ChipRow>{myDepts.map((d) => <Chip key={d.id} label={d.name} on={deptId === d.id} onPress={() => setDeptId(d.id)} />)}</ChipRow>
            </>
          ) : <Muted>Department: {myDepts[0]?.name ?? profile?.department}</Muted>}
          <Field label="Course code" value={code} onChangeText={setCode} placeholder="e.g. PHY101" autoCapitalize="characters" />
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. General Physics I" />
          <Muted style={{ marginTop: spacing.md, fontWeight: "600" }}>Year / level</Muted>
          <ChipRow>{myYears.map((y) => <Chip key={y} label={`Year ${y}`} on={year === y} onPress={() => setYear(y)} />)}</ChipRow>
          {!isAdmin && !!profile?.teaching_years?.length && <Muted>You can only create courses for the years an admin assigned to you.</Muted>}
          <Btn label={busy ? "Creating…" : "Create course"} onPress={create} disabled={busy || code.trim().length < 2 || title.trim().length < 2 || year == null} />
        </View>
      )}
    </Screen>
  );
}
