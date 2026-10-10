/**
 * Next.js server start hook — starts the run watchdog that resumes agent runs
 * and manager tasks interrupted before they finished (lib/run-watchdog.ts).
 *
 * The import must sit INSIDE the `NEXT_RUNTIME === "nodejs"` check: webpack
 * replaces the env var with a literal and drops the branch from the edge
 * bundle, which cannot resolve Node modules (fs, path, better-sqlite3…).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startWatchdog } = await import("./lib/run-watchdog");
      startWatchdog();
    } catch (e) {
      // e.g. the native SQLite module is built for a different runtime — the app
      // still works, only auto-resume is unavailable.
      console.error("Run watchdog could not start:", e instanceof Error ? e.message : e);
    }
  }
}
