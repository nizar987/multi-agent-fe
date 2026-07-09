import { NextRequest, NextResponse } from "next/server";
import { testAiConnection, detectProvider } from "@/lib/ai";
import { testDatabase, testGithub, testGitlab, testRedis } from "@/lib/connections";
import { getConfig, getSecret } from "@/lib/config";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = await req.json();
  const cfg = getConfig();

  if (b.service === "ai") {
    const apiKey = b.apiKey || getSecret("aiApiKey");
    if (!apiKey) return NextResponse.json({ ok: false, message: "API key is not set." });
    const baseUrl = b.baseUrl || cfg.ai.baseUrl;
    const rawProvider = b.provider || cfg.ai.provider;
    // Resolve "auto" to a concrete provider via URL detection so the correct
    // wire format (OpenAI vs Anthropic vs Gemini) is always used.
    const provider =
      rawProvider && rawProvider !== "auto"
        ? rawProvider
        : detectProvider(baseUrl);
    const r = await testAiConnection({
      baseUrl,
      model: b.model || cfg.ai.model,
      apiKey,
      provider,
    });
    if (r.ok) logger.info(`Connection test passed: AI (${b.model || cfg.ai.model})`);
    else logger.warn(`Connection test failed: AI — ${r.message}`);
    return NextResponse.json(r);
  }
  if (b.service === "github") {
    const token = b.token || getSecret("githubToken");
    if (!token) return NextResponse.json({ ok: false, message: "Token is not set." });
    return NextResponse.json(await testGithub(token));
  }
  if (b.service === "gitlab") {
    const token = b.token || getSecret("gitlabToken");
    if (!token) return NextResponse.json({ ok: false, message: "Token is not set." });
    return NextResponse.json(await testGitlab(token, b.apiUrl || cfg.gitlab.apiUrl));
  }
  if (b.service === "database") {
    const password = b.password || getSecret("dbPassword");
    return NextResponse.json(await testDatabase({ ...cfg.database, ...(b.database ?? {}) }, password));
  }
  if (b.service === "redis") {
    const password = b.password || getSecret("redisPassword");
    return NextResponse.json(await testRedis({ ...cfg.redis, ...(b.redis ?? {}) }, password));
  }
  return NextResponse.json({ ok: false, message: "unknown service" }, { status: 400 });
}
