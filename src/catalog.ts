/**
 * Live model catalog for the signed-in CANNBOT account.
 *
 * The OpenAI-compatible gateway does not answer `GET /models`, so discovery
 * uses CANNBOT's own endpoint. It authenticates with the access token, not the
 * VK. Rows are deduplicated and inactive entries are dropped because Pi rejects
 * a catalog with duplicate model ids.
 */

import { CATALOG_TIMEOUT_MS, CATALOG_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "./constants.ts";

export interface CatalogModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
}

interface CatalogRow {
  model?: unknown;
  title?: unknown;
  status?: unknown;
  contextLength?: unknown;
  maxTokens?: unknown;
  completionOptions?: { maxTokens?: unknown };
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const floored = Math.floor(value);
  return Number.isSafeInteger(floored) && floored > 0 ? floored : undefined;
}

function rowsOf(json: unknown): CatalogRow[] {
  if (typeof json !== "object" || json === null) return [];
  const record = json as Record<string, unknown>;
  if (Array.isArray(record.models)) return record.models as CatalogRow[];
  if (Array.isArray(record.data)) return record.data as CatalogRow[];
  const data = record.data;
  if (typeof data === "object" && data !== null) {
    const nested = data as Record<string, unknown>;
    return [
      ...(Array.isArray(nested.personalModels) ? (nested.personalModels as CatalogRow[]) : []),
      ...(Array.isArray(nested.builtinModels) ? (nested.builtinModels as CatalogRow[]) : []),
    ];
  }
  return [];
}

export function normalizeRows(rows: readonly CatalogRow[]): CatalogModel[] {
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const row of rows) {
    const id = typeof row.model === "string" ? row.model.trim() : "";
    if (id === "" || seen.has(id)) continue;
    // An omitted status means "active"; only an explicit non-1 is inactive.
    if (row.status !== undefined && row.status !== 1) continue;
    seen.add(id);
    models.push({
      id,
      name: typeof row.title === "string" && row.title !== "" ? row.title : id,
      contextWindow: positiveInteger(row.contextLength) ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: positiveInteger(row.maxTokens) ?? positiveInteger(row.completionOptions?.maxTokens) ?? DEFAULT_MAX_TOKENS,
    });
  }
  return models;
}

/**
 * Fetch the account's roster. Returns `undefined` on any failure so callers can
 * keep serving the previous or fallback catalog instead of an empty one.
 */
export async function fetchCatalog(access: string, signal?: AbortSignal): Promise<CatalogModel[] | undefined> {
  const timeout = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  try {
    const response = await fetch(CATALOG_URL, {
      headers: { Authorization: `Bearer ${access}` },
      signal: combined,
      // The request carries the access token: never follow a redirect.
      redirect: "error",
    });
    if (!response.ok) return undefined;
    const models = normalizeRows(rowsOf(await response.json()));
    return models.length > 0 ? models : undefined;
  } catch {
    return undefined;
  }
}
