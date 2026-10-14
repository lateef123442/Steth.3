import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useApp } from "../../context/AppContext";
import ChatView from "../../components/ChatView";
import ReportModal, { ReportTarget } from "../../components/ReportModal";
import { fetchGroupMessages, sendGroupMsg, subscribeGroup, fetchGroupMembers, fetchBlocks, blockUser, GroupMember } from "../../lib/socialApi";

/** Live chat for a study group. Long-press someone else's message to report it or block the sender. */
export default function GroupChatScreen({ navigation, route }: any) {
  const { groupId, name } = route.params as { groupId: string; name: string };
  const { profile } = useApp();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const byId = useRef(new Map<string, GroupMember>());
  const blocked = useRef(new Set<string>());
  useEffect(() => {
    Promise.all([
      fetchGroupMembers(groupId).then((m) => { byId.current = new Map(m.map((x) => [x.id, x])); setMembers(m); }).catch(() => {}),
      fetchBlocks().then((b) => { blocked.current = new Set(b.map((x) => x.id)); }).catch(() => {}),
    ]).finally(() => setReady(true));
  }, [groupId]);

  const load = useCallback((before?: string) => fetchGroupMessages(groupId, before), [groupId]);
  const send = useCallback((body: string) => sendGroupMsg(groupId, body), [groupId]);
  // includes my own messages from other devices; ChatView de-duplicates by id
  const subscribe = useCallback((on: (m: any) => void, onReconnect?: () => void) => subscribeGroup(groupId, on, onReconnect), [groupId]);
  const nameOf = useCallback((id: string) => byId.current.get(id), []);
  const hideSender = useCallback((id: string) => blocked.current.has(id), []);

  if (!profile || !ready) return null;
  return (
    <>
      <ChatView
        title={name} subtitle={members.length ? `${members.length} members · tap for members` : "Group chat"}
        meId={profile.id} load={load} send={send} subscribe={subscribe} nameOf={nameOf} hideSender={hideSender}
        onBack={() => navigation.goBack()} onHeaderPress={() => navigation.navigate("GroupMembers", { groupId, name })}
        onLongPressMessage={(m) => {
          const who = byId.current.get(m.sender_id)?.name ?? m.sender_name ?? "this person";
          Alert.alert(who, undefined, [
            { text: "Report this message", onPress: () => setReport({ userId: m.sender_id, name: who, context: "group", messageId: m.id, preview: m.body }) },
            { text: `Block ${who}`, style: "destructive", onPress: () => Alert.alert(`Block ${who}?`, "You won't see their messages in group chats or be able to message each other.", [
              { text: "Cancel", style: "cancel" },
              { text: "Block", style: "destructive", onPress: async () => { try { await blockUser(m.sender_id); blocked.current.add(m.sender_id); navigation.replace("GroupChat", { groupId, name }); } catch (e: any) { Alert.alert("Couldn't block", e?.message ?? "Try again."); } } },
            ]) },
            { text: "Cancel", style: "cancel" },
          ]);
        }}
      />
      <ReportModal target={report} onClose={() => setReport(null)} />
    </>
  );
}
