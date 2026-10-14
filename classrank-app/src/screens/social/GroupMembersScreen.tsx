import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Alert } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { Back, Btn, Card, Chip, Field, Label, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen } from "../../components/responsive";
import Avatar from "../../components/Avatar";
import { fetchGroupMembers, addGroupMember, searchPeople, GroupMember, PersonResult } from "../../lib/socialApi";

/** Members of a study group, and a search to bring in fellow students (friends, or classmates of your department and year). */
export default function GroupMembersScreen({ navigation, route }: any) {
  const { groupId, name } = route.params as { groupId: string; name: string };
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => { try { setMembers(await fetchGroupMembers(groupId)); } catch (e: any) { Alert.alert("Couldn't load members", e?.message ?? "Try again."); setMembers([]); } }, [groupId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(() => { searchPeople(q).then(setResults).catch(() => setResults([])); }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const ids = new Set((members ?? []).map((m) => m.id));
  const add = async (p: PersonResult) => {
    try { await addGroupMember(groupId, p.id); setAdded((a) => new Set(a).add(p.id)); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message ?? "Try again."); }
  };

  return (
    <Screen wide>
      <Back onPress={() => navigation.goBack()} />
      <Text style={s.h1}>{name}</Text>
      <Muted>{members ? `${members.length} members` : ""}</Muted>

      <Label>ADD A FELLOW STUDENT</Label>
      <View style={{ maxWidth: 560 }}>
        <Field value={q} onChangeText={setQ} placeholder="Search by name" autoCapitalize="none" autoCorrect={false} />
        <Muted style={{ marginTop: 4 }}>You can add friends and students from your own department and year.</Muted>
      </View>
      <Grid max={2}>
        {results?.map((p) => (
          <Card key={p.id} style={{ marginTop: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Avatar name={p.name} path={p.avatar_path} />
              <View style={{ flex: 1 }}><Text style={s.h3} numberOfLines={1}>{p.name}</Text><Muted numberOfLines={1}>{[p.department, p.year ? `Year ${p.year}` : null].filter(Boolean).join(" · ")}</Muted></View>
              {ids.has(p.id) || added.has(p.id) ? <Tag label="In group" color={colors.success} /> : <Chip label="＋ Add" on onPress={() => add(p)} />}
            </View>
          </Card>
        ))}
      </Grid>

      <Label>MEMBERS</Label>
      {members === null && <ListSkeleton />}
      <Grid max={2}>
        {members?.map((m) => (
          <Card key={m.id} style={{ marginTop: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Avatar name={m.name} path={m.avatar_path} />
              <View style={{ flex: 1 }}><Text style={s.h3} numberOfLines={1}>{m.name}</Text><Muted numberOfLines={1}>{m.role === "teacher" ? "Teacher" : [m.department, m.year ? `Year ${m.year}` : null].filter(Boolean).join(" · ")}</Muted></View>
              {m.is_owner && <Tag label={m.role === "teacher" ? "Teacher" : "Owner"} color={colors.violet} />}
            </View>
          </Card>
        ))}
      </Grid>
    </Screen>
  );
}
