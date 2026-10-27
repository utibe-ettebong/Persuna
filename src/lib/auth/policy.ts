/**
 * Who may sign up and who is an admin, from comma-separated env lists.
 * Entries are emails ("ada@example.org") or whole domains ("@example.org").
 */
export function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesList(email: string, list: string[]): boolean {
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf("@"));
  return list.some((entry) => (entry.startsWith("@") ? entry === domain : entry === e));
}

/** An empty allowlist means sign-ups are open. */
export function signUpAllowed(email: string, allowlist: string[]): boolean {
  return allowlist.length === 0 || matchesList(email, allowlist);
}
