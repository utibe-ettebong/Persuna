// The only bridge between the PERSUNA page and the desktop app: the page says
// when the pointer is over Persuna (so clicks there land on it, and pass
// through everywhere else), can hide the overlay, and hears the global
// shortcut and the hold-to-talk key.
const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  overlay: true,
  setInteractive: (on) => ipcRenderer.send("persuna:interactive", Boolean(on)),
  hide: () => ipcRenderer.send("persuna:hide"),
  // The screen or window to watch (asked once, then remembered): its source id, or null.
  pickScreen: () => ipcRenderer.invoke("persuna:pick-screen"),
  // The call shortcut's label (it can be changed from the menu bar), now and when it changes.
  shortcut: () => ipcRenderer.invoke("persuna:shortcut"),
  onShortcut: (handler) => {
    ipcRenderer.removeAllListeners("persuna:shortcut");
    ipcRenderer.on("persuna:shortcut", (_event, label) => handler(label));
  },
  // Hold-to-talk: "start" / "end" / "cancel", or "type" on a double tap.
  onHold: (handler) => {
    ipcRenderer.removeAllListeners("persuna:hold");
    ipcRenderer.on("persuna:hold", (_event, phase) => handler(phase));
  },
  holdKey: () => ipcRenderer.invoke("persuna:hold-key"),
  // One look at the screen (Persuna left out), or null without Screen Recording.
  look: () => ipcRenderer.invoke("persuna:look"),
  // Watching started or stopped (Persuna hides itself from captures meanwhile).
  watching: (on) => ipcRenderer.send("persuna:watching", Boolean(on)),
  // Where the island sits: on the notch, or hanging from the top centre.
  island: () => ipcRenderer.invoke("persuna:island"),
  onIsland: (handler) => {
    ipcRenderer.removeAllListeners("persuna:island");
    ipcRenderer.on("persuna:island", (_event, shape) => handler(shape));
  },
  // Permissions, asked for from the island: { mic, screen, keyboard } each
  // "granted" / "denied" / "not-determined"; ask("mic" | "screen" | "keyboard").
  permissions: () => ipcRenderer.invoke("persuna:permissions"),
  askPermission: (kind) => ipcRenderer.invoke("persuna:ask-permission", String(kind)),
  // Take the keyboard while the island is open (clicking elsewhere then closes it).
  focus: () => ipcRenderer.send("persuna:focus"),
  // A light tap on the trackpad when Work mode nudges you.
  nudge: () => ipcRenderer.send("persuna:nudge"),
  // Updates: { status: "idle" | "checking" | "downloading" | "ready" | "manual" |
  // "error", version?, progress? }, now and as it changes; and restart into it.
  updateState: () => ipcRenderer.invoke("persuna:update-state"),
  onUpdate: (handler) => {
    ipcRenderer.removeAllListeners("persuna:update");
    ipcRenderer.on("persuna:update", (_event, state) => handler(state));
  },
  installUpdate: () => ipcRenderer.send("persuna:install-update"),
  // ⌃⌥C: circle something to ask about it.
  onCircle: (handler) => {
    ipcRenderer.removeAllListeners("persuna:circle");
    ipcRenderer.on("persuna:circle", () => handler());
  },
  // Copying and pasting for you: paste resolves true once it pressed ⌘V in your app.
  copy: (text) => ipcRenderer.send("persuna:copy", String(text)),
  paste: (text) => ipcRenderer.invoke("persuna:paste", String(text)),
  // Files Persuna made, saved to Downloads: their file name, or null.
  saveFile: (file) => ipcRenderer.invoke("persuna:save-file", file),
  savePdf: (doc) => ipcRenderer.invoke("persuna:save-pdf", doc),
  onHoldKey: (handler) => {
    ipcRenderer.removeAllListeners("persuna:hold-key");
    ipcRenderer.on("persuna:hold-key", (_event, label) => handler(label));
  },
  onCall: (handler) => {
    ipcRenderer.removeAllListeners("persuna:call");
    ipcRenderer.on("persuna:call", () => handler());
  },
};

contextBridge.exposeInMainWorld("persunaDesktop", bridge);
// Pages served from before the rename look for this name; keep both working.
contextBridge.exposeInMainWorld("personaDesktop", bridge);
