import { NextResponse } from "next/server";
import { getBridge } from "@/lib/paths";
import { getConfig, updateConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Open native folder dialog and set as backup destination. */
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

  updateConfig({ backupDir: folder });
  logger.info(`Backup folder set: ${folder}`);
  return NextResponse.json({ folder });
}
