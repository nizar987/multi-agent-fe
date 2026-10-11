"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { useMediaQuery } from "@/components/useMediaQuery";

type AiStatus = "green" | "red" | "gray";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const byLabel = (a: NavItem, b: NavItem) => a.label.localeCompare(b.label);

interface NavSection {
  title: string;
  items: NavItem[];
}

/** Below this width the sidebar becomes an icon rail; expanding it opens an overlay. */
const NARROW_QUERY = "(max-width: 1099px)";
const COLLAPSED_KEY = "sidebar_collapsed";

/** Grouped sections (items alphabetical within each) so pages are easy to find. */
const SECTIONS: NavSection[] = [
  {
    title: "Work",
    items: [
      { href: "/", label: "Agents", icon: "agents" as const },
      { href: "/tasks", label: "Tasks", icon: "tasks" as const },
      { href: "/workspace", label: "Workspace", icon: "workspace" as const },
    ].sort(byLabel),
  },
  {
    title: "Library",
    items: [
      { href: "/knowledge", label: "Knowledge", icon: "knowledge" as const },
      { href: "/memory", label: "Memory", icon: "memory" as const },
      { href: "/skills", label: "Skills", icon: "skills" as const },
    ].sort(byLabel),
  },
  {
    title: "Monitor",
    items: [
      { href: "/logs", label: "Logs", icon: "logs" as const },
      { href: "/monitoring", label: "Monitoring", icon: "monitoring" as const },
      { href: "/usage", label: "Usage", icon: "usage" as const },
    ].sort(byLabel),
  },
  {
    title: "Setup",
    items: [
      { href: "/connections", label: "Connections", icon: "connections" as const },
      { href: "/permissions", label: "Permissions", icon: "permissions" as const },
      { href: "/schedules", label: "Schedules", icon: "schedules" as const },
      { href: "/tools", label: "Tools", icon: "tools" as const },
    ].sort(byLabel),
  },
];

function useAiStatus(): AiStatus {
  const [aiStatus, setAiStatus] = useState<AiStatus>("gray");

  useEffect(() => {
    let alive = true;
    const cacheKey = "ai_status_cache";
    const remember = (status: AiStatus) => {
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ status, ts: Date.now() })); } catch { /* ignore */ }
    };
    const poll = async () => {
      try {
        // Cache AI status in sessionStorage for 5 minutes so navigation does
        // not trigger two network requests per page.
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          try {
            const { status, ts } = JSON.parse(cached);
            if (Date.now() - ts < 5 * 60 * 1000) {
              if (alive) setAiStatus(status);
              return;
            }
          } catch { /* corrupt cache — ignore and re-fetch */ }
        }
        const s = await fetch("/api/settings").then((r) => r.json());
        if (!alive) return;
        if (!s.secrets.aiApiKey.set) {
          setAiStatus("gray");
          remember("gray");
          return;
        }
        const t = await fetch("/api/settings/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ service: "ai" }),
        }).then((r) => r.json());
        if (alive) {
          const status: AiStatus = t.ok ? "green" : "red";
          setAiStatus(status);
          remember(status);
        }
      } catch { if (alive) setAiStatus("red"); }
    };
    poll();
    const iv = setInterval(poll, 86_400_000); // once a day
    const onChanged = () => {
      // Invalidate cache when settings change so the next poll re-fetches
      try { sessionStorage.removeItem(cacheKey); } catch { /* ignore */ }
      poll();
    };
    window.addEventListener("settings-changed", onChanged);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("settings-changed", onChanged); };
  }, []);

  return aiStatus;
}

export default function Sidebar() {
  const pathname = usePathname();
  const aiStatus = useAiStatus();
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const [isMac, setIsMac] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    setIsMac(/Mac/.test(navigator.platform));
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  // Close the overlay on navigation or when the window grows wide again.
  useEffect(() => { setOverlayOpen(false); }, [pathname, isNarrow]);

  const toggle = () => {
    if (isNarrow) { setOverlayOpen((o) => !o); return; }
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Cmd/Ctrl+\ toggles the sidebar; Esc closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggle(); }
      else if (e.key === "Escape" && overlayOpen) setOverlayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isRail = isNarrow ? !overlayOpen : collapsed;

  const statusText =
    aiStatus === "green" ? "AI connected" :
    aiStatus === "red" ? "AI has issues" : "AI not configured";

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/" || pathname.startsWith("/agents") || pathname.startsWith("/chat")
      : pathname.startsWith(href);

  const navLink = (href: string, label: string, icon: IconName) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        className={`sidebar-item${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
        title={isRail ? label : undefined}
      >
        <Icon name={icon} className="sidebar-icon" />
        <span className="sidebar-label">{label}</span>
      </Link>
    );
  };

  const classes = [
    "sidebar",
    isRail ? "collapsed" : "",
    isNarrow && overlayOpen ? "overlay" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      {/* Reserves the rail's width while the expanded sidebar floats over the content. */}
      {isNarrow && <div className="sidebar-rail-spacer" aria-hidden />}
      {isNarrow && overlayOpen && (
        <div className="sidebar-scrim" onClick={() => setOverlayOpen(false)} aria-hidden />
      )}
      <nav aria-label="Main navigation" className={classes}>
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12z" fill="currentColor" /></svg>
          </span>
          <span className="sidebar-label sidebar-brand-name">Agent Platform</span>
          <button
            className="sidebar-collapse-btn"
            onClick={toggle}
            title={`${isRail ? "Expand" : "Collapse"} sidebar (${isMac ? "⌘" : "Ctrl+"}\\)`}
            aria-label={isRail ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isRail}
          >
            <Icon name="sidebar" size={16} />
          </button>
        </div>
        <div className="sidebar-nav">
          {SECTIONS.map((s) => (
            <div key={s.title} className="sidebar-section">
              <div className="sidebar-section-title">{s.title}</div>
              {s.items.map((n) => navLink(n.href, n.label, n.icon))}
            </div>
          ))}
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer">
          <a
            href="https://ko-fi.com/lordasu"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-item sidebar-item-donate"
            title={isRail ? "Support on Ko-fi" : undefined}
          >
            <Icon name="heart" className="sidebar-icon" />
            <span className="sidebar-label">Donate</span>
          </a>
          {navLink("/settings", "Settings", "settings")}
          <Link href="/settings" className="sidebar-status" title={statusText}>
            <span className={`dot dot-${aiStatus}${aiStatus === "green" ? " dot-glow" : ""}`} />
            <span className="sidebar-label">{statusText}</span>
          </Link>
        </div>
      </nav>
    </>
  );
}
