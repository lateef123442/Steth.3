/**
 * Browser-only fixes. react-native-web leaves a few phone features empty, and the app relies on them:
 *  - Alert.alert does nothing in a browser, so every confirmation and error message would be invisible.
 *  - Share.share is not available in every browser.
 * Imported once at start-up (App.tsx) and only does anything on the web.
 */
import { Alert, Platform, Share } from "react-native";

type AlertButton = { text?: string; style?: "default" | "cancel" | "destructive"; onPress?: (value?: string) => void };

if (Platform.OS === "web" && typeof window !== "undefined") {
  (Alert as any).alert = (title: string, message?: string, buttons?: AlertButton[], options?: { onDismiss?: () => void }) => {
    const text = [title, message].filter(Boolean).join("\n\n");
    const list = buttons ?? [];
    const cancel = list.find((b) => b.style === "cancel");
    const actions = list.filter((b) => b !== cancel);

    // No buttons, or just one: a plain message, then run the button's action.
    if (actions.length === 0 && !cancel) { window.alert(text); return; }
    if (actions.length === 0 && cancel) { window.alert(text); cancel.onPress?.(); return; }
    if (actions.length === 1 && !cancel) { window.alert(text); actions[0].onPress?.(); return; }

    // A question: OK runs the (first) action, Cancel runs the cancel button. Extra actions are offered in turn.
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const last = i === actions.length - 1;
      const ask = last ? text : `${text}\n\nOK = "${a.text ?? "Yes"}"   ·   Cancel = see other options`;
      if (window.confirm(ask)) { a.onPress?.(); return; }
    }
    if (cancel) cancel.onPress?.(); else options?.onDismiss?.();
  };

  const nativeShare = (Share as any).share?.bind(Share);
  (Share as any).share = async (content: { message?: string; title?: string; url?: string }) => {
    const text = [content.message, content.url].filter(Boolean).join("\n");
    const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
    try {
      if (nav?.share) { await nav.share({ title: content.title, text }); return { action: "sharedAction" }; }
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        window.alert("Copied to your clipboard. Paste it into WhatsApp or any app to share.");
        return { action: "sharedAction" };
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return { action: "dismissedAction" }; // the person closed the share sheet
    }
    return nativeShare ? nativeShare(content) : { action: "dismissedAction" };
  };
}
