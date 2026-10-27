/** The browser's local clock, sent with chat turns so times mean the user's time. */
export function clock() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const now = new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 16);
  return { day: now.slice(0, 10), now, offset };
}
