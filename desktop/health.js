// Permission health, desktop side: the real statuses behind setup's rows.
// Pure (no Electron), so the web suite pins them. The rule: a permission is
// granted only when its feature actually works — allowed on paper but broken
// in reality reports denied, with words saying how to fix it.

/**
 * The microphone: whatever the OS reports, on Mac and Windows alike.
 * @param {boolean} mac
 * @param {string} os
 */
function micStatus(mac, os) {
  void mac;
  return ["granted", "denied", "not-determined", "restricted", "unknown"].includes(os)
    ? os
    : "unknown";
}

/**
 * The talk key: granted only while the global hook is listening. On a Mac
 * the OS verdict counts too; on Windows there is no OS prompt, so a hook
 * that failed to start is denied, and one never tried is not-determined.
 * @param {{ mac: boolean, allowed?: boolean, listening?: boolean, error?: string | null }} opts
 */
function keyboardStatus({ mac, allowed = false, listening = false, error = null }) {
  if (listening) return "granted";
  if (error) return "denied";
  if (mac) return allowed ? "not-determined" : "denied";
  return "not-determined";
}

/**
 * Seeing the screen: macOS asks, so its verdict counts. Windows never asks,
 * so the eyes probe decides — true when it read the front window, false
 * when it failed, null before the first probe ran.
 * @param {{ mac: boolean, os?: string, eyes?: boolean | null }} opts
 */
function screenStatus({ mac, os = "unknown", eyes = null }) {
  if (!mac) return eyes === true ? "granted" : eyes === false ? "denied" : "unknown";
  return micStatus(mac, os);
}

/** Plain words for a broken talk key, with the likeliest fix first. */
function keyboardFix(error) {
  const detail = error ? ` (${String(error).slice(0, 140)})` : "";
  return (
    `Persuna couldn't watch the talk key${detail}. ` +
    "Antivirus software often blocks this — allow Persuna, then test again."
  );
}

/** Plain words for eyes that can't see, with the likeliest fix first. */
function eyesFix(why) {
  if (why === "missing") {
    return "Persuna's screen reader is missing from this install — reinstall Persuna Desktop.";
  }
  if (why === "timeout") {
    return "The screen reader timed out — something is blocking it. Allow Persuna in your antivirus, then test again.";
  }
  return "The screen reader didn't answer — allow Persuna in your antivirus, then test again.";
}

module.exports = { micStatus, keyboardStatus, screenStatus, keyboardFix, eyesFix };
