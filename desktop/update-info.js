// Reading a release's update file (latest-mac.yml, written by electron-builder)
// and deciding whether it's newer. No Electron here, so it's tested directly
// (src/lib/desktop/update-info.test.ts).

/** "0.6.10" > "0.6.9"; pre-release tags ("-beta") count as older. */
function isNewer(candidate, current) {
  const parse = (v) => {
    const [core, pre] = String(v).replace(/^v/, "").split("-", 2);
    return { parts: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: Boolean(pre) };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a.parts[i] ?? 0) !== (b.parts[i] ?? 0)) return (a.parts[i] ?? 0) > (b.parts[i] ?? 0);
  }
  return !a.pre && b.pre;
}

/**
 * The parts of an electron-builder update file Persuna needs: the version
 * and each file's name, SHA-512 (base64) and size. A tiny reader for that
 * one known shape, not a general YAML parser.
 */
function parseUpdateInfo(text) {
  const unquote = (v) => v.trim().replace(/^['"]|['"]$/g, "");
  const version = /^version:\s*(.+)$/m.exec(text)?.[1];
  const files = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const start = /^\s*-\s+url:\s*(.+)$/.exec(line);
    if (start) {
      current = { url: unquote(start[1]), sha512: "", size: 0 };
      files.push(current);
      continue;
    }
    if (!current || !/^\s{4,}\S/.test(line)) {
      if (!/^\s/.test(line)) current = null;
      continue;
    }
    const field = /^\s+(sha512|size):\s*(.+)$/.exec(line);
    if (field)
      current[field[1]] = field[1] === "size" ? Number(unquote(field[2])) : unquote(field[2]);
  }
  if (!version || !files.length) return null;
  return { version: unquote(version), files: files.filter((f) => f.url && f.sha512) };
}

/** The Mac zip for this chip ("arm64" or "x64"), or null. */
function pickMacZip(info, arch) {
  const want = arch === "arm64" ? "arm64" : "x64";
  return info.files.find((f) => f.url.endsWith(`-mac-${want}.zip`)) ?? null;
}

/**
 * Whether Persuna can replace itself where it's installed: not from a disk
 * image, not from a quarantine copy macOS made ("App Translocation"), and
 * in a folder it may write to.
 */
function canReplaceAt(bundlePath, folderWritable) {
  if (!bundlePath.endsWith(".app")) return false;
  if (bundlePath.startsWith("/Volumes/")) return false;
  if (bundlePath.includes("/AppTranslocation/")) return false;
  return folderWritable;
}

module.exports = { isNewer, parseUpdateInfo, pickMacZip, canReplaceAt };
