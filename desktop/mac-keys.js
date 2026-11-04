// The talk key on a Mac, from `persuna-eyes keys`: one line per key, "d 61"
// (down) or "u 61" (up), in Mac key codes. Pure: turns a line into the
// uiohook key codes the hold key already speaks.

/** Right ⌥, right ⌘ and right ⌃: the keys that can be held to talk. */
const MAC_TO_UIOHOOK = { 61: 3640, 54: 3676, 62: 3613 };
/** Every other key only has to differ from the talk key: kept clear of uiohook's codes. */
const OTHER = 0x10000;

/** A key going down or up, or null for a line that isn't one. */
function parseKeyLine(line) {
  const m = /^([du]) (\d{1,4})$/.exec(String(line).trim());
  if (!m) return null;
  const mac = Number(m[2]);
  return { down: m[1] === "d", code: MAC_TO_UIOHOOK[mac] ?? OTHER + mac };
}

module.exports = { parseKeyLine };
