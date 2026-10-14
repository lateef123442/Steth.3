import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, RefreshControl } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { Btn, Card, Chip, Empty, Field, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen, ChipRow } from "../../components/responsive";
import {
  fetchAdminFeedback, respondFeedback, fetchReports, updateReport, suspendChat, fetchInboxCounts, subscribeInbox,
  AdminFeedback, AdminReport, FeedbackStatus, ReportStatus, CATEGORY_LABEL, STATUS_LABEL,
} from "../../lib/supportApi";

type Tab = "Feedback" | "Reports";
const FB_TONE = { open: colors.ember, in_progress: colors.violet, resolved: colors.success } as const;
const REASON: Record<string, string> = { harassment: "Harassment", spam: "Spam", inappropriate: "Inappropriate", hate: "Hate speech", threat: "Threat", other: "Other" };

/** Admin inbox: feedback from users and abuse reports from chats. Updates live when something new arrives. */
export default function AdminInboxScreen() {
  const [tab, setTab] = useState<Tab>("Feedback");
  const [fbFilter, setFbFilter] = useState<FeedbackStatus | "all">("open");
  const [rpFilter, setRpFilter] = useState<ReportStatus | "all">("open");
  const [fb, setFb] = useState<AdminFeedback[] | null>(null);
  const [rp, setRp] = useState<AdminReport[] | null>(null);
  const [counts, setCounts] = useState({ feedback: 0, reports: 0 });
  const [replyFor, setReplyFor] = useState<string | null>(null), [reply, setReply] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null), [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadFb = useCallback(async () => { try { setFb(await fetchAdminFeedback(fbFilter)); } catch (e: any) { Alert.alert("Couldn't load feedback", e?.message ?? "Try again."); setFb([]); } }, [fbFilter]);
  const loadRp = useCallback(async () => { try { setRp(await fetchReports(rpFilter)); } catch (e: any) { Alert.alert("Couldn't load reports", e?.message ?? "Try again."); setRp([]); } }, [rpFilter]);
  const loadCounts = useCallback(() => { fetchInboxCounts().then(setCounts).catch(() => {}); }, []);
  useEffect(() => { loadFb(); loadCounts(); return subscribeInbox("feedback", () => { loadFb(); loadCounts(); }); }, [loadFb, loadCounts]);
  useEffect(() => { loadRp(); return subscribeInbox("reports", () => { loadRp(); loadCounts(); }); }, [loadRp]);

  const run = async (fn: () => Promise<unknown>, fail: string, after?: () => void) => { try { await fn(); after?.(); } catch (e: any) { Alert.alert(fail, e?.message ?? "Try again."); } };

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([loadFb(), loadRp()]); loadCounts(); setRefreshing(false); }} />}>
      <Text style={s.h1}>Inbox</Text>
      <ChipRow>
        <Chip label={`Feedback${counts.feedback ? ` (${counts.feedback})` : ""}`} on={tab === "Feedback"} onPress={() => setTab("Feedback")} />
        <Chip label={`Reports${counts.reports ? ` (${counts.reports})` : ""}`} on={tab === "Reports"} onPress={() => setTab("Reports")} />
      </ChipRow>

      {tab === "Feedback" && (
        <>
          <ChipRow>{(["open", "in_progress", "resolved", "all"] as const).map((k) => <Chip key={k} label={k === "all" ? "All" : STATUS_LABEL[k]} on={fbFilter === k} onPress={() => setFbFilter(k)} />)}</ChipRow>
          {fb === null && <ListSkeleton />}
          {fb?.length === 0 && <Empty icon="📭" title="Nothing here" body="New messages from users appear instantly." />}
          <Grid max={2}>
            {fb?.map((f) => (
              <Card key={f.id} style={{ marginTop: spacing.xs }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                  <Text style={[s.h3, { flex: 1 }]}>{f.subject}</Text><Tag label={STATUS_LABEL[f.status]} color={FB_TONE[f.status]} />
                </View>
                <Muted>{CATEGORY_LABEL[f.category]} · {f.author_name} ({f.author_role}{f.department ? `, ${f.department}` : ""}{f.year ? `, Year ${f.year}` : ""}){f.email ? ` · ${f.email}` : ""}</Muted>
                <Muted>{new Date(f.created_at).toLocaleString()}</Muted>
                <Text style={{ color: colors.text, marginTop: spacing.sm }}>{f.body}</Text>
                {!!f.admin_reply && <Text style={{ color: colors.tealDeep, marginTop: spacing.sm }}>↳ {f.admin_reply}</Text>}
                {replyFor === f.id ? (
                  <>
                    <Field value={reply} onChangeText={setReply} placeholder="Write a reply (the user sees it live)" multiline maxLength={2000} />
                    <View style={[s.row, { marginTop: spacing.sm }]}>
                      <Chip label="Send & resolve" on onPress={() => run(() => respondFeedback(f.id, "resolved", reply), "Couldn't send", () => { setReplyFor(null); setReply(""); })} />
                      <Chip label="Send, keep open" on={false} onPress={() => run(() => respondFeedback(f.id, "in_progress", reply), "Couldn't send", () => { setReplyFor(null); setReply(""); })} />
                      <Chip label="Cancel" on={false} onPress={() => { setReplyFor(null); setReply(""); }} />
                    </View>
                  </>
                ) : (
                  <View style={[s.row, { marginTop: spacing.sm }]}>
                    <Chip label="Reply" on onPress={() => { setReplyFor(f.id); setReply(f.admin_reply); }} />
                    {f.status !== "in_progress" && <Chip label="Mark in progress" on={false} onPress={() => run(() => respondFeedback(f.id, "in_progress", ""), "Couldn't update")} />}
                    {f.status !== "resolved" && <Chip label="Resolve" on={false} onPress={() => run(() => respondFeedback(f.id, "resolved", ""), "Couldn't update")} />}
                  </View>
                )}
              </Card>
            ))}
          </Grid>
        </>
      )}

      {tab === "Reports" && (
        <>
          <ChipRow>{(["open", "reviewing", "resolved", "dismissed", "all"] as const).map((k) => <Chip key={k} label={k[0].toUpperCase() + k.slice(1)} on={rpFilter === k} onPress={() => setRpFilter(k)} />)}</ChipRow>
          {rp === null && <ListSkeleton />}
          {rp?.length === 0 && <Empty icon="🛡️" title="No reports" body="Reports from chats appear instantly." />}
          <Grid max={2}>
            {rp?.map((r) => {
              const suspended = !!r.suspended_until && new Date(r.suspended_until) > new Date();
              return (
                <Card key={r.id} style={{ marginTop: spacing.xs }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                    <Text style={[s.h3, { flex: 1 }]}>{REASON[r.reason] ?? r.reason}</Text><Tag label={r.status} color={r.status === "open" ? colors.danger : r.status === "reviewing" ? colors.violet : colors.textFaint} />
                  </View>
                  <Muted>{r.reporter_name} reported {r.reported_name} · {r.context === "direct" ? "private chat" : r.context === "group" ? "group chat" : "profile"}</Muted>
                  <Muted>{new Date(r.created_at).toLocaleString()} · {r.reports_against} report{r.reports_against === 1 ? "" : "s"} against them{suspended ? " · chat suspended" : ""}</Muted>
                  {!!r.snippet && <View style={{ backgroundColor: colors.dangerTint, borderRadius: 10, padding: spacing.md, marginTop: spacing.sm }}><Text style={{ color: colors.text }}>“{r.snippet}”</Text></View>}
                  {!!r.details && <Text style={{ color: colors.text, marginTop: spacing.sm }}>{r.details}</Text>}
                  {!!r.admin_note && <Text style={{ color: colors.tealDeep, marginTop: spacing.sm }}>Note: {r.admin_note}</Text>}
                  {noteFor === r.id && <Field value={note} onChangeText={setNote} placeholder="Note about what you decided (optional)" maxLength={1000} />}
                  <View style={[s.row, { marginTop: spacing.sm }]}>
                    {noteFor !== r.id ? <Chip label="Add note" on={false} onPress={() => { setNoteFor(r.id); setNote(r.admin_note); }} /> : null}
                    {r.status !== "reviewing" && <Chip label="Reviewing" on={false} onPress={() => run(() => updateReport(r.id, "reviewing", noteFor === r.id ? note : r.admin_note), "Couldn't update", () => setNoteFor(null))} />}
                    <Chip label="Resolve" on onPress={() => run(() => updateReport(r.id, "resolved", noteFor === r.id ? note : r.admin_note), "Couldn't update", () => setNoteFor(null))} />
                    <Chip label="Dismiss" on={false} onPress={() => run(() => updateReport(r.id, "dismissed", noteFor === r.id ? note : r.admin_note), "Couldn't update", () => setNoteFor(null))} />
                  </View>
                  {!!r.reported_id && (
                    <View style={[s.row, { marginTop: spacing.sm }]}>
                      {suspended
                        ? <Chip label="Lift chat suspension" on={false} onPress={() => run(() => suspendChat(r.reported_id!, 0), "Couldn't update", loadRp)} />
                        : [1, 7, 30].map((d) => <Chip key={d} label={`Suspend chat ${d}d`} on={false} onPress={() => Alert.alert(`Suspend ${r.reported_name}'s chat for ${d} day${d > 1 ? "s" : ""}?`, "They won't be able to send messages, friend requests or add people to groups.", [{ text: "Cancel", style: "cancel" }, { text: "Suspend", style: "destructive", onPress: () => run(() => suspendChat(r.reported_id!, d), "Couldn't suspend", loadRp) }])} />)}
                    </View>
                  )}
                </Card>
              );
            })}
          </Grid>
        </>
      )}
    </Screen>
  );
}
