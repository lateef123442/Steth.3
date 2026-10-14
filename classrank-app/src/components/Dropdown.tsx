import React, { useMemo, useState } from "react";
import { View, Text, Modal, Pressable, FlatList, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, spacing, type } from "../theme/tokens";

export interface DropdownOption { value: string; label: string }

interface Props {
  value: string | null;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  placeholder?: string;
  title?: string;
  /** Show a search box inside the list. Turn on for long lists like universities. */
  searchable?: boolean;
  emptyText?: string;
}

/** Tap-to-open dropdown: a field that opens a full-screen, scrollable (and optionally searchable) list. */
export default function Dropdown({ value, options, onSelect, placeholder = "Select", title, searchable, emptyText = "No results" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = () => { setOpen(false); setQuery(""); };

  return (
    <>
      <Pressable style={styles.field} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={[styles.fieldText, !selected && { color: colors.textFaint }]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <SafeAreaView style={styles.sheet}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.header}>
              <Text style={styles.title}>{title ?? placeholder}</Text>
              <Pressable onPress={close} hitSlop={12}><Text style={styles.close}>Close</Text></Pressable>
            </View>
            {searchable && (
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={colors.textFaint}
                autoCorrect={false}
              />
            )}
            <FlatList
              data={shown}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <Pressable style={[styles.row, active && styles.rowActive]} onPress={() => { onSelect(item.value); close(); }}>
                    <Text style={[styles.rowText, active && styles.rowTextActive]}>{item.label}</Text>
                    {active && <Text style={styles.rowTextActive}>✓</Text>}
                  </Pressable>
                );
              }}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    backgroundColor: colors.card, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  fieldText: { flex: 1, fontSize: 15, fontFamily: type.body.fontFamily, color: colors.text },
  caret: { color: colors.textMuted, fontSize: 16, marginLeft: spacing.sm },
  sheet: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  title: { ...type.h2, color: colors.text, flex: 1 },
  close: { color: colors.teal, fontSize: 15, fontFamily: type.bodySemibold.fontFamily },
  search: {
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, backgroundColor: colors.card, borderRadius: radii.sm, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 15, fontFamily: type.body.fontFamily, color: colors.text,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowActive: { backgroundColor: colors.card },
  rowText: { flex: 1, fontSize: 15, fontFamily: type.body.fontFamily, color: colors.text },
  rowTextActive: { color: colors.teal, fontFamily: type.bodySemibold.fontFamily },
  empty: { textAlign: "center", color: colors.textMuted, padding: spacing.xl },
});
