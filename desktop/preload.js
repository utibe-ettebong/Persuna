// The only bridge between the PERSUNA page and the desktop app: the page says
// when the pointer is over Persona (so clicks there land on it, and pass
// through everywhere else), can hide the overlay, and hears when the global
// shortcut calls Persona.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("personaDesktop", {
  overlay: true,
  setInteractive: (on) => ipcRenderer.send("persona:interactive", Boolean(on)),
  hide: () => ipcRenderer.send("persona:hide"),
  onCall: (handler) => {
    ipcRenderer.removeAllListeners("persona:call");
    ipcRenderer.on("persona:call", () => handler());
  },
});
