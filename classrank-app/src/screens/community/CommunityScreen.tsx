import React, { useCallback, useEffect, useState } from "react";
import { Text, ScrollView, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { spacing, colors } from "../../theme/tokens";
import { Back, Card, Muted, Tag, s } from "../../components/study/ui";
import { WRAP } from "../../components/responsive";
import useSocialNotifications from "../../hooks/useSocialNotifications";
import { fetchMyGroups, StudyGroup } from "../../lib/groupApi";

export default function CommunityScreen({ navigation }: any) {
  const { requestCount, unreadMessageCount, groupWelcomeCount } = useSocialNotifications();
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try { setGroups(await fetchMyGroups()); setGroupsError(null); }
    catch (e: any) { setGroupsError(e?.message ?? "Couldn't load your group chats."); }
    finally { setGroupsLoading(false); }
  }, []);
  useEffect(() => {
    loadGroups();
    return navigation.addListener("focus", loadGroups);
  }, [navigation, loadGroups]);

  const socialCard = (title: string, description: string, count: number, initialTab: "Requests" | "Chats", icon: string) => (
    <Card onPress={() => navigation.navigate("Friends", { initialTab })} style={{ marginTop: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={s.h3}>{icon}  {title}</Text>
          <Muted>{description}</Muted>
        </View>
        {count > 0 && <Tag label={count > 99 ? "99+" : String(count)} color={colors.danger} />}
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }}>
        <Back onPress={() => navigation.goBack()} />
        <Text style={s.h1}>Community</Text>
        <Muted style={{ marginTop: 4 }}>Your place for group conversations, private chats, friends and campus updates.</Muted>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl }}>
          <Text style={s.h3}>GROUP CHATS</Text>
          {groupWelcomeCount > 0 && <Tag label={groupWelcomeCount > 99 ? "99+" : String(groupWelcomeCount)} color={colors.danger} />}
        </View>
        {groupsLoading ? <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.teal} /> : groupsError ? (
          <Card style={{ marginTop: spacing.md }}>
            <Text style={[s.h3, { color: colors.danger }]}>Could not load Community groups</Text>
            <Muted>{groupsError}</Muted>
            <Text onPress={() => { void loadGroups(); }} style={{ color: colors.tealDeep, fontWeight: "800", marginTop: 12 }}>Try again</Text>
          </Card>
        ) : groups.length === 0 ? (
          <Card style={{ marginTop: spacing.md }}>
            <Text style={s.h3}>No group chats yet</Text>
            <Muted>Your official department group will appear here when your teacher creates it.</Muted>
          </Card>
        ) : groups.map((group) => (
          <Card key={group.id} onPress={() => navigation.navigate("GroupChat", { groupId: group.id, name: group.name })} style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={s.h3}>{group.name}</Text>
                <Muted>{group.official ? "Official class group" + (group.year ? " · Year " + group.year : "") : "Study group"} · {group.member_count} members</Muted>
              </View>
              {group.official && <Tag label="Official" color={colors.violet} />}
            </View>
            <Muted style={{ color: colors.tealDeep, marginTop: 8, fontWeight: "700" }}>Open group chat →</Muted>
          </Card>
        ))}
        <Card onPress={() => navigation.navigate("Groups")} style={{ marginTop: spacing.md, backgroundColor: colors.violetTint, borderWidth: 0 }}>
          <Text style={s.h3}>Browse and manage study groups</Text>
          <Muted>Find groups, join with a code, and see all your group spaces.</Muted>
        </Card>

        <Text style={[s.h3, { marginTop: spacing.xl }]}>PRIVATE CHATS</Text>
        {socialCard("Your chats", "Open private conversations with your friends.", unreadMessageCount, "Chats", "💬")}
        {socialCard("Friend requests", "See who wants to connect with you.", requestCount, "Requests", "👋")}
        <Card onPress={() => navigation.navigate("Friends", { initialTab: "Friends" })} style={{ marginTop: spacing.md }}>
          <Text style={s.h3}>Friends</Text>
          <Muted>View your friends and start a private conversation.</Muted>
        </Card>
        <Card onPress={() => navigation.navigate("Feed")} style={{ marginTop: spacing.md }}>
          <Text style={s.h3}>Department feed</Text>
          <Muted>Posts from your department and campus.</Muted>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
