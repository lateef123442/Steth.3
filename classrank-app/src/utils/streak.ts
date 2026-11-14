/**
 * The streak a person really has right now. The database only restarts a streak when the next study action happens, so a
 * student who stopped for a week would otherwise keep seeing their old number. Same rule as the server: a streak is alive
 * if the last study day was today or yesterday (Pro keeps a one-day Streak Shield, so two days ago still counts).
 */
export function effectiveStreak(p: { current_streak: number; last_quiz_date?: string | null; is_pro?: boolean; pro_expires_at?: string | null }): number {
  if (!p.current_streak || !p.last_quiz_date) return 0;
  const day = (s: string) => Date.parse(s.slice(0, 10)); // YYYY-MM-DD read as a UTC date, like the server's current_date
  const today = day(new Date().toISOString());
  const last = day(p.last_quiz_date);
  if (Number.isNaN(last)) return p.current_streak;
  const daysSince = Math.round((today - last) / 86_400_000);
  const proActive = !!p.is_pro && !!p.pro_expires_at && Date.parse(p.pro_expires_at) > Date.now();
  return daysSince <= (proActive ? 2 : 1) ? p.current_streak : 0;
}
