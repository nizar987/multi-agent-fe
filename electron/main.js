/**
 * Electron main process — Agent Platform Desktop (PLAN Phase A).
 *
 * Production: runs the Next.js standalone server IN-PROCESS on a random
 * local port, then opens a BrowserWindow at that port. Because it is one
 * process, Next API routes have direct access to safeStorage/dialog via
 * global.__electronBridge (the config service reads it via lib/paths.ts).
 *
 * Dev: run `npm run dev` separately, then `npm run electron:dev` —
 * the window points at http://localhost:3210.
 */
const { app, BrowserWindow, dialog, safeStorage, Menu, shell, ipcMain, nativeTheme } = require("electron");
const path = require("path");
const net = require("net");

// Dev only when NOT packaged AND explicitly requested (electron:dev).
// In a packaged app, app.isPackaged is true → always run the server in-process.
const isDev = !app.isPackaged && process.env.NODE_ENV === "development";
const DEV_URL = "http://localhost:3210";

let mainWindow = null;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function installBridge() {
  global.__electronBridge = {
    userDataPath: app.getPath("userData"),
    platform: process.platform,
    nodePath: process.execPath,
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (buf) => safeStorage.decryptString(buf),
    secretBackendLabel: () => {
      if (process.platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function") {
        const b = safeStorage.getSelectedStorageBackend();
        if (b === "basic_text") return null; // let config.ts provide the warning label
        return `libsecret (${b})`;
      }
      return null; // use the per-platform default label in config.ts
    },
    pickFolder: async () => {
      const res = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (res.canceled || res.filePaths.length === 0) return null;
      return res.filePaths[0];
    },
  };
}

async function startNextServer() {
  const port = await findFreePort();
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  // the standalone server.js starts listening as soon as it is required
  const serverPath = path.join(__dirname, "..", ".next", "standalone", "server.js");
  require(serverPath);
  // wait for the port to be ready
  await new Promise((resolve) => {
    const tryConnect = () => {
      const sock = net.connect(port, "127.0.0.1", () => { sock.end(); resolve(); });
      sock.on("error", () => setTimeout(tryConnect, 150));
    };
    tryConnect();
  });
  return `http://127.0.0.1:${port}`;
}

function waitForUrl(url, timeoutMs) {
  const { port, hostname } = new URL(url);
  const deadline = Date.now() + timeoutMs;
  console.log(`Waiting for the dev server at ${url} … (run 'npm run dev' if it is not up)`);
  return new Promise((resolve) => {
    const tryConnect = () => {
      const sock = net.connect(Number(port), hostname, () => {
        sock.end();
        resolve(true);
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Conversation",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow?.webContents.send("shortcut", "new-chat"),
        },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.location.hash=''; window.location.pathname='/settings';`
          ),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Documentation",
          click: () => shell.openExternal("https://github.com/"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const THEMES = new Set(["system", "light", "dark"]);

/** Window background painted before the page loads — matches the CSS tokens. */
function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#111113" : "#ffffff";
}

function installThemeSync() {
  ipcMain.on("theme:set", (_event, theme) => {
    if (!THEMES.has(theme)) return;
    nativeTheme.themeSource = theme;
    if (mainWindow && process.platform !== "darwin") {
      mainWindow.setBackgroundColor(windowBackground());
    }
  });
}

async function createWindow() {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    // macOS: frameless hiddenInset with native vibrancy behind the sidebar;
    // the traffic lights sit in the sidebar's top padding.
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 16 },
          vibrancy: "sidebar",
          visualEffectState: "followWindow",
          backgroundColor: "#00000000",
        }
      : { backgroundColor: windowBackground() }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      scrollBounce: true,
      spellcheck: true,
    },
    show: false,
  });

  // Show as soon as the first frame is painted (no white flash, no waiting
  // for every subresource); loadURL below still resolves on full load.
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  let url;
  if (isDev) {
    url = DEV_URL;
    // Wait for the dev server (run `npm run dev` in another terminal).
    const ready = await waitForUrl(DEV_URL, 60_000);
    if (!ready) {
      const { dialog: dlg } = require("electron");
      dlg.showErrorBox(
        "Dev server is not running",
        "Could not reach " + DEV_URL + ".\n\n" +
        "First run this in another terminal:\n  npm run dev\n\n" +
        "then reopen:  npm run electron:dev"
      );
      app.quit();
      return;
    }
  } else {
    url = await startNextServer();
  }
  await mainWindow.loadURL(url);
  if (!mainWindow.isVisible()) mainWindow.show();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  installBridge();
  installThemeSync();
  buildMenu();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
