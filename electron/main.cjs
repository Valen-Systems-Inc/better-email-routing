const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("path");
const { startServer } = require("../server");

let serverHandle = null;
let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.setName("Better Email Routing");

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    serverHandle = await startServer({
      host: "127.0.0.1",
      port: Number(process.env.BETTER_EMAIL_ROUTING_APP_PORT || process.env.PORT || 8899),
      homeDir: app.getPath("userData")
    });
    createWindow(serverHandle.url);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "Better Email Routing",
      message: "The local mail server could not start.",
      detail: error.message
    });
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
    createWindow(serverHandle.url);
  }
});

app.on("before-quit", () => {
  if (serverHandle && serverHandle.server) {
    serverHandle.server.close();
  }
});

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "Better Email Routing",
    backgroundColor: "#fbfbfd",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.loadURL(url);
}
