import React from "react";
import { Text, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { spacing, colors } from "../../theme/tokens";
import { Back, Card, Muted, Tag, s } from "../../components/study/ui";
import { WRAP } from "../../components/responsive";
import useSocialNotifications from "../../hooks/useSocialNotifications";

export default function CommunityScreen({ navigation }: any) {
  const { requestCount, unreadMessageCount } = useSocialNotifications();

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
        <Muted style={{ marginTop: 4 }}>Study with your classmates and keep up with your courses.</Muted>
        <Card style={{ backgroundColor: colors.violetTint, borderWidth: 0 }} onPress={() => navigation.navigate("Groups")}>
          <Text style={s.h3}>Study groups</Text>
          <Muted>Discussions, questions, shared resources, and focus-time challenges with friends.</Muted>
        </Card>
        {socialCard("Friend requests", "See who wants to connect with you.", requestCount, "Requests", "👋")}
        {socialCard("Chats", "Continue conversations and see unread messages.", unreadMessageCount, "Chats", "💬")}
        <Card onPress={() => navigation.navigate("Friends", { initialTab: "Friends" })} style={{ marginTop: spacing.md }}>
          <Text style={s.h3}>Friends</Text>
          <Muted>View your friends and start a conversation.</Muted>
        </Card>
        <Card onPress={() => navigation.navigate("Feed")} style={{ marginTop: spacing.md }}>
          <Text style={s.h3}>Department feed</Text>
          <Muted>Posts from your department and campus.</Muted>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
