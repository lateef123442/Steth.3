import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import PressableScale from "../components/animated/PressableScale";
import { useApp } from "../context/AppContext";
import { supabase } from "../lib/supabase";
import { checkPasswordStrength } from "../utils/validation";
import { getPasswordResetRedirectUrl } from "../lib/deepLinking";
import { colors, radii, spacing, type } from "../theme/tokens";

const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;

export default function AccountSettingsScreen() {
  const navigation = useNavigation<any>();
  const { profile, session, refreshMyProfile } = useApp();
  const [name, setName] = useState(profile?.name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
  const profileValid = name.trim().length >= 2 && name.trim().length <= 60 && USERNAME_RULE.test(normalizedUsername);

  const saveProfile = async () => {
    if (!profileValid || savingProfile) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase.rpc("update_my_account_profile", {
        p_name: name.trim(),
        p_username: normalizedUsername,
        p_bio: bio.trim(),
      });
      if (error) throw error;
      await refreshMyProfile();
      Alert.alert("Profile updated", "Your name, username and bio have been saved.");
    } catch (error: any) {
      const message = String(error?.message ?? "Couldn't update your profile.");
      Alert.alert("Couldn't save profile", message.includes("profiles_username_lower_uidx") || message.includes("already taken")
        ? "That username is already taken. Try another one."
        : message);
    } finally {
      setSavingProfile(false);
    }
  };

  const sendPasswordReset = async () => {
    const email = session?.user?.email;
    if (!email) { Alert.alert("Email unavailable", "Log out and back in, then try again."); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: getPasswordResetRedirectUrl() });
      if (error) throw error;
      Alert.alert("Reset link sent", "Check your inbox and spam folder for a secure password reset link.");
    } catch (error: any) {
      Alert.alert("Couldn't send reset link", error?.message ?? "Please try again.");
    }
  };

  const changePassword = async () => {
    if (changingPassword) return;
    if (!currentPassword) { Alert.alert("Current password required", "Enter your current password to continue."); return; }
    const strength = checkPasswordStrength(newPassword);
    if (!strength.valid) { Alert.alert("Choose a stronger password", strength.message ?? "Use at least 8 characters, including a letter and a number."); return; }
    if (newPassword !== confirmPassword) { Alert.alert("Passwords don't match", "Re-enter the new password in both fields."); return; }
    const email = session?.user?.email;
    if (!email) { Alert.alert("Session unavailable", "Log out and back in, then try again."); return; }

    setChangingPassword(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInError) throw new Error("Your current password is incorrect.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      Alert.alert("Password changed", "Your account password has been updated.");
    } catch (error: any) {
      Alert.alert("Couldn't change password", error?.message ?? "Please try again.");
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <PressableScale onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>‹  Back to profile</Text>
        </PressableScale>
        <Text style={styles.title}>Account settings</Text>
        <Text style={styles.subtitle}>Manage the details you use on Steth.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Personal details</Text>
          <Text style={styles.hint}>Your name is shown on your profile and in Steth.</Text>
          <Text style={styles.label}>Display name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.textFaint} autoCapitalize="words" maxLength={60} />
          <Text style={styles.label}>Username</Text>
          <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="e.g. ahmed_dev" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} maxLength={20} />
          <Text style={styles.hint}>3–20 characters. Use lowercase letters, numbers or underscores. Your username must be unique.</Text>
          <Text style={styles.label}>Bio</Text>
          <TextInput style={[styles.input, styles.bioInput]} value={bio} onChangeText={setBio} placeholder="Tell people a little about yourself..." placeholderTextColor={colors.textFaint} multiline maxLength={240} textAlignVertical="top" />
          <Text style={styles.hint}>{bio.length}/240 characters. This appears on your public profile.</Text>
          {!profileValid && (name.length > 0 || username.length > 0) && <Text style={styles.error}>Enter a name (2–60 characters) and a valid username.</Text>}
          <PressableScale style={[styles.button, (!profileValid || savingProfile) && styles.disabled]} onPress={saveProfile} disabled={!profileValid || savingProfile}>
            {savingProfile ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save profile</Text>}
          </PressableScale>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Change password</Text>
          <Text style={styles.hint}>Confirm your current password before choosing a new one.</Text>
          <Text style={styles.label}>Current password</Text>
          <TextInput style={styles.input} value={currentPassword} onChangeText={setCurrentPassword} placeholder="Current password" placeholderTextColor={colors.textFaint} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
          <Text style={styles.label}>New password</Text>
          <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} placeholder="At least 8 characters, with a number" placeholderTextColor={colors.textFaint} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
          <Text style={styles.label}>Confirm new password</Text>
          <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter new password" placeholderTextColor={colors.textFaint} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
          {confirmPassword.length > 0 && newPassword !== confirmPassword && <Text style={styles.error}>The new passwords do not match.</Text>}
          <PressableScale style={[styles.button, (!currentPassword || !newPassword || !confirmPassword || changingPassword) && styles.disabled]} onPress={changePassword} disabled={!currentPassword || !newPassword || !confirmPassword || changingPassword}>
            {changingPassword ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Update password</Text>}
          </PressableScale>
          <PressableScale onPress={sendPasswordReset} style={styles.forgotLink}>
            <Text style={styles.forgotText}>Forgot your current password? Use password reset.</Text>
          </PressableScale>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.xl, paddingBottom: spacing.xxxl * 2 },
  back: { alignSelf: "flex-start", paddingVertical: spacing.sm },
  backText: { color: colors.tealDeep, fontWeight: "700" },
  title: { ...type.h1, color: colors.text, marginTop: spacing.lg },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  cardTitle: { ...type.h3, color: colors.text },
  hint: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 18 },
  label: { ...type.label, color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: { backgroundColor: colors.paper, borderRadius: radii.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 15, fontFamily: type.body.fontFamily, borderWidth: 1, borderColor: colors.border, color: colors.text },
  bioInput: { minHeight: 88, paddingTop: spacing.md },
  error: { ...type.caption, color: colors.danger, marginTop: spacing.sm },
  button: { marginTop: spacing.xl, backgroundColor: colors.navy, borderRadius: radii.md, paddingVertical: spacing.lg, alignItems: "center" },
  disabled: { opacity: 0.45 },
  buttonText: { color: "#fff", ...type.h3 },
  forgotLink: { marginTop: spacing.lg, alignSelf: "center", padding: spacing.sm },
  forgotText: { ...type.caption, color: colors.tealDeep, textAlign: "center" },
});
