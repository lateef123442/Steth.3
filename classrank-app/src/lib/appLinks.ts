/**
 * Where friends can download Steth. Used in the invite message students share.
 * Set this to your website, for example "https://your-site.netlify.app". Leave it empty to share the code only.
 */
export const APP_DOWNLOAD_URL: string = "";

/** The text a student shares with a friend. The ?ref= part lets your website pick the code up later. */
export function inviteMessage(code: string, paid = false): string {
  const link = APP_DOWNLOAD_URL ? `${APP_DOWNLOAD_URL.replace(/\/+$/, "")}/?ref=${encodeURIComponent(code)}` : "";
  return (
    `Join me on Steth, the study app for Nigerian university students! ` +
    (paid ? `Sign up with my invite code ${code} and we both get 7 days of Pro free.` : `Sign up with my invite code ${code}.`) +
    (link ? `\nDownload: ${link}` : "") +
    `\nInvite code: ${code}`
  );
}
