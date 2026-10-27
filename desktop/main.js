// Persuna Desktop. Your Persuna lives in a see-through layer over your whole
// screen, above every app (even full-screen ones), and clicks pass straight
// through it except where Persona and its conversation are. It loads
// /companion from your PERSUNA server, so chat, voice, notes and tasks work
// as on the web.
//
// Watching is still your choice each time. The operating system asks once
// (macOS: Screen Recording); after that, turning watching on in Persona
// starts it without a picker, using the screen or window you chose and
// asked it to remember. Persona's own layer never appears in what it sees.
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = process.env.PERSUNA_URL || "https://persuna-production.up.railway.app";
const ORIGIN = new URL(APP_URL).origin;
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "notifications"]);
const MAC = process.platform === "darwin";

let overlay = null;
let signIn = null;
let tray = null;

/* ---------- Settings (a small JSON file in the app's data folder) ---------- */

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

function isOurs(url) {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}
const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

/* ---------- The overlay: Persona over the whole screen ---------- */

function createOverlay() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    title: "Persuna",
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Above everything, on every desktop and over full-screen apps.
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks go through to the apps underneath until the pointer is over Persona.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // Persona never shows up in screenshots or in what it watches.
  overlay.setContentProtection(true);
  overlay.loadURL(`${ORIGIN}/companion?overlay=1`);
  // Show the layer only once it holds Persuna. Signed out, it lands on the
  // sign-in page, which must never cover the screen (clicks pass through it).
  overlay.once("ready-to-show", () => {
    if (/^\/companion/.test(pathOf(overlay?.webContents.getURL() ?? ""))) overlay?.showInactive();
  });

  overlay.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  overlay.webContents.on("will-navigate", (event, url) => {
    if (isOurs(url) && /^\/companion/.test(pathOf(url))) return;
    event.preventDefault();
    if (isOurs(url) && /^\/sign-(in|up)/.test(pathOf(url))) return openSignIn(url);
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // Signed out: the server redirects to /sign-in. That needs a normal window.
  overlay.webContents.on("did-navigate", (_e, url) => {
    if (/^\/sign-(in|up)/.test(pathOf(url))) {
      overlay?.hide();
      overlay?.loadURL("about:blank");
      openSignIn(url);
    }
  });
  overlay.on("closed", () => (overlay = null));
}

function openSignIn(url) {
  overlay?.hide();
  if (signIn) return signIn.focus();
  signIn = new BrowserWindow({
    width: 460,
    height: 680,
    title: "Sign in to PERSUNA",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  signIn.loadURL(url);
  signIn.webContents.on("did-navigate", (_e, next) => {
    if (/^\/companion/.test(pathOf(next))) {
      signIn?.close();
      void overlay?.loadURL(`${ORIGIN}/companion?overlay=1`).then(() => {
        overlay?.showInactive();
        rebuildTray();
      });
    }
  });
  signIn.webContents.setWindowOpenHandler(({ url: link }) => {
    if (/^https?:/.test(link)) void shell.openExternal(link);
    return { action: "deny" };
  });
  signIn.on("closed", () => (signIn = null));
}

/* ---------- Messages from the page (see preload.js) ---------- */

ipcMain.on("persona:interactive", (event, on) => {
  if (!overlay || event.sender !== overlay.webContents) return;
  overlay.setIgnoreMouseEvents(!on, { forward: true });
});
ipcMain.on("persona:hide", (event) => {
  if (overlay && event.sender === overlay.webContents) overlay.hide();
  rebuildTray();
});

/* ---------- Watching ---------- */

const SCREEN_SETTINGS = MAC
  ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
  : null;

/** macOS asks once for Screen Recording. Explain and open Settings if it was refused. */
async function screenAllowed() {
  if (!MAC) return true;
  const status = systemPreferences.getMediaAccessStatus("screen");
  if (status === "granted" || status === "not-determined") return true;
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: "Persuna needs Screen Recording permission to watch",
    detail:
      "Open System Settings → Privacy & Security → Screen Recording, turn on Persuna, then quit and reopen Persuna. It only watches while you have watching turned on.",
    buttons: ["Open System Settings", "Not now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) void shell.openExternal(SCREEN_SETTINGS);
  return false;
}

/** The remembered screen or window, or ask once (and offer to remember). */
async function chooseSource() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 0, height: 0 },
  });
  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  const windows = sources.filter(
    (s) => s.id.startsWith("window:") && s.name && s.name !== "Persuna",
  );
  const saved = readSettings().watch;
  if (saved?.kind === "screen" && screens[0]) return screens[0];
  if (saved?.kind === "window") {
    const match = windows.find((w) => w.name === saved.name);
    if (match) return match;
  }

  const choices = [
    ...(screens[0] ? [{ label: "My whole screen", source: screens[0], kind: "screen" }] : []),
    ...windows.slice(0, 10).map((w) => ({ label: w.name.slice(0, 60), source: w, kind: "window" })),
  ];
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: "question",
    message: "What should Persuna watch?",
    detail:
      "Persuna looks every 30 seconds while it changes, writes down your steps, and keeps no screenshots. Stop any time from Persuna.",
    buttons: [...choices.map((c) => c.label), "Cancel"],
    cancelId: choices.length,
    noLink: true,
    checkboxLabel: "Remember this, and don't ask again (change it from the menu bar icon)",
    checkboxChecked: true,
  });
  const picked = choices[response];
  if (!picked) return null;
  if (checkboxChecked) {
    writeSettings({ watch: { kind: picked.kind, name: picked.source.name } });
    rebuildTray();
  }
  return picked.source;
}

