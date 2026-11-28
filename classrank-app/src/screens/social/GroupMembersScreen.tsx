import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Alert } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import { Back, Card, Chip, Field, Label, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Grid, Screen } from "../../components/responsive";
import Avatar from "../../components/Avatar";
import { useApp } from "../../context/AppContext";
import { fetchGroupMembers, addGroupMember, searchPeople, GroupMember, PersonResult } from "../../lib/socialApi";
import { fetchMyGroups, fetchGroupProfile, leaveGroup, deleteGroup } from "../../lib/groupApi";
import { chooseGroupAvatar, uploadGroupAvatar, groupAvatarUrl } from "../../lib/socialApi";
import { fetchGroupJoinRequests, reviewGroupJoinRequest, fetchGroupActivity, setGroupAdmin, markGroupJoinActivityRead, GroupJoinRequest, GroupActivity } from "../../lib/groupQuestions";

export default function GroupMembersScreen({ navigation, route }: any) {
  const { groupId, name } = route.params as { groupId: string; name: string };
  const { profile } = useApp();
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [groupPhotoPath, setGroupPhotoPath] = useState<string | null>(null);
  const [groupDescription, setGroupDescription] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [requests, setRequests] = useState<GroupJoinRequest[]>([]);
  const [activity, setActivity] = useState<GroupActivity[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setMembersError(null);
    setMembers(null);
    const [membersResult, groupsResult, profileResult] = await Promise.allSettled([
      fetchGroupMembers(groupId),
      fetchMyGroups(),
      fetchGroupProfile(groupId),
    ]);

    const m = membersResult.status === "fulfilled" ? membersResult.value : [];
    setMembers(m);
    const groups = groupsResult.status === "fulfilled" ? groupsResult.value : [];
    const groupProfile = profileResult.status === "fulfilled" ? profileResult.value : null;
    const owner = groups.find((g) => g.id === groupId)?.owner_id ?? groupProfile?.owner_id ?? null;
    setOwnerId(owner);
    if (groupProfile) {
      setGroupPhotoPath(groupProfile.group_avatar_path ?? null);
      setGroupDescription(groupProfile.description ?? "");
    }

    if (membersResult.status === "rejected") {
      const reason = membersResult.reason as any;
      setMembersError(reason?.message ?? "The group member list could not be loaded.");
      setMembers([]);
      return;
    }

    const manager = owner === profile?.id || m.some((x) => x.id === profile?.id && x.group_role === "admin");
    if (manager) {
      const [requestsResult, activityResult] = await Promise.allSettled([
        fetchGroupJoinRequests(groupId),
        fetchGroupActivity(groupId),
      ]);
      setRequests(requestsResult.status === "fulfilled" ? requestsResult.value : []);
      setActivity(activityResult.status === "fulfilled" ? activityResult.value : []);
      if (activityResult.status === "fulfilled") await markGroupJoinActivityRead(groupId).catch(() => {});
    } else {
      setRequests([]);
      setActivity([]);
    }
  }, [groupId, profile?.id]);

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
  const review = async (id: string, approve: boolean) => {
    setBusyId(id);
    try { await reviewGroupJoinRequest(id, approve); await load(); }
    catch (e: any) { Alert.alert("Couldn't update request", e?.message ?? "Try again."); }
    finally { setBusyId(null); }
  };
  const toggleAdmin = async (m: GroupMember) => {
    setBusyId(m.id);
    try { await setGroupAdmin(groupId, m.id, m.group_role !== "admin"); await load(); }
    catch (e: any) { Alert.alert("Couldn't update admin role", e?.message ?? "Try again."); }
    finally { setBusyId(null); }
  };
  const isOwner = ownerId === profile?.id;
  const canManage = isOwner || !!members?.some((m) => m.id === profile?.id && m.group_role === "admin");
  const changePhoto = async () => {
    if (photoBusy || !canManage) return;
    setPhotoBusy(true);
    try { const asset = await chooseGroupAvatar(); if (!asset) return; const path = await uploadGroupAvatar(groupId, groupPhotoPath, asset); setGroupPhotoPath(path); }
    catch (e: any) { Alert.alert("Couldn't update group photo", e?.message ?? "Try again."); }
    finally { setPhotoBusy(false); }
  };
  const exitGroup = () => Alert.alert(
    isOwner ? "Delete this group?" : "Leave this group?",
    isOwner ? "This will permanently delete the group for all members." : "You will leave this study group and stop receiving its messages.",
    [
      { text: "Cancel", style: "cancel" },
      { text: isOwner ? "Delete group" : "Leave group", style: "destructive", onPress: async () => {
        try {
          if (isOwner) await deleteGroup(groupId); else await leaveGroup(groupId);
          navigation.navigate("Groups");
        } catch (e: any) { Alert.alert(isOwner ? "Couldn't delete group" : "Couldn't leave group", e?.message ?? "Try again."); }
      } },
    ],
  );

  return (
    <Screen wide>
      <Back onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm }}>
        <Avatar name={name} path={groupPhotoPath} size={76} bucket="group-avatars" />
        <View style={{ flex: 1 }}>
          <Text style={s.h1}>{name}</Text>
          <Muted>{members ? members.length + " members" : ""}</Muted>
          {!!groupDescription && <Muted numberOfLines={2}>{groupDescription}</Muted>}
          {canManage && <Chip label={photoBusy ? "Updating photo…" : groupPhotoPath ? "Change group photo" : "Add group photo"} on={false} onPress={changePhoto} />}
        </View>
      </View>
      <Label>ADD A FELLOW STUDENT</Label>
      <View style={{ maxWidth: 560 }}>
        <Field value={q} onChangeText={setQ} placeholder="Search by name" autoCapitalize="none" autoCorrect={false} />
        <Muted style={{ marginTop: 4 }}>You can add friends and students from your own department and year.</Muted>
      </View>
      <Grid max={2}>
        {results?.map((p) => <Card key={p.id} style={{ marginTop: spacing.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar name={p.name} path={p.avatar_path} />
            <View style={{ flex: 1 }}><Text style={s.h3} numberOfLines={1}>{p.name}</Text><Muted numberOfLines={1}>{[p.department, p.year ? "Year " + p.year : null].filter(Boolean).join(" · ")}</Muted></View>
            {ids.has(p.id) || added.has(p.id) ? <Tag label="In group" color={colors.success} /> : <Chip label="＋ Add" on onPress={() => add(p)} />}
          </View>
        </Card>)}
      </Grid>
      <Label>MEMBERS · TAP A PERSON TO OPEN THEIR PROFILE</Label>
      {members === null && <ListSkeleton />}
      {!!membersError && <Card style={{ marginTop: spacing.xs }}>
        <Muted>{membersError}</Muted>
        <Chip label="Retry" on onPress={load} />
      </Card>}
      <Grid max={2}>
        {members?.map((m) => <Card key={m.id} style={{ marginTop: spacing.xs }} onPress={() => navigation.navigate("PublicProfile", { userId: m.id })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar name={m.name} path={m.avatar_path} />
            <View style={{ flex: 1 }}><Text style={s.h3} numberOfLines={1}>{m.name}</Text><Muted numberOfLines={1}>{m.role === "teacher" ? "Teacher" : [m.department, m.year ? "Year " + m.year : null].filter(Boolean).join(" · ")}</Muted></View>
            {m.is_owner ? <Tag label="Owner" color={colors.violet} /> : m.group_role === "admin" ? <Tag label="Admin" color={colors.teal} /> : null}
          </View>
          {isOwner && !m.is_owner && <View style={{ marginTop: 8 }}><Chip label={m.group_role === "admin" ? "Remove admin" : "Make admin"} on onPress={() => toggleAdmin(m)} /></View>}
        </Card>)}
      </Grid>
      <View style={{ marginTop: spacing.xl, marginBottom: spacing.xl }}>
        <Chip label={isOwner ? "Delete group" : "Leave group"} on={false} onPress={exitGroup} />
      </View>
      {canManage && <>
        <Label>JOIN REQUESTS</Label>
        {requests.length === 0 ? <Muted>No pending join requests.</Muted> : requests.map((r) => <Card key={r.id} style={{ marginTop: spacing.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Avatar name={r.name} path={r.avatar_path} />
            <View style={{ flex: 1 }}><Text style={s.h3}>{r.name}</Text><Muted>{[r.department, r.year ? "Year " + r.year : null].filter(Boolean).join(" · ")}</Muted></View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Chip label={busyId === r.id ? "Please wait…" : "Approve"} on onPress={() => review(r.id, true)} />
            <Chip label="Decline" on={false} onPress={() => review(r.id, false)} />
          </View>
        </Card>)}
        <Label>GROUP ACTIVITY</Label>
        {activity.length === 0 ? <Muted>No recent group activity.</Muted> : activity.map((a, i) => <Muted key={a.created_at + "-" + i} style={{ marginTop: 5 }}>{a.name ?? "A member"} {a.event_type.replace("_", " ")} · {new Date(a.created_at).toLocaleString()}</Muted>)}
      </>}
    </Screen>
  );
}
