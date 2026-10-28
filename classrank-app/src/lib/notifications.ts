import Notifications, { notificationsAvailable } from "./expoNotifications";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { loadStudy, getStudyData, shiftOutOfQuiet } from "./studyStore";

const STREAK_REMINDER_ID = "streak-risk-reminder";
const REMINDER_HOUR = 18; // 6 PM — matches the "Retention Loop" spec from the original business plan.

// Controls how a notification behaves while the app is in the foreground.
// Shown as a banner even if the app is open, since a streak reminder is
// exactly the kind of thing worth surfacing immediately rather than only
// when backgrounded.
let muted = false;
/** Study Mode turns this on so Steth's own notifications never interrupt reading. */
export function setNotificationsMuted(value: boolean) {
  muted = value;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: !muted,
    shouldShowList: !muted,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Android 13+ only shows the "Allow notifications?" pop-up once the app has created at least one notification
 * channel, so the channel must exist BEFORE permission is requested (it used to be created afterwards, which meant
 * the pop-up never appeared and nothing was ever delivered).
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Steth",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#14B8A6",
    });
  } catch (err) {
    console.log("[notifications] channel setup skipped:", err);
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  await ensureAndroidChannel();
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/**
 * Schedules (or reschedules) the streak-risk reminder for the next 6 PM —
 * today's if it hasn't passed yet, tomorrow's otherwise. Always cancels any
 * previously scheduled reminder first, so calling this repeatedly (e.g. on
 * every app foreground) doesn't stack up duplicate notifications.
 *
 * This is a *local* notification — scheduled entirely on-device via
 * expo-notifications, no server round-trip and no push token needed. That's
 * deliberate: it's simple, works offline, and doesn't depend on
 * infrastructure that isn't built yet (see registerPushToken below for the
 * distinction).
 */
export async function scheduleStreakReminder(departmentName: string): Promise<void> {
  await cancelStreakReminder();

  const granted = await requestNotificationPermissions();
  if (!granted) return;

  let target = new Date();
  target.setHours(REMINDER_HOUR, 0, 0, 0);
  if (target.getTime() <= Date.now()) {
    target.setDate(target.getDate() + 1);
  }
  // Honour the student's quiet hours (set in Study setup): if the reminder would land inside them, wait until they end.
  await loadStudy();
  target = shiftOutOfQuiet(getStudyData().prefs, target);

  await Notifications.scheduleNotificationAsync({
    identifier: STREAK_REMINDER_ID,
    content: {
      title: "Protect your streak 🔥",
      body: `You haven't taken today's ${departmentName} quiz yet — a couple of minutes keeps it alive.`,
    },
    trigger: target,
  });
}

/** Call this once a student completes today's quiz — no need to nag them further today. */
export async function cancelStreakReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(STREAK_REMINDER_ID);
  } catch {
    // No-op: throws if nothing was scheduled under that identifier, which is expected most of the time.
  }
}

/**
 * Registers this device for push notifications and stores the token on the
 * user's profile. This is groundwork for a *future* feature (e.g. a teacher
 * publishing an announcement that pushes to their department) — the
 * server-side sending mechanism (a Supabase Edge Function calling Expo's
 * push API) is not built yet. This function only captures and stores the
 * token so that future piece has something to target.
 *
 * Silently no-ops on simulators/emulators (push tokens require a physical
 * device) and in Expo Go for SDK versions where remote push requires a
 * development build — failures here are expected in some environments and
 * shouldn't interrupt the rest of the app.
 */
let lastPushError: string | null = null;

/** Gets this phone's push token and saves it on the account. Throws with a reason if any step fails. */
async function registerOrThrow(userId: string): Promise<string> {
  if (!notificationsAvailable) throw new Error("EXPO_GO");
  if (!Device.isDevice) throw new Error("NOT_A_DEVICE"); // simulators/emulators can't get a real push token
  const granted = await requestNotificationPermissions();
  if (!granted) throw new Error("PERMISSION_DENIED");

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

  // The RPC also detaches this token from any other account that still holds it (shared phone). The direct
  // update is only a fallback for databases where migration 019/035 hasn't been applied yet.
  const { error } = await supabase.rpc("register_push_token", { p_token: tokenResponse.data });
  if (error) {
    const { error: fallback } = await supabase.from("profiles").update({ expo_push_token: tokenResponse.data }).eq("id", userId);
    if (fallback) throw error;
  }
  return tokenResponse.data;
}

