"use client";
import { useEffect, useState } from "react";

type OS = "mac" | "linux" | "windows" | "unknown";

export default function LandingPage() {
  const [detectedOS, setDetectedOS] = useState<OS>("unknown");
  const [showDemoModal, setShowDemoModal] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) setDetectedOS("mac");
    else if (ua.includes("linux")) setDetectedOS("linux");
    else if (ua.includes("win")) setDetectedOS("windows");
  }, []);

  const downloadLinks = {
    mac: { label: "Download for macOS", icon: "🍎", url: "https://github.com/nizar987/multi-agent-fe/releases/download/untagged-6309d82da15c44238070/Agent-Platform-0.1.0-arm64.dmg" },
    linux: { label: "Download for Linux", icon: "🐧", url: "https://github.com/nizar987/multi-agent-fe/releases/download/untagged-6309d82da15c44238070/agent-platform-desktop_0.1.0_amd64.deb" },
    windows: { label: "Download for Windows", icon: "🪟", url: "https://github.com/nizar987/multi-agent-fe/releases/download/untagged-6309d82da15c44238070/Agent-Platform-Setup-0.1.0.exe" },
  };

  const primaryDownload = detectedOS !== "unknown" ? downloadLinks[detectedOS] : null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text-primary)" }}>
      {/* Header */}
      <header style={{
        padding: "24px 48px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "var(--bg-muted)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "18px", fontWeight: 600 }}>
          <span style={{ fontSize: "24px" }}>◆</span>
          Agent Platform
        </div>
        <nav style={{ display: "flex", gap: "24px", alignItems: "center" }}>
          <a href="#features" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>Features</a>
          <a href="#architecture" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>Architecture</a>
          {/* <a href="https://github.com" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>GitHub</a> */}
          <a href="https://ko-fi.com/lordasu" target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>Donate</a>
        </nav>
      </header>

      {/* Hero */}
      <section style={{
        padding: "120px 48px",
        textAlign: "center",
        maxWidth: "900px",
        margin: "0 auto"
      }}>
        <h1 style={{
          fontSize: "56px",
          fontWeight: 700,
          lineHeight: 1.1,
          marginBottom: "24px",
          background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text"
        }}>
          Run Multiple AI Agents Locally
        </h1>
        <p style={{
          fontSize: "20px",
          color: "var(--text-secondary)",
          marginBottom: "48px",
          lineHeight: 1.6
        }}>
          Collaborate, share memory, and automate complex tasks with a desktop app that puts you in control.
        </p>

        {/* Demo Now Button */}
        <div style={{ marginBottom: "32px" }}>
          <button
            onClick={() => setShowDemoModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              padding: "14px 36px",
              fontSize: "17px",
              fontWeight: 700,
              background: "var(--accent)",
              color: "#fff",
              borderRadius: "var(--radius-md)",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 20px rgba(193, 95, 60, 0.35)",
              transition: "all 0.2s ease",
              letterSpacing: "0.02em"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--accent-hover)";
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 6px 24px rgba(193, 95, 60, 0.45)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "var(--accent)";
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(193, 95, 60, 0.35)";
            }}
          >
            ▶ Demo Now
          </button>
        </div>

        {/* Download Section */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
          {primaryDownload && (
            <a
              href={primaryDownload.url}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "12px",
                padding: "16px 32px",
                fontSize: "18px",
                fontWeight: 600,
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                borderRadius: "var(--radius-md)",
                textDecoration: "none",
                border: "1px solid var(--border)",
                transition: "all 0.2s"
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <span>{primaryDownload.icon}</span>
              {primaryDownload.label}
            </a>
          )}

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
            <span style={{ color: "var(--text-tertiary)", fontSize: "14px", alignSelf: "center" }}>
              Also available for:
            </span>
            {detectedOS !== "mac" && (
              <a href="#" style={{
                padding: "8px 16px",
                fontSize: "14px",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                borderRadius: "var(--radius-sm)",
                textDecoration: "none",
                border: "1px solid var(--border)"
              }}>
                🍎 macOS
              </a>
            )}
            {detectedOS !== "linux" && (
              <a href="#" style={{
                padding: "8px 16px",
                fontSize: "14px",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                borderRadius: "var(--radius-sm)",
                textDecoration: "none",
                border: "1px solid var(--border)"
              }}>
                🐧 Linux
              </a>
            )}
            {detectedOS !== "windows" && (
              <a href="#" style={{
                padding: "8px 16px",
                fontSize: "14px",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                borderRadius: "var(--radius-sm)",
                textDecoration: "none",
                border: "1px solid var(--border)"
              }}>
                🪟 Windows
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{
        padding: "80px 48px",
        background: "var(--bg-muted)",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)"
      }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <h2 style={{
            fontSize: "36px",
            fontWeight: 700,
            textAlign: "center",
            marginBottom: "64px"
          }}>
            Everything You Need for Multi-Agent Workflows
          </h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "32px"
          }}>
            {[
              {
                icon: "◆",
                title: "Multi-Agent Collaboration",
                desc: "Create specialized agents with unique tools and knowledge. Run them in parallel or orchestrate with a manager agent."
              },
              {
                icon: "🧩",
                title: "Flexible Workspace",
                desc: "Choose between parallel execution for speed or manager mode for complex task decomposition."
              },
              {
                icon: "✦",
                title: "Custom Skills",
                desc: "Write reusable instruction snippets that inject into agent prompts. Share skills across agents."
              },
              {
                icon: "📚",
                title: "Knowledge Base",
                desc: "Attach documents, guides, and context to specific agents. Keep knowledge organized and accessible."
              },
              {
                icon: "▤",
                title: "Shared Memory",
                desc: "Agents can read and write to a shared memory space. Every access is audited for transparency."
              },
              {
                icon: "🛠",
                title: "Extensible Tools",
                desc: "Connect to GitLab, filesystem, databases, and more via MCP (Model Context Protocol)."
              },
              {
                icon: "📋",
                title: "Detailed Logs",
                desc: "Track every action, tool call, and decision. Debug and optimize your workflows with ease."
              },
              {
                icon: "⚙",
                title: "Full Control",
                desc: "Run locally on your machine. Configure AI providers, set approval modes, and manage secrets securely."
              }
            ].map((feature, i) => (
              <div key={i} style={{
                padding: "32px",
                background: "var(--bg)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border)",
                transition: "all 0.2s"
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.boxShadow = "var(--shadow-md)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
              >
                <div style={{
                  fontSize: "32px",
                  marginBottom: "16px",
                  display: "inline-block",
                  padding: "12px",
                  background: "var(--accent-soft)",
                  borderRadius: "var(--radius-md)"
                }}>
                  {feature.icon}
                </div>
                <h3 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "12px" }}>
                  {feature.title}
                </h3>
                <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" style={{ padding: "80px 48px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h2 style={{
            fontSize: "36px",
            fontWeight: 700,
            textAlign: "center",
            marginBottom: "24px"
          }}>
            Built for Power Users
          </h2>
          <p style={{
            fontSize: "18px",
            color: "var(--text-secondary)",
            textAlign: "center",
            marginBottom: "64px",
            lineHeight: 1.6
          }}>
            Desktop-first architecture with local storage and full transparency
          </p>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "24px"
          }}>
            {[
              {
                title: "Electron + Next.js",
                desc: "Cross-platform desktop app with modern web technologies"
              },
              {
                title: "SQLite Database",
                desc: "Local-first storage for conversations, agents, and metadata"
              },
              {
                title: "MCP Integration",
                desc: "Connect to external services via Model Context Protocol"
              },
              {
                title: "AI Provider Agnostic",
                desc: "Works with OpenAI, Anthropic, and other compatible APIs"
              }
            ].map((item, i) => (
              <div key={i} style={{
                padding: "24px",
                background: "var(--bg-surface)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)"
              }}>
                <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
                  {item.title}
                </h3>
                <p style={{ color: "var(--text-secondary)", lineHeight: 1.5, margin: 0, fontSize: "14px" }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: "80px 48px",
        background: "var(--bg-muted)",
        borderTop: "1px solid var(--border)",
        textAlign: "center"
      }}>
        <div style={{ maxWidth: "600px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "32px", fontWeight: 700, marginBottom: "16px" }}>
            Ready to Get Started?
          </h2>
          <p style={{
            fontSize: "18px",
            color: "var(--text-secondary)",
            marginBottom: "32px",
            lineHeight: 1.6
          }}>
            Download Agent Platform and take control of your AI workflows
          </p>
          <button
            onClick={() => setShowDemoModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              padding: "16px 36px",
              fontSize: "18px",
              fontWeight: 700,
              background: "var(--accent)",
              color: "#fff",
              borderRadius: "var(--radius-md)",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 20px rgba(193, 95, 60, 0.35)",
              transition: "all 0.2s ease"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--accent-hover)";
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 6px 24px rgba(193, 95, 60, 0.45)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "var(--accent)";
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(193, 95, 60, 0.35)";
            }}
          >
            ▶ Demo Now
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding: "32px 48px",
        borderTop: "1px solid var(--border)",
        textAlign: "center",
        color: "var(--text-tertiary)",
        fontSize: "14px"
      }}>
        <p style={{ margin: 0 }}>
          Made with ❤️ by the community.
          <a href="https://ko-fi.com/lordasu" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", marginLeft: "8px" }}>
            Support on Ko-fi
          </a>
        </p>
      </footer>

      {/* ===== Download / Demo Modal ===== */}
      {showDemoModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "fadeIn 150ms ease-out"
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDemoModal(false); }}
        >
          <div style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            width: "100%",
            maxWidth: "520px",
            overflow: "hidden",
            animation: "scaleIn 160ms ease-out"
          }}>
            {/* Modal Header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "20px 24px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-muted)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "22px" }}>◆</span>
                <div>
                  <h2 id="demo-modal-title" style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
                    Download Agent Platform
                  </h2>
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
                    Free & open source · Runs 100% locally
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDemoModal(false)}
                aria-label="Close modal"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "32px",
                  height: "32px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg)",
                  color: "var(--text-secondary)",
                  fontSize: "18px",
                  cursor: "pointer",
                  flexShrink: 0,
                  transition: "background 140ms ease, color 140ms ease"
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "var(--danger-soft)";
                  e.currentTarget.style.color = "var(--danger)";
                  e.currentTarget.style.borderColor = "var(--danger)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "var(--bg)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                ×
              </button>
            </div>

            {/* Detected OS badge */}
            {detectedOS !== "unknown" && (
              <div style={{
                margin: "20px 24px 0",
                padding: "10px 14px",
                background: "var(--accent-soft)",
                border: "1px solid var(--accent)",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                <span>✦</span>
                <span>We detected you&apos;re on <strong>{detectedOS === "mac" ? "macOS" : detectedOS === "linux" ? "Linux" : "Windows"}</strong> — recommended download is highlighted below.</span>
              </div>
            )}

            {/* Download Options */}
            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {([
                { os: "mac" as OS, icon: "🍎", label: "macOS", sublabel: "Apple Silicon & Intel · .dmg", url: "https://github.com/nizar987/multi-agent-fe/releases/download/untagged-6309d82da15c44238070/Agent-Platform-0.1.0-arm64.dmg" },
                { os: "windows" as OS, icon: "🪟", label: "Windows", sublabel: "64-bit · .exe installer", url: "https://github.com/nizar987/multi-agent-fe/releases/download/untagged-6309d82da15c44238070/Agent-Platform-Setup-0.1.0.exe" },
                { os: "linux" as OS, icon: "🐧", label: "Linux", sublabel: "x86_64 · .AppImage", url: "https://github.com/nizar987/multi-agent-fe/releases/download/untagged-6309d82da15c44238070/agent-platform-desktop_0.1.0_amd64.deb" },
              ]).map(({ os, icon, label, sublabel, url }) => {
                const isDetected = detectedOS === os;
                return (
                  <a
                    key={os}
                    href={url}
                    aria-label={`Download for ${label}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "16px",
                      padding: "16px 20px",
                      border: isDetected ? "2px solid var(--accent)" : "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      background: isDetected ? "var(--accent-soft)" : "var(--bg-surface)",
                      textDecoration: "none",
                      color: "var(--text-primary)",
                      transition: "all 0.18s ease",
                      position: "relative"
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = "var(--accent)";
                      e.currentTarget.style.background = "var(--accent-soft)";
                      e.currentTarget.style.transform = "translateX(4px)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = isDetected ? "var(--accent)" : "var(--border)";
                      e.currentTarget.style.background = isDetected ? "var(--accent-soft)" : "var(--bg-surface)";
                      e.currentTarget.style.transform = "translateX(0)";
                    }}
                  >
                    <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <strong style={{ fontSize: "15px", fontWeight: 600 }}>{label}</strong>
                        {isDetected && (
                          <span style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 7px",
                            background: "var(--accent)",
                            color: "#fff",
                            borderRadius: "999px",
                            letterSpacing: "0.04em",
                            textTransform: "uppercase"
                          }}>
                            Recommended
                          </span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                        {sublabel}
                      </p>
                    </div>
                    <span style={{ fontSize: "18px", color: "var(--text-tertiary)", flexShrink: 0 }}>↓</span>
                  </a>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: "16px 24px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px"
            }}>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                🔒 No account needed. Data stays on your machine.
              </span>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "12px", color: "var(--accent)", whiteSpace: "nowrap" }}
              >
                View on GitHub ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
