/**
 * Model → AI-connection routing map.
 *
 * /api/models aggregates the model lists of ALL saved AI connections and
 * records here which connection serves which model. When a chat/agent then
 * picks a model that belongs to a non-active connection, the AI client uses
 * that connection's base URL / provider / API key automatically, so every
 * model in the dropdown actually works regardless of which provider is active.
 */
import type { AiProvider } from "./ai";

export interface ModelRoute {
  connId: number;
  baseUrl: string;
  provider: AiProvider;
}

const g = globalThis as { __modelRoutes?: Map<string, ModelRoute> };
const routes: Map<string, ModelRoute> = g.__modelRoutes ?? new Map();
g.__modelRoutes = routes;

export function setModelRoutes(map: Record<string, ModelRoute>): void {
  routes.clear();
  for (const [model, route] of Object.entries(map)) routes.set(model, route);
}

export function getModelRoute(model: string): ModelRoute | null {
  return routes.get(model) ?? null;
}
