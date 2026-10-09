/**
 * Shared cache for /api/models. Stored here so connection mutations can
 * invalidate it without depending on the route handler module.
 */
export type ModelsCache = { at: number; data: any };

let cache: ModelsCache | null = null;

export function getModelsCache(): ModelsCache | null {
  return cache;
}

export function setModelsCache(c: ModelsCache): void {
  cache = c;
}

export function invalidateModelsCache(): void {
  cache = null;
}
