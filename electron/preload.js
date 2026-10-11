/**
 * Preload — the only bridge between the renderer and the main process.
 * Exposes a tiny, explicit API on `window.desktop` (contextIsolation stays on).
 */
const { contextBridge, ipcRenderer } = require("electron");

const THEMES = new Set(["system", "light", "dark"]);

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  /** macOS window uses native vibrancy behind a translucent sidebar. */
  vibrancy: process.platform === "darwin",
  /** Keep the native window chrome (vibrancy, scrollbars) in sync with the in-app theme. */
  setTheme: (theme) => {
    if (THEMES.has(theme)) ipcRenderer.send("theme:set", theme);
  },
});
