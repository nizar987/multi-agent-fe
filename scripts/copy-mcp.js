/**
 * Post-build: copy the MCP server packages (spawned dynamically, so not
 * detected by Next file tracing) into the standalone output so the build
 * is self-contained.
 */
const fs = require("fs");
const path = require("path");

const PKGS = [
  "@modelcontextprotocol/server-filesystem",
  "@modelcontextprotocol/server-gitlab",
  // the sdk is traced by Next but only partially (CJS only) — MCP servers need ESM
  "@modelcontextprotocol/sdk",
];

const root = path.join(__dirname, "..");
const dest = path.join(root, ".next", "standalone", "node_modules");

function copyPkgWithDeps(pkg, seen = new Set()) {
  if (seen.has(pkg)) return;
  seen.add(pkg);
  // direct lookup in node_modules — robust against packages whose
  // "exports" do not expose ./package.json
  const src = path.join(root, "node_modules", pkg);
  if (!fs.existsSync(path.join(src, "package.json"))) {
    console.warn(`skipped (missing): ${pkg}`);
    return;
  }
  const target = path.join(dest, pkg);
  fs.cpSync(src, target, { recursive: true, dereference: true, force: true });
  console.log(`copied: ${pkg}`);
  const meta = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
  for (const dep of Object.keys(meta.dependencies ?? {})) copyPkgWithDeps(dep, seen);
}

for (const p of PKGS) copyPkgWithDeps(p);
console.log("copy-mcp done.");
