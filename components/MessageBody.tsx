"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

/* ------------------------------------------------------------------ */
/* Progress indicator — shown while agent is thinking                  */
/* ------------------------------------------------------------------ */

const THINKING_PHRASES = [
  "Thinking…",
  "Processing…",
  "Analyzing…",
  "Working on it…",
  "Reading context…",
];

export function ThinkingIndicator({ tool }: { tool?: string }) {
  const label = tool ? `Using ${tool}…` : THINKING_PHRASES[0];
  return (
    <div className="agent-thinking">
      <span className="thinking-dots"><span /><span /><span /></span>
      <span className="thinking-label">{label}</span>
    </div>
  );
}

export function ToolProgress({ tools }: { tools: { tool: string; done: boolean; ok?: boolean }[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="tool-progress-list">
      {tools.map((t, i) => (
        <div key={i} className="tool-progress-item">
          {t.done
            ? <span className={`tool-status ${t.ok ? "ok" : "err"}`}>{t.ok ? "✓" : "✕"}</span>
            : <span className="dot dot-blue pulse-dot" />}
          <span className="tool-name">{t.tool}</span>
          {!t.done && <span className="tool-progress-bar"><span /></span>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Code block with copy button                                         */
/* ------------------------------------------------------------------ */

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);

  // Extract language from className (e.g. "language-typescript")
  const lang = className?.replace("language-", "") ?? "";

  const code = typeof children === "string"
    ? children
    : Array.isArray(children)
      ? children.map((c) => (typeof c === "string" ? c : "")).join("")
      : String(children ?? "");

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code.trimEnd());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older Electron versions
      const el = document.createElement("textarea");
      el.value = code.trimEnd();
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <div className="code-block-wrap">
      <div className="code-block-header">
        {lang && <span className="code-block-lang">{lang}</span>}
        <button
          className={`code-copy-btn${copied ? " copied" : ""}`}
          onClick={copy}
          title={copied ? "Copied!" : "Copy code"}
          aria-label={copied ? "Copied!" : "Copy code"}
        >
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="code-block-pre">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart renderer — detects ```chart JSON blocks in markdown           */
/* ------------------------------------------------------------------ */

type ChartSpec = {
  type: "line" | "bar" | "pie";
  title?: string;
  data: Record<string, any>[];
  xKey?: string;
  yKey?: string | string[];
  colors?: string[];
};

const DEFAULT_COLORS = ["#d97757", "#2b6cb0", "#2e7d4f", "#b7791f", "#805ad5", "#e05d4d"];

function ChartBlock({ spec }: { spec: ChartSpec }) {
  const colors = spec.colors ?? DEFAULT_COLORS;
  const xKey = spec.xKey ?? Object.keys(spec.data[0] ?? {})[0] ?? "x";
  const yKeys = Array.isArray(spec.yKey)
    ? spec.yKey
    : spec.yKey
    ? [spec.yKey]
    : Object.keys(spec.data[0] ?? {}).filter((k) => k !== xKey);

  return (
    <div className="chart-block">
      {spec.title && <div className="chart-title">{spec.title}</div>}
      <ResponsiveContainer width="100%" height={220}>
        {spec.type === "pie" ? (
          <PieChart>
            <Pie data={spec.data} dataKey={yKeys[0] ?? "value"} nameKey={xKey} cx="50%" cy="50%" outerRadius={80} label>
              {spec.data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        ) : spec.type === "line" ? (
          <LineChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {yKeys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {yKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main MessageBody — markdown + chart rendering                       */
/* ------------------------------------------------------------------ */

export default function MessageBody({ text, isError, onOpenPreview }: { text: string; isError?: boolean; onOpenPreview?: (href: string) => void }) {
  if (!text) return null;

  // Split text into segments: chart blocks vs normal markdown
  const segments: { kind: "md" | "chart"; content: string }[] = [];
  const chartRegex = /```chart\n([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = chartRegex.exec(text)) !== null) {
    if (match.index > last) segments.push({ kind: "md", content: text.slice(last, match.index) });
    segments.push({ kind: "chart", content: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "md", content: text.slice(last) });

  return (
    <div className={`message-body${isError ? " message-body-error" : ""}`}>
      {segments.map((seg, i) => {
        if (seg.kind === "chart") {
          try {
            const spec: ChartSpec = JSON.parse(seg.content);
            return <ChartBlock key={i} spec={spec} />;
          } catch {
            return <CodeBlock key={i}>{seg.content}</CodeBlock>;
          }
        }
        return (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, className, children, ...props }: any) {
                const inline = !className;
                return inline
                  ? <code className="inline-code" {...props}>{children}</code>
                  : <CodeBlock className={className}>{children}</CodeBlock>;
              },
              table({ children }: any) {
                return <div className="table-wrap"><table>{children}</table></div>;
              },
              a({ href, children, ...props }: any) {
                if (!href) return <a {...props}>{children}</a>;
                // If consumer provided a preview handler, render as a preview button
                if (onOpenPreview) {
                  return (
                    <button
                      className="preview-link-btn"
                      onClick={() => onOpenPreview(href)}
                      title={`Open preview: ${href}`}
                    >
                      {children}
                      <span className="preview-link-icon" aria-hidden>↗</span>
                    </button>
                  );
                }
                // fallback: open externally
                return (
                  <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
                    {children}
                  </a>
                );
              },
            }}
          >
            {seg.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
