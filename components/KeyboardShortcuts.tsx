"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Global keyboard shortcuts (DESIGN §6):
 *   Cmd/Ctrl+,   → open Settings
 *   Cmd/Ctrl+N   → new conversation  (also handled locally in ChatPage,
 *                  this fires it from anywhere outside chat)
 *
 * Registered once at the AppLayout level so every page benefits.
 * Does not interfere with browser/OS shortcuts that don't match.
 */
export default function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Cmd/Ctrl+, → Settings (universal desktop convention)
      if (e.key === ",") {
        e.preventDefault();
        router.push("/settings");
        return;
      }

      // Cmd/Ctrl+N → new conversation (only when NOT already in a chat page,
      // where ChatPage handles it locally with a more specific action)
      if (e.key === "n") {
        const inChat = window.location.pathname.startsWith("/chat/");
        if (!inChat) {
          e.preventDefault();
          router.push("/");
        }
        // if in chat, let ChatPage's own handler deal with it
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  // purely behavioural — renders nothing
  return null;
}
