const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { 
  connectSpotify, 
  getPlayback,
  controlPlayback
} = require("./spotify-auth");

const pagePath = path.join(__dirname, "index.html");
const pageUrl = pathToFileURL(pagePath).href;

function createWindow() {
  const window = new BrowserWindow({
    width: 380,
    height: 610,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: "#201b33",
    title: "Pixel Player",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Keep this window on our local interface.
  window.webContents.on("will-navigate", function (event) {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(function () {
    return { action: "deny" };
  });

  window.loadFile(pagePath);
}

ipcMain.handle("spotify:connect", async function (event) {
  // Accept requests only from our local main frame.
  if (
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== pageUrl
  ) {
    return { ok: false, message: "Unrecognized connection request." };
  }

  try {
    await connectSpotify();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("spotify:get-playback", async function (event) {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== pageUrl
  ) {
    return { ok: false, message: "Unrecognized playback request." };
  }

  try {
    const playback = await getPlayback();
    return { ok: true, playback };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("spotify:control", async function (event, action) {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== pageUrl
  ) {
    return { ok: false, message: "Unrecognized playback request." };
  }

  try {
    await controlPlayback(action);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

app.whenReady().then(function () {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});