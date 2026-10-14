import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, RefreshControl, Share, Modal, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../../theme/tokens";
import { Btn, Card, Chip, Empty, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen, ChipRow } from "../../components/responsive";
import PressableScale from "../../components/animated/PressableScale";
import {
  generateProCodes, fetchProCodes, revokeProCode, fetchPaymentRequests, approvePaymentRequest, rejectPaymentRequest, receiptUrl,
  subscribePaymentRequests, ProCode, PaymentRequest, ProDuration, DURATION_LABEL,
} from "../../lib/proApi";

type Tab = "Requests" | "Codes";
const shareCode = (code: string, days: ProDuration) =>
  Share.share({ message: `Your Steth Pro code (${DURATION_LABEL[days]}): ${code}\nOpen the app → Pro → enter this code. It works once.` }).catch(() => {});

/** Admin: review payment receipts, generate one-time 13-character Pro codes (7 days or 1 month), and see which are used. */
export default function AdminProScreen() {
  const [tab, setTab] = useState<Tab>("Requests");
  const [days, setDays] = useState<ProDuration>(30);
  const [reqFilter, setReqFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [codeFilter, setCodeFilter] = useState<"all" | "unused" | "used">("all");
  const [reqs, setReqs] = useState<PaymentRequest[] | null>(null);
  const [codes, setCodes] = useState<ProCode[] | null>(null);
  const [fresh, setFresh] = useState<{ code: string; days: ProDuration; who?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewing, setViewing] = useState<{ url: string | null; name: string } | null>(null);

  const loadReqs = useCallback(async () => { try { setReqs(await fetchPaymentRequests(reqFilter)); } catch (e: any) { Alert.alert("Couldn't load receipts", e?.message ?? "Try again."); setReqs([]); } }, [reqFilter]);
  const loadCodes = useCallback(async () => { try { setCodes(await fetchProCodes(codeFilter)); } catch (e: any) { Alert.alert("Couldn't load codes", e?.message ?? "Try again."); setCodes([]); } }, [codeFilter]);
  useEffect(() => { loadReqs(); return subscribePaymentRequests(loadReqs); }, [loadReqs]);
  useEffect(() => { loadCodes(); }, [loadCodes]);

  const generate = async () => {
    setBusy(true);
    try { const [c] = await generateProCodes(days, 1); setFresh({ code: c.code, days: c.duration_days }); loadCodes(); }
    catch (e: any) { Alert.alert("Couldn't generate code", e?.message ?? "Try again."); } finally { setBusy(false); }
  };
  const approve = async (r: PaymentRequest, d: ProDuration) => {
    setBusy(true);
    try { const c = await approvePaymentRequest(r.id, d); setFresh({ code: c.code, days: c.duration_days, who: r.name }); loadReqs(); loadCodes(); }
    catch (e: any) { Alert.alert("Couldn't approve", e?.message ?? "Try again."); loadReqs(); } finally { setBusy(false); }
  };
  const reject = (r: PaymentRequest) => Alert.alert(`Reject ${r.name}'s receipt?`, "They'll see it wasn't approved.", [
    { text: "Cancel", style: "cancel" },
    { text: "Reject", style: "destructive", onPress: async () => { try { await rejectPaymentRequest(r.id); loadReqs(); } catch (e: any) { Alert.alert("Couldn't reject", e?.message ?? "Try again."); } } },
  ]);
  const revoke = (c: ProCode) => Alert.alert("Delete this unused code?", c.code, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await revokeProCode(c.id); loadCodes(); } catch (e: any) { Alert.alert("Couldn't delete", e?.message ?? "Try again."); loadCodes(); } } },
  ]);
  const viewReceipt = async (r: PaymentRequest) => { setViewing({ url: null, name: r.name }); setViewing({ url: await receiptUrl(r.receipt_path), name: r.name }); };

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([loadReqs(), loadCodes()]); setRefreshing(false); }} />}>
      <Text style={s.h1}>Pro codes</Text>

      <Card>
        <Text style={s.h3}>Generate a code</Text>
        <Muted>13 letters and digits · works once · you choose how long it lasts.</Muted>
        <ChipRow>{([7, 30] as const).map((d) => <Chip key={d} label={DURATION_LABEL[d]} on={days === d} onPress={() => setDays(d)} />)}</ChipRow>
        <Btn label={busy ? "Working…" : `Generate ${DURATION_LABEL[days]} code`} onPress={generate} disabled={busy} />
        {fresh && (
          <View style={{ marginTop: spacing.md, alignItems: "center", gap: 4, backgroundColor: colors.paper, borderRadius: 12, padding: spacing.md }}>
            <Muted>{fresh.who ? `Approved ${fresh.who} · ` : ""}{DURATION_LABEL[fresh.days]}</Muted>
            <Text selectable style={{ fontSize: 26, fontWeight: "800", letterSpacing: 3, color: colors.tealDeep }}>{fresh.code}</Text>
            <Btn label="Send / copy code" onPress={() => shareCode(fresh.code, fresh.days)} />
          </View>
        )}
      </Card>

      <ChipRow>
        <Chip label="Receipts" on={tab === "Requests"} onPress={() => setTab("Requests")} />
        <Chip label="All codes" on={tab === "Codes"} onPress={() => setTab("Codes")} />
      </ChipRow>

      {tab === "Requests" && (
        <>
          <ChipRow>{(["pending", "approved", "rejected"] as const).map((k) => <Chip key={k} label={k[0].toUpperCase() + k.slice(1)} on={reqFilter === k} onPress={() => setReqFilter(k)} />)}</ChipRow>
          {reqs === null && <ListSkeleton />}
          {reqs?.length === 0 && <Empty icon="🧾" title="No receipts here" body="New receipts from students appear instantly." />}
          <Grid max={2}>
            {reqs?.map((r) => (
              <Card key={r.id} style={{ marginTop: spacing.xs }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                  <Text style={[s.h3, { flex: 1 }]}>{r.name}</Text>
                  <Tag label={r.status} color={r.status === "pending" ? colors.ember : r.status === "approved" ? colors.success : colors.danger} />
                </View>
                <Muted>{[r.department, r.year ? `Year ${r.year}` : null, r.email].filter(Boolean).join(" · ")}</Muted>
                <Muted>{new Date(r.created_at).toLocaleString()}</Muted>
                <Btn label="View receipt" ghost onPress={() => viewReceipt(r)} />
                {r.status === "pending" && (
                  <>
                    <Muted>Approve to generate a code, then send it on WhatsApp:</Muted>
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <View style={{ flex: 1 }}><Btn label="Approve · 7 days" onPress={() => approve(r, 7)} disabled={busy} /></View>
                      <View style={{ flex: 1 }}><Btn label="Approve · 1 month" onPress={() => approve(r, 30)} disabled={busy} /></View>
                    </View>
                    <Btn label="Reject" danger ghost onPress={() => reject(r)} />
                  </>
                )}
                {r.status === "approved" && !!r.code && (
                  <View style={{ gap: 4 }}>
                    <Text selectable style={{ fontWeight: "800", letterSpacing: 2, color: colors.tealDeep }}>{r.code}</Text>
                    <Btn label="Send / copy code again" ghost onPress={() => shareCode(r.code!, r.duration_days!)} />
                  </View>
                )}
              </Card>
            ))}
          </Grid>
        </>
      )}

      {tab === "Codes" && (
        <>
          <ChipRow>{(["all", "unused", "used"] as const).map((k) => <Chip key={k} label={k[0].toUpperCase() + k.slice(1)} on={codeFilter === k} onPress={() => setCodeFilter(k)} />)}</ChipRow>
          {codes === null && <ListSkeleton />}
          {codes?.length === 0 && <Empty icon="🔑" title="No codes yet" body="Generate one above." />}
          <Grid max={2}>
            {codes?.map((c) => (
              <Card key={c.id} style={{ marginTop: spacing.xs }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
                  <Text selectable style={{ fontWeight: "800", letterSpacing: 2, color: c.used ? colors.textFaint : colors.tealDeep, textDecorationLine: c.used ? "line-through" : "none" }}>{c.code}</Text>
                  <Tag label={c.used ? "USED" : "UNUSED"} color={c.used ? colors.textFaint : colors.success} />
                </View>
                <Muted>{DURATION_LABEL[c.duration_days]} · created {new Date(c.created_at).toLocaleDateString()}</Muted>
                {c.used && <Muted>Used by {c.used_by_name ?? "a deleted user"} · {new Date(c.used_at!).toLocaleString()}</Muted>}
                {!c.used && (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Btn label="Send / copy" ghost onPress={() => shareCode(c.code, c.duration_days)} /></View>
                    <View style={{ flex: 1 }}><Btn label="Delete" danger ghost onPress={() => revoke(c)} /></View>
                  </View>
                )}
              </Card>
            ))}
          </Grid>
        </>
      )}

      <Modal visible={!!viewing} animationType="fade" transparent onRequestClose={() => setViewing(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)" }}>
          <PressableScale onPress={() => setViewing(null)} style={{ alignSelf: "flex-end", padding: spacing.lg }}><Text style={{ color: "#fff", fontSize: 22 }}>✕</Text></PressableScale>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.md }}>
            {viewing?.url ? <Image source={{ uri: viewing.url }} resizeMode="contain" style={{ width: "100%", height: "100%" }} /> : <ActivityIndicator color="#fff" />}
          </View>
          <Text style={{ color: "#fff", textAlign: "center", padding: spacing.md }}>{viewing?.name}</Text>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}
