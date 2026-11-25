/** CANNBOT auth, live model catalog, and Pi model definitions. */

import type { Model, OAuthCredential, OpenAICompletionsCompat, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { networkInterfaces } from "node:os";

import { cannbotFetch } from "./http.ts";

export type CannbotModel = Model<"openai-completions">;

export const PROVIDER_ID = "cannbot";
export const PROVIDER_NAME = "CANNBOT";
export const GATEWAY_BASE_URL = "https://cannbot.hicann.cn/gateway/compatible-mode/v1";
export const AUTH_URL = "https://cannbot.hicann.cn/cannbot/api/auth/authenticate";
export const CATALOG_URL = "https://cannbot.hicann.cn/cannbot/api/models/list?page=1&size=100";

const DEFAULT_CONTEXT_WINDOW = 1_048_576;
const DEFAULT_MAX_TOKENS = 131_072;
const DEFAULT_EXPIRES_IN_SECONDS = 86_400;
const AUTH_TIMEOUT_MS = 8_000;
const CATALOG_TIMEOUT_MS = 15_000;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEEPSEEK_COMPAT: OpenAICompletionsCompat = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
};
const DEEPSEEK_THINKING: ThinkingLevelMap = { minimal: null, xhigh: "xhigh", max: "max" };
const QWEN_THINKING: ThinkingLevelMap = { off: "none", xhigh: "xhigh", max: "max" };
const GLM_THINKING: ThinkingLevelMap = {
  off: null,
  minimal: null,
  low: "low",
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
};
const VISION_MODELS = new Set([
  "deepseek-v4.1-flash",
  "qwen3.8-max",
  "qwen3.8-flash",
  "glm-5.3-flash",
]);

function thinkingMapFor(id: string): ThinkingLevelMap | undefined {
  if (id.startsWith("deepseek")) return DEEPSEEK_THINKING;
  if (id.startsWith("qwen")) return QWEN_THINKING;
  if (id.startsWith("glm")) return GLM_THINKING;
  return undefined;
}

export function buildModel(input: {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
}): CannbotModel {
  const { id, name } = input;
  return {
    type: "chat",
    id,
    name,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: GATEWAY_BASE_URL,
    reasoning: true,
    thinkingLevelMap: thinkingMapFor(id),
    input: VISION_MODELS.has(id) ? ["text", "image"] : ["text"],
    cost: ZERO_COST,
    contextWindow:
      input.contextWindow && input.contextWindow > 0 ? Math.floor(input.contextWindow) : DEFAULT_CONTEXT_WINDOW,
    maxTokens: input.maxTokens && input.maxTokens > 0 ? Math.floor(input.maxTokens) : DEFAULT_MAX_TOKENS,
    compat: id.startsWith("deepseek") ? DEEPSEEK_COMPAT : undefined,
  };
}

export function primaryMac(): string {
  const iface = Object.values(networkInterfaces())
    .flat()
    .find((info) => info && !info.internal && info.mac && info.mac !== "00:00:00:00:00:00");
  return iface?.mac ?? "00:00:00:00:00:00";
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Exchange a Virtual Key for a short-lived access token. */
export async function authenticate(
  rawVk: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = cannbotFetch,
): Promise<OAuthCredential> {
  const vk = rawVk.trim();
  if (!vk) throw new Error("CANNBOT Virtual Key is required");

  const res = await fetchFn(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-vkey": vk },
    body: JSON.stringify({ type: "cli", mac: primaryMac() }),
    redirect: "error",
    signal: withTimeout(AUTH_TIMEOUT_MS, signal),
  });

  if (!res.ok) {
    const body = (await res.text()).trim().slice(0, 200);
    throw new Error(`CANNBOT authentication failed: HTTP ${res.status}${body ? ` ${body}` : ""}`);
  }

  const data = (await res.json()) as { accessToken?: unknown; expiresIn?: unknown };
  if (typeof data.accessToken !== "string" || !data.accessToken) {
    throw new Error("CANNBOT authentication failed: response has no accessToken");
  }

  const expiresIn =
    typeof data.expiresIn === "number" && data.expiresIn > 0 ? data.expiresIn : DEFAULT_EXPIRES_IN_SECONDS;
  return {
    type: "oauth",
    refresh: vk,
    access: data.accessToken,
    expires: Date.now() + expiresIn * 1000,
  };
}

interface CatalogRow {
  model?: string;
  title?: string;
  status?: number;
  contextLength?: number;
  maxTokens?: number;
}

export function parseCatalog(rows: readonly CatalogRow[]): CannbotModel[] {
  const seen = new Set<string>();
  const models: CannbotModel[] = [];
  for (const row of rows) {
    const id = row.model?.trim();
    if (!id || seen.has(id) || (row.status !== undefined && row.status !== 1)) continue;
    seen.add(id);
    models.push(
      buildModel({
        id,
        name: row.title || id,
        contextWindow: row.contextLength,
        maxTokens: row.maxTokens,
      }),
    );
  }
  return models;
}

/** Fetch the account's live model roster; returns `undefined` on any failure. */
export async function fetchCatalog(
  access: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = cannbotFetch,
): Promise<CannbotModel[] | undefined> {
  try {
    const res = await fetchFn(CATALOG_URL, {
      headers: { authorization: `Bearer ${access}` },
      redirect: "error",
      signal: withTimeout(CATALOG_TIMEOUT_MS, signal),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { models?: CatalogRow[] };
    const models = Array.isArray(data.models) ? parseCatalog(data.models) : [];
    return models.length > 0 ? models : undefined;
  } catch {
    return undefined;
  }
}
