// Persuna Desktop. Your Persuna lives in a bar at the top of your screen, in a
// see-through layer above every app (even full-screen ones); clicks pass
// straight through it except on Persuna itself. It loads /companion from your
// PERSUNA server, so chat, voice, notes and tasks work as on the web.
//
// Talk: hold right ⌥ (right Alt on Windows) from any app, and let go when
// you're done. Type: tap it twice quickly, or click Persuna. The key can be
// changed or turned off from the menu bar menu; ⌃⌥P (Ctrl+Alt+P) still starts
// a hands-free conversation.
//
// The first time, a setup window signs you in (in your browser, or there),
// asks for the Mac's permissions one at a time, tests the microphone, and
// gets you and Persuna acquainted.
//
// Watching is still your choice each time. The operating system asks once
// (macOS: Screen Recording); after that, turning watching on in Persona
// starts it without a picker, using the screen or window you chose and
// asked it to remember. When you talk or type to Persuna, it takes one look at
// the screen so it can see what you mean (switch that off from its menu).
// Persuna leaves itself out of what it sees, but shows in your own screenshots.
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
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createHoldKey } = require("./hold-key");

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
/** Keys that can be held to talk (uiohook key codes). */
const HOLD_KEYS = [
  { id: "right-option", code: 3640, mac: "right ⌥", other: "right Alt" },
  { id: "right-command", code: 3676, mac: "right ⌘", other: "right Windows key" },
  { id: "right-control", code: 3613, mac: "right ⌃", other: "right Ctrl" },
];
const DEFAULT_HOLD = "right-option";
let overlay = null;
let setup = null;
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

/**
 * Where Persuna's island goes: hugging the camera notch on a Mac that has
 * one, else hanging from the top centre of the screen (other Macs, Windows).
 * Electron can't ask macOS for the notch, so it's inferred: only built-in
 * displays have one, and they get a taller menu bar (about 37 points, not 24).
 */
function islandShape() {
  const display = screen.getPrimaryDisplay();
  const menuBar = display.workArea.y - display.bounds.y;
  const notch = MAC && display.internal && menuBar >= 30;
  return { notch, height: notch ? menuBar : 34, notchWidth: notch ? 196 : 0 };
}

