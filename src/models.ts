/** Mapping from a catalog row to a Pi chat-model definition. */

import type { ProviderConfig } from "@earendil-works/pi-coding-agent";

import type { CatalogModel } from "./catalog.ts";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  FALLBACK_MODELS,
  VISION_MODELS,
} from "./constants.ts";

type ModelConfigs = NonNullable<ProviderConfig["models"]>;
export type CannbotModel = Extract<ModelConfigs[number], { type?: "chat" }>;
type CannbotCompat = NonNullable<CannbotModel["compat"]>;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/**
 * DeepSeek models behind the gateway need `thinking.type` rather than an
 * omitted field to stop thinking, and replayed assistant messages must keep
 * their `reasoning_content`. `max_completion_tokens` is accepted by the gateway
 * and is Pi's default for an unrecognized URL, but state it explicitly.
 */
const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
  maxTokensField: "max_completion_tokens",
} as CannbotCompat;

function compatFor(id: string): CannbotCompat | undefined {
  return id.startsWith("deepseek") ? { ...DEEPSEEK_COMPAT } : undefined;
}

function build(id: string, name: string, contextWindow: number, maxTokens: number): CannbotModel {
  const input: ("text" | "image")[] = VISION_MODELS.has(id) ? ["text", "image"] : ["text"];
  return {
    type: "chat",
    id,
    name,
    reasoning: true,
    input,
    cost: { ...ZERO_COST },
    contextWindow,
    maxTokens,
    compat: compatFor(id),
  };
}

/** The static roster used before the first fetch and whenever it fails. */
export function fallbackModels(): CannbotModel[] {
  return FALLBACK_MODELS.map(({ id, name }) => build(id, name, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS));
}

/** Map a live catalog to Pi model definitions. */
export function toModels(catalog: readonly CatalogModel[]): CannbotModel[] {
  return catalog.map(({ id, name, contextWindow, maxTokens }) => build(id, name, contextWindow, maxTokens));
}
