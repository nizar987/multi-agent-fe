"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type AiStatus = "green" | "red" | "gray";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const byLabel = (a: NavItem, b: NavItem) => a.label.localeCompare(b.label);

interface NavSection {
  title: string;
  items: NavItem[];
}

/** Grouped sections (items alphabetical within each) so pages are easy to find. */
const SECTIONS: NavSection[] = [
  {
    title: "Work",
    items: [
      { href: "/", label: "Agents", icon: "◆" },
      { href: "/tasks", label: "Tasks", icon: "🎫" },
      { href: "/workspace", label: "Workspace", icon: "🧩" },
    ].sort(byLabel),
  },
  {
    title: "Library",
    items: [
      { href: "/knowledge", label: "Knowledge", icon: "📚" },
      { href: "/memory", label: "Memory", icon: "▤" },
      { href: "/skills", label: "Skills", icon: "✦" },
    ].sort(byLabel),
  },
  {
    title: "Monitor",
    items: [
      { href: "/logs", label: "Logs", icon: "📋" },
      { href: "/monitoring", label: "Monitoring", icon: "📈" },
      { href: "/usage", label: "Usage", icon: "📊" },
    ].sort(byLabel),
  },
  {
    title: "Setup",
    items: [
      { href: "/connections", label: "Connections", icon: "🔗" },
      { href: "/permissions", label: "Permissions", icon: "🛡" },
      { href: "/schedules", label: "Schedules", icon: "⏰" },
      { href: "/tools", label: "Tools", icon: "🛠" },
    ].sort(byLabel),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [aiStatus, setAiStatus] = useState<AiStatus>("gray");
  const [isMac, setIsMac] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setIsMac(/Mac/.test(navigator.platform));
    try { setCollapsed(localStorage.getItem("sidebar_collapsed") === "1"); } catch { /* ignore */ }
    let alive = true;
    const poll = async () => {
      try {
        // Cache AI status in sessionStorage for 5 minutes (MAJOR-4 fix)
        // This prevents 2 network requests on every page navigation.
        const cacheKey = "ai_status_cache";
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
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ status: "gray", ts: Date.now() })); } catch { /* ignore */ }
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
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ status, ts: Date.now() })); } catch { /* ignore */ }
        }
      } catch { if (alive) setAiStatus("red"); }
    };
    poll();
    const iv = setInterval(poll, 86_400_000); // once a day
    const onChanged = () => {
      // Invalidate cache when settings change so next poll re-fetches
      try { sessionStorage.removeItem("ai_status_cache"); } catch { /* ignore */ }
      poll();
    };
    window.addEventListener("settings-changed", onChanged);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("settings-changed", onChanged); };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("sidebar_collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const statusText =
    aiStatus === "green" ? "AI connected" :
    aiStatus === "red" ? "AI has issues" : "AI not configured";

  const isActive = (n: NavItem) =>
    n.href === "/"
      ? pathname === "/" || pathname.startsWith("/agents") || pathname.startsWith("/chat")
      : pathname.startsWith(n.href);

  const item = (n: NavItem) => (
    <Link
      key={n.href}
      href={n.href}
      className={`sidebar-item${isActive(n) ? " active" : ""}`}
      title={collapsed ? n.label : undefined}
    >
      <span>{n.icon}</span> <span className="sidebar-label">{n.label}</span>
    </Link>
  );

  return (
    <nav aria-label="Main navigation" className={`sidebar${isMac ? " mac-pad" : ""}${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-brand" title="Agent Platform">
        <span className="brand-mark">◆</span> <span className="sidebar-label">Agent Platform</span>
        <button
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <div className="sidebar-nav">
        {SECTIONS.map((s) => (
          <div key={s.title} className="sidebar-section">
            <div className="sidebar-section-title">{s.title}</div>
            {s.items.map(item)}
          </div>
        ))}
      </div>
      <div className="sidebar-spacer" />
      <div className="sidebar-divider" />
      <a
        href="https://ko-fi.com/lordasu"
        target="_blank"
        rel="noopener noreferrer"
        className="sidebar-item sidebar-item-donate"
        title="Support on Ko-fi"
      >
        <span>☕</span> <span className="sidebar-label">Donate</span>
      </a>
      <Link href="/settings" className={`sidebar-item${pathname.startsWith("/settings") ? " active" : ""}`} title={collapsed ? "Settings" : undefined}>
        <span>⚙</span> <span className="sidebar-label">Settings</span>
      </Link>
      <div className="sidebar-status" title={statusText}>
        <span className={`dot dot-${aiStatus === "green" ? "green" : aiStatus === "red" ? "red" : "gray"}`} />
        <span className="sidebar-label">{statusText}</span>
      </div>
    </nav>
  );
}
