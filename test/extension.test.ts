import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import register from "../src/extension.ts";
import { FALLBACK_MODELS } from "../src/constants.ts";
import { setRequestImpl } from "../src/http.ts";

process.env.PI_CANNBOT_NO_FETCH_TRUST = "1";

interface Registered {
  id: string;
  config: any;
}

async function registered(): Promise<Registered> {
  const calls: Registered[] = [];
  const pi = {
    registerProvider: (id: string, config: unknown) => calls.push({ id, config }),
  };
  await register(pi as never);
  const call = calls[0];
  assert.ok(call !== undefined);
  return call;
}

function withoutTransport(t: TestContext): void {
  t.after(() => setRequestImpl(undefined));
}

test("registers the cannbot provider with OAuth and a fallback roster", async () => {
  const { id, config } = await registered();
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

test("modifyModels injects x-api-vkey from the stored credential", async () => {
  const { config } = await registered();
  const models = config.oauth.modifyModels(
    [{ id: "m", headers: { existing: "1" }, marker: true }],
    { refresh: "vk-1", access: "access", expires: 0 },
  );

  assert.equal(models[0].headers["x-api-vkey"], "vk-1");
  assert.equal(models[0].headers.existing, "1");
  assert.equal(models[0].marker, true);
});

test("refreshModels adopts the live catalog for an OAuth credential", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => ({
    status: 200,
    text: JSON.stringify({ models: [{ model: "live-model", title: "Live Model", status: 1, contextLength: 8192 }] }),
  }));

  const { config } = await registered();
  const models = await config.refreshModels({
    credential: { type: "oauth", access: "token", refresh: "vk", expires: 0 },
    signal: new AbortController().signal,
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, "live-model");
  assert.equal(models[0].contextWindow, 8192);
});

test("refreshModels keeps the fallback roster without a credential", async () => {
  const { config } = await registered();
  const models = await config.refreshModels({
    signal: new AbortController().signal,
  });
  assert.equal(models.length, FALLBACK_MODELS.length);
});

test("refreshModels keeps the fallback roster when the catalog fails", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => ({ status: 500, text: "nope" }));
  const { config } = await registered();
  const models = await config.refreshModels({
    credential: { type: "oauth", access: "token", refresh: "vk", expires: 0 },
    signal: new AbortController().signal,
  });
  assert.equal(models.length, FALLBACK_MODELS.length);
});
