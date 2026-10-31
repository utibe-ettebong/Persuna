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
 * `heard` is the talk-key test: false means the hook is up but a real press
 * never reached it, which is denied however healthy the hook looks.
 * @param {{ mac: boolean, allowed?: boolean, listening?: boolean, error?: string | null, heard?: boolean | null }} opts
 */
function keyboardStatus({ mac, allowed = false, listening = false, error = null, heard = null }) {
  if (heard === false) return "denied";
  if (listening) return "granted";
  if (error) return "denied";
  if (mac) return allowed ? "not-determined" : "denied";
  return "not-determined";
}

/**
 * Seeing the screen: macOS asks, so its verdict counts. Windows never asks,
 * so the eyes probe decides — true when it read the front window and took a
 * screenshot, false when either failed, null before the first probe ran.
 * @param {{ mac: boolean, os?: string, eyes?: boolean | null }} opts
 */
function screenStatus({ mac, os = "unknown", eyes = null }) {
  if (!mac) return eyes === true ? "granted" : eyes === false ? "denied" : "unknown";
  return micStatus(mac, os);
}

/**
 * A capture that came back solid black: something blocked it. Takes a small
 * thumbnail's raw pixels (4 bytes each; the fourth is alpha, so it's skipped).
 * @param {Uint8Array} pixels
 */
function blankCapture(pixels) {
  for (let i = 0; i < pixels.length; i++) {
    if (i % 4 !== 3 && pixels[i] > 8) return false;
  }
  return true;
}

/** Plain words for a broken talk key, with the likeliest fix first. */
function keyboardFix(error) {
  const detail = error ? ` (${String(error).slice(0, 140)})` : "";
  return (
    `Persuna couldn't watch the talk key${detail}. ` +
    "Antivirus software often blocks this — allow Persuna, then test again."
  );
}

/** Plain words for a talk key that was pressed and never arrived. */
function keySilentFix(key) {
  return (
    `${key ?? "The talk key"} never reached Persuna. Antivirus or a keyboard tool may be ` +
    "blocking it: allow Persuna, or pick another key from the tray menu, then test again."
  );
}

/** Plain words for eyes that can't see, with the likeliest fix first. */
function eyesFix(why) {
  if (why === "missing") {
    return "Persuna's screen reader is missing. Antivirus may have removed it: restore persuna-eyes.exe, or reinstall Persuna Desktop.";
  }
  if (why === "blocked") {
    return "Something stopped Persuna's screen reader from running. Allow persuna-eyes.exe in your antivirus, then test again.";
  }
  if (why === "no-window") {
    return "The screen reader ran but found no window in front. Open an app, then test again.";
  }
  if (why === "no-capture") {
    return "Persuna couldn't take a screenshot, or it came back black. Allow Persuna in your antivirus, and check no screen-privacy tool is on, then test again.";
  }
  if (why === "timeout") {
    return "The screen reader timed out — something is blocking it. Allow Persuna in your antivirus, then test again.";
  }
  return "The screen reader didn't answer — allow Persuna in your antivirus, then test again.";
}

module.exports = {
  micStatus,
  keyboardStatus,
  screenStatus,
  blankCapture,
  keyboardFix,
  keySilentFix,
  eyesFix,
};
