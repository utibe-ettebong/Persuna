// Persona Desktop: the PERSUNA companion in a small window that stays above
// your other apps. It loads /companion from your PERSUNA server, so you sign
// in once and everything (chat, voice, notes, tasks) works as on the web.
// Screen watching can pick ANY app window (Figma, a video editor…), and only
// after you choose one. Nothing is captured until you do.
const { app, BrowserWindow, Menu, desktopCapturer, dialog, session, shell } = require("electron");

const APP_URL = process.env.PERSUNA_URL || "https://persuna-production.up.railway.app";
const ORIGIN = new URL(APP_URL).origin;
/** Paths that stay in the small window; anything else opens in your browser. */
const IN_WINDOW = [/^\/companion/, /^\/sign-(in|up)/, /^\/api\//];
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "notifications"]);

let win;

function isOurs(url) {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 640,
    minWidth: 320,
    minHeight: 420,
    title: "Persona",
    alwaysOnTop: true,
    autoHideMenuBar: true,
    // See-through and frameless: Persona floats over your desktop, not in a box.
    // Drag it by Persona itself.
    transparent: true,
    frame: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin" && { vibrancy: "under-window", visualEffectState: "active" }),
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(`${ORIGIN}/companion`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const keep = isOurs(url) && IN_WINDOW.some((re) => re.test(new URL(url).pathname));
    if (!keep) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
}

/** Asks which window Persona may watch. Persona's own window isn't offered. */
async function chooseSource() {
  const sources = (
    await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 0, height: 0 },
    })
  ).filter((s) => s.name && !/^Persona$/.test(s.name));
  const choices = sources.slice(0, 12);
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    message: "Which window should Persona watch?",
    detail:
      "Persona looks at this one window every 30 seconds while it changes, writes down your steps, and never keeps the screenshots. Stop any time from the companion.",
    buttons: [...choices.map((s) => s.name.slice(0, 60)), "Cancel"],
    cancelId: choices.length,
    noLink: true,
  });
  return response < choices.length ? choices[response] : null;
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isOurs(details.requestingUrl) && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return requestingOrigin === ORIGIN && ALLOWED_PERMISSIONS.has(permission);
  });
  // getDisplayMedia() from the companion lands here. On recent macOS the
  // system's own window picker is used; elsewhere, a simple list.
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!isOurs(request.securityOrigin ?? request.frame?.url ?? "")) return callback({});
      const source = await chooseSource();
      callback(source ? { video: source } : {});
    },
    { useSystemPicker: true },
  );

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      {
        label: "Window",
        submenu: [
          {
            label: "Keep on top",
            type: "checkbox",
            checked: true,
            click: (item) => win?.setAlwaysOnTop(item.checked, "floating"),
          },
          { role: "reload" },
          {
            label: "Close Persona",
            accelerator: "CmdOrCtrl+W",
            click: () => win?.close(),
          },
          { role: "minimize" },
        ],
      },
    ]),
  );

  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
