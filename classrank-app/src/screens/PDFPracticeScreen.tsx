import React, { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Screen } from "../components/responsive";
import { Btn, Card, Muted, s } from "../components/study/ui";
import { colors, spacing } from "../theme/tokens";
import { supabase } from "../lib/supabase";
import { generateQuestionsFromPdf } from "../lib/studyAi";
import { addQuestions, addSubject, addTopic, getStudyData } from "../lib/studyStore";
import { uid } from "../lib/studyTypes";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const COUNTS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

export default function PDFPracticeScreen({ navigation }: any) {
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const generate = async () => {
    if (busy) return;
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      const name = file.name || "study-material.pdf";
      if (!name.toLowerCase().endsWith(".pdf")) throw new Error("Please choose a PDF file.");
      if (file.size != null && (file.size <= 0 || file.size > MAX_PDF_BYTES)) throw new Error("The PDF must be smaller than 10 MB.");
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Please sign in again and retry.");
      const safeName = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
      uploadedPath = `${auth.user.id}/${uid()}-${safeName}`;
      const bytes = await (await fetch(file.uri)).arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) throw new Error("The PDF must be smaller than 10 MB.");
      const { error: uploadError } = await supabase.storage.from("pdf-practice").upload(uploadedPath, bytes, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      setFileName(name);
      const made = await generateQuestionsFromPdf(uploadedPath, count);
      let subjectId = getStudyData().subjects.find((x) => x.name === "PDF Practice")?.id;
      if (!subjectId) subjectId = addSubject("PDF Practice");
      const topicName = name.replace(/\.pdf$/i, "").slice(0, 80) || "Uploaded PDF";
      let topicId = getStudyData().topics.find((x) => x.subjectId === subjectId && x.name === topicName)?.id;
      if (!topicId) {
        addTopic(subjectId, topicName);
        topicId = getStudyData().topics.find((x) => x.subjectId === subjectId && x.name === topicName)?.id;
      }
      if (!topicId) throw new Error("Questions were generated, but the practice topic could not be saved. Please retry.");
      addQuestions(made.map((q) => ({ ...q, subjectId: subjectId!, topicId, source: "ai" as const })));
      Alert.alert("Your CBT is ready", `${made.length} questions were generated from ${name}.`, [{ text: "Start practice", onPress: () => navigation.navigate("PracticeSession", { mode: "topic", subjectId, topicId }) }]);
    } catch (error: any) {
      Alert.alert("Couldn't create your CBT", error?.message || "Check the PDF and your connection, then try again.");
    } finally {
      if (uploadedPath) await supabase.storage.from("pdf-practice").remove([uploadedPath]).catch(() => {});
      setBusy(false);
    }
  };

  return (
    <Screen wide>
      <View style={{ maxWidth: 680, width: "100%", alignSelf: "center", paddingBottom: spacing.xxxl }}>
        <Pressable onPress={() => navigation.goBack()}><Text style={{ color: colors.teal, marginBottom: spacing.md }}>← Back to Practice</Text></Pressable>
        <Text style={s.h1}>PDF to CBT</Text>
        <Muted style={{ marginTop: 6 }}>Upload lecture notes, handouts or a textbook PDF. Steth reads the material and creates a multiple-choice test from it.</Muted>
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={s.h3}>1. Choose your question count</Text>
          <Muted>Pick any amount from 5 to 100 questions.</Muted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: spacing.xs }}>
              {COUNTS.map((n) => <Pressable key={n} onPress={() => setCount(n)} style={{ minWidth: 44, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 12, alignItems: "center", backgroundColor: count === n ? colors.teal : colors.card, borderWidth: 1, borderColor: count === n ? colors.teal : colors.border }}><Text style={{ color: count === n ? "#fff" : colors.text, fontWeight: "700" }}>{n}</Text></Pressable>)}
            </View>
          </ScrollView>
          <Text style={[s.h3, { marginTop: spacing.xl }]}>2. Upload your PDF</Text>
          <Muted>PDF only · Maximum file size 10 MB · The uploaded file is deleted after question generation.</Muted>
          {!!fileName && <Muted style={{ marginTop: spacing.sm }}>Last selected: {fileName}</Muted>}
          <View style={{ marginTop: spacing.md }}><Btn label={busy ? "Reading PDF and generating questions…" : "Choose PDF and generate CBT"} onPress={generate} disabled={busy} /></View>
        </Card>
        <Card style={{ marginTop: spacing.md, backgroundColor: colors.violetTint, borderWidth: 0 }}>
          <Text style={s.h3}>How it works</Text>
          <Muted>1. Select a PDF. 2. AI scans its content. 3. It creates questions with four answer options and explanations. 4. Start the CBT and see your score.</Muted>
        </Card>
      </View>
    </Screen>
  );
}