function createOverlay() {
  // The whole screen, menu bar included, so the island can sit on the notch.
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  overlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    // Lets a frameless window cover the menu bar (macOS keeps others below it).
    enableLargerThanScreen: true,
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
  // Above your apps and the menu bar, on every desktop and over full-screen
  // apps. macOS's own prompts still come first (see stepAside).
  overlay.setAlwaysOnTop(true, MAC ? "status" : "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks go through to the apps underneath until the pointer is over Persona.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // Persuna shows in your screenshots and recordings; it hides itself only
  // from what it looks at itself (while watching, and for each look).
  overlay.setContentProtection(false);
  overlay.loadURL(`${ORIGIN}/companion?overlay=1`);
  // Show the layer only once it holds Persuna. Signed out, it lands on the
  // sign-in page, which must never cover the screen (clicks pass through it).
  overlay.once("ready-to-show", () => {
    // Not while setup is open: Persuna appears when it's done.
    if (!setup && /^\/companion/.test(pathOf(overlay?.webContents.getURL() ?? ""))) {
      overlay?.showInactive();
    }
  });

  overlay.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  overlay.webContents.on("will-navigate", (event, url) => {
    if (isOurs(url) && /^\/companion/.test(pathOf(url))) return;
    event.preventDefault();
    if (isOurs(url) && /^\/(sign-(in|up)|welcome)/.test(pathOf(url))) return openSetup();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // Signed out: the server redirects to /sign-in. Welcome them in a small window instead.
  overlay.webContents.on("did-navigate", (_e, url) => {
    if (/^\/(sign-(in|up)|welcome)/.test(pathOf(url))) {
      overlay?.hide();
      overlay?.loadURL("about:blank");
      openSetup();
    }
  });
  overlay.on("closed", () => (overlay = null));
}

/**
 * The setup window: sign in, the Mac's permissions, a mic test, practising
 * the talk key, and getting acquainted. Opens on first run, when signed out,
 * and from the menu bar menu.
 */
function openSetup() {
  overlay?.hide();
  if (setup) {
    setup.show();
    setup.focus();
    return;
  }
  setup = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 860,
    minHeight: 620,
    maximizable: false,
    fullscreenable: false,
    title: "Set up Persuna",
    titleBarStyle: MAC ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    backgroundColor: "#faf8fc",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "setup-preload.js"),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  setup.loadURL(`${ORIGIN}/desktop/setup`);
  setup.once("ready-to-show", () => {
    setup?.show();
    app.focus({ steal: true });
  });
  setup.webContents.on("will-navigate", (event, url) => {
    if (isOurs(url) && /^\/(desktop\/setup|sign-(in|up)|api\/)/.test(pathOf(url))) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  setup.webContents.setWindowOpenHandler(({ url: link }) => {
    if (/^https?:/.test(link)) void shell.openExternal(link);
    return { action: "deny" };
  });
  setup.on("closed", () => {
    setup = null;
    // Closed before finishing: Persuna still appears if you're signed in.
    if (overlay && !overlay.isVisible()) void showOverlay();
  });
}

/** Load Persuna's bar (fresh, so it picks up what setup saved) and show it. */
async function showOverlay() {
  if (!overlay) createOverlay();
  await overlay.loadURL(`${ORIGIN}/companion?overlay=1`).catch(() => {});
  if (/^\/companion/.test(pathOf(overlay?.webContents.getURL() ?? ""))) overlay?.showInactive();
  rebuildTray();
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
  // While watching, Persuna keeps itself out of the picture.
  if (source) setWatching(true);
  return source?.id ?? null;
});
ipcMain.on("persona:watching", (event, on) => {
  if (overlay && event.sender === overlay.webContents) setWatching(Boolean(on));
});
ipcMain.handle("persona:island", () => islandShape());

let watching = false;
function setWatching(on) {
  watching = on;
  overlay?.setContentProtection(on);
}

/** The longest side of a look, in pixels: plenty to read text, small enough to send. */
const LOOK_WIDTH = 1600;

/**
 * A screenshot of the main screen right now, for Persuna to understand what
 * you're asking about. Persuna hides itself from it. Null without Screen
 * Recording (it never asks from here: that's setup's job).
 */
ipcMain.handle("persona:look", async (event) => {
  if (!overlay || event.sender !== overlay.webContents) return null;
  if (MAC && systemPreferences.getMediaAccessStatus("screen") !== "granted") return null;
  const display = screen.getPrimaryDisplay();
  const scale = Math.min(1, LOOK_WIDTH / (display.size.width * display.scaleFactor));
  overlay.setContentProtection(true);
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor * scale),
        height: Math.round(display.size.height * display.scaleFactor * scale),
      },
    });
    const main = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!main || main.thumbnail.isEmpty()) return null;
    return `data:image/jpeg;base64,${main.thumbnail.toJPEG(72).toString("base64")}`;
  } catch {
    return null;
  } finally {
    overlay?.setContentProtection(watching);
  }
});

ipcMain.handle("persona:shortcut", () => shortcutLabel(callShortcut));

ipcMain.on("persona:hide", (event) => {
  if (overlay && event.sender === overlay.webContents) overlay.hide();
  rebuildTray();
});

/* ---------- Setup window (see setup-preload.js) ---------- */

const fromSetup = (event) => Boolean(setup) && event.sender === setup.webContents;
const PRIVACY = (pane) => `x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`;
/** The app on disk (Persuna.app), which you drag into System Settings' lists. */
const appBundle = () => (MAC ? path.resolve(process.execPath, "../../..") : process.execPath);

