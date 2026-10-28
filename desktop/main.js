// Persuna Desktop. Your Persuna lives in a see-through layer over your whole
// screen, above every app (even full-screen ones), and clicks pass straight
// through it except where Persona and its conversation are. It loads
// /companion from your PERSUNA server, so chat, voice, notes and tasks work
// as on the web.
//
// Call Persuna from anywhere with ⌃⌥P (Ctrl+Alt+P on Windows; change it from
// the menu bar menu), by clicking it in the Dock, or from the menu bar icon: it listens, answers out loud, and goes quiet again.
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
  globalShortcut,
  ipcMain,
  nativeImage,
  Notification,
  screen,
  session,
  shell,
  systemPreferences,
} = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = process.env.PERSUNA_URL || "https://persuna-production.up.railway.app";
const ORIGIN = new URL(APP_URL).origin;
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "notifications"]);
const MAC = process.platform === "darwin";

/**
 * Shortcuts that call Persuna. The chosen one (menu bar menu → Call shortcut)
 * is tried first, then the rest, so one another app has taken never leaves
 * Persuna without a shortcut. ⌘Space and ⌘⇧Space belong to Spotlight and
 * search tools, so the default is ⌃⌥P (Ctrl+Alt+P on Windows).
 */
const CALL_SHORTCUTS = [
  { accelerator: "Control+Alt+P", mac: "⌃⌥P", other: "Ctrl+Alt+P" },
  { accelerator: "Control+Alt+Space", mac: "⌃⌥Space", other: "Ctrl+Alt+Space" },
  { accelerator: "Alt+Shift+P", mac: "⌥⇧P", other: "Alt+Shift+P" },
];
let callShortcut = null;
const shortcutLabel = (accelerator) => {
  const s = CALL_SHORTCUTS.find((c) => c.accelerator === accelerator);
  return s ? (MAC ? s.mac : s.other) : null;
};
let overlay = null;
let welcome = null;
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
      // Persuna may speak as soon as it appears, without waiting for a click.
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  // Above your apps, on every desktop and over full-screen apps, but below
  // macOS's own prompts and System Settings, so permissions stay clickable.
  overlay.setAlwaysOnTop(true, "floating");
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
    if (isOurs(url) && /^\/(sign-(in|up)|welcome)/.test(pathOf(url))) return openWelcome();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // Signed out: the server redirects to /sign-in. Welcome them in a small window instead.
  overlay.webContents.on("did-navigate", (_e, url) => {
    if (/^\/(sign-(in|up)|welcome)/.test(pathOf(url))) {
      overlay?.hide();
      overlay?.loadURL("about:blank");
      openWelcome();
    }
  });
  overlay.on("closed", () => (overlay = null));
}

