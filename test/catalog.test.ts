import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { fetchCatalog, normalizeRows } from "../src/catalog.ts";
import { CATALOG_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../src/constants.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withFetch(t: TestContext, impl: typeof fetch): void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

test("normalizeRows deduplicates, drops inactive rows, and fills defaults", () => {
  const models = normalizeRows([
    { model: "a", title: "A", status: 1, contextLength: 1000.9, completionOptions: { maxTokens: 10 } },
    { model: "a", title: "duplicate", status: 1, contextLength: 5 },
    { model: "b", status: 0 },
    { model: "", status: 1 },
    { model: "c", status: 1, contextLength: 0 },
  ]);

  assert.deepEqual(
    models.map((model) => model.id),
    ["a", "c"],
  );
  assert.equal(models[0]?.name, "A");
  assert.equal(models[0]?.contextWindow, 1000);
  assert.equal(models[0]?.maxTokens, 10);
  assert.equal(models[1]?.contextWindow, DEFAULT_CONTEXT_WINDOW);
  assert.equal(models[1]?.maxTokens, DEFAULT_MAX_TOKENS);
});

test("fetchCatalog authenticates with the access token and returns rows", async (t) => {
  let authorization: string | null = null;
  let url = "";
  withFetch(t, (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    authorization = new Headers(init?.headers).get("authorization");
    return jsonResponse({
      success: true,
      models: [
        { model: "deepseek-v4.1-flash", title: "DeepSeek-V4.1-Flash", status: 1, contextLength: 1_048_576 },
      ],
    });
  }) as typeof fetch);

  const catalog = await fetchCatalog("the-token");

  assert.equal(url, CATALOG_URL);
  assert.equal(authorization, "Bearer the-token");
  assert.deepEqual(catalog, [
    {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek-V4.1-Flash",
      contextWindow: 1_048_576,
      maxTokens: DEFAULT_MAX_TOKENS,
    },
  ]);
});

test("fetchCatalog reads the personal/builtin shape", async (t) => {
  withFetch(t, (async () =>
    jsonResponse({
      data: {
        personalModels: [{ model: "personal", title: "Personal", contextLength: 4096 }],
        builtinModels: [
          { model: "personal", title: "Shadowed" },
          { model: "shared", title: "Shared", completionOptions: { maxTokens: 2048 } },
        ],
      },
    })) as typeof fetch);

  const catalog = await fetchCatalog("token");
  assert.deepEqual(
    catalog?.map((model) => model.id),
    ["personal", "shared"],
  );
  assert.equal(catalog?.[1]?.maxTokens, 2048);
});

test("fetchCatalog returns undefined instead of an empty roster", async (t) => {
  withFetch(t, (async () => jsonResponse({ success: true, models: [{ model: "x", status: 0 }] })) as typeof fetch);
  assert.equal(await fetchCatalog("token"), undefined);
});

test("fetchCatalog treats an HTTP failure as no catalog", async (t) => {
  withFetch(t, (async () => new Response("nope", { status: 401 })) as typeof fetch);
  assert.equal(await fetchCatalog("token"), undefined);
});

test("fetchCatalog treats a network failure as no catalog", async (t) => {
  withFetch(t, (async () => {
    throw new Error("offline");
  }) as typeof fetch);
  assert.equal(await fetchCatalog("token"), undefined);
});
