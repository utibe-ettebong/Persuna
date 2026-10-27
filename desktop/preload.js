// The only bridge between the PERSUNA page and the desktop app: the page says
// when the pointer is over Persona (so clicks there land on it, and pass
// through everywhere else), and can hide the overlay.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("personaDesktop", {
  overlay: true,
  setInteractive: (on) => ipcRenderer.send("persona:interactive", Boolean(on)),
  hide: () => ipcRenderer.send("persona:hide"),
});
