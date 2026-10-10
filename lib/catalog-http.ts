/** HTTP mapping for catalog (agents / skills / knowledge) errors in API routes. */
import { NextResponse } from "next/server";
import { SharedDbUnavailableError } from "./catalog";
import { logger } from "./logger";

/** 503 for an unreachable shared DB; anything else is rethrown (500 by Next). */
export function catalogErrorResponse(e: unknown, what: string): NextResponse {
  if (e instanceof SharedDbUnavailableError) {
    logger.warn(`${what}: ${e.message}`);
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  throw e;
}
