import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Alert, RefreshControl } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import { Btn, Card, Chip, Empty, Field, Muted, Tag, s } from "../../components/study/ui";
import { Back } from "../../components/study/ui";
import { Grid, Screen, ChipRow } from "../../components/responsive";
import Avatar from "../../components/Avatar";
import PressableScale from "../../components/animated/PressableScale";
import {
  fetchFriends, fetchConversations, fetchBlocks, unblockUser, subscribeFriendships, searchPeople, sendFriendRequest, respondFriendRequest, removeFriend, subscribeDirect,
  Friends, Conversation, Person, PersonResult,
} from "../../lib/socialApi";

type Tab = "Chats" | "Friends" | "Requests" | "Find people" | "Blocked";
const sub = (p: { department: string | null; year: number | null }) => [p.department, p.year ? `Year ${p.year}` : null].filter(Boolean).join(" · ");
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

/** Chats, friends, requests and a people search that shows each person's name, department and year before you add them. */
export default function FriendsScreen({ navigation }: any) {
  const { profile } = useApp();
  const [tab, setTab] = useState<Tab>("Chats");
  const [friends, setFriends] = useState<Friends | null>(null);
  const [chats, setChats] = useState<Conversation[] | null>(null);
  const [blocks, setBlocks] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [searching, setSearching] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try { const [f, c, b] = await Promise.all([fetchFriends(), fetchConversations(), fetchBlocks().catch(() => [] as Person[])]); setFriends(f); setChats(c); setBlocks(b); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load your friends."); setFriends((f) => f ?? { friends: [], incoming: [], outgoing: [] }); setChats((c) => c ?? []); }
  }, []);
  useEffect(() => { load(); return navigation.addListener("focus", load); }, [load, navigation]);
  // a new message anywhere refreshes the chat list live
  useEffect(() => (profile ? subscribeDirect(profile.id, () => { fetchConversations().then(setChats).catch(() => {}); }, () => { fetchConversations().then(setChats).catch(() => {}); }) : undefined), [profile]);

  // requests, acceptances and removals show up live
  useEffect(() => (profile ? subscribeFriendships(profile.id, () => { load(); }, () => { load(); }) : undefined), [profile, load]);

  // search as you type (debounced)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchPeople(q)); } catch (e: any) { Alert.alert("Search failed", e?.message ?? "Try again."); } finally { setSearching(false); }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const act = async (fn: () => Promise<unknown>, fail: string) => { try { await fn(); await load(); if (q.trim().length >= 2) setResults(await searchPeople(q)); } catch (e: any) { Alert.alert(fail, e?.message ?? "Try again."); } };
  const open = (p: Person) => navigation.navigate("Chat", { userId: p.id, name: p.name, department: p.department, year: p.year, avatar_path: p.avatar_path });
  const unread = (chats ?? []).reduce((n, c) => n + c.unread, 0);
  const requests = friends?.incoming.length ?? 0;

  const personRow = (p: Person, right: React.ReactNode, onPress?: () => void) => (
    <Card key={p.id} onPress={onPress} style={{ marginTop: spacing.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Avatar name={p.name} path={p.avatar_path} />
        <View style={{ flex: 1 }}><Text style={s.h3} numberOfLines={1}>{p.name}</Text><Muted numberOfLines={1}>{sub(p) || "Student"}</Muted></View>
        {right}
      </View>
    </Card>
  );

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Back onPress={() => navigation.goBack()} />
      <Text style={s.h1}>Friends & chats</Text>
      <ChipRow>
        {(["Chats", "Friends", "Requests", "Find people", "Blocked"] as Tab[]).map((t) => (
          <Chip key={t} label={t === "Chats" && unread ? `Chats (${unread})` : t === "Requests" && requests ? `Requests (${requests})` : t} on={tab === t} onPress={() => setTab(t)} />
        ))}
      </ChipRow>
      {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

      {tab === "Chats" && (
        <>
          {chats?.length === 0 && <Empty icon="💬" title="No chats yet" body="Add a friend, then tap their name to start chatting." action={{ label: "Find people", onPress: () => setTab("Find people") }} />}
          <Grid max={2}>
            {chats?.map((c) => personRow(c, (
              <View style={{ alignItems: "flex-end", gap: 4 }}><Muted>{ago(c.last_at)}</Muted>{c.unread > 0 && <Tag label={`${c.unread} new`} color={colors.teal} />}</View>
            ), () => open(c)))}
          </Grid>
        </>
      )}

      {tab === "Friends" && (
        <>
          {friends?.friends.length === 0 && <Empty icon="🤝" title="No friends yet" body="Search for classmates by name and send a request." action={{ label: "Find people", onPress: () => setTab("Find people") }} />}
          <Grid max={2}>
            {friends?.friends.map((p) => personRow(p, (
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Chip label="Message" on onPress={() => open(p)} />
                <PressableScale onPress={() => Alert.alert(`Remove ${p.name}?`, "You won't be able to message each other until you add each other again.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => act(() => removeFriend(p.id), "Couldn't remove") }])} style={{ padding: spacing.sm }}><Text style={s.muted}>✕</Text></PressableScale>
              </View>
            ), () => open(p)))}
          </Grid>
        </>
      )}

      {tab === "Requests" && (
        <>
          {friends && friends.incoming.length === 0 && friends.outgoing.length === 0 && <Empty icon="📬" title="No pending requests" />}
          {friends && friends.incoming.length > 0 && <Text style={[s.h3, { marginTop: spacing.sm }]}>Wants to be your friend</Text>}
          <Grid max={2}>
            {friends?.incoming.map((p) => personRow(p, (
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Chip label="Accept" on onPress={() => act(() => respondFriendRequest(p.id, true), "Couldn't accept")} />
                <Chip label="Decline" on={false} onPress={() => act(() => respondFriendRequest(p.id, false), "Couldn't decline")} />
              </View>
            )))}
          </Grid>
          {friends && friends.outgoing.length > 0 && <Text style={[s.h3, { marginTop: spacing.lg }]}>Waiting for a reply</Text>}
          <Grid max={2}>
            {friends?.outgoing.map((p) => personRow(p, <Chip label="Cancel" on={false} onPress={() => act(() => removeFriend(p.id), "Couldn't cancel")} />))}
          </Grid>
        </>
      )}

      {tab === "Find people" && (
        <>
          <Field value={q} onChangeText={setQ} placeholder="Search students by name" autoCapitalize="none" autoCorrect={false} />
          <Muted style={{ marginTop: 4 }}>You'll see each person's department and year before you add them.</Muted>
          {searching && <Muted style={{ marginTop: spacing.sm }}>Searching…</Muted>}
          {results?.length === 0 && !searching && <Muted style={{ marginTop: spacing.sm }}>No students found for “{q.trim()}”.</Muted>}
          <Grid max={2}>
            {results?.map((p) => personRow(p, p.relation === "friend" ? <Chip label="Message" on onPress={() => open(p)} />
              : p.relation === "sent" ? <Tag label="Requested" color={colors.textFaint} />
              : p.relation === "received" ? <Chip label="Accept" on onPress={() => act(() => respondFriendRequest(p.id, true), "Couldn't accept")} />
              : <Chip label="＋ Add" on onPress={() => act(() => sendFriendRequest(p.id), "Couldn't send request")} />))}
          </Grid>
        </>
      )}
      {tab === "Blocked" && (
        <>
          {blocks?.length === 0 && <Empty icon="🛡️" title="No one is blocked" body="People you block can't message you or send you requests, and you won't see their messages in groups." />}
          <Grid max={2}>
            {blocks?.map((p) => personRow(p, <Chip label="Unblock" on={false} onPress={() => act(() => unblockUser(p.id), "Couldn't unblock")} />))}
          </Grid>
        </>
      )}
    </Screen>
  );
}