/* ---------- Menu bar / system tray ---------- */

function rebuildTray() {
  if (!tray) return;
  const watch = readSettings().watch;
  const visible = Boolean(overlay?.isVisible());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: visible ? "Hide Persuna" : "Show Persuna",
        click: () => {
          if (!overlay) createOverlay();
          else if (overlay.isVisible()) overlay.hide();
          else overlay.showInactive();
          rebuildTray();
        },
      },
      { type: "separator" },
      {
        label: watch
          ? `Watches: ${watch.kind === "screen" ? "whole screen" : watch.name}`
          : "Watches: asks each time",
        enabled: false,
      },
      {
        label: "Ask what to watch next time",
        enabled: Boolean(watch),
        click: () => {
          writeSettings({ watch: null });
          rebuildTray();
        },
      },
      { type: "separator" },
      {
        label: "Open at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { label: "Open PERSUNA in the browser", click: () => void shell.openExternal(ORIGIN) },
      { label: "Reload Persuna", click: () => overlay?.reload() },
      { type: "separator" },
      { label: "Quit Persuna", role: "quit" },
    ]),
  );
}

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "build", MAC ? "trayTemplate.png" : "tray.png"),
  );
  if (MAC) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Persuna");
  rebuildTray();
}

/* ---------- Start ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    overlay?.showInactive();
    rebuildTray();
  });

  app.whenReady().then(() => {
    // Live in the menu bar / tray rather than the Dock.
    if (MAC) app.dock?.hide();
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(isOurs(details.requestingUrl) && ALLOWED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler(
      (_wc, permission, origin) => origin === ORIGIN && ALLOWED_PERMISSIONS.has(permission),
    );
    // Persona's "watch" calls getDisplayMedia(); answer it with the chosen source.
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!isOurs(request.securityOrigin ?? request.frame?.url ?? "")) return callback({});
      if (!(await screenAllowed())) return callback({});
      const source = await chooseSource();
      callback(source ? { video: source } : {});
    });
    // macOS asks for the microphone the first time Persona listens.
    if (MAC) void systemPreferences.askForMediaAccess("microphone").catch(() => {});

    createOverlay();
    createTray();
    screen.on("display-metrics-changed", () => {
      const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
      overlay?.setBounds({ x, y, width, height });
    });
  });

  // Closing every window keeps Persona in the menu bar; Quit is in its menu.
  app.on("window-all-closed", () => {});
}
