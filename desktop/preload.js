// The only bridge between the PERSUNA page and the desktop app: the page says
// when the pointer is over Persona (so clicks there land on it, and pass
// through everywhere else), can hide the overlay, and hears when the global
// shortcut calls Persona.
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
  onCall: (handler) => {
    ipcRenderer.removeAllListeners("persona:call");
    ipcRenderer.on("persona:call", () => handler());
  },
});
