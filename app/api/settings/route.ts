import { NextRequest, NextResponse } from "next/server";
import {
  getConfig, updateConfig, hasSecret, secretTail, secretBackendLabel,
} from "@/lib/config";
import { backupStatus, ensureDailyBackup } from "@/lib/backup";
import { loadCronJobs } from "@/lib/cron";

export const dynamic = "force-dynamic";

let cronLoaded = false;

export async function GET() {
  ensureDailyBackup();
  if (!cronLoaded) { cronLoaded = true; loadCronJobs(); }
  const cfg = getConfig();
  return NextResponse.json({
    config: cfg,
    secrets: {
      aiApiKey: { set: hasSecret("aiApiKey"), tail: secretTail("aiApiKey") },
      githubToken: { set: hasSecret("githubToken"), tail: secretTail("githubToken") },
      gitlabToken: { set: hasSecret("gitlabToken"), tail: secretTail("gitlabToken") },
      dbPassword: { set: hasSecret("dbPassword"), tail: secretTail("dbPassword") },
      redisPassword: { set: hasSecret("redisPassword"), tail: secretTail("redisPassword") },
      tavilyApiKey: { set: hasSecret("tavilyApiKey"), tail: secretTail("tavilyApiKey") },
    },
    secretBackend: secretBackendLabel(),
    backup: backupStatus(),
  });
}

export async function PUT(req: NextRequest) {
  const patch = await req.json();
  const cfg = updateConfig(patch);
  return NextResponse.json({ config: cfg });
}
