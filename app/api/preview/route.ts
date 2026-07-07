/**
 * GET /api/preview?path=... — read a local file for the preview panel.
 * Only files inside allowedDirs may be read.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const TEXT_EXTS = new Set([
  ".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".env",
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".css", ".html", ".xml",
  ".sh", ".bash", ".zsh", ".fish", ".sql", ".csv", ".log",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

function isAllowed(filePath: string, allowedDirs: string[]): boolean {
  const resolved = path.resolve(filePath);
  return allowedDirs.some((d) => resolved.startsWith(path.resolve(d)));
}

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "path is required" }, { status: 400 });

  const cfg = getConfig();
  const allowed = cfg.filesystem.allowedDirs;

  if (allowed.length > 0 && !isAllowed(filePath, allowed)) {
    return NextResponse.json({ error: "Access denied — the folder is not in the allow list." }, { status: 403 });
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(filePath).slice(0, 100).map((name) => {
      const full = path.join(filePath, name);
      const s = fs.statSync(full);
      return { name, isDir: s.isDirectory(), size: s.size };
    });
    return NextResponse.json({ type: "dir", entries });
  }

  const ext = path.extname(filePath).toLowerCase();

  if (IMAGE_EXTS.has(ext)) {
    const buf = fs.readFileSync(filePath);
    const mime =
      ext === ".svg" ? "image/svg+xml" :
      ext === ".gif" ? "image/gif" :
      ext === ".webp" ? "image/webp" :
      ext === ".png" ? "image/png" : "image/jpeg";
    return new Response(buf, { headers: { "content-type": mime } });
  }

  if (TEXT_EXTS.has(ext) || stat.size < 200_000) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return NextResponse.json({ type: "text", ext, content: content.slice(0, 100_000) });
    } catch {
      return NextResponse.json({ error: "Failed to read the file." }, { status: 500 });
    }
  }

  return NextResponse.json({ type: "binary", size: stat.size, ext });
}
