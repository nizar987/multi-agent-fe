"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type AiStatus = "green" | "red" | "gray";

const NAV = [
  { href: "/", label: "Agents", icon: "◆" },
  { href: "/workspace", label: "Workspace", icon: "🧩" },
  { href: "/skills", label: "Skills", icon: "✦" },
  { href: "/knowledge", label: "Knowledge", icon: "📚" },
  { href: "/memory", label: "Memory", icon: "▤" },
  { href: "/usage", label: "Usage", icon: "📊" },
  { href: "/logs", label: "Logs", icon: "📋" },
  { href: "/monitoring", label: "Monitoring", icon: "📈" },
  { href: "/tools", label: "Tools", icon: "🛠" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [aiStatus, setAiStatus] = useState<AiStatus>("gray");
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac/.test(navigator.platform));
    let alive = true;
    const poll = async () => {
      try {
        const s = await fetch("/api/settings").then((r) => r.json());
        if (!alive) return;
        if (!s.secrets.aiApiKey.set) { setAiStatus("gray"); return; }
        // light test using the saved config — cached 60 s by the interval
        const t = await fetch("/api/settings/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ service: "ai" }),
        }).then((r) => r.json());
        if (alive) setAiStatus(t.ok ? "green" : "red");
      } catch { if (alive) setAiStatus("red"); }
    };
    poll();
    const iv = setInterval(poll, 86_400_000); // once a day
    const onChanged = () => poll();
    window.addEventListener("settings-changed", onChanged);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("settings-changed", onChanged); };
  }, []);

  const statusText =
    aiStatus === "green" ? "AI connected" :
    aiStatus === "red" ? "AI has issues" : "AI not configured";

  return (
    <nav aria-label="Main navigation" className={`sidebar${isMac ? " mac-pad" : ""}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">◆</span> Agent Platform
      </div>
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`sidebar-item${
            n.href === "/" ? (pathname === "/" || pathname.startsWith("/agents") || pathname.startsWith("/chat") ? " active" : "")
            : pathname.startsWith(n.href) ? " active" : ""
          }`}
        >
          <span>{n.icon}</span> {n.label}
        </Link>
      ))}
      <div className="sidebar-spacer" />
      <div className="sidebar-divider" />
      <Link href="/connections" className={`sidebar-item${pathname.startsWith("/connections") ? " active" : ""}`}>
        <span>🔗</span> Connections
      </Link>
      <Link href="/schedules" className={`sidebar-item${pathname.startsWith("/schedules") ? " active" : ""}`}>
        <span>⏰</span> Schedules
      </Link>
      <Link href="/permissions" className={`sidebar-item${pathname.startsWith("/permissions") ? " active" : ""}`}>
        <span>🛡</span> Permissions
      </Link>
      <a
        href="https://ko-fi.com/lordasu"
        target="_blank"
        rel="noopener noreferrer"
        className="sidebar-item sidebar-item-donate"
        title="Support on Ko-fi"
      >
        <span>☕</span> Donate
      </a>
      <Link href="/settings" className={`sidebar-item${pathname.startsWith("/settings") ? " active" : ""}`}>
        <span>⚙</span> Settings
      </Link>
      <div className="sidebar-status" title={statusText}>
        <span className={`dot dot-${aiStatus === "green" ? "green" : aiStatus === "red" ? "red" : "gray"}`} />
        {statusText}
      </div>
    </nav>
  );
}
