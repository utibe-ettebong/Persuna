// The setup window's bridge to the app: permissions, the drag-me tile,
// signing in through the browser, and the talk key while you practise.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("personaSetup", {
  permissions: () => ipcRenderer.invoke("setup:permissions"),
  askMic: () => ipcRenderer.invoke("setup:ask-mic"),
  askKeyboard: () => ipcRenderer.invoke("setup:ask-keyboard"),
  askScreen: () => ipcRenderer.invoke("setup:ask-screen"),
  dragApp: () => ipcRenderer.send("setup:drag-app"),
  appIcon: () => ipcRenderer.invoke("setup:app-icon"),
  restart: () => ipcRenderer.send("setup:restart"),
  signInWithBrowser: () => ipcRenderer.send("setup:sign-in-browser"),
  finish: (options) =>
    ipcRenderer.send("setup:finish", { openAtLogin: Boolean(options?.openAtLogin) }),
  onHold: (handler) => {
    ipcRenderer.removeAllListeners("persona:hold");
    ipcRenderer.on("persona:hold", (_event, phase) => handler(phase));
  },
});
