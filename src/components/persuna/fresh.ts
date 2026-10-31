/** How often an open desktop island checks for a new version of the site. */
export const FRESH_CHECK_MS = 2 * 60_000;
/** A new version waits until you've been quiet this long. */
export const QUIET_MS = 60_000;

/**
 * Persuna Desktop keeps one page open for as long as it runs, so a deployed
 * fix never reaches it until a restart. True when the page should reload: the
 * server is on another build and nothing would be interrupted.
 */
export function shouldRefresh(
  loaded: string | null | undefined,
  current: unknown,
  quietFor: number,
  busy: boolean,
): boolean {
  if (!loaded || typeof current !== "string" || !current || current === loaded) return false;
  return !busy && quietFor >= QUIET_MS;
}
