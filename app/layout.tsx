import "./globals.css";

export const metadata = { title: "Agent Platform" };

// Inline script that runs synchronously before first paint — reads the saved
// theme from localStorage (written by the Settings page) and applies it to
// <html data-theme> so there is no flash of wrong theme on load.
// This must be a raw string injected via dangerouslySetInnerHTML so Next.js
// does not strip or defer it.
const themeInitScript = `
(function () {
  var root = document.documentElement;
  // Desktop shell (electron/preload.js) — lets CSS adapt to native chrome.
  var desktop = window.desktop;
  if (desktop) {
    root.classList.add('desktop');
    if (desktop.platform === 'darwin') root.classList.add('desktop-mac');
    if (desktop.vibrancy) root.classList.add('vibrancy');
  }
  try {
    var t = localStorage.getItem('agent_platform_theme');
    if (t === 'light' || t === 'dark') {
      root.dataset.theme = t;
    } else {
      // 'system' or unset — remove the attribute so CSS prefers-color-scheme
      // takes over naturally.
      delete root.dataset.theme;
    }
    if (desktop && desktop.setTheme) desktop.setTheme(t || 'system');
  } catch (e) { /* localStorage blocked (private mode etc.) — ignore */ }
})();
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme init — must run synchronously before paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {/* Frameless-window drag strip (Electron) — inert in a normal browser. */}
        <div className="titlebar-drag" aria-hidden />
        {children}
      </body>
    </html>
  );
}