ipcMain.handle("setup:permissions", (event) => {
  if (!fromSetup(event)) return null;
  if (keyboardAllowed()) startKeyListener();
  return {
    mic: MAC ? systemPreferences.getMediaAccessStatus("microphone") : "granted",
    keyboard: keyboardAllowed() ? "granted" : "denied",
    screen: MAC ? systemPreferences.getMediaAccessStatus("screen") : "granted",
    holdKey: holdKeyLabel(),
    mac: MAC,
  };
});
ipcMain.handle("setup:ask-mic", async (event) => {
  if (!fromSetup(event) || !MAC) return true;
  if (systemPreferences.getMediaAccessStatus("microphone") === "denied") {
    void shell.openExternal(PRIVACY("Microphone"));
    return false;
  }
  return systemPreferences.askForMediaAccess("microphone");
});
ipcMain.handle("setup:ask-keyboard", (event) => {
  if (!fromSetup(event) || !MAC) return;
  // Adds Persuna to the list (switched off) and points the way.
  systemPreferences.isTrustedAccessibilityClient(true);
  void shell.openExternal(PRIVACY("Accessibility"));
});
ipcMain.handle("setup:ask-screen", async (event) => {
  if (!fromSetup(event) || !MAC) return;
  if (systemPreferences.getMediaAccessStatus("screen") === "granted") return;
  if (readSettings().screenAskedFor !== app.getVersion()) {
    writeSettings({ screenAskedFor: app.getVersion() });
    if (systemPreferences.getMediaAccessStatus("screen") !== "not-determined") {
      await forgetOldScreenPermission();
    }
    // Asking for a capture source is what makes macOS show its prompt.
    await desktopCapturer
      .getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } })
      .catch(() => {});
  }
  if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
    void shell.openExternal(PRIVACY("ScreenCapture"));
  }
});
ipcMain.on("setup:drag-app", (event) => {
  if (!fromSetup(event)) return;
  void app.getFileIcon(appBundle(), { size: "normal" }).then((icon) => {
    event.sender.startDrag({ file: appBundle(), icon });
  });
});
ipcMain.handle("setup:app-icon", async (event) => {
  if (!fromSetup(event)) return null;
  const icon = await app.getFileIcon(appBundle(), { size: "normal" }).catch(() => null);
  return icon ? icon.toDataURL() : null;
});
ipcMain.on("setup:restart", (event) => fromSetup(event) && restart());
ipcMain.on("setup:sign-in-browser", (event) => {
  if (!fromSetup(event)) return;
  signInState = randomBytes(24).toString("base64url");
  void shell.openExternal(`${ORIGIN}/desktop/connect?state=${signInState}`);
});
ipcMain.on("setup:finish", (event, options) => {
  if (!fromSetup(event)) return;
  app.setLoginItemSettings({ openAtLogin: Boolean(options?.openAtLogin) });
  writeSettings({ setupDone: true });
  const done = setup;
  setup = null;
  done?.removeAllListeners("closed");
  done?.close();
  void showOverlay();
});

/* ---------- Signing in through the browser (persuna://) ---------- */

/** The sign-in this app started; a persuna:// link must bring it back. */
let signInState = null;

/** persuna://signed-in?token=…&state=… from /desktop/connect. */
function openLink(url) {
  let link;
  try {
    link = new URL(url);
  } catch {
    return;
  }
  if (link.protocol !== "persuna:" || link.hostname !== "signed-in") return;
  const token = link.searchParams.get("token");
  const state = link.searchParams.get("state");
  if (!token || !signInState || state !== signInState) return;
  signInState = null;
  openSetup();
  void setup?.loadURL(`${ORIGIN}/api/desktop/sign-in?token=${encodeURIComponent(token)}`);
  app.focus({ steal: true });
}

/* ---------- Hold to talk (a system-wide key listener) ---------- */

let keyListener = null;
let keyWatch = null;
const holdKey = createHoldKey({ emit: onHoldKey });

const keyboardAllowed = () => !MAC || systemPreferences.isTrustedAccessibilityClient(false);
const chosenHoldKey = () => {
  const id = readSettings().holdKey ?? DEFAULT_HOLD;
  return HOLD_KEYS.find((k) => k.id === id) ?? null;
};
/** "right ⌥", or null when it's off or not listening yet. */
function holdKeyLabel() {
  const key = chosenHoldKey();
  return keyListener && key ? (MAC ? key.mac : key.other) : null;
}

/**
 * Starts listening for the talk key. macOS only allows it once Persuna is
 * switched on under Accessibility; until then it checks every few seconds,
 * so turning it on takes effect without a restart.
 */
