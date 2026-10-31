// The setup window's bridge to the app: permissions, the drag-me tile,
// signing in through the browser, and the talk key while you practise.
const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  permissions: () => ipcRenderer.invoke("setup:permissions"),
  askMic: () => ipcRenderer.invoke("setup:ask-mic"),
  askKeyboard: () => ipcRenderer.invoke("setup:ask-keyboard"),
  askScreen: () => ipcRenderer.invoke("setup:ask-screen"),
  // A grant gone stale: clear it and start over, in one step.
  resetPermission: (kind) => ipcRenderer.invoke("setup:reset-permission", kind),
  // Try every permission for real, with plain words when one fails.
  selfTest: () => ipcRenderer.invoke("setup:self-test"),
  // Waits for a real press of the talk key (Windows, which has no OS verdict).
  testKey: () => ipcRenderer.invoke("setup:test-key"),
  dragApp: () => ipcRenderer.send("setup:drag-app"),
  appIcon: () => ipcRenderer.invoke("setup:app-icon"),
  restart: () => ipcRenderer.send("setup:restart"),
  signInWithBrowser: () => ipcRenderer.send("setup:sign-in-browser"),
  finish: (options) =>
    ipcRenderer.send("setup:finish", { openAtLogin: Boolean(options?.openAtLogin) }),
  onHold: (handler) => {
    ipcRenderer.removeAllListeners("persuna:hold");
    ipcRenderer.on("persuna:hold", (_event, phase) => handler(phase));
  },
};

contextBridge.exposeInMainWorld("persunaSetup", bridge);
// Pages served from before the rename look for this name; keep both working.
contextBridge.exposeInMainWorld("personaSetup", bridge);
