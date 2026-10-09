/**
 * Shared sanitizer for the `config` blob of a connection (POST + PATCH).
 *
 * The blob is user-supplied JSON that ends up in the DB and is read back by
 * lib/ai.ts, /api/models and the connection managers. Keep it flat: primitives
 * and arrays of primitives only — no nested objects, so nothing can smuggle
 * structure into the places that read this config.
 *
 * Arrays ARE allowed on purpose: NVIDIA NIM stores its selected model list in
 * `config.models` (see components/NvidiaNimSection.tsx) and /api/models reads
 * it. Dropping arrays silently reduced a multi-model connection to one model.
 */
export const MAX_CONFIG_STRING = 2048;
export const MAX_CONFIG_ARRAY = 50;

type Primitive = string | number | boolean;

function isPrimitive(v: unknown): v is Primitive {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function clamp(v: Primitive): Primitive {
  return typeof v === "string" ? v.slice(0, MAX_CONFIG_STRING) : v;
}

/** True when the value is a plain object usable as a config blob. */
export function isConfigObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Keep primitives and arrays of primitives; drop everything else. */
export function sanitizeConnectionConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (isPrimitive(v)) {
      safe[k] = clamp(v);
    } else if (Array.isArray(v)) {
      safe[k] = v.filter(isPrimitive).map(clamp).slice(0, MAX_CONFIG_ARRAY);
    }
  }
  return safe;
}
