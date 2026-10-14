import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, RefreshControl } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import { Btn, Card, Chip, Empty, Field, Label, Muted, Tag, YearTag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen, ChipRow } from "../../components/responsive";
import { fetchMyGroups, StudyGroup } from "../../lib/groupApi";
import { createYearGroup } from "../../lib/socialApi";
import { fetchMyTeachingDepartments } from "../../lib/supportApi";

const ALL_YEARS = [1, 2, 3, 4, 5];

/** Teachers run class study groups for their department and year; every student in that year is added automatically. */
export default function TeacherGroupsScreen({ navigation }: any) {
  const { profile } = useApp();
  const years = profile?.teaching_years?.length ? profile.teaching_years : ALL_YEARS;
  const [groups, setGroups] = useState<StudyGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(""), [desc, setDesc] = useState("");
  const [year, setYear] = useState<number | null>(years.length === 1 ? years[0] : null);
  const [myDepts, setMyDepts] = useState<{ id: string; name: string }[]>([]);
  const [deptId, setDeptId] = useState<string | null>(profile?.department_id ?? null);
  useEffect(() => { fetchMyTeachingDepartments().then((d) => { setMyDepts(d); setDeptId((cur) => cur ?? d[0]?.id ?? null); }).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setGroups(await fetchMyGroups()); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load groups."); setGroups((g) => g ?? []); }
  }, []);
  useEffect(() => { load(); return navigation.addListener("focus", load); }, [load, navigation]);

  const create = async () => {
    if (busy || year == null || !deptId) return;
    setBusy(true);
    try {
      const g = await createYearGroup(deptId, name, desc, year);
      setName(""); setDesc(""); await load();
      Alert.alert("Class group created", `${g.students_added} ${myDepts.find((d) => d.id === deptId)?.name ?? profile?.department ?? ""} Year ${year} student${g.students_added === 1 ? " was" : "s were"} added. New students in this year join automatically when they sign up.`, [{ text: "Open", onPress: () => navigation.navigate("Group", { groupId: g.id }) }, { text: "OK" }]);
    } catch (e: any) { Alert.alert("Couldn't create group", e?.message ?? "Try again."); } finally { setBusy(false); }
  };

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={s.h1}>Class groups</Text>
      <Muted>{profile?.department} · chat, discussions and quizzes with your students</Muted>
      {groups === null && <ListSkeleton />}
      {error && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{error}</Muted>}
      {groups?.length === 0 && !error && <Empty icon="👥" title="No class groups yet" body="Create one for a year you teach. Every student in that year joins immediately." />}
      <Grid>
        {groups?.map((g) => (
          <Card key={g.id} style={{ marginTop: spacing.sm }} onPress={() => navigation.navigate("Group", { groupId: g.id })}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
              <Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{g.name}</Text>
              {g.year ? <YearTag year={g.year} /> : null}
            </View>
            <Muted>{g.member_count} member{g.member_count === 1 ? "" : "s"}{g.official ? "" : " · personal group"}</Muted>
            <View style={[s.row, { marginTop: spacing.sm }]}><Tag label="💬 Chat" color={colors.tealDeep} /><Tag label="👥 Members" color={colors.violet} /></View>
          </Card>
        ))}
      </Grid>

      <View style={{ maxWidth: 560 }}>
        <Label>NEW CLASS GROUP</Label>
        <Field label="Group name" value={name} onChangeText={setName} placeholder="e.g. Physics Year 1 class" />
        <Field label="Description (optional)" value={desc} onChangeText={setDesc} placeholder="What is this group for?" />
        {myDepts.length > 1 && (<><Muted style={{ marginTop: spacing.md, fontWeight: "600" }}>Department</Muted><ChipRow>{myDepts.map((d) => <Chip key={d.id} label={d.name} on={deptId === d.id} onPress={() => setDeptId(d.id)} />)}</ChipRow></>)}
        <Muted style={{ marginTop: spacing.md, fontWeight: "600" }}>Year / level</Muted>
        <ChipRow>{years.map((y) => <Chip key={y} label={`Year ${y}`} on={year === y} onPress={() => setYear(y)} />)}</ChipRow>
        <Btn label={busy ? "Creating…" : "Create class group"} onPress={create} disabled={busy || name.trim().length < 2 || year == null || !deptId} />
      </View>
    </Screen>
  );
}