function startKeyListener() {
  if (keyListener) return;
  if (!keyboardAllowed()) {
    keyWatch ??= setInterval(() => keyboardAllowed() && startKeyListener(), 2000);
    return;
  }
  clearInterval(keyWatch);
  keyWatch = null;
  try {
    const { uIOhook } = require("uiohook-napi");
    uIOhook.on("keydown", (e) => holdKey.keydown(e.keycode, Date.now()));
    uIOhook.on("keyup", (e) => holdKey.keyup(e.keycode, Date.now()));
    uIOhook.start();
    keyListener = uIOhook;
  } catch (error) {
    console.error("Persuna couldn't listen for the talk key:", error);
    return;
  }
  holdKey.setKey(chosenHoldKey()?.code ?? null);
  announceHoldKey();
}

function announceHoldKey() {
  overlay?.webContents.send("persona:hold-key", holdKeyLabel());
  rebuildTray();
}

function chooseHoldKey(id) {
  writeSettings({ holdKey: id });
  holdKey.setKey(chosenHoldKey()?.code ?? null);
  announceHoldKey();
}

/** The talk key did something: to the setup window while it's open, else to Persuna's bar. */
function onHoldKey(phase) {
  if (setup?.isVisible()) {
    setup.webContents.send("persona:hold", phase);
    return;
  }
  if (!overlay) createOverlay();
  if (!/^\/companion/.test(pathOf(overlay.webContents.getURL()))) return;
  if (!overlay.isVisible()) {
    overlay.showInactive();
    rebuildTray();
  }
  if (phase === "type") {
    // Typing needs the keyboard: bring Persuna forward.
    overlay.show();
    overlay.focus();
    app.focus({ steal: true });
  }
  overlay.webContents.send("persona:hold", phase);
}

ipcMain.handle("persona:hold-key", () => holdKeyLabel());

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
        label: "Hold to talk",
        submenu: [
          ...HOLD_KEYS.map((k) => ({
            label: MAC ? k.mac : k.other,
            type: "radio",
            checked: (readSettings().holdKey ?? DEFAULT_HOLD) === k.id,
            click: () => chooseHoldKey(k.id),
          })),
          {
            label: "Off",
            type: "radio",
            checked: readSettings().holdKey === "off",
            click: () => chooseHoldKey("off"),
          },
          ...(keyListener
            ? []
            : [
                { type: "separator" },
                { label: "Needs Accessibility: set it up…", click: openSetup },
              ]),
        ],
      },
      {
        label: "Hands-free conversation",
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
      { label: "Set up Persuna…", click: openSetup },
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
  const how = holdKeyLabel()
    ? `Hold ${holdKeyLabel()}`
    : callShortcut
      ? `Press ${shortcutLabel(callShortcut)}`
      : "Click its icon";
  const note = new Notification({
    title: "Persuna is running",
    body: `${how} to talk, any time. It's in your ${MAC ? "Dock and menu bar" : "system tray"}.`,
    silent: true,
  });
  note.on("click", callPersuna);
  note.show();
}

/* ---------- Start ---------- */

// persuna:// links (signing in through the browser) come to this app.
if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient("persuna", process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient("persuna");
}
// macOS hands links over as an event, which can arrive before the app is ready.
app.on("will-finish-launching", () => {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) openLink(url);
    else void app.whenReady().then(() => openLink(url));
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // Windows hands links over as an argument to a second launch.
    const link = argv.find((a) => a.startsWith("persuna://"));
    if (link) return openLink(link);
    overlay?.showInactive();
    rebuildTray();
  });
  // Clicking Persuna in the Dock calls it, like the shortcut.
  app.on("activate", () => {
    if (!setup) callPersuna();
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
    startKeyListener();
    createTray();
    if (!readSettings().setupDone) openSetup();
    else sayRunning();
    screen.on("display-metrics-changed", () => {
      const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
      overlay?.setBounds({ x, y, width, height });
      overlay?.webContents.send("persona:island", islandShape());
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    keyListener?.stop();
  });
  // Closing every window keeps Persona in the menu bar; Quit is in its menu.
  app.on("window-all-closed", () => {});
}
