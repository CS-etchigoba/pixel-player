const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spotify", {
  connect: () => ipcRenderer.invoke("spotify:connect"),
  getPlayback: () => ipcRenderer.invoke("spotify:get-playback"),
  control: action => ipcRenderer.invoke("spotify:control", action)
});