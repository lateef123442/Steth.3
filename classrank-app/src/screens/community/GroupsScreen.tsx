import React, { useCallback, useEffect, useState } from "react";
import { Text, ScrollView, TextInput, Alert, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../../theme/tokens";
import { Back, Card, Chip, Label, Muted, s, ListSkeleton } from "../../components/study/ui";
import { fetchMyGroups, StudyGroup } from "../../lib/groupApi";
import Avatar from "../../components/Avatar";
import { requestGroupJoin } from "../../lib/groupQuestions";
import { fetchUnreadJoinedMemberCounts } from "../../lib/groupQuestions";
import StaggerIn from "../../components/animated/StaggerIn";
import { WRAP } from "../../components/responsive";
import useGroupUnreadCounts from "../../hooks/useGroupUnreadCounts";

export default function GroupsScreen({ navigation }: any) {
  const [groups, setGroups] = useState<StudyGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinedCounts, setJoinedCounts] = useState<Record<string, number>>({});
  const groupUnreadCounts = useGroupUnreadCounts();

  const load = useCallback(async () => {
    try {
      const nextGroups = await fetchMyGroups(); setGroups(nextGroups); setError(null);
      const counts = await fetchUnreadJoinedMemberCounts().catch(() => ({}));
      setJoinedCounts(counts);
    } catch (e: any) { setError(e?.message ?? "Couldn't load your groups."); setGroups((g) => g ?? []); }
  }, []);
  useEffect(() => { load(); return navigation.addListener("focus", load); }, [load, navigation]);

  const run = async (fn: () => Promise<void>, fail: string) => { if (busy) return; setBusy(true); try { await fn(); } catch (e: any) { Alert.alert(fail, e?.message ?? "Try again."); } finally { setBusy(false); } };
  const join = () => run(async () => {
    const result = await requestGroupJoin(code);
    setCode(""); await load();
    if (result.status === "member" && result.group_id) navigation.navigate("GroupChat", { groupId: result.group_id, name: result.name ?? "Study group" });
    else Alert.alert("Request sent", "Your request to join " + result.name + " is waiting for the group owner or an appointed admin to approve it.");
  }, "Couldn't join");

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }} keyboardShouldPersistTaps="handled">
        <Back onPress={() => navigation.goBack()} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
          <Text style={[s.h1, { flex: 1 }]}>Study groups</Text>
          <Pressable onPress={() => navigation.navigate("GroupCreate")} accessibilityRole="button" accessibilityLabel="Create a new study group" style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.teal, borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", lineHeight: 22 }}>＋</Text>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Create</Text>
          </Pressable>
        </View>
        {groups === null && <ListSkeleton />}
        {error && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{error}</Muted>}
        {groups?.length === 0 && !error && <Muted style={{ marginTop: spacing.sm }}>No groups yet. Start one or join with a friend's code.</Muted>}
        {groups?.map((g, i) => (
          <StaggerIn key={g.id} index={i}><Card style={{ marginTop: spacing.sm }} onPress={() => navigation.navigate("GroupChat", { groupId: g.id, name: g.name })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Avatar name={g.name} path={g.group_avatar_path} size={48} bucket="group-avatars" />
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                {groupUnreadCounts[g.id] > 0 && <View accessibilityLabel={`${groupUnreadCounts[g.id]} unread messages in ${g.name}`} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} />}
                <Text style={[s.h3, { flex: 1 }]}>{g.official ? "Official · " : ""}{g.name}</Text>
              </View>
              {groupUnreadCounts[g.id] > 0 && <View style={{ minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{groupUnreadCounts[g.id] > 99 ? "99+" : groupUnreadCounts[g.id]}</Text></View>}
              {!!joinedCounts[g.id] && <View style={{ minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{joinedCounts[g.id] > 99 ? "99+" : joinedCounts[g.id]}</Text></View>}
            </View>
            <Muted>{g.official ? `Class group${g.year ? ` · Year ${g.year}` : ""}${g.owner_name ? ` · ${g.owner_name}` : ""} · ` : ""}{g.member_count} member{g.member_count === 1 ? "" : "s"} · Open group chat →</Muted>
          </Card></StaggerIn>
        ))}

        <Label>JOIN WITH A CODE</Label>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <TextInput style={[s.input, { flex: 1 }]} value={code} onChangeText={setCode} placeholder="Group code" placeholderTextColor={colors.textFaint} autoCapitalize="characters" autoCorrect={false} />
          <Chip label="Join" on onPress={join} />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
