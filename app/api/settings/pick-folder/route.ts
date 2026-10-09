import { NextResponse } from "next/server";
import { getBridge } from "@/lib/paths";
import { getConfig, updateConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Return the list of folders that have been picked before. */
export async function GET() {
  const cfg = getConfig();
  return NextResponse.json({ folders: cfg.filesystem.allowedDirs });
}

/** Open the native OS folder dialog (Electron). */
export async function POST() {
  const bridge = getBridge();
  if (!bridge?.pickFolder) {
    return NextResponse.json(
      { error: "The native folder dialog is only available in the desktop app (Electron)." },
      { status: 501 }
    );
  }
  const folder = await bridge.pickFolder();
  if (!folder) return NextResponse.json({ canceled: true });

  const cfg = getConfig();
  if (!cfg.filesystem.allowedDirs.includes(folder)) {
    updateConfig({ filesystem: { allowedDirs: [...cfg.filesystem.allowedDirs, folder] } });
  }
  return NextResponse.json({ folder });
}
