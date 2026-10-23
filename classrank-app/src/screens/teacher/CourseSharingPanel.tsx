import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import PressableScale from "../../components/animated/PressableScale";
import Dropdown from "../../components/Dropdown";
import { Btn, Card, Chip, Label, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { ChipRow } from "../../components/responsive";
import { CourseShare, fetchCourseShares, saveCourseShares } from "../../lib/courseApi";

interface Props {
  courseId: string;
  courseCode: string;
  homeDepartment?: string;
  homeYear?: number | null;
}

const audienceLabel = (year: number | null) => (year == null ? "All years" : `Year ${year}`);
const sameAudience = (a: CourseShare, b: CourseShare) => a.department_id === b.department_id && a.year === b.year;
const fingerprint = (list: CourseShare[]) => list.map((x) => `${x.department_id}:${x.year ?? "all"}`).sort().join("|");

/** The teacher who owns a course (or an admin) chooses which OTHER departments and years may also view it. */
export default function CourseSharingPanel({ courseId, courseCode, homeDepartment, homeYear }: Props) {
  const { departments, years } = useApp();
  const [shares, setShares] = useState<CourseShare[] | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [yearPick, setYearPick] = useState<number | "all">("all");
  const [busy, setBusy] = useState(false);

  const deptOptions = useMemo(() => departments.map((d) => ({ value: d.id, label: d.name })), [departments]);
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? "Department";

  useEffect(() => {
    let alive = true;
    fetchCourseShares(courseId)
      .then((list) => { if (alive) { setShares(list); setSaved(fingerprint(list)); setError(null); } })
      .catch((e: any) => { if (alive) { setError(e?.message ?? "Couldn't load sharing."); setShares([]); } });
    return () => { alive = false; };
  }, [courseId]);

  const dirty = shares !== null && fingerprint(shares) !== saved;

  const add = () => {
    if (!deptId || !shares) return;
    const entry: CourseShare = { department_id: deptId, department: deptName(deptId), year: yearPick === "all" ? null : yearPick };
    if (shares.some((x) => sameAudience(x, entry))) { Alert.alert("Already added", `${entry.department} · ${audienceLabel(entry.year)} is already in the list.`); return; }
    // "All years" of a department already covers its individual years, so drop those to keep the list tidy.
    const next = entry.year == null ? shares.filter((x) => x.department_id !== deptId) : shares.filter((x) => !(x.department_id === deptId && x.year == null));
    if (entry.year != null && shares.some((x) => x.department_id === deptId && x.year == null)) {
      Alert.alert("Already covered", `${entry.department} is already shared with all years.`);
      return;
    }
    setShares([...next, entry]);
    setDeptId(null);
    setYearPick("all");
  };

  const remove = (target: CourseShare) => setShares((cur) => (cur ?? []).filter((x) => !sameAudience(x, target)));

  const save = async () => {
    if (!shares || busy) return;
    setBusy(true);
    try {
      await saveCourseShares(courseId, shares.map((x) => ({ department_id: x.department_id, year: x.year })));
      const fresh = await fetchCourseShares(courseId);
      setShares(fresh); setSaved(fingerprint(fresh));
      Alert.alert("Sharing saved", fresh.length ? `Students in the selected departments can now view ${courseCode}.` : `${courseCode} is visible to its own department and year only.`);
    } catch (e: any) {
      Alert.alert("Couldn't save sharing", e?.message ?? "Try again.");
    } finally { setBusy(false); }
  };

  if (shares === null) return <ListSkeleton rows={2} />;

  return (
    <>
      <Text style={s.h2}>Share this course</Text>
      <Muted style={{ marginTop: 2 }}>
        Students in your own department and year always see {courseCode}. Add other departments or years below if they should be able to view it too. They get the topics, daily quiz, tests and exams, just like your own students.
      </Muted>
      {!!error && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{error}</Muted>}

      <Label>ALWAYS VISIBLE TO</Label>
      <Card>
        <Text style={s.h3}>{homeDepartment ?? "Your department"}</Text>
        <Muted>{homeYear != null ? `Year ${homeYear}` : "Its own year"}</Muted>
      </Card>

      <Label>ALSO SHARED WITH</Label>
      {shares.length === 0 && <Muted>Not shared with anyone else yet.</Muted>}
      {shares.map((x) => (
        <Card key={`${x.department_id}:${x.year ?? "all"}`} style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={s.h3}>{x.department ?? deptName(x.department_id)}</Text>
            <View style={{ marginTop: 4, flexDirection: "row" }}><Tag label={audienceLabel(x.year)} color={colors.violet} /></View>
          </View>
          <PressableScale onPress={() => remove(x)} style={{ padding: spacing.sm }} accessibilityRole="button" accessibilityLabel={`Remove ${x.department ?? "department"}`}>
            <Text style={[s.muted, { color: colors.danger, fontWeight: "700" }]}>Remove</Text>
          </PressableScale>
        </Card>
      ))}

      <Label>ADD A DEPARTMENT</Label>
      <Dropdown value={deptId} options={deptOptions} onSelect={setDeptId} placeholder="Choose a department" title="Share with department" searchable />
      <Muted style={{ marginTop: spacing.md, fontWeight: "600" }}>Which year?</Muted>
      <ChipRow>
        <Chip label="All years" on={yearPick === "all"} onPress={() => setYearPick("all")} />
        {years.map((y) => <Chip key={y} label={`Year ${y}`} on={yearPick === y} onPress={() => setYearPick(y)} />)}
      </ChipRow>
      <Btn ghost label="+ Add to list" onPress={add} disabled={!deptId} />

      <Btn label={busy ? "Saving…" : dirty ? "Save sharing" : "Saved"} onPress={save} disabled={busy || !dirty} />
      {dirty && <Muted style={{ marginTop: 6 }}>You have changes that are not saved yet.</Muted>}
    </>
  );
}
