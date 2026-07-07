/**
 * Post-build: Next standalone does NOT copy `.next/static` and `public`
 * into the standalone folder (must be done manually — see the Next docs).
 * Without this, CSS/JS and public assets 404 in the packaged app.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.error("copy-static: .next/standalone does not exist yet — run `next build` first.");
  process.exit(1);
}

// .next/static → .next/standalone/.next/static
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standalone, ".next", "static");
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
  console.log("copied: .next/static");
}

// public → .next/standalone/public (if present)
const publicSrc = path.join(root, "public");
const publicDest = path.join(standalone, "public");
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
  console.log("copied: public");
}

console.log("copy-static done.");
