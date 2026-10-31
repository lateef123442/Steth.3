import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PressableScale from "../../components/animated/PressableScale";
import { colors, radius } from "../../theme/colors";
import { useApp } from "../../context/AppContext";
import { createDepartment, createInviteCode, listInviteCodes, addStudyYear, removeStudyYear } from "../../lib/adminApi";
import { InviteCode } from "../../types";

export default function AdminDepartmentsScreen() {
  const { departments, refreshDepartments, years, refreshYears } = useApp();
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(departments[0]?.id ?? null);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [showNewDept, setShowNewDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptFaculty, setNewDeptFaculty] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);
  const [deptFormError, setDeptFormError] = useState<string | null>(null);

  const loadCodes = useCallback(async (deptId: string | null) => {
    setLoadingCodes(true);
    setCodesError(null);
    try {
      const result = await listInviteCodes(deptId ?? undefined);
      setCodes(result);
    } catch (err: any) {
      setCodesError(err?.message ?? "Couldn't load invite codes.");
    } finally {
      setLoadingCodes(false);
    }
  }, []);

  useEffect(() => {
    loadCodes(selectedDeptId);
  }, [selectedDeptId, loadCodes]);

  const handleGenerateCode = async () => {
    if (!selectedDeptId) return;
    setGenerating(true);
    try {
      const code = await createInviteCode(selectedDeptId);
      Alert.alert("Invite code created", `Share this with the new teacher:\n\n${code}`);
      loadCodes(selectedDeptId);
    } catch (err: any) {
      Alert.alert("Couldn't create code", err?.message ?? "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  };

  const handleAddYear = async (y: number) => {
    try { await addStudyYear(y); await refreshYears(); }
    catch (err: any) { Alert.alert("Couldn't add year", err?.message ?? "Something went wrong."); }
  };

  const handleRemoveYear = (y: number) => {
    Alert.alert(`Remove Year ${y}?`, "Students already in Year " + y + " keep it. It just won't be offered to new signups.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        try { await removeStudyYear(y); await refreshYears(); }
        catch (err: any) { Alert.alert("Couldn't remove year", err?.message ?? "Something went wrong."); }
      } },
    ]);
  };

  const handleCreateDepartment = async () => {
    if (newDeptName.trim().length === 0 || newDeptFaculty.trim().length === 0) {
      setDeptFormError("Both name and faculty are required.");
      return;
    }
    setCreatingDept(true);
    setDeptFormError(null);
    try {
      await createDepartment(newDeptName.trim(), newDeptFaculty.trim());
      setNewDeptName("");
      setNewDeptFaculty("");
      setShowNewDept(false);
      await refreshDepartments();
      Alert.alert("Department created", `${newDeptName.trim()} has been added.`);
    } catch (err: any) {
      setDeptFormError(err?.message ?? "Couldn't create department.");
    } finally {
      setCreatingDept(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={codes}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.container}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Departments</Text>

            <View style={styles.chipWrap}>
              {departments.map((d) => (
                <PressableScale
                  key={d.id}
                  style={[styles.chip, selectedDeptId === d.id && styles.chipSelected]}
                  onPress={() => setSelectedDeptId(d.id)}
                >
                  <Text style={[styles.chipText, selectedDeptId === d.id && styles.chipTextSelected]}>{d.name}</Text>
                </PressableScale>
              ))}
            </View>

            <PressableScale style={styles.linkButton} onPress={() => setShowNewDept((s) => !s)}>
              <Text style={styles.linkButtonText}>{showNewDept ? "Cancel" : "+ New Department"}</Text>
            </PressableScale>

            {showNewDept && (
              <View style={styles.newDeptForm}>
                <TextInput
                  style={styles.input}
                  placeholder="Department name (e.g. Psychology)"
                  placeholderTextColor={colors.textMuted}
                  value={newDeptName}
                  onChangeText={setNewDeptName}
                />
                <TextInput
                  style={[styles.input, { marginTop: 8 }]}
                  placeholder="Faculty (e.g. Faculty of Arts & Humanities)"
                  placeholderTextColor={colors.textMuted}
                  value={newDeptFaculty}
                  onChangeText={setNewDeptFaculty}
                />
                {deptFormError && <Text style={styles.errorText}>{deptFormError}</Text>}
                <PressableScale style={styles.primaryButton} onPress={handleCreateDepartment} disabled={creatingDept}>
                  {creatingDept ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create</Text>}
                </PressableScale>
              </View>
            )}

            <Text style={styles.sectionTitle}>Years of study (shown at signup)</Text>
            <Text style={styles.codeMeta}>Tap a year to remove it. Tap + to add one.</Text>
            <View style={[styles.chipWrap, { marginTop: 8 }]}>
              {years.map((y) => (
                <PressableScale key={y} style={[styles.chip, styles.chipSelected]} onPress={() => handleRemoveYear(y)}>
                  <Text style={[styles.chipText, styles.chipTextSelected]}>Year {y}  ✕</Text>
                </PressableScale>
              ))}
              {[1, 2, 3, 4, 5, 6, 7].filter((y) => !years.includes(y)).map((y) => (
                <PressableScale key={`add-${y}`} style={styles.chip} onPress={() => handleAddYear(y)}>
                  <Text style={styles.chipText}>+ Year {y}</Text>
                </PressableScale>
              ))}
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Teacher Invite Codes</Text>
              <PressableScale style={styles.smallButton} onPress={handleGenerateCode} disabled={generating || !selectedDeptId}>
                {generating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>+ Generate</Text>}
              </PressableScale>
            </View>

            {loadingCodes && <ActivityIndicator color={colors.teal} style={{ marginTop: 12 }} />}
            {codesError && <Text style={styles.errorText}>{codesError}</Text>}
          </View>
        }
        ListEmptyComponent={
          !loadingCodes ? <Text style={styles.emptyText}>No invite codes yet for this department.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.codeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.codeText}>{item.code}</Text>
              <Text style={styles.codeMeta}>
                {item.used_by ? `Used ${new Date(item.used_at ?? "").toLocaleDateString()}` : "Unused"}
              </Text>
            </View>
            <View style={[styles.statusPill, item.used_by ? styles.statusUsed : styles.statusAvailable]}>
              <Text style={styles.statusPillText}>{item.used_by ? "Used" : "Available"}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginBottom: 16 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  chipTextSelected: { color: "#fff" },
  linkButton: { marginBottom: 12 },
  linkButtonText: { color: colors.teal, fontWeight: "700", fontSize: 14 },
  newDeptForm: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  primaryButton: { backgroundColor: colors.navy, borderRadius: radius.sm, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  smallButton: { backgroundColor: colors.teal, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  smallButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 16, fontSize: 13 },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 8,
  },
  codeText: { fontSize: 15, fontWeight: "800", color: colors.text, letterSpacing: 1 },
  codeMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  statusPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusAvailable: { backgroundColor: colors.tealLight },
  statusUsed: { backgroundColor: colors.border },
  statusPillText: { fontSize: 13, fontWeight: "700", color: colors.text },
});
