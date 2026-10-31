/**
 * Turns technical error text (from the network, the sign-in service or the database) into short, kind sentences
 * anyone can understand. Anything we don't recognise is left exactly as it was.
 */
const RULES: [RegExp, string][] = [
  [/network request failed|failed to fetch|network error|networkerror|timed out|timeout|could not connect|no internet|offline|load failed/i,
    "Can't reach the internet. Check your data or Wi-Fi, then try again."],
  [/invalid login credentials/i, "That email or password isn't right. Please check them and try again."],
  [/email not confirmed/i, "Please open the email we sent you and tap the link first. Then log in."],
  [/user already registered|already been registered|already registered/i, "This email already has an account. Tap Log In instead."],
  [/jwt expired|invalid jwt|refresh token|not authenticated|session (has )?expired|auth session missing/i, "You were signed out. Please log in again."],
  [/pro_required/i, "This part needs Pro."],
  [/too many (requests|attempts|wrong)|rate limit|over_request_rate_limit/i, "Too many tries. Please wait a minute, then try again."],
  [/could not find the function|schema cache|pgrst\d*|relation .* does not exist|function .* does not exist|column .* does not exist/i,
    "This part isn't ready yet. Please try again later."],
  [/row-level security|violates row-level|permission denied|not authorized|not allowed/i, "You're not allowed to do that."],
  [/duplicate key|already exists/i, "That is already there."],
  [/violates (check|foreign key|not-null)|invalid input syntax|null value in column/i, "Something is missing or not right in what you entered. Please check it and try again."],
  [/payload too large|file is too large|exceeds the maximum/i, "That file is too big. Please choose a smaller one."],
];

export function friendlyMessage(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  for (const [pattern, friendly] of RULES) if (pattern.test(text)) return friendly;
  return text;
}