/** The first-run window: a hello, then sign in or create an account. */
function openWelcome() {
  overlay?.hide();
  if (welcome) {
    welcome.show();
    welcome.focus();
    return;
  }
  welcome = new BrowserWindow({
    width: 420,
    height: 660,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Welcome to Persuna",
    titleBarStyle: MAC ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    backgroundColor: "#f8f6f8",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  welcome.loadURL(`${ORIGIN}/welcome`);
  welcome.once("ready-to-show", () => {
    welcome?.show();
    app.focus({ steal: true });
  });
  welcome.webContents.on("did-navigate", (_e, next) => {
    if (/^\/companion/.test(pathOf(next))) {
      welcome?.close();
      void overlay?.loadURL(`${ORIGIN}/companion?overlay=1`).then(() => {
        overlay?.showInactive();
        rebuildTray();
      });
    }
  });
  welcome.webContents.on("will-navigate", (event, url) => {
    if (isOurs(url) && /^\/(welcome|sign-(in|up)|companion|api\/)/.test(pathOf(url))) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  welcome.webContents.setWindowOpenHandler(({ url: link }) => {
    if (/^https?:/.test(link)) void shell.openExternal(link);
    return { action: "deny" };
  });
  welcome.on("closed", () => (welcome = null));
}

/* ---------- Messages from the page (see preload.js) ---------- */

ipcMain.on("persona:interactive", (event, on) => {
  if (!overlay || event.sender !== overlay.webContents) return;
  overlay.setIgnoreMouseEvents(!on, { forward: true });
});
ipcMain.handle("persona:pick-screen", async (event) => {
  if (!overlay || event.sender !== overlay.webContents) return null;
  if (!(await ensureScreenPermission())) return null;
  const source = await chooseSource();
  return source?.id ?? null;
});

ipcMain.handle("persona:shortcut", () => shortcutLabel(callShortcut));

ipcMain.on("persona:hide", (event) => {
  if (overlay && event.sender === overlay.webContents) overlay.hide();
  rebuildTray();
});

/* ---------- Watching ---------- */

const SCREEN_SETTINGS = MAC
  ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
  : null;

/** Let macOS's prompts and System Settings sit above Persuna while you answer them. */
function stepAside(aside) {
  if (!overlay) return;
  if (aside) overlay.setAlwaysOnTop(false);
  else overlay.setAlwaysOnTop(true, "floating");
}

/** Bring a dialog to the front: Persuna lives in the menu bar, so it isn't the active app. */
async function ask(options) {
  app.focus({ steal: true });
  return dialog.showMessageBox(options);
}

/**
 * Forget macOS's Screen Recording entry for Persuna. Builds that aren't
 * signed with an Apple Developer ID get a new identity with every version, so
 * an entry left by an earlier version shows Persuna as allowed while macOS
 * refuses this one. Clearing it lets macOS ask again for this version.
 */
const APP_ID = "app.persuna.persona";
function forgetOldScreenPermission() {
  return new Promise((resolve) => {
    execFile("/usr/bin/tccutil", ["reset", "ScreenCapture", APP_ID], () => resolve());
  });
}

/**
 * macOS Screen Recording. The first time (and once after each update), macOS
 * shows its own prompt; Persuna's own questions wait until that's answered,
 * so the two never sit on top of each other. macOS only lets Persuna see the
 * screen after a restart, so once you've turned it on, Persuna offers one
 * (here, in a notification, and at the top of its menu bar menu).
 */
async function ensureScreenPermission() {
  if (!MAC) return true;
  let status = systemPreferences.getMediaAccessStatus("screen");
  if (status === "granted") return true;
  stepAside(true);
  try {
    if (readSettings().screenAskedFor !== app.getVersion()) {
      writeSettings({ screenAskedFor: app.getVersion() });
      if (status !== "not-determined") await forgetOldScreenPermission();
      // Asking for a capture source is what makes macOS show its prompt.
      await desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } })
        .catch(() => {});
      status = systemPreferences.getMediaAccessStatus("screen");
      if (status === "granted") return true;
    }
    const { response } = await ask({
      type: "info",
      message: "Let Persuna see your screen",
      detail:
        "1. Click Open System Settings.\n2. Under Screen & System Audio Recording, turn Persuna on (if it's already on, turn it off and on again).\n3. Restart Persuna: macOS needs that before it can see.\n\nPersuna only watches while you've asked it to, and keeps no screenshots.",
      buttons: ["Open System Settings", "It's on: restart Persuna", "Not now"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 1) restart();
    if (response === 0) {
      void shell.openExternal(SCREEN_SETTINGS);
      offerRestart();
    }
    return false;
  } finally {
    stepAside(false);
  }
}

function restart() {
  app.relaunch();
  app.exit(0);
}

let restartOffered = false;
/** After System Settings opens: a notification, and a menu item, to restart once it's on. */
function offerRestart() {
  restartOffered = true;
  rebuildTray();
  if (Notification.isSupported()) {
    const note = new Notification({
      title: "Turned Persuna on?",
      body: "Click here to restart Persuna so it can see your screen.",
    });
    note.on("click", restart);
    note.show();
  }
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
  stepAside(true);
  const { response, checkboxChecked } = await ask({
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
  stepAside(false);
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
      ...(restartOffered
        ? [
            { label: "Restart Persuna to finish screen access", click: restart },
            { type: "separator" },
          ]
        : []),
      {
        label: "Talk to Persuna",
        accelerator: callShortcut ?? undefined,
        registerAccelerator: false,
        click: callPersuna,
      },
      {
        label: "Call shortcut",
        submenu: CALL_SHORTCUTS.map((c) => ({
          label: MAC ? c.mac : c.other,
          type: "radio",
          checked: c.accelerator === callShortcut,
          click: () => chooseShortcut(c.accelerator),
        })),
      },
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

/* ---------- Calling Persuna ---------- */

/** Bring Persuna up (if hidden) and have it listen, or stop it talking. */
function callPersuna() {
  if (!overlay) createOverlay();
  if (!overlay.isVisible() && /^\/companion/.test(pathOf(overlay.webContents.getURL()))) {
    overlay.showInactive();
    rebuildTray();
  }
  overlay.webContents.send("persona:call");
}

function registerCallShortcut() {
  if (callShortcut) globalShortcut.unregister(callShortcut);
  callShortcut = null;
  const chosen = readSettings().shortcut;
  const order = [
    ...CALL_SHORTCUTS.filter((c) => c.accelerator === chosen),
    ...CALL_SHORTCUTS.filter((c) => c.accelerator !== chosen),
  ];
  for (const { accelerator } of order) {
    try {
      if (globalShortcut.register(accelerator, callPersuna)) {
        callShortcut = accelerator;
        return;
      }
    } catch {
      // Taken or not allowed: try the next one.
    }
  }
}

function chooseShortcut(accelerator) {
  writeSettings({ shortcut: accelerator });
  registerCallShortcut();
  rebuildTray();
  // The page shows the shortcut beside Persuna.
  overlay?.webContents.send("persona:shortcut", shortcutLabel(callShortcut));
}

/** Once per launch: say Persuna is on, and how to call it. */
function sayRunning() {
  if (!Notification.isSupported()) return;
  const how = callShortcut ? `Press ${shortcutLabel(callShortcut)}` : "Click its icon";
  const note = new Notification({
    title: "Persuna is running",
    body: `${how} to talk, any time. It's in your ${MAC ? "Dock and menu bar" : "system tray"}.`,
    silent: true,
  });
  note.on("click", callPersuna);
  note.show();
}

/* ---------- Start ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    overlay?.showInactive();
    rebuildTray();
  });
  // Clicking Persuna in the Dock calls it, like the shortcut.
  app.on("activate", () => {
    if (!welcome) callPersuna();
  });

  app.whenReady().then(() => {
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
      if (!(await ensureScreenPermission())) return callback({});
      const source = await chooseSource();
      callback(source ? { video: source } : {});
    });
    // macOS asks for the microphone the first time Persona listens.
    if (MAC) void systemPreferences.askForMediaAccess("microphone").catch(() => {});

    createOverlay();
    registerCallShortcut();
    createTray();
    sayRunning();
    screen.on("display-metrics-changed", () => {
      const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
      overlay?.setBounds({ x, y, width, height });
    });
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());
  // Closing every window keeps Persona in the menu bar; Quit is in its menu.
  app.on("window-all-closed", () => {});
}
