import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, AppState } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, radii, type } from "../theme/tokens";
import PressableScale from "./animated/PressableScale";
import Avatar from "./Avatar";
import { ChatMessage } from "../lib/socialApi";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };

/**
 * Shared real-time chat. Newest message at the bottom; older ones load when you scroll up. New messages arrive through
 * `subscribe` (Supabase Realtime); your own sends are added instantly from the server's reply. Messages are de-duplicated
 * by id, and the history is re-fetched when the connection comes back so nothing is missed.
 */
export default function ChatView({ title, subtitle, avatar, meId, load, send, subscribe, nameOf, onBack, onHeaderPress, onFocusRefresh, onMenu, onLongPressMessage, hideSender }: {
  title: string; subtitle?: string; avatar?: React.ReactNode; meId: string;
  load: (before?: string) => Promise<ChatMessage[]>;                 // newest first
  send: (body: string) => Promise<ChatMessage>;
  subscribe: (onMessage: (m: ChatMessage) => void, onReconnect?: () => void) => () => void;
  nameOf?: (senderId: string) => { name: string; avatar_path?: string | null } | undefined;   // group chats: who wrote it
  onBack: () => void; onHeaderPress?: () => void; onFocusRefresh?: (messages: ChatMessage[]) => void;
  onMenu?: () => void;                                   // header ⋯ button (block / report)
  onLongPressMessage?: (m: ChatMessage) => void;         // long-press SOMEONE ELSE'S message (report / block)
  hideSender?: (senderId: string) => boolean;            // e.g. people I blocked
}) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null); // newest first (FlatList is inverted)
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [more, setMore] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMsgs((cur) => {
      const out = [...(cur ?? [])];
      for (const m of incoming) if (!seen.current.has(m.id) && !(m.sender_id !== meId && hideSender?.(m.sender_id))) { seen.current.add(m.id); out.push(m); }
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
  }, [meId, hideSender]);

  const refresh = useCallback(async () => {
    try { const first = await load(); merge(first); setMore(first.length >= 40); setError(null); onFocusRefresh?.(first); }
    catch (e: any) { setError(e?.message ?? "Couldn't load messages."); setMsgs((m) => m ?? []); }
  }, [load, merge, onFocusRefresh]);

  useEffect(() => {
    refresh();
    // Live messages, plus a re-fetch whenever the connection drops and comes back so nothing is missed.
    const off = subscribe((m) => { merge([m]); onFocusRefresh?.([m]); }, refresh);
    // Coming back to the app after it was in the background also catches up on anything sent meanwhile.
    const app = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { off(); app.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const older = async () => {
    if (!msgs?.length || !more || loadingMore) return;
    setLoadingMore(true);
    try { const page = await load(msgs[msgs.length - 1].created_at); merge(page); setMore(page.length >= 40); } catch { /* try again on next scroll */ } finally { setLoadingMore(false); }
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    // Optimistic: show the message instantly, then swap in the server's copy (or remove it if the send fails).
    const tmpId = `tmp-${Date.now()}`;
    setSending(true); setText("");
    setMsgs((cur) => [{ id: tmpId, sender_id: meId, body, created_at: new Date().toISOString() }, ...(cur ?? [])]);
    try {
      const m = await send(body);
      setMsgs((cur) => {
        const rest = (cur ?? []).filter((x) => x.id !== tmpId);
        if (seen.current.has(m.id)) return rest;           // the live event already delivered it
        seen.current.add(m.id);
        return [...rest, { ...m, sender_id: meId }].sort((a, b) => b.created_at.localeCompare(a.created_at));
      });
    } catch (e: any) {
      setMsgs((cur) => (cur ?? []).filter((x) => x.id !== tmpId));
      setText(body); Alert.alert("Message not sent", e?.message ?? "Check your connection and try again.");
    } finally { setSending(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      {/* "padding" on Android too: with edge-to-edge the system no longer resizes the window for the keyboard, so without it the message box stays hidden behind the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }}>
          <PressableScale onPress={onBack} style={{ padding: spacing.xs }}><Text style={{ color: colors.tealDeep, fontSize: 22 }}>←</Text></PressableScale>
          <PressableScale onPress={onHeaderPress} disabled={!onHeaderPress} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 }}>
            {avatar}
            <View style={{ flex: 1 }}>
              <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>{title}</Text>
              {!!subtitle && <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>{subtitle}</Text>}
            </View>
          </PressableScale>
          {onMenu && <PressableScale onPress={onMenu} style={{ padding: spacing.sm }} accessibilityLabel="More options"><Text style={{ fontSize: 22, color: colors.textMuted }}>⋯</Text></PressableScale>}
        </View>

        {msgs === null ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} /> : (
          <FlatList
            data={msgs} inverted keyExtractor={(m) => m.id} onEndReached={older} onEndReachedThreshold={0.3}
            contentContainerStyle={{ padding: spacing.lg, gap: 6, width: "100%", maxWidth: 820, alignSelf: "center" }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={{ transform: [{ scaleY: -1 }], textAlign: "center", color: colors.textMuted, marginTop: 40 }}>{error ?? "No messages yet. Say hi 👋"}</Text>}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.teal} style={{ margin: 12 }} /> : null}
            renderItem={({ item, index }) => {
              const mine = item.sender_id === meId;
              const who = !mine ? nameOf?.(item.sender_id) ?? (item.sender_name ? { name: item.sender_name, avatar_path: item.avatar_path } : undefined) : undefined;
              const older = msgs[index + 1]; // previous message in time (list is newest-first)
              const newDay = !older || day(older.created_at) !== day(item.created_at);
              const samePrev = older && older.sender_id === item.sender_id && !newDay;
              return (
                <View>
                  {newDay && <Text style={{ textAlign: "center", color: colors.textFaint, fontSize: 12, marginVertical: spacing.md }}>{day(item.created_at)}</Text>}
                  <View style={{ flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end", gap: 8, marginTop: samePrev ? 0 : spacing.sm }}>
                    {!mine && nameOf ? <View style={{ width: 28 }}>{!samePrev && who ? <Avatar name={who.name} path={who.avatar_path} size={28} /> : null}</View> : null}
                    <PressableScale haptic="medium" scaleTo={0.99} disabled={mine || !onLongPressMessage} onLongPress={() => onLongPressMessage?.(item)} style={{ maxWidth: "78%" }}>
                    <View style={{ backgroundColor: mine ? colors.teal : colors.card, borderRadius: radii.md, paddingVertical: 8, paddingHorizontal: 12, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
                      {!mine && !!who && !samePrev && <Text style={{ color: colors.violet, fontWeight: "700", fontSize: 12, marginBottom: 2 }}>{who.name}</Text>}
                      <Text style={[type.body, { color: mine ? "#fff" : colors.text }]} selectable>{item.body}</Text>
                      <Text style={{ color: mine ? "#D6FFF9" : colors.textFaint, fontSize: 10, alignSelf: "flex-end", marginTop: 2 }}>{time(item.created_at)}</Text>
                    </View>
                    </PressableScale>
                  </View>
                </View>
              );
            }}
          />
        )}

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card }}>
          <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={colors.textFaint} multiline maxLength={2000}
            style={{ flex: 1, maxHeight: 120, backgroundColor: colors.paper, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: colors.text, ...type.body }} />
          <PressableScale onPress={submit} disabled={!text.trim() || sending} style={{ backgroundColor: colors.teal, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: !text.trim() || sending ? 0.4 : 1 }}>
            <Text style={{ color: "#fff", fontSize: 18 }}>➤</Text>
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
