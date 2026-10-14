import React, { useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { colors, spacing } from "../../theme/tokens";
import { Btn, Muted, s } from "../../components/study/ui";
import PressableScale from "../../components/animated/PressableScale";
import { uploadMaterialFile } from "../../lib/courseApi";
import { validateFile, fmtSize, ALLOWED_EXTENSIONS, PICKER_TYPES } from "../../lib/fileRules";

type Picked = { key: string; uri: string; name: string; size: number | null; title: string; error?: string };

const baseTitle = (name: string) => name.replace(/\.[^.]+$/, "").slice(0, 120);

/**
 * Pick one or SEVERAL documents (e.g. a whole set of past questions) and attach them all to a topic in one go.
 * Each file gets a name students will see (editable). Files upload one after another with progress; any that fail
 * stay in the list with the reason so you can retry just those.
 */
export default function TeacherFileUpload({ courseId, topicId, onAdded }: { courseId: string; topicId: string | null; onAdded: () => void | Promise<void> }) {
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const pick = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, copyToCacheDirectory: true, multiple: true });
      if (r.canceled || !r.assets?.length) return;
      const added: Picked[] = []; const rejected: string[] = [];
      for (const a of r.assets) {
        const bad = validateFile(a.name, a.size);
        if (bad) { rejected.push(`${a.name}: ${bad}`); continue; }
        added.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, uri: a.uri, name: a.name, size: a.size ?? null, title: baseTitle(a.name) });
      }
      setFiles((cur) => [...cur, ...added]);
      if (rejected.length) Alert.alert("Some files were skipped", rejected.slice(0, 5).join("\n") + (rejected.length > 5 ? `\n…and ${rejected.length - 5} more` : ""));
    } catch (e: any) { Alert.alert("Couldn't open the file picker", e?.message ?? "Try again."); }
  };

  const setTitle = (key: string, title: string) => setFiles((cur) => cur.map((f) => (f.key === key ? { ...f, title } : f)));
  const remove = (key: string) => setFiles((cur) => cur.filter((f) => f.key !== key));

  const uploadAll = async () => {
    const todo = files.filter((f) => f.title.trim());
    if (!todo.length || busy) return;
    setBusy(true); setProgress({ done: 0, total: todo.length });
    const failed = new Map<string, string>();
    let limitHit = false;
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      try {
        await uploadMaterialFile({ courseId, uri: f.uri, name: f.name, size: f.size, topicId, title: f.title.trim() });
      } catch (e: any) {
        const msg = e?.message ?? "Upload failed";
        failed.set(f.key, msg);
        if (/already has \d+ files/i.test(msg)) { limitHit = true; todo.slice(i + 1).forEach((x) => failed.set(x.key, "Not uploaded — the course file limit was reached.")); setProgress({ done: todo.length, total: todo.length }); break; }
      }
      setProgress({ done: i + 1, total: todo.length });
    }
    setFiles((cur) => cur.filter((f) => failed.has(f.key) || !f.title.trim()).map((f) => ({ ...f, error: failed.get(f.key) })));
    setBusy(false); setProgress(null);
    try { await onAdded(); } catch { /* list refresh is best-effort */ }
    const ok = todo.length - failed.size;
    if (failed.size) Alert.alert(`${ok} uploaded, ${failed.size} failed`, limitHit ? "This course has reached its file limit. Delete some files, then retry the rest." : "The ones that failed are still in the list with the reason — tap Upload to retry them.");
  };

  const ready = files.filter((f) => f.title.trim()).length;

  return (
    <View>
      <Muted>Choose one or many files at once — PDF, images, Word, PowerPoint, Excel or text, up to 10 MB each.</Muted>
      <Btn ghost label={files.length ? "➕ Add more files" : "📎 Choose files"} onPress={pick} disabled={busy} />
      {files.map((f) => (
        <View key={f.key} style={{ marginTop: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Muted style={{ flex: 1 }} numberOfLines={1}>{f.name}{f.size != null ? ` · ${fmtSize(f.size)}` : ""}</Muted>
            {!busy && <PressableScale onPress={() => remove(f.key)} accessibilityLabel={`Remove ${f.name}`} style={{ padding: 6 }}><Text style={{ color: colors.danger, fontWeight: "700" }}>✕</Text></PressableScale>}
          </View>
          <TextInput style={s.input} value={f.title} onChangeText={(t) => setTitle(f.key, t)} editable={!busy} placeholder="Name students will see" placeholderTextColor={colors.textFaint} />
          {!!f.error && <Text style={{ color: colors.danger, fontSize: 12 }}>{f.error}</Text>}
        </View>
      ))}
      {files.length > 0 && (
        <Btn
          label={busy && progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : `Upload ${ready} file${ready === 1 ? "" : "s"}`}
          disabled={busy || ready === 0} onPress={uploadAll}
        />
      )}
      {!files.length && <Muted style={{ marginTop: 4 }}>Accepted: {ALLOWED_EXTENSIONS.join(", ")}</Muted>}
    </View>
  );
}
