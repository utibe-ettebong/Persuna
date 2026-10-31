// Operating apps in Work mode, desktop side: validation and AppleScript building.
// Pure (no Electron), so the web suite pins the exact scripts the Mac runs.
// The server validates first (src/lib/operate/actions.ts); the desktop checks
// again before touching anything.

function validOperateAction(action) {
  if (!action || typeof action !== "object") return null;
  const label = typeof action.label === "string" ? action.label.trim().slice(0, 140) : "";
  if (!label) return null;
  if (action.kind === "click") {
    const { x, y } = action;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 10000 || y > 10000) {
      return null;
    }
    return { kind: "click", x, y, label };
  }
  if (action.kind === "type") {
    if (typeof action.text !== "string" || !action.text || action.text.length > 500) return null;
    // No line breaks: pressing Return is its own approved step, never hidden in text.
    if (/[\u0000-\u001f\u007f]/.test(action.text.replace(/\t/g, ""))) return null;
    return { kind: "type", text: action.text, label };
  }
  if (action.kind === "key") {
    if (!/^(enter|tab|escape|space|up|down|left|right|delete|[a-z0-9])$/.test(action.key ?? "")) {
      return null;
    }
    const mods = Array.isArray(action.modifiers) ? action.modifiers : [];
    if (
      mods.length > 3 ||
      !mods.every((m) => ["command", "shift", "option", "control"].includes(m))
    ) {
      return null;
    }
    return { kind: "key", key: action.key, modifiers: [...new Set(mods)], label };
  }
  if (action.kind === "open") {
    if (!/^[\w][\w .'\-]{0,60}$/.test(action.app ?? "")) return null;
    return { kind: "open", app: action.app, label };
  }
  return null;
}

/** AppleScript string escaping: backslashes and quotes can't break out. */
function appleEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const KEY_CODES = {
  enter: 36,
  tab: 48,
  escape: 53,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  delete: 51,
};
const MOD_DOWN = {
  command: "command down",
  shift: "shift down",
  option: "option down",
  control: "control down",
};

/**
 * The AppleScript line(s) for a validated action: one line for click, key and
 * open; typed text in 40-character chunks (the stop word aborts between them).
 * Returns null for anything unvalidated.
 */
function osaScripts(action) {
  const run = validOperateAction(action);
  if (!run) return null;
  if (run.kind === "click") {
    return [`tell application "System Events" to click at {${run.x}, ${run.y}}`];
  }
  if (run.kind === "type") {
    const lines = [];
    for (let at = 0; at < run.text.length; at += 40) {
      lines.push(
        `tell application "System Events" to keystroke "${appleEscape(run.text.slice(at, at + 40))}"`,
      );
    }
    return lines;
  }
  if (run.kind === "key") {
    const using =
      run.modifiers.length > 0
        ? ` using {${run.modifiers.map((m) => MOD_DOWN[m]).join(", ")}}`
        : "";
    const press =
      run.key === "space" && run.modifiers.length === 0
        ? `keystroke " "`
        : KEY_CODES[run.key] != null
          ? `key code ${KEY_CODES[run.key]}${using}`
          : `keystroke "${run.key}"${using}`;
    return [`tell application "System Events" to ${press}`];
  }
  return [`tell application "${appleEscape(run.app)}" to activate`];
}

module.exports = { validOperateAction, osaScripts };
