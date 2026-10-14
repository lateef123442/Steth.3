import React, { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useApp } from "../../context/AppContext";
import ChatView from "../../components/ChatView";
import Avatar from "../../components/Avatar";
import ReportModal, { ReportTarget } from "../../components/ReportModal";
import { fetchConversation, sendDirect, subscribeDirect, markRead, blockUser } from "../../lib/socialApi";

/** Private chat with one friend. Messages (yours from any device, and theirs) appear live. Block or report from the ⋯ menu or by long-pressing a message. */
export default function ChatScreen({ navigation, route }: any) {
  const { userId, name, department, year, avatar_path } = route.params as { userId: string; name: string; department?: string | null; year?: number | null; avatar_path?: string | null };
  const { profile } = useApp();
  const [report, setReport] = useState<ReportTarget | null>(null);
  const load = useCallback((before?: string) => fetchConversation(userId, before), [userId]);
  const send = useCallback((body: string) => sendDirect(userId, body), [userId]);
  const subscribe = useCallback((on: (m: any) => void, onReconnect?: () => void) => subscribeDirect(profile!.id, (m) => {
    // only this conversation: from them to me, or from me (another device) to them
    if (m.sender_id === userId || (m.sender_id === profile!.id && m.recipient_id === userId)) on(m);
  }, onReconnect), [profile, userId]);
  const read = useCallback(() => { markRead(userId).catch(() => {}); }, [userId]);

  const confirmBlock = () => Alert.alert(`Block ${name}?`, "You won't be able to message each other, and they'll be removed from your friends. You can unblock them later from Friends → Blocked.", [
    { text: "Cancel", style: "cancel" },
    { text: "Block", style: "destructive", onPress: async () => { try { await blockUser(userId); navigation.goBack(); } catch (e: any) { Alert.alert("Couldn't block", e?.message ?? "Try again."); } } },
  ]);
  const menu = () => Alert.alert(name, undefined, [
    { text: "Report", onPress: () => setReport({ userId, name, context: "direct" }) },
    { text: "Block", style: "destructive", onPress: confirmBlock },
    { text: "Cancel", style: "cancel" },
  ]);

  if (!profile) return null;
  return (
    <>
      <ChatView
        title={name} subtitle={[department, year ? `Year ${year}` : null].filter(Boolean).join(" · ")} avatar={<Avatar name={name} path={avatar_path} size={38} />}
        meId={profile.id} load={load} send={send} subscribe={subscribe} onBack={() => navigation.goBack()} onFocusRefresh={read} onMenu={menu}
        onLongPressMessage={(m) => Alert.alert("Message", undefined, [
          { text: "Report this message", onPress: () => setReport({ userId, name, context: "direct", messageId: m.id, preview: m.body }) },
          { text: "Block " + name, style: "destructive", onPress: confirmBlock },
          { text: "Cancel", style: "cancel" },
        ])}
      />
      <ReportModal target={report} onClose={() => setReport(null)} />
    </>
  );
}
