import { NextResponse } from "next/server";
import { getBridge } from "@/lib/paths";
import { getConfig, updateConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * POST /api/workspace/pick-folder — native folder dialog for the Workspace
 * "working folder". The chosen folder is also added to filesystem.allowedDirs
 * so the filesystem tools can reach it; the client stores the path and sends
 * it as `workingDir` with every workspace message.
 */
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
