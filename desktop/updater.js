// Keeps Persuna Desktop up to date from its GitHub releases, without
// reinstalling: it checks at launch and every few hours, downloads a newer
// version in the background, and installs it when Persuna restarts or quits.
//
// Windows uses electron-updater (the NSIS installer updates in place).
// On a Mac, electron-updater (Squirrel.Mac) only accepts apps signed with an
// Apple Developer ID, which Persuna isn't yet, so the Mac does it itself:
// download the zip for this chip, check its SHA-512 against the release's
// update file, unpack it, and swap the app bundle once Persuna has quit.
const { app, net } = require("electron");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { canReplaceAt, isNewer, parseUpdateInfo, pickMacZip } = require("./update-info");

const REPO = "utibe-ettebong/Persuna";
// PERSUNA_UPDATES_FROM points the Mac updater at another copy of the
// releases (laid out like GitHub's), for testing an update end to end.
const RELEASES = process.env.PERSUNA_UPDATES_FROM || `https://github.com/${REPO}/releases`;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_MS = process.env.PERSUNA_UPDATES_FROM ? 1000 : 30_000;

/**
 * state: { status: "idle" | "checking" | "downloading" | "ready" | "manual" | "error",
 *          version?, progress? (0–1), error? }
 * "manual" means a newer version exists but this copy can't replace itself
 * (opened from the disk image, or a folder it can't write to).
 */
function createUpdater({ onChange }) {
  let state = { status: "idle" };
  let staged = null; // Mac: the unpacked new Persuna.app, ready to swap in.
  let installing = false;
  const set = (next) => {
    state = { ...next };
    onChange(state);
  };
  const MAC = process.platform === "darwin";
  const bundle = () => path.resolve(process.execPath, "../../..");

  /* ---------- Windows ---------- */

  let winUpdater = null;
  function windows() {
    if (winUpdater) return winUpdater;
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
    autoUpdater.on("update-not-available", () => set({ status: "idle" }));
    autoUpdater.on("download-progress", (p) =>
      set({ status: "downloading", progress: p.percent / 100, version: state.version }),
    );
    autoUpdater.on("update-available", (info) =>
      set({ status: "downloading", version: info.version, progress: 0 }),
    );
    autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
    autoUpdater.on("error", (error) =>
      set({ status: "error", error: String(error?.message ?? error) }),
    );
    winUpdater = autoUpdater;
    return autoUpdater;
  }

  /* ---------- Mac ---------- */

  const updatesDir = () => path.join(app.getPath("userData"), "updates");

  async function macCheck() {
    if (state.status === "downloading" || state.status === "ready") return;
    set({ status: "checking" });
    const res = await net.fetch(`${RELEASES}/latest/download/latest-mac.yml`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Update check: HTTP ${res.status}`);
    const info = parseUpdateInfo(await res.text());
    if (!info || !isNewer(info.version, app.getVersion())) return set({ status: "idle" });
    const file = pickMacZip(info, process.arch);
    if (!file) return set({ status: "idle" });
    let writable = false;
    try {
      fs.accessSync(path.dirname(bundle()), fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    if (!canReplaceAt(bundle(), writable)) return set({ status: "manual", version: info.version });

    // Download, hashing as it arrives, then check against the update file.
    fs.rmSync(updatesDir(), { recursive: true, force: true });
    fs.mkdirSync(updatesDir(), { recursive: true });
    const zip = path.join(updatesDir(), file.url);
    set({ status: "downloading", version: info.version, progress: 0 });
    const download = await net.fetch(
      `${RELEASES}/download/desktop-v${info.version}/${encodeURIComponent(file.url)}`,
    );
    if (!download.ok || !download.body) throw new Error(`Download: HTTP ${download.status}`);
    const hash = createHash("sha512");
    let received = 0;
    let lastReport = 0;
    const body = Readable.fromWeb(download.body);
    body.on("data", (chunk) => {
      hash.update(chunk);
      received += chunk.length;
      if (file.size && Date.now() - lastReport > 500) {
        lastReport = Date.now();
        set({ status: "downloading", version: info.version, progress: received / file.size });
      }
    });
    await pipeline(body, fs.createWriteStream(zip));
    if (hash.digest("base64") !== file.sha512) {
      fs.rmSync(updatesDir(), { recursive: true, force: true });
      throw new Error("The download didn't match the release's fingerprint; it was discarded.");
    }

    // Unpack with ditto (keeps the app's signature, links and permissions).
    const unpacked = path.join(updatesDir(), "app");
    await run("/usr/bin/ditto", ["-x", "-k", zip, unpacked]);
    fs.rmSync(zip, { force: true });
    const newApp = fs
      .readdirSync(unpacked)
      .map((name) => path.join(unpacked, name))
      .find((p) => p.endsWith(".app"));
    if (!newApp) throw new Error("The update had no app inside.");
    staged = { app: newApp, version: info.version };
    set({ status: "ready", version: info.version });
  }

  /**
   * Swaps the new app in once this process has exited, then (optionally)
   * opens it. A small shell script does it, so it runs after Persuna quits.
   * If anything fails, the old app is put back.
   */
  function macSwap(relaunch) {
    if (!staged || installing) return false;
    installing = true;
    const script = path.join(updatesDir(), "install.sh");
    fs.writeFileSync(
      script,
      `#!/bin/bash
PID="$1"; APP="$2"; NEW="$3"; RELAUNCH="$4"
for _ in $(seq 1 300); do kill -0 "$PID" 2>/dev/null || break; sleep 0.1; done
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && mv "$NEW" "$APP"; then
  rm -rf "$APP.old"
else
  [ -d "$APP.old" ] && [ ! -d "$APP" ] && mv "$APP.old" "$APP"
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
[ "$RELAUNCH" = "1" ] && open "$APP"
exit 0
`,
      { mode: 0o755 },
    );
    spawn("/bin/bash", [script, String(process.pid), bundle(), staged.app, relaunch ? "1" : "0"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  }

  /* ---------- Both ---------- */

  async function check() {
    try {
      if (MAC) await macCheck();
      else await windows().checkForUpdates();
    } catch (error) {
      set({ status: "error", error: String(error?.message ?? error), version: state.version });
    }
  }

  return {
    get state() {
      return state;
    },
    /** Checks soon after launch, then every few hours. */
    start() {
      setTimeout(() => void check(), FIRST_CHECK_MS);
      setInterval(() => void check(), CHECK_EVERY_MS);
    },
    check,
    /** Restart into the downloaded version now. */
    installNow() {
      if (state.status !== "ready") return;
      if (MAC) {
        if (macSwap(true)) app.exit(0);
      } else {
        windows().quitAndInstall(true, true);
      }
    },
    /** Quitting with an update waiting: install it on the way out (no relaunch). */
    installOnQuit() {
      if (MAC && state.status === "ready") macSwap(false);
      // Windows: electron-updater installs on quit by itself.
    },
  };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

module.exports = { createUpdater };
