import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import register from "../src/extension.ts";
import { FALLBACK_MODELS } from "../src/constants.ts";

interface Registered {
  id: string;
  config: any;
}

function registered(): Registered {
  const calls: Registered[] = [];
  const pi = {
    registerProvider: (id: string, config: unknown) => calls.push({ id, config }),
  };
  register(pi as never);
  const call = calls[0];
  assert.ok(call !== undefined);
  return call;
}

function withFetch(t: TestContext, impl: typeof fetch): void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

test("registers the cannbot provider with OAuth and a fallback roster", () => {
  const { id, config } = registered();
  assert.equal(id, "cannbot");
  assert.equal(config.name, "CANNBOT");
  assert.equal(config.baseUrl, "https://cannbot.hicann.cn/gateway/compatible-mode/v1");
  assert.equal(config.api, "openai-completions");
  assert.equal(config.models.length, FALLBACK_MODELS.length);
  assert.equal(config.oauth.name, "CANNBOT");
  for (const key of ["login", "refreshToken", "getApiKey", "modifyModels"]) {
    assert.equal(typeof config.oauth[key], "function");
  }
});

test("modifyModels injects x-api-vkey from the stored credential", () => {
  const { config } = registered();
  const models = config.oauth.modifyModels(
    [{ id: "m", headers: { existing: "1" }, marker: true }],
    { refresh: "vk-1", access: "access", expires: 0 },
  );

  assert.equal(models[0].headers["x-api-vkey"], "vk-1");
  assert.equal(models[0].headers.existing, "1");
  assert.equal(models[0].marker, true);
});

test("refreshModels adopts the live catalog for an OAuth credential", async (t) => {
  withFetch(
    t,
    (async () =>
      new Response(
        JSON.stringify({ models: [{ model: "live-model", title: "Live Model", status: 1, contextLength: 8192 }] }),
        { status: 200 },
      )) as typeof fetch,
  );

  const { config } = registered();
  const models = await config.refreshModels({
    credential: { type: "oauth", access: "token", refresh: "vk", expires: 0 },
    signal: new AbortController().signal,
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, "live-model");
  assert.equal(models[0].contextWindow, 8192);
});

test("refreshModels keeps the fallback roster without a credential", async () => {
  const { config } = registered();
  const models = await config.refreshModels({
    signal: new AbortController().signal,
  });
  assert.equal(models.length, FALLBACK_MODELS.length);
});

test("refreshModels keeps the fallback roster when the catalog fails", async (t) => {
  withFetch(t, (async () => new Response("nope", { status: 500 })) as typeof fetch);
  const { config } = registered();
  const models = await config.refreshModels({
    credential: { type: "oauth", access: "token", refresh: "vk", expires: 0 },
    signal: new AbortController().signal,
  });
  assert.equal(models.length, FALLBACK_MODELS.length);
});
