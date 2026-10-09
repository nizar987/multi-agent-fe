/**
 * electron-builder afterPack hook — ad-hoc code-sign the macOS app bundle.
 *
 * Without a Developer ID (mac.identity = null) electron-builder skips signing,
 * so the app ships the stock Electron binary with Electron's generic
 * linker-signed ad-hoc signature (identifier "Electron", Info.plist not bound).
 * That signature is byte-identical for every unsigned Electron app — including
 * malware built on Electron — and macOS (XProtect / Gatekeeper) may flag and
 * trash the app as "contains malware".
 *
 * Re-signing the whole bundle ad-hoc gives it its own identity: the identifier
 * becomes our bundle id, Info.plist and resources are sealed, and the code
 * hashes are unique to this app. This is NOT a replacement for Developer ID
 * signing + notarization when distributing to other Macs.
 */
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};
