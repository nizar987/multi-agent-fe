/**
 * Detects web URLs & file paths in agent response text.
 * Used by the preview panel in chat and workspace.
 */

export type PreviewTarget =
  | { kind: "web"; url: string; label: string }
  | { kind: "file"; path: string; label: string };

const URL_RE = /https?:\/\/[^\s<>()"'`\]]+/g;
// absolute unix/mac paths, or quoted paths
const FILE_RE = /(?:^|[\s(`"'])((?:\/[\w.\- ]+)+\.\w{1,6})(?=[\s)`"'.,]|$)/g;

function cleanUrl(u: string): string {
  return u.replace(/[.,;:)\]]+$/, "");
}

const basename = (p: string) => p.split("/").pop() || p;

/** Extract all unique preview targets from a chunk of text. */
export function detectTargets(text: string): PreviewTarget[] {
  if (!text) return [];
  const out: PreviewTarget[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(URL_RE)) {
    const url = cleanUrl(m[0]);
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      out.push({ kind: "web", url, label: host });
    } catch { /* skip invalid url */ }
  }

  for (const m of text.matchAll(FILE_RE)) {
    const p = m[1].trim();
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ kind: "file", path: p, label: basename(p) });
  }

  return out;
}
