import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PressableScale from "../../components/animated/PressableScale";
import { colors, radius } from "../../theme/colors";
import { searchUsers, setUserRole } from "../../lib/adminApi";
import { AdminUserResult, Role } from "../../types";
import { useApp } from "../../context/AppContext";
import { getTeacherYears, setTeacherYears } from "../../lib/courseApi";
import { getTeacherDepartments, setTeacherDepartments, deleteUser } from "../../lib/supportApi";

const ROLE_OPTIONS: Role[] = ["student", "teacher", "admin"];
const PAGE_SIZE = 20;

/** Admin edits a teacher: which departments and years they cover, or removes the account. */
function TeacherAccess({ teacher, onDeleted }: { teacher: { id: string; name: string }; onDeleted: () => void }) {
  const { departments } = useApp();
  const [years, setYears] = useState<number[] | null>(null);
  const [depts, setDepts] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getTeacherYears(teacher.id).then(setYears).catch(() => setYears([]));
    getTeacherDepartments(teacher.id).then(setDepts).catch(() => setDepts([]));
  }, [teacher.id]);
  if (!years || !depts) return null;

  const toggleYear = (y: number) => { setSaved(false); setYears((c) => (c ?? []).includes(y) ? (c ?? []).filter((x) => x !== y) : [...(c ?? []), y].sort()); };
  const toggleDept = (id: string) => { setSaved(false); setDepts((c) => (c ?? []).includes(id) ? (c ?? []).filter((x) => x !== id) : [...(c ?? []), id]); };
  const save = async () => {
    if (depts.length === 0) return Alert.alert("Choose a department", "A teacher needs at least one department.");
    setBusy(true);
    try { await setTeacherDepartments(teacher.id, depts); await setTeacherYears(teacher.id, years); setSaved(true); Alert.alert("Saved", `${teacher.name}'s access was updated.`); }
    catch (err: any) { Alert.alert("Couldn't save", err?.message ?? "Something went wrong."); }
    finally { setBusy(false); }
  };
  const remove = () => Alert.alert(`Delete ${teacher.name}'s account?`, "This can't be undone. What should happen to the courses they created?", [
    { text: "Cancel", style: "cancel" },
    { text: "Keep courses (transfer to me)", onPress: () => confirmDelete("transfer") },
    { text: "Delete their courses too", style: "destructive", onPress: () => confirmDelete("delete") },
  ]);
  const confirmDelete = async (mode: "transfer" | "delete") => {
    setBusy(true);
    try { await deleteUser(teacher.id, mode); Alert.alert("Account deleted", mode === "transfer" ? "Their courses now belong to you, so students keep their progress." : "Their courses were deleted."); onDeleted(); }
    catch (err: any) { Alert.alert("Couldn't delete", err?.message ?? "Something went wrong."); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.userMeta}>Departments this teacher can teach in (the first stays their main one)</Text>
      <View style={[styles.roleRow, { flexWrap: "wrap" }]}>
        {departments.map((d) => (
          <PressableScale key={d.id} style={[styles.roleChip, depts.includes(d.id) && styles.roleChipActive]} onPress={() => toggleDept(d.id)}>
            <Text style={[styles.roleChipText, depts.includes(d.id) && styles.roleChipTextActive]}>{d.name}</Text>
          </PressableScale>
        ))}
      </View>
      <Text style={[styles.userMeta, { marginTop: 8 }]}>Years {years.length === 0 ? "(none selected = all years)" : ""}</Text>
      <View style={styles.roleRow}>
        {[1, 2, 3, 4, 5].map((y) => (
          <PressableScale key={y} style={[styles.roleChip, years.includes(y) && styles.roleChipActive]} onPress={() => toggleYear(y)}>
            <Text style={[styles.roleChipText, years.includes(y) && styles.roleChipTextActive]}>Year {y}</Text>
          </PressableScale>
        ))}
      </View>
      <View style={[styles.roleRow, { marginTop: 8 }]}>
        {!saved && (
          <PressableScale style={[styles.roleChip, { borderColor: colors.teal }]} onPress={save} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={colors.teal} /> : <Text style={styles.roleChipText}>Save changes</Text>}
          </PressableScale>
        )}
        <PressableScale style={[styles.roleChip, { borderColor: colors.danger }]} onPress={remove} disabled={busy}>
          <Text style={[styles.roleChipText, { color: colors.danger }]}>Delete account</Text>
        </PressableScale>
      </View>
    </View>
  );
}

