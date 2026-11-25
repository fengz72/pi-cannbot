import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONTEXT_WINDOW, FALLBACK_MODELS } from "../src/constants.ts";
import { fallbackModels, toModels } from "../src/models.ts";

test("fallbackModels covers every known model with zero cost", () => {
  const models = fallbackModels();
  assert.equal(models.length, FALLBACK_MODELS.length);
  for (const model of models) {
    assert.equal(model.type, "chat");
    assert.equal(model.reasoning, true);
    assert.equal(model.contextWindow, DEFAULT_CONTEXT_WINDOW);
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  }
});

test("only measured models advertise image input", () => {
  const byId = new Map(fallbackModels().map((model) => [model.id, model]));
  assert.deepEqual(byId.get("deepseek-v4.1-flash")?.input, ["text", "image"]);
  assert.deepEqual(byId.get("qwen3.8-max")?.input, ["text", "image"]);
  assert.deepEqual(byId.get("deepseek-v4-pro")?.input, ["text"]);
  assert.deepEqual(byId.get("glm-5.3")?.input, ["text"]);
});

test("DeepSeek models get the DeepSeek thinking format and reasoning replay", () => {
  const byId = new Map(fallbackModels().map((model) => [model.id, model]));
  assert.deepEqual(byId.get("deepseek-v4.1-flash")?.compat, {
    thinkingFormat: "deepseek",
    requiresReasoningContentOnAssistantMessages: true,
    maxTokensField: "max_completion_tokens",
  });
  assert.equal(byId.get("qwen3.8-max")?.compat, undefined);
});

test("toModels carries catalog metadata", () => {
  const models = toModels([{ id: "custom", name: "Custom", contextWindow: 8192, maxTokens: 1024 }]);
  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, "custom");
  assert.equal(models[0]?.name, "Custom");
  assert.equal(models[0]?.contextWindow, 8192);
  assert.equal(models[0]?.maxTokens, 1024);
  assert.deepEqual(models[0]?.input, ["text"]);
  assert.equal(models[0]?.compat, undefined);
});
