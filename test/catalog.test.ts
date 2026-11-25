import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { fetchCatalog, normalizeRows } from "../src/catalog.ts";
import { CATALOG_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../src/constants.ts";
import { setRequestImpl, type HttpRequestOptions } from "../src/http.ts";

function withoutTransport(t: TestContext): void {
  t.after(() => setRequestImpl(undefined));
}

function jsonResponse(body: unknown, status = 200): { status: number; text: string } {
  return { status, text: JSON.stringify(body) };
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
  withoutTransport(t);
  let captured: HttpRequestOptions | undefined;
  setRequestImpl(async (options) => {
    captured = options;
    return jsonResponse({
      success: true,
      models: [
        { model: "deepseek-v4.1-flash", title: "DeepSeek-V4.1-Flash", status: 1, contextLength: 1_048_576 },
      ],
    });
  });

  const catalog = await fetchCatalog("the-token");

  assert.equal(captured?.url, CATALOG_URL);
  assert.equal(captured?.headers["authorization"], "Bearer the-token");
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
  withoutTransport(t);
  setRequestImpl(async () =>
    jsonResponse({
      data: {
        personalModels: [{ model: "personal", title: "Personal", contextLength: 4096 }],
        builtinModels: [
          { model: "personal", title: "Shadowed" },
          { model: "shared", title: "Shared", completionOptions: { maxTokens: 2048 } },
        ],
      },
    }));

  const catalog = await fetchCatalog("token");
  assert.deepEqual(
    catalog?.map((model) => model.id),
    ["personal", "shared"],
  );
  assert.equal(catalog?.[1]?.maxTokens, 2048);
});

test("fetchCatalog returns undefined instead of an empty roster", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => jsonResponse({ success: true, models: [{ model: "x", status: 0 }] }));
  assert.equal(await fetchCatalog("token"), undefined);
});

test("fetchCatalog treats an HTTP failure as no catalog", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => ({ status: 401, text: "nope" }));
  assert.equal(await fetchCatalog("token"), undefined);
});

test("fetchCatalog treats a transport failure as no catalog", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => {
    throw new Error("offline");
  });
  assert.equal(await fetchCatalog("token"), undefined);
});

test("fetchCatalog treats malformed JSON as no catalog", async (t) => {
  withoutTransport(t);
  setRequestImpl(async () => ({ status: 200, text: "<html>" }));
  assert.equal(await fetchCatalog("token"), undefined);
});