export default function AdminUsersScreen() {
  const { profile: currentProfile } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleSearch = async () => {
    if (query.trim().length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await searchUsers(query.trim(), PAGE_SIZE, 0);
      setResults(result);
      setHasMore(result.length === PAGE_SIZE);
    } catch (err: any) {
      setError(err?.message ?? "Search failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const more = await searchUsers(query.trim(), PAGE_SIZE, results.length);
      setResults((prev) => [...prev, ...more]);
      setHasMore(more.length === PAGE_SIZE);
    } catch (err: any) {
      setError(err?.message ?? "Couldn't load more results.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSetRole = (user: AdminUserResult, role: Role) => {
    if (user.role === role) return;
    if (user.id === currentProfile?.id) {
      Alert.alert("Can't change your own role", "Ask another admin to change your role if needed.");
      return;
    }
    Alert.alert(`Set ${user.name} to ${role}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: async () => {
          setUpdatingId(user.id);
          try {
            await setUserRole(user.id, role);
            setResults((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)));
          } catch (err: any) {
            Alert.alert("Couldn't update role", err?.message ?? "Something went wrong.");
          } finally {
            setUpdatingId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Manage Users</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or email"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            autoCapitalize="none"
          />
          <PressableScale style={styles.searchButton} onPress={handleSearch} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.searchButtonText}>Search</Text>}
          </PressableScale>
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <FlatList
        data={results}
        keyExtractor={(u) => u.id}
        contentContainerStyle={styles.list}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.teal} style={{ marginTop: 12 }} /> : null}
        ListEmptyComponent={
          !loading ? <Text style={styles.emptyText}>Search for a student, teacher, or admin by name or email.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.userCard}>
            <Text style={styles.userName}>{item.name}</Text>
            <Text style={styles.userMeta}>{item.email}</Text>
            <Text style={styles.userMeta}>
              {item.department ?? "No department"} · {item.university}
            </Text>
            <View style={styles.roleRow}>
              {ROLE_OPTIONS.map((role) => (
                <PressableScale
                  key={role}
                  style={[styles.roleChip, item.role === role && styles.roleChipActive]}
                  onPress={() => handleSetRole(item, role)}
                  disabled={updatingId === item.id}
                >
                  {updatingId === item.id && item.role !== role ? (
                    <ActivityIndicator size="small" color={colors.teal} />
                  ) : (
                    <Text style={[styles.roleChipText, item.role === role && styles.roleChipTextActive]}>
                      {role}
                    </Text>
                  )}
                </PressableScale>
              ))}
            </View>
            {item.role === "teacher" && <TeacherAccess teacher={{ id: item.id, name: item.name }} onDeleted={() => setResults((prev) => prev.filter((u) => u.id !== item.id))} />}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginBottom: 12 },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  searchButton: { backgroundColor: colors.navy, borderRadius: radius.sm, paddingHorizontal: 16, justifyContent: "center" },
  searchButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 8 },
  list: { padding: 20, paddingTop: 12 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontSize: 13 },
  userCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  userName: { fontSize: 15, fontWeight: "700", color: colors.text },
  userMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  roleRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  roleChip: { flex: 1, paddingVertical: 8, borderRadius: 14, alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  roleChipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  roleChipText: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "capitalize" },
  roleChipTextActive: { color: "#fff" },
});