/**
 * Registers this device for push notifications (class announcements, group replies) and stores the token on the
 * account. Failures never interrupt the app; the reason is kept for "Check notifications" in Profile.
 */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    await registerOrThrow(userId);
    lastPushError = null;
  } catch (err: any) {
    lastPushError = String(err?.message ?? err);
    console.log("[notifications] push token registration skipped:", err);
  }
}

export interface NotificationCheck { ok: boolean; title: string; message: string }

const FIREBASE_HINT = /firebase|fcm|google-services|InvalidCredentials|server key/i;
const FIREBASE_MESSAGE =
  "This version of Steth isn't connected to Google's notification service (Firebase) yet, so class announcements can't reach phones. " +
  "Reminders on this phone still work. The developer needs to finish the one-time Firebase setup and publish a new build.";

/** Step-by-step self test for the Profile screen: permission, a local notification, registration, then a real push from the server. */
export async function runNotificationCheck(userId: string): Promise<NotificationCheck> {
  if (Platform.OS === "web") return { ok: false, title: "Not in the web version", message: "Reminders and class alerts need the Steth app. The web version on iPhone can't send notifications." };
  if (!notificationsAvailable) return { ok: false, title: "Not available here", message: "Notifications don't work inside Expo Go. Open the installed Steth app instead." };
  if (!Device.isDevice) return { ok: false, title: "Use a real phone", message: "Notifications can't be tested on an emulator." };

  const granted = await requestNotificationPermissions();
  if (!granted) return { ok: false, title: "Notifications are off", message: "Open your phone's Settings → Apps → Steth → Notifications, turn them on, then check again." };

  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: "Steth reminder test ✅", body: "Reminders on this phone are working." },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
    });
  } catch (err: any) {
    return { ok: false, title: "Couldn't show a notification", message: String(err?.message ?? err) };
  }

  try {
    await registerOrThrow(userId);
    lastPushError = null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    lastPushError = msg;
    if (FIREBASE_HINT.test(msg)) return { ok: false, title: "Reminders work, class alerts don't yet", message: FIREBASE_MESSAGE };
    return { ok: false, title: "This phone couldn't register for class alerts", message: msg };
  }

  const { data, error } = await supabase.functions.invoke("notify", { body: { kind: "test" } });
  if (error) {
    const status = (error as any)?.context?.status;
    return {
      ok: false,
      title: "Class alerts aren't set up on the server",
      message: status === 404
        ? "The notification service hasn't been deployed yet. The developer needs to deploy the 'notify' function in Supabase."
        : `The notification service didn't answer (${error.message}).`,
    };
  }
  const res = (data ?? {}) as { sent?: number; hasToken?: boolean; problem?: string };
  if (!res.hasToken) return { ok: false, title: "Phone not registered yet", message: "Your phone's token wasn't saved. Make sure the database update (migration 035) has been applied, then check again." };
  if ((res.sent ?? 0) > 0) return { ok: true, title: "Everything works 🎉", message: "You should see two notifications: a reminder in a few seconds and a class-alert test just now." };
  if (res.problem && FIREBASE_HINT.test(res.problem)) return { ok: false, title: "Reminders work, class alerts don't yet", message: FIREBASE_MESSAGE };
  return { ok: false, title: "Class alert didn't go through", message: res.problem || "The server accepted the request but no notification was delivered." };
}

export const getLastPushError = () => lastPushError;

/** Stop sending pushes to this account (sign-out, or the student turned announcements/replies off). */
export async function clearPushToken(userId?: string): Promise<void> {
  try {
    const { error } = await supabase.rpc("clear_push_token");
    if (error && userId) await supabase.from("profiles").update({ expo_push_token: null }).eq("id", userId);
  } catch (err) {
    console.log("[notifications] clear push token skipped:", err);
  }
}
