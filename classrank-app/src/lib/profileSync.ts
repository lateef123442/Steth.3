/**
 * Tells the app "points or streak just changed on the server" so it can refresh what is shown on Home and Profile.
 * Course quizzes, topics, exams and resources update the numbers in the database, but nothing used to reload them.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onProfileStale(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function markProfileStale(): void {
  listeners.forEach((l) => { try { l(); } catch { /* a listener must never break the activity itself */ } });
}
