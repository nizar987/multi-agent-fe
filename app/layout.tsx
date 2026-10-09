import "./globals.css";

export const metadata = { title: "Agent Platform" };

// Inline script that runs synchronously before first paint — reads the saved
// theme from localStorage (written by the Settings page) and applies it to
// <html data-theme> so there is no flash of wrong theme on load.
// This must be a raw string injected via dangerouslySetInnerHTML so Next.js
// does not strip or defer it.
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('agent_platform_theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.dataset.theme = t;
    } else {
      // 'system' or unset — remove the attribute so CSS prefers-color-scheme
      // takes over naturally.
      delete document.documentElement.dataset.theme;
    }
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
