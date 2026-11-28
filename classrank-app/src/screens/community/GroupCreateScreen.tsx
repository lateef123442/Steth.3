import React, { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../../theme/tokens";
import { Back, Btn, Label, Muted, s } from "../../components/study/ui";
import Dropdown from "../../components/Dropdown";
import { createGroup } from "../../lib/groupApi";
import { chooseGroupAvatar, uploadGroupAvatar } from "../../lib/socialApi";
import type { ImagePickerAsset } from "expo-image-picker";
import { fetchMyCourses, type MyCourse } from "../../lib/courseApi";
import { WRAP } from "../../components/responsive";

export default function GroupCreateScreen({ navigation }: any) {
  const [groupPhoto, setGroupPhoto] = useState<ImagePickerAsset | null>(null);
  const [courses, setCourses] = useState<MyCourse[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyCourses().then(setCourses).catch((error: any) => setCourseError(error?.message ?? "Couldn't load your courses."));
  }, []);

  const submit = async () => {
    if (busy || name.trim().length < 2) return;
    setBusy(true);
    try {
      const group = await createGroup(name.trim(), description.trim(), courseId);
      if (groupPhoto) {
        try { await uploadGroupAvatar(group.id, null, groupPhoto); }
        catch (photoError: any) { Alert.alert("Group created, photo not uploaded", photoError?.message ?? "You can add the photo from group info."); }
      }
      Alert.alert("Group created", `Your group is ready. Share this invite code with classmates: ${group.join_code}`, [
        { text: "Open group chat", onPress: () => navigation.replace("GroupChat", { groupId: group.id, name: name.trim() }) },
      ]);
    } catch (error: any) {
      Alert.alert("Couldn't create group", error?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }} keyboardShouldPersistTaps="handled">
        <Back onPress={() => navigation.goBack()} />
        <Text style={s.h1}>Create a study group</Text>
        <Muted style={{ marginTop: 5 }}>Give your group a name, add a short description and optionally connect it to one of your courses.</Muted>
        <Label>GROUP NAME</Label>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. CSC 201 exam crew" placeholderTextColor={colors.textFaint} maxLength={70} />
        <Label>DESCRIPTION (OPTIONAL)</Label>
        <TextInput style={[s.input, { minHeight: 92, textAlignVertical: "top" }]} value={description} onChangeText={setDescription} placeholder="What's this group for?" placeholderTextColor={colors.textFaint} multiline maxLength={240} />
        <Label>GROUP PROFILE PHOTO (OPTIONAL)</Label>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.xs }}>
          {groupPhoto ? <Image source={{ uri: groupPhoto.uri }} style={{ width: 64, height: 64, borderRadius: 32 }} /> : <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tealTint, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.teal, fontSize: 24 }}>＋</Text></View>}
          <View style={{ flex: 1 }}><Btn ghost label={groupPhoto ? "Change group photo" : "Choose group photo"} onPress={async () => { try { const asset = await chooseGroupAvatar(); if (asset) setGroupPhoto(asset); } catch (e: any) { Alert.alert("Couldn't choose photo", e?.message ?? "Try again."); } }} /></View>
        </View>
        <Label>LINK A COURSE (OPTIONAL)</Label>
        <Dropdown
          value={courseId}
          options={[{ value: "", label: "No course linked" }, ...courses.map((course) => ({ value: course.id, label: `${course.code} · ${course.title}` }))]}
          onSelect={(value) => setCourseId(value || null)}
          placeholder="Choose a course"
          title="Link a course"
          searchable
        />
        {!!courseError && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{courseError}</Muted>}
        <View style={{ marginTop: spacing.lg }}>
          <Btn label={busy ? "Creating…" : "Create group"} onPress={submit} disabled={busy || name.trim().length < 2} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
