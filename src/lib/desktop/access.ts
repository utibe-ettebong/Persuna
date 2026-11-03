/** Setup's permission rows, as the desktop reports them. */
export type Access = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

/**
 * Whether setup may leave the Permissions step (its Continue button). The Mac
 * needs the microphone and Accessibility; watching the screen stays opt-in and
 * is asked for when used. Windows has no OS permission moment — setup's own
 * tests are the verdict — so all three must actually work before setup calls
 * itself ready.
 */
export function accessContinues(
  mac: boolean,
  access: { mic?: Access; keyboard?: Access; screen?: Access },
): boolean {
  const ok = (a?: Access) => a === "granted";
  if (!ok(access.mic) || !ok(access.keyboard)) return false;
  return mac || ok(access.screen);
}
