import { NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/lib/config";
import { seedExampleAgents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ done: getConfig().onboardingDone });
}

/** Finish onboarding: seed 3 example agents + mark done. */
export async function POST() {
  const agents = seedExampleAgents();
  updateConfig({ onboardingDone: true });
  return NextResponse.json({ agents });
}
