import { NextResponse } from "next/server";
import { runBackup, backupStatus } from "@/lib/backup";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(backupStatus());
}

export async function POST() {
  const result = runBackup();
  return NextResponse.json(result);
}
