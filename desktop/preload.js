// The only bridge between the PERSUNA page and the desktop app: the page says
// when the pointer is over Persona (so clicks there land on it, and pass
// through everywhere else), can hide the overlay, and hears the global
// shortcut and the hold-to-talk key.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("personaDesktop", {
  overlay: true,
  setInteractive: (on) => ipcRenderer.send("persona:interactive", Boolean(on)),
  hide: () => ipcRenderer.send("persona:hide"),
  // The screen or window to watch (asked once, then remembered): its source id, or null.
  pickScreen: () => ipcRenderer.invoke("persona:pick-screen"),
  // The call shortcut's label (it can be changed from the menu bar), now and when it changes.
  shortcut: () => ipcRenderer.invoke("persona:shortcut"),
  onShortcut: (handler) => {
    ipcRenderer.removeAllListeners("persona:shortcut");
    ipcRenderer.on("persona:shortcut", (_event, label) => handler(label));
  },
  // Hold-to-talk: "start" / "end" / "cancel", or "type" on a double tap.
  onHold: (handler) => {
    ipcRenderer.removeAllListeners("persona:hold");
    ipcRenderer.on("persona:hold", (_event, phase) => handler(phase));
  },
  holdKey: () => ipcRenderer.invoke("persona:hold-key"),
  // One look at the screen (Persuna left out), or null without Screen Recording.
  look: () => ipcRenderer.invoke("persona:look"),
  // Watching started or stopped (Persuna hides itself from captures meanwhile).
  watching: (on) => ipcRenderer.send("persona:watching", Boolean(on)),
  // Where the island sits: on the notch, or hanging from the top centre.
  island: () => ipcRenderer.invoke("persona:island"),
  onIsland: (handler) => {
    ipcRenderer.removeAllListeners("persona:island");
    ipcRenderer.on("persona:island", (_event, shape) => handler(shape));
  },
  // Permissions, asked for from the island: { mic, screen, keyboard } each
  // "granted" / "denied" / "not-determined"; ask("mic" | "screen" | "keyboard").
  permissions: () => ipcRenderer.invoke("persona:permissions"),
  askPermission: (kind) => ipcRenderer.invoke("persona:ask-permission", String(kind)),
  // Take the keyboard while the island is open (clicking elsewhere then closes it).
  focus: () => ipcRenderer.send("persona:focus"),
  // A light tap on the trackpad when Work mode nudges you.
  nudge: () => ipcRenderer.send("persona:nudge"),
  // ⌃⌥C: circle something to ask about it.
  onCircle: (handler) => {
    ipcRenderer.removeAllListeners("persona:circle");
    ipcRenderer.on("persona:circle", () => handler());
  },
  // Copying and pasting for you: paste resolves true once it pressed ⌘V in your app.
  copy: (text) => ipcRenderer.send("persona:copy", String(text)),
  paste: (text) => ipcRenderer.invoke("persona:paste", String(text)),
  // Files Persuna made, saved to Downloads: their file name, or null.
  saveFile: (file) => ipcRenderer.invoke("persona:save-file", file),
  savePdf: (doc) => ipcRenderer.invoke("persona:save-pdf", doc),
  onHoldKey: (handler) => {
    ipcRenderer.removeAllListeners("persona:hold-key");
    ipcRenderer.on("persona:hold-key", (_event, label) => handler(label));
  },
  onCall: (handler) => {
    ipcRenderer.removeAllListeners("persona:call");
    ipcRenderer.on("persona:call", () => handler());
  },
});
